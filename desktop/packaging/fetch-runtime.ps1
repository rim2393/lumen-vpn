$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $PSScriptRoot "runtime"
$serviceDir = Join-Path $PSScriptRoot "service"
$downloadsDir = Join-Path $PSScriptRoot "downloads"
$workDir = Join-Path $downloadsDir "work"

New-Item -ItemType Directory -Force -Path $runtimeDir, $serviceDir, $downloadsDir, $workDir | Out-Null

function Invoke-Download($Url, $OutFile) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

function Get-GitHubRelease($Repo) {
  Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{
    "User-Agent" = "LumenVPN-Packaging"
    "Accept" = "application/vnd.github+json"
  }
}

function Get-Asset($Release, $Pattern) {
  $asset = $Release.assets | Where-Object { $_.name -like $Pattern } | Select-Object -First 1
  if (-not $asset) {
    throw "No asset matching '$Pattern' in $($Release.html_url)"
  }
  return $asset
}

# sing-box
$singRelease = Get-GitHubRelease "SagerNet/sing-box"
$singAsset = Get-Asset $singRelease "sing-box-*-windows-amd64.zip"
$singZip = Join-Path $downloadsDir $singAsset.name
Invoke-Download $singAsset.browser_download_url $singZip
$singExtract = Join-Path $workDir "sing-box"
Remove-Item -Recurse -Force $singExtract -ErrorAction SilentlyContinue
Expand-Archive -Path $singZip -DestinationPath $singExtract -Force
$singExe = Get-ChildItem -Path $singExtract -Recurse -Filter "sing-box.exe" | Select-Object -First 1
if (-not $singExe) { throw "sing-box.exe was not found after extraction" }
Copy-Item $singExe.FullName (Join-Path $runtimeDir "sing-box.exe") -Force

# Cloak client
$cloakRelease = Get-GitHubRelease "cbeuw/Cloak"
$cloakAsset = Get-Asset $cloakRelease "ck-client-windows-amd64-*"
$cloakOut = Join-Path $runtimeDir "cloak.exe"
Invoke-Download $cloakAsset.browser_download_url $cloakOut

# WinSW service wrapper
$winswRelease = Get-GitHubRelease "winsw/winsw"
$winswAsset = Get-Asset $winswRelease "WinSW-x64.exe"
Invoke-Download $winswAsset.browser_download_url (Join-Path $serviceDir "LumenVPNService.exe")

# AmneziaWG Windows client. The installed CLI is extracted from the MSI when available.
$awgRelease = Get-GitHubRelease "amnezia-vpn/amneziawg-windows-client"
$awgAsset = Get-Asset $awgRelease "*.msi"
$awgMsi = Join-Path $downloadsDir $awgAsset.name
Invoke-Download $awgAsset.browser_download_url $awgMsi
$awgExtract = Join-Path $workDir "amneziawg"
Remove-Item -Recurse -Force $awgExtract -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $awgExtract | Out-Null
$awg = Start-Process -FilePath "msiexec.exe" -ArgumentList "/a `"$awgMsi`" /qn TARGETDIR=`"$awgExtract`"" -Wait -PassThru
if ($awg.ExitCode -ne 0) { throw "AmneziaWG MSI extraction failed with exit code $($awg.ExitCode)" }
$awgExe = Get-ChildItem -Path $awgExtract -Recurse -Filter "amneziawg.exe" | Select-Object -First 1
if (-not $awgExe) {
  $awgExe = Get-ChildItem -Path $awgExtract -Recurse -Filter "wireguard.exe" | Select-Object -First 1
}
if (-not $awgExe) { throw "AmneziaWG executable was not found after MSI extraction" }
Copy-Item $awgExe.FullName (Join-Path $runtimeDir "amneziawg.exe") -Force

# OpenVPN Community MSI, current link from https://openvpn.net/community/
$openVpnMsiUrl = "https://swupdate.openvpn.org/community/releases/OpenVPN-2.7.4-I001-amd64.msi"
$openVpnMsi = Join-Path $downloadsDir "OpenVPN-2.7.4-I001-amd64.msi"
Invoke-Download $openVpnMsiUrl $openVpnMsi
Copy-Item $openVpnMsi (Join-Path $runtimeDir "openvpn-driver.msi") -Force
$openVpnExtract = Join-Path $workDir "openvpn"
Remove-Item -Recurse -Force $openVpnExtract -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $openVpnExtract | Out-Null
$msi = Start-Process -FilePath "msiexec.exe" -ArgumentList "/a `"$openVpnMsi`" /qn TARGETDIR=`"$openVpnExtract`"" -Wait -PassThru
if ($msi.ExitCode -ne 0) { throw "OpenVPN MSI extraction failed with exit code $($msi.ExitCode)" }
$openVpnExe = Get-ChildItem -Path $openVpnExtract -Recurse -Filter "openvpn.exe" | Select-Object -First 1
if (-not $openVpnExe) { throw "openvpn.exe was not found after MSI extraction" }
Copy-Item $openVpnExe.FullName (Join-Path $runtimeDir "openvpn.exe") -Force

$openVpnDlls = Get-ChildItem -Path $openVpnExe.DirectoryName -Filter "*.dll" -ErrorAction SilentlyContinue
foreach ($dll in $openVpnDlls) {
  Copy-Item $dll.FullName (Join-Path $runtimeDir $dll.Name) -Force
}
$tapCtl = Get-ChildItem -Path $openVpnExe.DirectoryName -Filter "tapctl.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($tapCtl) {
  Copy-Item $tapCtl.FullName (Join-Path $runtimeDir "tapctl.exe") -Force
}

@"
Runtime bundle generated at $(Get-Date -Format o)

sing-box: $($singRelease.tag_name) / $($singAsset.name)
Cloak: $($cloakRelease.tag_name) / $($cloakAsset.name)
WinSW: $($winswRelease.tag_name) / $($winswAsset.name)
AmneziaWG: $($awgRelease.tag_name) / $($awgAsset.name)
OpenVPN: OpenVPN-2.7.4-I001-amd64.msi
OpenVPN driver MSI: runtime/openvpn-driver.msi
"@ | Set-Content -Path (Join-Path $runtimeDir "VERSIONS.txt") -Encoding UTF8

Write-Host "Runtime bundle is ready:"
Get-ChildItem $runtimeDir, $serviceDir | Select-Object FullName, Length
