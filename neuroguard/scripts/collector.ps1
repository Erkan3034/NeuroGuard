# NeuroGuard — Enhanced System Data Collector v2.0
# Büyük dosya tarama, sistem bilgisi, ağ bağlantıları eklendi

param(
    [int]$IntervalSeconds = 3,
    [string]$DataDir = ""
)

$ErrorActionPreference = "SilentlyContinue"

# DataDir yoksa script dizininden bir üst + data
if (-not $DataDir -or $DataDir -eq "") {
    if ($PSScriptRoot) {
        $DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) "data"
    } else {
        $DataDir = Join-Path $PWD "data"
    }
}

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

Write-Host "NEUROGUARD COLLECTOR v2.0 STARTED" -ForegroundColor Cyan
Write-Host "DataDir: $DataDir" -ForegroundColor Gray
Write-Host "Interval: ${IntervalSeconds}s" -ForegroundColor Gray
Write-Host "---" -ForegroundColor DarkGray

# ── SYSTEM INFO (sabit - sadece başlangıçta topla) ──
Write-Host "[INIT] Sistem bilgileri toplaniyor..." -ForegroundColor Yellow
$sysInfo = [PSCustomObject]@{ os=""; cpuName=""; cpuCores=0; cpuThreads=0; gpuName=""; ramSlots=@(); biosVersion=""; motherboard="" }
try {
    $osInfo = Get-CimInstance Win32_OperatingSystem
    $cpuInfo = Get-CimInstance Win32_Processor
    $gpuInfo = Get-CimInstance Win32_VideoController | Select-Object -First 1
    $ramSticks = Get-CimInstance Win32_PhysicalMemory
    $bios = Get-CimInstance Win32_BIOS
    $board = Get-CimInstance Win32_BaseBoard

    $ramSlotArr = @()
    $ramSticks | ForEach-Object {
        $ramSlotArr += [PSCustomObject]@{
            sizeMB = [math]::Round($_.Capacity / 1MB, 0)
            speed = $_.Speed
            manufacturer = $_.Manufacturer
            partNumber = ($_.PartNumber -replace '\s+$','')
            type = switch ($_.SMBIOSMemoryType) { 26 { "DDR4" }; 34 { "DDR5" }; default { "DDR" } }
        }
    }

    $sysInfo = [PSCustomObject]@{
        os = "$($osInfo.Caption) $($osInfo.Version) Build $($osInfo.BuildNumber)"
        cpuName = $cpuInfo[0].Name.Trim()
        cpuCores = $cpuInfo[0].NumberOfCores
        cpuThreads = $cpuInfo[0].NumberOfLogicalProcessors
        cpuMaxMHz = $cpuInfo[0].MaxClockSpeed
        gpuName = $gpuInfo.Name
        gpuDriverVersion = $gpuInfo.DriverVersion
        gpuRAM_MB = [math]::Round($gpuInfo.AdapterRAM / 1MB, 0)
        ramSlots = $ramSlotArr
        ramTotalSlots = (Get-CimInstance Win32_PhysicalMemoryArray).MemoryDevices
        biosVersion = "$($bios.Manufacturer) $($bios.SMBIOSBIOSVersion)"
        motherboard = "$($board.Manufacturer) $($board.Product)"
        computerName = $env:COMPUTERNAME
        userName = $env:USERNAME
    }
} catch {}
try { ($sysInfo | ConvertTo-Json -Depth 4 -Compress) | Out-File (Join-Path $DataDir "sysinfo.json") -Encoding utf8 -Force } catch {}
Write-Host "[INIT] Sistem bilgileri kaydedildi" -ForegroundColor Green

# ── LARGE FILE SCAN (ayrı döngü sayacı) ──
$largeFileScanCounter = 0
$largeFileScanInterval = 20  # her 60 saniyede bir (20 x 3s)

function Scan-LargeFiles {
    param([string]$OutPath)
    Write-Host "[SCAN] Buyuk dosya taramasi baslatildi..." -ForegroundColor Yellow
    $files = @()
    $drives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
    foreach ($drv in $drives) {
        $driveLetter = $drv.DeviceID + "\"
        try {
            # Kullanıcı profili, Desktop, Downloads, Documents, programlar
            $scanPaths = @(
                (Join-Path $env:USERPROFILE "Downloads"),
                (Join-Path $env:USERPROFILE "Documents"),
                (Join-Path $env:USERPROFILE "Desktop"),
                (Join-Path $env:USERPROFILE "Videos"),
                (Join-Path $env:USERPROFILE "Music"),
                (Join-Path $env:USERPROFILE "Pictures"),
                (Join-Path $env:USERPROFILE "OneDrive*"),
                "$($driveLetter)Program Files",
                "$($driveLetter)Program Files (x86)",
                "$($driveLetter)Games",
                "$($driveLetter)Users\$env:USERNAME\AppData\Local",
                "$env:TEMP"
            )

            foreach ($sp in $scanPaths) {
                if (Test-Path $sp) {
                    Get-ChildItem -Path $sp -Recurse -File -ErrorAction SilentlyContinue |
                        Where-Object { $_.Length -gt 50MB } |
                        ForEach-Object {
                            $sizeMB = [math]::Round($_.Length / 1MB, 2)
                            $sizeGB = [math]::Round($_.Length / 1GB, 3)
                            $ext = $_.Extension.ToLower()
                            $category = switch -Regex ($ext) {
                                '\.(mp4|mkv|avi|mov|wmv|flv|webm)' { "Video" }
                                '\.(mp3|wav|flac|aac|ogg|wma)' { "Ses" }
                                '\.(jpg|jpeg|png|gif|bmp|tiff|raw|psd|svg)' { "Gorsel" }
                                '\.(zip|rar|7z|tar|gz|bz2)' { "Arsiv" }
                                '\.(iso|img|vhd|vmdk)' { "Disk Imaji" }
                                '\.(exe|msi|appx|msix)' { "Program" }
                                '\.(dll|sys|drv)' { "Sistem" }
                                '\.(log|txt|csv)' { "Log/Metin" }
                                '\.(pdf|doc|docx|xls|xlsx|ppt|pptx)' { "Belge" }
                                '\.(unitypackage|asset|prefab)' { "Unity" }
                                '\.(apk|aab)' { "Android" }
                                default { "Diger" }
                            }

                            $files += [PSCustomObject]@{
                                name = $_.Name
                                path = $_.FullName
                                directory = $_.DirectoryName
                                sizeMB = $sizeMB
                                sizeGB = $sizeGB
                                extension = $ext
                                category = $category
                                lastModified = $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
                                created = $_.CreationTime.ToString("yyyy-MM-dd HH:mm")
                            }
                        }
                }
            }
        } catch {}
    }

    # En büyükten küçüğe sırala, ilk 200
    $files = $files | Sort-Object sizeMB -Descending | Select-Object -First 200

    # Kategori summary
    $catSummary = @()
    $files | Group-Object category | ForEach-Object {
        $totalMB = ($_.Group | Measure-Object sizeMB -Sum).Sum
        $catSummary += [PSCustomObject]@{
            category = $_.Name
            count = $_.Count
            totalMB = [math]::Round($totalMB, 1)
            totalGB = [math]::Round($totalMB / 1024, 2)
        }
    }
    $catSummary = $catSummary | Sort-Object totalMB -Descending

    $result = [PSCustomObject]@{
        scanTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        totalFiles = $files.Count
        totalSizeMB = [math]::Round(($files | Measure-Object sizeMB -Sum).Sum, 1)
        totalSizeGB = [math]::Round(($files | Measure-Object sizeMB -Sum).Sum / 1024, 2)
        categories = $catSummary
        files = $files
    }

    try { ($result | ConvertTo-Json -Depth 4 -Compress) | Out-File $OutPath -Encoding utf8 -Force } catch {}
    Write-Host "[SCAN] $($files.Count) buyuk dosya bulundu ($(([math]::Round(($files | Measure-Object sizeMB -Sum).Sum / 1024, 1))) GB)" -ForegroundColor Green
}

# İlk başta büyük dosya taraması yap
Scan-LargeFiles -OutPath (Join-Path $DataDir "largefiles.json")

# ═══ ANA DÖNGÜ ═══
while ($true) {
    try {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        
        # ── CPU ──
        $cpuPct = 0
        try {
            $c = Get-CimInstance Win32_Processor
            $cpuPct = [math]::Round(($c | Measure-Object LoadPercentage -Average).Average, 1)
        } catch { $cpuPct = 0 }

        # ── RAM ──
        $memTotal = 0; $memUsed = 0; $memFree = 0; $memPct = 0
        try {
            $os = Get-CimInstance Win32_OperatingSystem
            $memTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
            $memFree = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
            $memUsed = [math]::Round($memTotal - $memFree, 2)
            $memPct = if ($memTotal -gt 0) { [math]::Round(($memUsed / $memTotal) * 100, 1) } else { 0 }
        } catch {}

        # ── DISK ──
        $disksArr = @()
        try {
            Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
                $dt = [math]::Round($_.Size / 1GB, 2)
                $df = [math]::Round($_.FreeSpace / 1GB, 2)
                $du = [math]::Round($dt - $df, 2)
                $dp = if ($dt -gt 0) { [math]::Round(($du / $dt) * 100, 1) } else { 0 }
                $disksArr += [PSCustomObject]@{ drive=$_.DeviceID; totalGB=$dt; usedGB=$du; freeGB=$df; percent=$dp }
            }
        } catch {}

        # ── NETWORK ──
        $netSent = 0; $netRecv = 0
        try {
            $ni = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Where-Object { $_.BytesTotalPersec -gt 0 }
            $netSent = [math]::Round(($ni | Measure-Object BytesSentPersec -Sum).Sum / 1KB, 2)
            $netRecv = [math]::Round(($ni | Measure-Object BytesReceivedPersec -Sum).Sum / 1KB, 2)
        } catch {}

        # ── NETWORK CONNECTIONS ──
        $connList = @()
        try {
            Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | ForEach-Object {
                $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
                $connList += [PSCustomObject]@{
                    localAddress = $_.LocalAddress
                    localPort = $_.LocalPort
                    remoteAddress = $_.RemoteAddress
                    remotePort = $_.RemotePort
                    state = $_.State.ToString()
                    pid = $_.OwningProcess
                    processName = $proc.ProcessName
                }
            }
        } catch {}

        # ── UPTIME ──
        $uptD = 0; $uptH = 0; $uptM = 0; $uptTotal = 0
        try {
            $osUp = Get-CimInstance Win32_OperatingSystem
            $up = (Get-Date) - $osUp.LastBootUpTime
            $uptD = $up.Days; $uptH = $up.Hours; $uptM = $up.Minutes; $uptTotal = [math]::Round($up.TotalHours, 1)
        } catch {}

        # ── PROCESSES ──
        $procList = @()
        $threatList = @()
        $tempPaths = @($env:TEMP, $env:TMP)
        $sysprocs = @("svchost","csrss","lsass","services","smss","wininit","winlogon","dwm","System","Registry","Idle","MemCompression")
        $safeBig = @("chrome","firefox","msedge","Code","explorer","MsMpEng","SearchHost","devenv","idea64","Teams","Spotify","Discord","OneDrive","slack")

        try {
            Get-Process | Where-Object { $_.Id -ne 0 -and $_.Id -ne 4 } | ForEach-Object {
                $cpuT = 0; try { $cpuT = [math]::Round($_.CPU, 2) } catch {}
                $memMB = [math]::Round($_.WorkingSet64 / 1MB, 2)
                $pth = ""; try { $pth = $_.Path } catch {}
                $co = ""; try { $co = $_.Company } catch {}
                $wt = ""; try { $wt = $_.MainWindowTitle } catch {}
                $st = ""; try { $st = $_.StartTime.ToString("yyyy-MM-dd HH:mm:ss") } catch {}
                $resp = $true; try { $resp = $_.Responding } catch {}
                $thc = 0; try { $thc = $_.Threads.Count } catch {}

                $pObj = [PSCustomObject]@{
                    pid=$_.Id; name=$_.ProcessName; cpuSeconds=$cpuT; memMB=$memMB
                    path=$pth; company=$co; windowTitle=$wt; startTime=$st
                    threads=$thc; handles=$_.HandleCount; responding=$resp
                }
                $procList += $pObj

                # ── THREAT DETECTION ──
                $reasons = @()
                $risk = "none"
                $nm = $_.ProcessName

                if ($cpuT -gt 300 -and $nm -notin $sysprocs -and $nm -notin $safeBig) {
                    $reasons += "Cok yuksek CPU: $($cpuT)s"; $risk = "high"
                }
                if ($memMB -gt 500 -and $co -eq "" -and $nm -notin $sysprocs -and $nm -notin $safeBig) {
                    $reasons += "Yuksek bellek: $($memMB) MB (bilinmeyen yayinci)"
                    if ($risk -eq "none") { $risk = "medium" }
                }
                foreach ($tp in $tempPaths) {
                    if ($tp -and $pth -and $pth.StartsWith($tp)) {
                        $reasons += "Temp klasorunden calisiyor"; $risk = "high"
                    }
                }
                if ($nm -in $sysprocs -and $pth -and -not $pth.StartsWith("C:\Windows")) {
                    $reasons += "Sistem sureci ama yanlis dizinden calisiyor: $pth"; $risk = "critical"
                }
                if ($wt -eq "" -and $thc -gt 10 -and $memMB -gt 100 -and $co -eq "" -and $nm -notin $sysprocs -and $nm -notin $safeBig -and $nm -notin @("backgroundTaskHost","RuntimeBroker","SearchHost","StartMenuExperienceHost","TextInputHost","WidgetService","SecurityHealthSystray","PhoneExperienceHost","LockApp","ShellExperienceHost","SystemSettings","ApplicationFrameHost","dllhost","conhost","sihost","taskhostw","ctfmon","fontdrvhost","WmiPrvSE")) {
                    $reasons += "Gizli pencere, yuksek kaynak kullaniyor"
                    if ($risk -eq "none") { $risk = "low" }
                }
                if ($reasons.Count -gt 0) {
                    $threatList += [PSCustomObject]@{
                        pid=$_.Id; name=$nm; path=$pth; memMB=$memMB; cpuSec=$cpuT
                        risk=$risk; reasons=$reasons; company=$co
                    }
                }
            }
        } catch {}

        $riskOrder = @{ "critical"=0; "high"=1; "medium"=2; "low"=3; "none"=4 }
        $threatList = $threatList | Sort-Object { $riskOrder[$_.risk] }

        # ── STARTUP ──
        $startupList = @()
        try {
            $regCU = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
            if (Test-Path $regCU) {
                $p = Get-ItemProperty $regCU
                $p.PSObject.Properties | Where-Object { $_.Name -notmatch "^PS" } | ForEach-Object {
                    $startupList += [PSCustomObject]@{ name=$_.Name; command=[string]$_.Value; location="Registry (Current User)"; enabled=$true }
                }
            }
        } catch {}
        try {
            $regLM = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
            if (Test-Path $regLM) {
                $p = Get-ItemProperty $regLM
                $p.PSObject.Properties | Where-Object { $_.Name -notmatch "^PS" } | ForEach-Object {
                    $startupList += [PSCustomObject]@{ name=$_.Name; command=[string]$_.Value; location="Registry (Local Machine)"; enabled=$true }
                }
            }
        } catch {}
        try {
            $sf = [Environment]::GetFolderPath("Startup")
            if ($sf -and (Test-Path $sf)) {
                Get-ChildItem $sf -File | ForEach-Object {
                    $startupList += [PSCustomObject]@{ name=$_.BaseName; command=$_.FullName; location="Startup Folder"; enabled=$true }
                }
            }
        } catch {}

        # ── HEALTH SCORE ──
        $hp = 100
        if ($cpuPct -gt 90) { $hp -= 30 } elseif ($cpuPct -gt 70) { $hp -= 20 } elseif ($cpuPct -gt 50) { $hp -= 10 }
        if ($memPct -gt 90) { $hp -= 30 } elseif ($memPct -gt 75) { $hp -= 20 } elseif ($memPct -gt 60) { $hp -= 10 }
        $dp0 = if ($disksArr.Count -gt 0) { $disksArr[0].percent } else { 0 }
        if ($dp0 -gt 90) { $hp -= 15 } elseif ($dp0 -gt 80) { $hp -= 10 }
        $hp -= [math]::Min($threatList.Count * 5, 25)
        $hp = [math]::Max($hp, 0)

        # ── STATS OBJECT ──
        $stats = [PSCustomObject]@{
            timestamp = $ts
            cpu = [PSCustomObject]@{ percent = $cpuPct }
            memory = [PSCustomObject]@{ totalGB=$memTotal; usedGB=$memUsed; freeGB=$memFree; percent=$memPct }
            disks = $disksArr
            network = [PSCustomObject]@{ totalSentKBps=$netSent; totalRecvKBps=$netRecv }
            uptime = [PSCustomObject]@{ days=$uptD; hours=$uptH; minutes=$uptM; totalHours=$uptTotal }
            healthScore = $hp
            processCount = $procList.Count
            threatCount = $threatList.Count
            connectionCount = $connList.Count
        }

        # ── JSON YAZIM ──
        try { ($stats | ConvertTo-Json -Depth 5 -Compress) | Out-File (Join-Path $DataDir "stats.json") -Encoding utf8 -Force } catch {}
        try { ($procList | ConvertTo-Json -Depth 3 -Compress) | Out-File (Join-Path $DataDir "processes.json") -Encoding utf8 -Force } catch {}
        try { ($threatList | ConvertTo-Json -Depth 4 -Compress) | Out-File (Join-Path $DataDir "threats.json") -Encoding utf8 -Force } catch {}
        try { ($startupList | ConvertTo-Json -Depth 3 -Compress) | Out-File (Join-Path $DataDir "startup.json") -Encoding utf8 -Force } catch {}
        try { ($connList | ConvertTo-Json -Depth 3 -Compress) | Out-File (Join-Path $DataDir "connections.json") -Encoding utf8 -Force } catch {}

        # Büyük dosya taraması (her N döngüde bir)
        $largeFileScanCounter++
        if ($largeFileScanCounter -ge $largeFileScanInterval) {
            $largeFileScanCounter = 0
            Scan-LargeFiles -OutPath (Join-Path $DataDir "largefiles.json")
        }

        # Konsol
        $sc = if ($hp -ge 70) { "Green" } elseif ($hp -ge 40) { "Yellow" } else { "Red" }
        Write-Host "[$ts] HP:$hp CPU:$cpuPct% RAM:$memPct% PROC:$($procList.Count) THREAT:$($threatList.Count) CONN:$($connList.Count)" -ForegroundColor $sc

    } catch {
        Write-Host "[ERR] $($_.Exception.Message)" -ForegroundColor Red
    }

    Start-Sleep -Seconds $IntervalSeconds
}
