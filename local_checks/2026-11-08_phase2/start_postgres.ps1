$ErrorActionPreference = 'Stop'
$roundRoot = $PSScriptRoot
$pgRoot = [System.IO.Path]::GetFullPath((Join-Path $roundRoot '../2026-11-08_round1/postgres-portable/pgsql'))
$pgLink = Join-Path $env:TEMP 'agent-eval-round1-pg'
$pgData = Join-Path $env:TEMP 'agent-eval-round1-pgdata'

if (-not (Test-Path -LiteralPath (Join-Path $pgRoot 'bin/postgres.exe'))) {
  throw 'Missing isolated PostgreSQL binaries; see DEMO.md for the verified download sources.'
}
if (Test-Path -LiteralPath $pgLink) {
  $linkItem = Get-Item -LiteralPath $pgLink
  $actualTarget = [System.IO.Path]::GetFullPath([string]@($linkItem.Target)[0])
  if ($linkItem.LinkType -ne 'Junction' -or $actualTarget -ne $pgRoot) {
    throw "Existing temporary link is not this project's PostgreSQL: $pgLink"
  }
} else {
  New-Item -ItemType Junction -Path $pgLink -Target $pgRoot | Out-Null
}
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  & (Join-Path $pgLink 'bin/initdb.exe') -D $pgData -U postgres -A trust --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
}
& (Join-Path $pgLink 'bin/pg_ctl.exe') -D $pgData status
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $pgLink 'bin/pg_ctl.exe') -D $pgData -l (Join-Path $env:TEMP 'agent-eval-round1-postgres.log') -o '-h 127.0.0.1 -p 15433' -w start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL start failed' }
}
$env:DATABASE_URL = 'postgresql://postgres@127.0.0.1:15433/agent_eval_phase2'
& (Join-Path $pgLink 'bin/psql.exe') -h 127.0.0.1 -p 15433 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='agent_eval_phase2'" | Tee-Object -Variable exists | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the isolated cluster' }
if (-not $exists) {
  & (Join-Path $pgLink 'bin/createdb.exe') -h 127.0.0.1 -p 15433 -U postgres agent_eval_phase2
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the separate phase2 database' }
}
Push-Location $roundRoot
try {
  node migrate-real-pg.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Migration failed; inspect output, do not mark this passed.' }
} finally { Pop-Location }
