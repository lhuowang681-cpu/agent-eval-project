$ErrorActionPreference='Stop'
$binary=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../2026-11-08_round1/postgres-portable/pgsql'))
$link=Join-Path $env:TEMP 'vnext-acceptance-pg-bin'
$data=Join-Path $env:TEMP 'vnext-acceptance-pg-data'
if (!(Test-Path -LiteralPath "$binary/bin/postgres.exe")) {throw 'PostgreSQL binary unavailable'}
if (Test-Path -LiteralPath $link) {
 $item=Get-Item -LiteralPath $link
 if ($item.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath([string]@($item.Target)[0]) -ne $binary) {throw 'Unexpected existing path'}
} else {New-Item -ItemType Junction -Path $link -Target $binary | Out-Null}
if (!(Test-Path -LiteralPath "$data/PG_VERSION")) {
 & "$link/bin/initdb.exe" -D $data -U postgres -A trust --encoding=UTF8 --locale=C
 if ($LASTEXITCODE) {throw 'initdb failed'}
}
& "$link/bin/pg_ctl.exe" -D $data status
if ($LASTEXITCODE) {
 $controller=Start-Process -FilePath "$link/bin/pg_ctl.exe" -ArgumentList @('-D',$data,'-l',"$data/server.log",'-o','"-h 127.0.0.1 -p 15435"','-w','start') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$data/controller-out.log" -RedirectStandardError "$data/controller-err.log"
 if (!$controller.WaitForExit(30000)) {throw 'PostgreSQL controller deadline exceeded'}
 if ($controller.ExitCode -ne 0) {throw 'PostgreSQL start failed; inspect controller log'}
}
$found=& "$link/bin/psql.exe" -h 127.0.0.1 -p 15435 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='vnext_acceptance_20261114'"
if (!$found) {& "$link/bin/createdb.exe" -h 127.0.0.1 -p 15435 -U postgres vnext_acceptance_20261114; if ($LASTEXITCODE) {throw 'createdb failed'}}
Write-Output 'Isolated PostgreSQL ready on 127.0.0.1:15435 / vnext_acceptance_20261114'
