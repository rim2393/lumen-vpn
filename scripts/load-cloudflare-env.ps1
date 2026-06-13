param(
    [string]$StorePath = "$env:APPDATA\Lumen\secrets\cloudflare.json",
    [switch]$PrintStatus
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $StorePath)) {
    throw "Cloudflare DPAPI secret file was not found. Run scripts/save-cloudflare-secret.ps1 first."
}

$payload = Get-Content -Raw -Path $StorePath | ConvertFrom-Json
if (-not $payload.accountId -or -not $payload.tokenDpapi) {
    throw "Cloudflare DPAPI secret file is incomplete. Run scripts/save-cloudflare-secret.ps1 again."
}

$secureToken = ConvertTo-SecureString $payload.tokenDpapi
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

$env:CLOUDFLARE_ACCOUNT_ID = [string]$payload.accountId
$env:CLOUDFLARE_API_TOKEN = $plainToken

if ($PrintStatus) {
    Write-Host "Cloudflare env loaded from Windows DPAPI store. Token value is not printed."
}
