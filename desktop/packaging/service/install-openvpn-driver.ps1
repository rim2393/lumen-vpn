$ErrorActionPreference = "Stop"
$installDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$driverMsi = Join-Path $installDir "runtime\openvpn-driver.msi"

if ((Get-Service -Name "ovpn-dco" -ErrorAction SilentlyContinue) -and
    (Get-Service -Name "tap0901" -ErrorAction SilentlyContinue)) {
  Write-Host "OpenVPN drivers are already installed."
  exit 0
}

if (-not (Test-Path $driverMsi)) {
  throw "Missing OpenVPN driver MSI: $driverMsi"
}

$process = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$driverMsi`" /qn /norestart" -Wait -PassThru
if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
  throw "OpenVPN driver MSI failed with exit code $($process.ExitCode)"
}
