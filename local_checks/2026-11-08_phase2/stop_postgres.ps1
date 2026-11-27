$ErrorActionPreference = 'Stop'
$pgLink = Join-Path $env:TEMP 'agent-eval-round1-pg'
$pgData = Join-Path $env:TEMP 'agent-eval-round1-pgdata'
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) { throw 'This acceptance database has not been initialized.' }
& (Join-Path $pgLink 'bin/pg_ctl.exe') -D $pgData -m fast -w stop
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL stop failed' }
