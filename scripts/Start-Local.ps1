$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw '需要 Node.js 24.15 或更新的 24.x，请先安装或加入 PATH。' }
& $nodeCommand.Source (Join-Path $PSScriptRoot 'service.cjs') start
if ($LASTEXITCODE -ne 0) { throw '服务启动未成功，请检查 data/service.log。' }
