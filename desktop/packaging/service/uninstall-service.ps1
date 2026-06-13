$ErrorActionPreference = "Stop"
$installDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$serviceExe = Join-Path $installDir "service\LumenVPNService.exe"
if (Test-Path $serviceExe) {
  & $serviceExe stop
  & $serviceExe uninstall
}
