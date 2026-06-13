param(
    [string]$AccountId,
    [string]$StorePath = "$env:APPDATA\Lumen\secrets\cloudflare.json"
)

$ErrorActionPreference = "Stop"

if (-not $AccountId) {
    $AccountId = Read-Host "Cloudflare Account ID"
}

if (-not $AccountId) {
    throw "Cloudflare Account ID is required."
}

if ($env:CLOUDFLARE_API_TOKEN) {
    $secureToken = ConvertTo-SecureString $env:CLOUDFLARE_API_TOKEN -AsPlainText -Force
} else {
    $secureToken = Read-Host "Cloudflare API token" -AsSecureString
}

$storeDir = Split-Path -Parent $StorePath
New-Item -ItemType Directory -Path $storeDir -Force | Out-Null

$payload = [ordered]@{
    accountId = $AccountId
    tokenDpapi = ConvertFrom-SecureString $secureToken
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("o")
}

$payload | ConvertTo-Json | Set-Content -Path $StorePath -Encoding UTF8

Write-Host "Cloudflare credentials saved with Windows DPAPI for the current user. Plain token was not written to project files."
