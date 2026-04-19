@echo off
chcp 65001 >nul 2>&1
title NeuroGuard - PC Yonetim Sistemi
color 0B

echo.
echo   =====================================================
echo   =                                                   =
echo   =                 NEUROGUARD v2.0                   =
echo   =      PC Yonetim ^& Tehdit Tespit Sistemi          =
echo   =                  By ErkanTRG                      =
echo   =====================================================
echo.

:: Dizin belirleme
set "ROOT=%~dp0"
set "SCRIPTS=%ROOT%scripts\"
set "DATA=%ROOT%data\"

:: Data klasoru
if not exist "%DATA%" mkdir "%DATA%"

echo   [1/3] Veri toplayici baslatiliyor...
start "NeuroGuard Collector" /MIN powershell -ExecutionPolicy Bypass -NoProfile -NoExit -Command "& '%SCRIPTS%collector.ps1' -DataDir '%DATA%' -IntervalSeconds 3"

:: Ilk veri toplanana kadar bekle
echo   [2/3] Ilk veriler toplaniyor, lutfen bekleyin...
timeout /t 6 /nobreak >nul

echo   [3/3] HTTP Sunucu baslatiliyor...
start "NeuroGuard Server" /MIN node "%SCRIPTS%server.js"

:: Sunucunun hazir olmasini bekle
timeout /t 2 /nobreak >nul

echo.
echo   ====================================================
echo   Dashboard adresi: http://localhost:8777
echo   ====================================================
echo.
echo   Tarayici aciliyor...
start "" http://localhost:8777

echo.
echo   NeuroGuard calisiyor!
echo   Bu pencereyi kapatmak servisleri DURDURMAZ.
echo   Durdurmak icin Gorev Yoneticisi'nden:
echo     - "NeuroGuard Collector" (powershell) penceresini kapatin
echo     - "NeuroGuard Server" (node) penceresini kapatin
echo.
pause
