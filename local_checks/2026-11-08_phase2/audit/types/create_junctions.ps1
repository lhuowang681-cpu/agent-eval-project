$ErrorActionPreference = 'Stop'
$auditRoot = $PSScriptRoot
$completed = 0
foreach ($manifestName in @('dependency-links.json', 'snapshot-dependency-links.json')) {
  $links = Get-Content -LiteralPath (Join-Path $auditRoot $manifestName) -Raw | ConvertFrom-Json
  foreach ($link in $links) {
    $resolvedOutput = [System.IO.Path]::GetFullPath($link.path)
    if (-not $resolvedOutput.StartsWith($auditRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Dependency output escaped audit directory"
    }
    if (-not (Test-Path -LiteralPath $resolvedOutput)) {
      New-Item -ItemType Junction -Path $resolvedOutput -Target $link.target | Out-Null
    }
    $completed++
  }
}
Write-Output "Prepared $completed dependency junctions inside isolated audit copies"
