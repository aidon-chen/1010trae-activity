param([Parameter(Mandatory = $true)][string]$Backup)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $projectRoot 'data'
$sourcePath = (Resolve-Path -LiteralPath $Backup).Path
$nodeCommand = Get-Command node -ErrorAction Stop
& $nodeCommand.Source (Join-Path $PSScriptRoot 'validate-backup.cjs') $sourcePath
if ($LASTEXITCODE -ne 0) { throw '备份不完整或不是此服务的数据库，未恢复。' }
& (Join-Path $PSScriptRoot 'Stop-Local.ps1')
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5173/api/health' -TimeoutSec 2
  if ($health.service -eq 'trae-local-lottery') { throw '前台服务仍在运行，请先在原终端停止。' }
} catch {
  if ($_.Exception.Message -like '*前台服务仍在运行*') { throw }
}
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$dbPath = Join-Path $dataRoot 'lottery.sqlite'
if ($sourcePath -eq $dbPath) { throw '不能用正在恢复的目标文件作为备份源。' }
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$savedPath = Join-Path $dataRoot ('before-restore-' + $timestamp)
New-Item -ItemType Directory -Path $savedPath | Out-Null
foreach ($name in @('lottery.sqlite', 'lottery.sqlite-wal', 'lottery.sqlite-shm')) {
  $existingPath = Join-Path $dataRoot $name
  if (Test-Path -LiteralPath $existingPath) { Move-Item -LiteralPath $existingPath -Destination (Join-Path $savedPath $name) }
}
Copy-Item -LiteralPath $sourcePath -Destination $dbPath
Write-Output ('已恢复备份；恢复前数据库保留于 ' + $savedPath)
& (Join-Path $PSScriptRoot 'Start-Local.ps1')
