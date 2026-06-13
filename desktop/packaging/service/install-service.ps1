$ErrorActionPreference = "Stop"
$installDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$driverInstaller = Join-Path $installDir "service\install-openvpn-driver.ps1"
if (Test-Path $driverInstaller) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $driverInstaller
}
$serviceExe = Join-Path $installDir "service\LumenVPNService.exe"
if (-not (Test-Path $serviceExe)) {
  throw "Missing WinSW service wrapper: $serviceExe"
}

$existing = Get-Service -Name "LumenVPN" -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne "Stopped") {
    Stop-Service -Name "LumenVPN" -Force -ErrorAction SilentlyContinue
    $existing.WaitForStatus("Stopped", "00:00:20")
  }
  & sc.exe delete LumenVPN | Out-Host
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1060) {
    throw "Failed to delete existing LumenVPN service. Exit code: $LASTEXITCODE"
  }
  Start-Sleep -Seconds 2
}

& $serviceExe install
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install LumenVPN service. Exit code: $LASTEXITCODE"
}

& $serviceExe start
if ($LASTEXITCODE -ne 0) {
  throw "Failed to start LumenVPN service. Exit code: $LASTEXITCODE"
}
