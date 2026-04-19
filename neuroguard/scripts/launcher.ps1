# NeuroGuard — Unified Launcher
# Collector ve Server'ı aynı dizinde çalıştırır

$ErrorActionPreference = "SilentlyContinue"
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptDir = Join-Path $rootDir "scripts"
$dataDir = Join-Path $rootDir "data"

# Data klasörünü oluştur
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║         NEUROGUARD LAUNCHER            ║" -ForegroundColor Cyan
Write-Host "  ║   Root: $rootDir" -ForegroundColor Cyan
Write-Host "  ║   Data: $dataDir" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Collector'ı arka planda başlat
$collectorScript = Join-Path $scriptDir "collector.ps1"
Write-Host "[1] Collector baslatiliyor..." -ForegroundColor Yellow
$collectorJob = Start-Job -ScriptBlock {
    param($script, $data)
    & $script -DataDir $data
} -ArgumentList $collectorScript, $dataDir

Write-Host "[1] Collector PID: $($collectorJob.Id) - STARTED" -ForegroundColor Green

# Bekle ki ilk veri toplansın
Start-Sleep -Seconds 4

# Verilerin oluşup oluşmadığını kontrol et
$statsFile = Join-Path $dataDir "stats.json"
if (Test-Path $statsFile) {
    Write-Host "[OK] Veri dosyalari olusturuldu!" -ForegroundColor Green
} else {
    Write-Host "[!] Veri dosyalari henuz olusturulmadi, bekleniyor..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}

# Server'ı başlat
$serverScript = Join-Path $scriptDir "server.ps1"
Write-Host "[2] HTTP Server baslatiliyor..." -ForegroundColor Yellow
& $serverScript -RootDir $rootDir -DataDir $dataDir
