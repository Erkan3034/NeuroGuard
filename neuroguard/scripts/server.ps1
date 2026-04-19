# NeuroGuard — HTTP API Server
# Dashboard dosyalarını ve API endpoint'lerini sunar
# Port: 8777

param(
    [int]$Port = 8777,
    [string]$RootDir = (Split-Path $PSScriptRoot -Parent),
    [string]$DataDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "data")
)

# Data klasörünü oluştur
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# Action log dosyası
$ActionLogFile = Join-Path $DataDir "action_log.json"
if (-not (Test-Path $ActionLogFile)) {
    "[]" | Set-Content -Path $ActionLogFile -Encoding UTF8
}

# ─── MIME Types ───
$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".ico"  = "image/x-icon"
    ".svg"  = "image/svg+xml"
    ".woff2" = "font/woff2"
    ".woff" = "font/woff"
}

# ─── ACTION: Process Sonlandır ───
function Invoke-KillProcess {
    param([int]$ProcessId, [string]$ProcessName)
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        return @{ success = $true; message = "'$ProcessName' (PID: $ProcessId) basariyla sonlandirildi." }
    } catch {
        return @{ success = $false; message = "Hata: $($_.Exception.Message)" }
    }
}

# ─── ACTION: Process Askıya Al ───
function Invoke-SuspendProcess {
    param([int]$ProcessId, [string]$ProcessName)
    try {
        # Windows'ta process suspend için debug API gerekir, basit bir yaklaşım
        $result = & taskkill /PID $ProcessId /F 2>&1
        return @{ success = $true; message = "'$ProcessName' (PID: $ProcessId) durduruldu." }
    } catch {
        return @{ success = $false; message = "Hata: $($_.Exception.Message)" }
    }
}

# ─── ACTION: Startup Devre Dışı ───
function Invoke-DisableStartup {
    param([string]$Name, [string]$Location)
    try {
        if ($Location -eq "Registry (Current User)") {
            Remove-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name $Name -ErrorAction Stop
            return @{ success = $true; message = "'$Name' baslangic programi devre disi birakildi (Current User)." }
        }
        elseif ($Location -eq "Registry (Local Machine)") {
            Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name $Name -ErrorAction Stop
            return @{ success = $true; message = "'$Name' baslangic programi devre disi birakildi (Local Machine)." }
        }
        elseif ($Location -eq "Startup Folder") {
            $startupFolder = [Environment]::GetFolderPath("Startup")
            $files = Get-ChildItem -Path $startupFolder -Filter "$Name.*" -ErrorAction SilentlyContinue
            foreach ($f in $files) { Remove-Item -Path $f.FullName -Force }
            return @{ success = $true; message = "'$Name' baslangic klasorunden kaldirildi." }
        }
        return @{ success = $false; message = "Bilinmeyen konum: $Location" }
    } catch {
        return @{ success = $false; message = "Hata: $($_.Exception.Message)" }
    }
}

# ─── ACTION: Temp Temizle ───
function Invoke-CleanTemp {
    try {
        $tempPath = $env:TEMP
        $before = (Get-ChildItem -Path $tempPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
        Get-ChildItem -Path $tempPath -Recurse -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | Remove-Item -Force -ErrorAction SilentlyContinue
        $after = (Get-ChildItem -Path $tempPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
        $cleaned = [math]::Round($before - $after, 2)
        return @{ success = $true; message = "Gecici dosylar temizlendi. $cleaned MB serbest birakildi." }
    } catch {
        return @{ success = $false; message = "Hata: $($_.Exception.Message)" }
    }
}

# ─── Log Action ───
function Write-ActionLog {
    param([string]$Action, [string]$Target, [string]$Result, [bool]$Success)
    try {
        $log = @()
        if (Test-Path $ActionLogFile) {
            $content = Get-Content -Path $ActionLogFile -Raw -ErrorAction SilentlyContinue
            if ($content) {
                $log = $content | ConvertFrom-Json -ErrorAction SilentlyContinue
                if (-not $log) { $log = @() }
            }
        }
        $entry = @{
            timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            action    = $Action
            target    = $Target
            result    = $Result
            success   = $Success
        }
        $log = @($entry) + @($log)
        if ($log.Count -gt 100) { $log = $log[0..99] }
        $log | ConvertTo-Json -Depth 3 -Compress | Set-Content -Path $ActionLogFile -Encoding UTF8 -Force
    } catch {}
}

# ═══════════════════════════════════════════
# HTTP SERVER
# ═══════════════════════════════════════════
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

try {
    $listener.Start()
} catch {
    Write-Host "[ERROR] Port $Port kullanimda. Farkli bir port deneyin." -ForegroundColor Red
    exit 1
}

Write-Host "╔═══════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║      NEUROGUARD HTTP SERVER               ║" -ForegroundColor Magenta
Write-Host "║      http://localhost:$Port                ║" -ForegroundColor Magenta
Write-Host "║      Ctrl+C ile durdurun                  ║" -ForegroundColor Magenta
Write-Host "╚═══════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        # CORS headers
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        $response.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")
        
        $path = $request.Url.LocalPath
        $method = $request.HttpMethod
        
        # OPTIONS preflight
        if ($method -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }
        
        $responseBody = ""
        $contentType = "text/html; charset=utf-8"
        $statusCode = 200
        
        # ─── API ROUTES ───
        if ($path -eq "/api/stats") {
            $contentType = "application/json; charset=utf-8"
            $filePath = Join-Path $DataDir "stats.json"
            if (Test-Path $filePath) {
                $responseBody = Get-Content -Path $filePath -Raw -Encoding UTF8
            } else {
                $responseBody = '{"error":"no data yet"}'
            }
        }
        elseif ($path -eq "/api/processes") {
            $contentType = "application/json; charset=utf-8"
            $filePath = Join-Path $DataDir "processes.json"
            if (Test-Path $filePath) {
                $responseBody = Get-Content -Path $filePath -Raw -Encoding UTF8
            } else {
                $responseBody = '[]'
            }
        }
        elseif ($path -eq "/api/threats") {
            $contentType = "application/json; charset=utf-8"
            $filePath = Join-Path $DataDir "threats.json"
            if (Test-Path $filePath) {
                $responseBody = Get-Content -Path $filePath -Raw -Encoding UTF8
            } else {
                $responseBody = '[]'
            }
        }
        elseif ($path -eq "/api/startup") {
            $contentType = "application/json; charset=utf-8"
            $filePath = Join-Path $DataDir "startup.json"
            if (Test-Path $filePath) {
                $responseBody = Get-Content -Path $filePath -Raw -Encoding UTF8
            } else {
                $responseBody = '[]'
            }
        }
        elseif ($path -eq "/api/actionlog") {
            $contentType = "application/json; charset=utf-8"
            if (Test-Path $ActionLogFile) {
                $responseBody = Get-Content -Path $ActionLogFile -Raw -Encoding UTF8
            } else {
                $responseBody = '[]'
            }
        }
        elseif ($path -eq "/api/action" -and $method -eq "POST") {
            $contentType = "application/json; charset=utf-8"
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            try {
                $action = $body | ConvertFrom-Json
                $result = @{ success = $false; message = "Bilinmeyen islem" }
                
                switch ($action.type) {
                    "kill" {
                        $result = Invoke-KillProcess -ProcessId $action.pid -ProcessName $action.name
                        Write-ActionLog -Action "Process Sonlandirma" -Target "$($action.name) (PID: $($action.pid))" -Result $result.message -Success $result.success
                    }
                    "suspend" {
                        $result = Invoke-SuspendProcess -ProcessId $action.pid -ProcessName $action.name
                        Write-ActionLog -Action "Process Durdurma" -Target "$($action.name) (PID: $($action.pid))" -Result $result.message -Success $result.success
                    }
                    "disable_startup" {
                        $result = Invoke-DisableStartup -Name $action.name -Location $action.location
                        Write-ActionLog -Action "Startup Devre Disi" -Target $action.name -Result $result.message -Success $result.success
                    }
                    "clean_temp" {
                        $result = Invoke-CleanTemp
                        Write-ActionLog -Action "Temp Temizleme" -Target "TEMP klasoru" -Result $result.message -Success $result.success
                    }
                }
                
                $responseBody = $result | ConvertTo-Json -Compress
                Write-Host "[ACTION] $($action.type) -> $($result.message)" -ForegroundColor $(if ($result.success) { "Green" } else { "Red" })
            } catch {
                $responseBody = '{"success":false,"message":"Gecersiz istek"}'
                $statusCode = 400
            }
        }
        # ─── STATIC FILES ───
        else {
            if ($path -eq "/" -or $path -eq "") { $path = "/index.html" }
            
            $filePath = Join-Path $RootDir ($path.TrimStart("/").Replace("/", "\"))
            
            if (Test-Path $filePath) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
                
                if ($ext -in @(".html", ".css", ".js", ".json", ".svg")) {
                    $responseBody = Get-Content -Path $filePath -Raw -Encoding UTF8
                } else {
                    # Binary dosya
                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    $response.ContentType = $contentType
                    $response.StatusCode = 200
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
            } else {
                $statusCode = 404
                $responseBody = "<h1>404 - Not Found</h1><p>$path bulunamadi</p>"
            }
        }
        
        # Response gönder
        $response.ContentType = $contentType
        $response.StatusCode = $statusCode
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($responseBody)
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()
        
        # Log (only non-data requests)
        if ($path -notlike "/api/*" -and $path -notlike "*.js" -and $path -notlike "*.css") {
            Write-Host "[${method}] $path -> $statusCode" -ForegroundColor DarkGray
        }
        
    } catch {
        if ($_.Exception.Message -notlike "*thread*") {
            Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}
