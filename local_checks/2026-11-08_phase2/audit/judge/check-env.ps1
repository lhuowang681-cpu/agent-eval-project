# Existence only: do not fetch or print credential values or read .env contents.
$names = @('OPENAI_API_KEY','OPENAI_PROXY_URL','OPENAI_BASE_URL','AIHUBMIX_API_KEY','AZURE_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY','DEEPSEEK_API_KEY','OPENROUTER_API_KEY')
$records = foreach ($name in $names) {
  [pscustomobject]@{name=$name; processVariableExists=(Test-Path -LiteralPath "Env:$name")}
}
$result = [pscustomobject]@{
  checkedAt=(Get-Date -Format o)
  scope='Current audit process only. No values read; no .env or database credential lookup; no paid request.'
  variables=@($records)
  availability='Presence cannot prove validity, non-placeholder status, provider permissions, configured DB credentials or quota.'
}
$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'env-presence.json') -Encoding utf8
$records | Format-Table -AutoSize
