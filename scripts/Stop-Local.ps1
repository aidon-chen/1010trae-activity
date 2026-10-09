$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw '找不到 Node.js。' }
& $nodeCommand.Source (Join-Path $PSScriptRoot 'service.cjs') stop
if ($LASTEXITCODE -ne 0) { throw '服务停止未确认，请检查 data/service.log。' }
