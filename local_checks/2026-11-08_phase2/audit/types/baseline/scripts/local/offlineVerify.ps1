<#
.SYNOPSIS
  检查点 1：物理断网复跑。自包含 —— 启动后自己等断网、自己跑测试、自己复查。

.DESCRIPTION
  为什么要做成自包含：断网会同时切断与模型 API 的连接，所以不能「人断网 + 助手实时驱动」。
  本脚本的流程是：

    阶段 A  等待网络真正断开（每 5 秒探一次公网，最多等 10 分钟）
    阶段 B  断网确认后，跑完整套离线验证
    阶段 C  复查网络仍处于断开状态（防止中途自动重连，那会让整轮结论失效）
    全程写日志到 plan\offline-verify.log

  你要做的只有两件事：运行本脚本 → 看到「等待断网」提示后禁用 WLAN。
  跑完后恢复网络，把日志给助手看。

.NOTES
  ⚠️ 只禁用物理网卡（WLAN）。**不要禁用 `vEthernet (WSL ...)`** ——
     那是 Hyper-V 虚拟网卡，Docker Desktop 的 lobe-postgres 端口转发依赖它，
     禁了会连带把数据库打掉，测出来的失败与「是否出网」无关。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\local\offlineVerify.ps1
#>

param(
  [int]$WaitMinutes = 10,
  [string]$LogPath = "D:\somethingelse-main\somethingelse-main\codinganalysis\plan\offline-verify.log"
)

$ErrorActionPreference = 'Continue'
$repo = "D:\somethingelse-main\somethingelse-main\codinganalysis\lobehub"
$env:PATH = "$env:LOCALAPPDATA\npm-global;$env:PATH"
$env:NO_PROXY = "localhost,127.0.0.1"

function Log {
  param([string]$Text)
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Text
  Write-Host $line
  Add-Content -Path $LogPath -Value $line -Encoding utf8
}

# 判断「是否还有出网能力」。
#
# ⚠️ 不能用 Test-NetConnection 直连公网 IP：本机所有出网都走系统代理
# （127.0.0.1:7897），再叠加 Array Networks VPN 适配器，**裸 TCP 直连 1.1.1.1:443
# 在联网状态下也是不通的**（实测超时 42 秒）。用它做判据会在没断网时就判定「已断网」，
# 让整轮检查点变成假通过 —— 比不测更糟。
#
# 改用确定性判据：是否还有**物理网卡处于 Up**。这恰好就是「物理断网」的定义，
# 且不受代理 / VPN / DNS 的干扰。
# 虚拟网卡（Hyper-V / vEthernet / WSL / Loopback / VMware / VirtualBox）必须排除 ——
# Docker 的 lobe-postgres 端口转发依赖 vEthernet (WSL)，它全程应保持 Up。
function Get-PhysicalUpAdapters {
  Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
    $_.Status -eq 'Up' -and
    $_.InterfaceDescription -notmatch 'Hyper-V|vEthernet|WSL|Loopback|VMware|VirtualBox|TAP-Windows'
  }
}

function Test-Internet {
  $up = @(Get-PhysicalUpAdapters)
  return ($up.Count -gt 0)
}

function Test-LocalServices {
  $ports = @{ 3010 = 'Next 后端'; 5432 = 'PostgreSQL'; 6379 = 'Redis'; 8088 = 'Mock LLM'; 8089 = 'Mock Services' }
  $allUp = $true
  foreach ($p in $ports.Keys | Sort-Object) {
    $up = [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
    Log ("  {0,-5} {1,-16} {2}" -f $p, $ports[$p], $(if ($up) { 'LISTEN' } else { '❌ 不在监听' }))
    if (-not $up) { $allUp = $false }
  }
  return $allUp
}

Set-Content -Path $LogPath -Value "" -Encoding utf8
Log "══════════════════════════════════════════════════════════"
Log "检查点 1 · 物理断网复跑"
Log "══════════════════════════════════════════════════════════"

Log ""
Log "▶ 阶段 0：断网前基线"
Log "本地服务："
$baseOk = Test-LocalServices
if (-not $baseOk) {
  Log ""
  Log "❌ 有本地服务没起来，先补齐再跑，否则失败原因会和「是否出网」混在一起。"
  exit 1
}

Log ""
Log "物理网卡状态（断网前）："
$before = @(Get-PhysicalUpAdapters)
if ($before.Count -eq 0) {
  Log "  ❌ 没有任何物理网卡处于 Up —— 你已经断网了。"
  Log "     请先启用网卡、确认基线，再重跑本脚本，否则「断网前 vs 断网后」的对照不成立。"
  exit 1
}
$before | ForEach-Object { Log ("  Up: {0}  ({1})" -f $_.Name, $_.InterfaceDescription) }
Log "虚拟网卡（应全程保持 Up，不要禁用）："
Get-NetAdapter -ErrorAction SilentlyContinue |
  Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -match 'Hyper-V|vEthernet|WSL' } |
  ForEach-Object { Log ("  Up: {0}  ({1})" -f $_.Name, $_.InterfaceDescription) }

Log ""
Log "══════════════════════════════════════════════════════════"
Log "▶ 请现在禁用 WLAN"
Log ""
Log "   设置 → 网络和 Internet → 高级网络设置 → WLAN → 禁用"
Log "   或右键开始 → 网络连接 → 找到 WLAN → 禁用"
Log ""
Log "   ⚠️ 只禁 WLAN。不要动 vEthernet (WSL ...)，那是 Docker 的虚拟网卡。"
Log "══════════════════════════════════════════════════════════"

$deadline = (Get-Date).AddMinutes($WaitMinutes)
$offline = $false
while ((Get-Date) -lt $deadline) {
  if (-not (Test-Internet)) {
    # 连续两次都为空才算数，避免网卡切换瞬间被误判
    Start-Sleep -Seconds 3
    if (-not (Test-Internet)) { $offline = $true; break }
  }
  Start-Sleep -Seconds 3
}

if (-not $offline) {
  Log ""
  Log "❌ 等待 $WaitMinutes 分钟仍有物理网卡处于 Up，未检测到断网。已放弃。"
  @(Get-PhysicalUpAdapters) | ForEach-Object { Log ("   仍 Up: {0}" -f $_.Name) }
  exit 1
}

Log ""
Log "✅ 已确认断网：无任何物理网卡处于 Up。"
# 同时确认 Docker 依赖的虚拟网卡没被误禁 —— 否则数据库会挂，失败原因就和出网无关了
$vsw = @(Get-NetAdapter -ErrorAction SilentlyContinue |
  Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -match 'Hyper-V|vEthernet|WSL' })
Log ("   vEthernet(WSL) 仍在: {0}" -f $(if ($vsw.Count -gt 0) { '✅ 是' } else { '⚠️ 否 —— 若 PostgreSQL 随后失败，是误禁虚拟网卡所致，非出网问题' }))
Log ""

Log "▶ 阶段 1：断网后本地服务仍在"
$stillUp = Test-LocalServices
Log ("本地服务全部存活: {0}" -f $(if ($stillUp) { '✅ 是' } else { '❌ 否 —— 有服务因断网挂了，需排查' }))

Set-Location $repo

$suites = @(
  @{ Name = '冒烟（检查点 5-10）'; Cmd = 'tools/api-test/smoke.ts' },
  @{ Name = '步锁 / 签名（待补测 #1）'; Cmd = 'tools/api-test/step-lock.ts' },
  @{ Name = 'BM25（待补测 #6）'; Cmd = 'tools/api-test/bm25.ts' },
  @{ Name = 'F8 子任务'; Cmd = 'tools/api-test/f8-subagent.ts' },
  @{ Name = 'F9 群体编排'; Cmd = 'tools/api-test/f9-group.ts' },
  @{ Name = 'F13 接入通道'; Cmd = 'tools/api-test/f13-channels.ts' },
  @{ Name = 'F14/F15 可观测性'; Cmd = 'tools/api-test/f14-observability.ts' }
)

Log ""
Log "▶ 阶段 2：断网状态下跑测试"
foreach ($s in $suites) {
  Log ""
  Log ("──── {0} ────" -f $s.Name)
  $out = & bun run tsx $s.Cmd 2>&1 | Out-String
  $clean = ($out -replace '\x1b\[[0-9;]*[A-Za-z]', '')
  # 只把结果行摘进日志，全文另存
  ($clean -split "`n") | Where-Object { $_ -match '✅|❌|通过 \d+ / 失败' } | ForEach-Object { Log ("  " + $_.Trim()) }
  Add-Content -Path "$LogPath.full" -Value "`n########## $($s.Name) ##########`n$clean" -Encoding utf8
}

Log ""
Log "▶ 阶段 3：连接审计（断网下应为空，但仍记录）"
$pids = Get-Process node, bun, electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
Log ("监控进程数: {0}" -f $pids.Count)
$external = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
  Where-Object { $pids -contains $_.OwningProcess -and $_.RemoteAddress -notmatch '^(127\.|::1$|0\.0\.0\.0)' }
if ($external) {
  Log "❌ 发现非回环连接："
  $external | ForEach-Object { Log ("   PID {0} → {1}:{2}" -f $_.OwningProcess, $_.RemoteAddress, $_.RemotePort) }
} else {
  Log "✅ 无非回环出站连接"
}

Log ""
Log "▶ 阶段 4：复查全程断开（防止 Windows 自动重连）"
$stillOffline = -not (Test-Internet)
Log ("仍无物理网卡 Up: {0}" -f $(if ($stillOffline) { '✅ 是 —— 整轮结论有效' } else { '❌ 否 —— 中途重连了，本轮结论作废，需重跑' }))
if (-not $stillOffline) {
  @(Get-PhysicalUpAdapters) | ForEach-Object { Log ("   重新 Up: {0}" -f $_.Name) }
}

Log ""
Log "══════════════════════════════════════════════════════════"
Log "跑完了。现在可以重新启用 WLAN。"
Log "完整输出: $LogPath.full"
Log "══════════════════════════════════════════════════════════"
