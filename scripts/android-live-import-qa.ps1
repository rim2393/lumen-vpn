param(
    [string]$SubscriptionUrl = $env:LUMEN_ANDROID_SUBSCRIPTION_URL,
    [string]$Package = "tel.lumentech.vpn.debug",
    [string]$ImportName = "Lumen live subscription",
    [string]$Serial = "",
    [string]$ApkPath = "",
    [switch]$ClearAppData,
    [switch]$Connect,
    [int]$ImportWaitSeconds = 14,
    [string]$OutDir = "D:\android-app-new\.tmp\android-live-import-qa"
)

$ErrorActionPreference = "Stop"

function Fail($Message) {
    throw "[android-live-import-qa] $Message"
}

function Require-Tool($Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Fail "$Name not found in PATH. Install/update the Android toolchain and retry."
    }
    return $cmd.Source
}

function Invoke-Adb {
    param([string[]]$AdbArgs)
    & adb @AdbArgs *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail "adb command failed."
    }
}

function Grant-OptionalPermission {
    param(
        [string]$DeviceSerial,
        [string]$AppPackage,
        [string]$Permission
    )

    & adb -s $DeviceSerial shell pm grant $AppPackage $Permission *> $null
}

function Quote-AndroidShellArg {
    param([string]$Value)
    return "'" + $Value.Replace("'", "'\''") + "'"
}

function New-StringFromCodePoints {
    param([int[]]$CodePoints)
    return -join ($CodePoints | ForEach-Object { [char]$_ })
}

function Get-DeviceSerial {
    if ($Serial.Trim()) {
        return $Serial.Trim()
    }
    $devices = & adb devices
    $found = @(
        $devices |
            Select-String -Pattern "^(?<serial>\S+)\s+device$" |
            ForEach-Object { $_.Matches[0].Groups["serial"].Value }
    )
    if ($found.Count -eq 0) {
        Fail "No connected Android device/emulator."
    }
    if ($found.Count -gt 1) {
        Fail "More than one device is connected. Pass -Serial explicitly."
    }
    return $found[0]
}

function Read-RoomCounts {
    param([string]$DeviceSerial, [string]$AppPackage, [string]$Directory)

    $dbPath = Join-Path $Directory "lumen.db"
    $walPath = Join-Path $Directory "lumen.db-wal"
    $shmPath = Join-Path $Directory "lumen.db-shm"
    Remove-Item -Force $dbPath, $walPath, $shmPath -ErrorAction SilentlyContinue
    foreach ($name in @("lumen.db", "lumen.db-wal", "lumen.db-shm")) {
        $target = Join-Path $Directory $name
        $cmd = "adb -s $DeviceSerial exec-out run-as $AppPackage cat databases/$name > `"$target`""
        & cmd.exe /d /c $cmd
        if ($LASTEXITCODE -ne 0 -and $name -eq "lumen.db") {
            Fail "Could not read app database via run-as. Use a debuggable build or run this against the debug package."
        }
    }
    if (-not (Test-Path $dbPath) -or (Get-Item $dbPath).Length -le 0) {
        Fail "App database copy is empty."
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        Fail "python not found in PATH; needed for sqlite DB inspection."
    }
    $helper = Join-Path $PSScriptRoot "android_read_room_counts.py"
    if (-not (Test-Path $helper)) {
        Fail "Room DB helper not found: $helper"
    }
    $json = & python $helper $dbPath
    if ($LASTEXITCODE -ne 0) {
        Fail "Local sqlite inspection failed."
    }
    return $json | ConvertFrom-Json
}

function Dump-UiTree {
    param(
        [string]$DeviceSerial,
        [string]$TargetPath,
        [int]$Attempts = 5
    )
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        & adb -s $DeviceSerial exec-out uiautomator dump /dev/tty > $TargetPath
        if ($LASTEXITCODE -eq 0) {
            $dump = Get-Content -Raw -Path $TargetPath -ErrorAction SilentlyContinue
            if ($dump -and $dump -notmatch "null root node") {
                return
            }
        }
        Start-Sleep -Seconds 2
    }
    Fail "Could not dump UI tree."
}

if (-not $SubscriptionUrl.Trim()) {
    Fail "Pass the real production subscription URL via -SubscriptionUrl or LUMEN_ANDROID_SUBSCRIPTION_URL. The script never prints it."
}
if ($SubscriptionUrl -notmatch "^https://") {
    Fail "Subscription URL must use HTTPS."
}

Require-Tool "adb" | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$device = Get-DeviceSerial
$packageCheck = & adb -s $device shell pm path $Package
if ($ApkPath.Trim()) {
    if (-not (Test-Path $ApkPath)) {
        Fail "APK not found: $ApkPath"
    }
    Invoke-Adb @("-s", $device, "install", "-r", "-d", $ApkPath)
    $packageCheck = & adb -s $device shell pm path $Package
}
if (-not $packageCheck) {
    Fail "Package $Package is not installed. Pass -ApkPath or install it first."
}

if ($ClearAppData) {
    Invoke-Adb @("-s", $device, "shell", "pm", "clear", $Package)
}
Grant-OptionalPermission -DeviceSerial $device -AppPackage $Package -Permission "android.permission.POST_NOTIFICATIONS"
Invoke-Adb @("-s", $device, "logcat", "-c")

$deepLink = "lumen://import?name=$([uri]::EscapeDataString($ImportName))&url=$([uri]::EscapeDataString($SubscriptionUrl))"
$startCommand = "am start -a android.intent.action.VIEW -d $(Quote-AndroidShellArg $deepLink) -p $(Quote-AndroidShellArg $Package)"
Invoke-Adb @("-s", $device, "shell", $startCommand)
Start-Sleep -Seconds 5

$dialogXml = Join-Path $OutDir "import-dialog.xml"
Dump-UiTree -DeviceSerial $device -TargetPath $dialogXml
$dialog = Get-Content -Raw -Path $dialogXml
if ($dialog -notmatch "CONFIRM IMPORT") {
    Fail "Import confirmation dialog did not appear."
}
if ($dialog -match [regex]::Escape($SubscriptionUrl)) {
    Fail "Raw subscription URL leaked into confirmation UI."
}

$buttonMatch = [regex]::Match($dialog, 'text="IMPORT"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
if (-not $buttonMatch.Success) {
    Fail "IMPORT button not found in UI tree."
}
$x = [int](([int]$buttonMatch.Groups[1].Value + [int]$buttonMatch.Groups[3].Value) / 2)
$y = [int](([int]$buttonMatch.Groups[2].Value + [int]$buttonMatch.Groups[4].Value) / 2)
Invoke-Adb @("-s", $device, "shell", "input", "tap", "$x", "$y")
Start-Sleep -Seconds $ImportWaitSeconds

$counts = Read-RoomCounts -DeviceSerial $device -AppPackage $Package -Directory $OutDir
if ($counts.subscriptions -lt 1 -or $counts.servers -lt 1 -or $counts.ready_servers -lt 1) {
    Fail "Import completed but no usable subscription/server rows were persisted."
}

$afterXml = Join-Path $OutDir "after-import.xml"
$screenshot = Join-Path $OutDir "after-import.png"
& adb -s $device exec-out uiautomator dump /dev/tty > $afterXml
& adb -s $device exec-out screencap -p > $screenshot

$connectEvidence = "not_requested"
if ($Connect) {
    $connectRu = New-StringFromCodePoints @(0x041F, 0x041E, 0x0414, 0x041A, 0x041B, 0x042E, 0x0427, 0x0418, 0x0422, 0x042C)
    $connectedRu = New-StringFromCodePoints @(0x041F, 0x041E, 0x0414, 0x041A, 0x041B, 0x042E, 0x0427, 0x0415, 0x041D, 0x041E)
    $protectedRu = New-StringFromCodePoints @(0x0417, 0x0410, 0x0429, 0x0418, 0x0429, 0x0415, 0x041D, 0x041E)
    $okRu = New-StringFromCodePoints @(0x041E, 0x041A)
    $allowRu = New-StringFromCodePoints @(0x0420, 0x0430, 0x0437, 0x0440, 0x0435, 0x0448, 0x0438, 0x0442, 0x044C)
    $connectPattern = "CONNECT|$([regex]::Escape($connectRu))|VPN"
    $connectButtonPattern = "text=""(CONNECT|$([regex]::Escape($connectRu)))""[^>]*bounds=""\[(\d+),(\d+)\]\[(\d+),(\d+)\]"""
    $permissionPattern = "text=""(OK|$([regex]::Escape($okRu))|$([regex]::Escape($allowRu))|Allow|ALLOW)""[^>]*bounds=""\[(\d+),(\d+)\]\[(\d+),(\d+)\]"""
    $connectedPattern = "CONNECTED|PROTECTED|VPN|$([regex]::Escape($connectedRu))|$([regex]::Escape($protectedRu))"

    $homeText = Get-Content -Raw -Path $afterXml
    if ($homeText -notmatch $connectPattern) {
        Invoke-Adb @("-s", $device, "shell", "input", "keyevent", "4")
        Start-Sleep -Seconds 2
        Dump-UiTree -DeviceSerial $device -TargetPath $afterXml
    }
    $afterText = Get-Content -Raw -Path $afterXml
    $connectMatch = [regex]::Match($afterText, $connectButtonPattern)
    if ($connectMatch.Success) {
        $m = $connectMatch
        $cx = [int](([int]$m.Groups[2].Value + [int]$m.Groups[4].Value) / 2)
        $cy = [int](([int]$m.Groups[3].Value + [int]$m.Groups[5].Value) / 2)
        Invoke-Adb @("-s", $device, "shell", "input", "tap", "$cx", "$cy")
        Start-Sleep -Seconds 2
        Dump-UiTree -DeviceSerial $device -TargetPath $afterXml
        $permissionText = Get-Content -Raw -Path $afterXml
        $permissionMatch = [regex]::Match($permissionText, $permissionPattern)
        if ($permissionMatch.Success) {
            $pm = $permissionMatch
            $px = [int](([int]$pm.Groups[2].Value + [int]$pm.Groups[4].Value) / 2)
            $py = [int](([int]$pm.Groups[3].Value + [int]$pm.Groups[5].Value) / 2)
            Invoke-Adb @("-s", $device, "shell", "input", "tap", "$px", "$py")
        }
        Start-Sleep -Seconds 25
        Dump-UiTree -DeviceSerial $device -TargetPath $afterXml
        $postConnect = Get-Content -Raw -Path $afterXml
        $connectEvidence = if ($postConnect -match $connectedPattern) { "attempted_visible_state" } else { "attempted_no_visible_connected_state" }
    } else {
        $connectEvidence = "connect_button_not_found"
    }
}

$crashLog = Join-Path $OutDir "crash-logcat.txt"
& adb -s $device logcat -b crash -d > $crashLog
$crashText = Get-Content -Raw -Path $crashLog -ErrorAction SilentlyContinue
if ($crashText -match $Package) {
    Fail "Crash log contains entries for $Package. See $crashLog."
}

[pscustomobject]@{
    ok = $true
    device = $device
    package = $Package
    subscriptions = $counts.subscriptions
    servers = $counts.servers
    ready_servers = $counts.ready_servers
    confirmation_redaction = "raw_url_not_visible"
    connect = $connectEvidence
    ui_dump = $afterXml
    screenshot = $screenshot
} | ConvertTo-Json -Compress
