$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$distDir = Join-Path $root "desktop\build\install\lumen-vpn"
$wixDir = Join-Path $root "desktop\build\wix"
$outDir = Join-Path $root "desktop\build\msi"
$wixExe = Join-Path $root ".tooling\wix\wix.exe"

if (-not (Test-Path $wixExe)) {
  throw "WiX CLI not found at $wixExe. Install it with: dotnet tool install --tool-path .tooling\wix wix --version 4.0.6"
}

& (Join-Path $root "gradlew.bat") :desktop:installDist --console=plain
if ($LASTEXITCODE -ne 0) {
  throw "desktop:installDist failed with exit code $LASTEXITCODE"
}

New-Item -ItemType Directory -Force -Path $wixDir, $outDir | Out-Null

function Convert-ToWixId([string] $Value) {
  $hash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA1]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value))
  ).Replace("-", "").Substring(0, 10)
  $name = [System.Text.RegularExpressions.Regex]::Replace($Value, "[^A-Za-z0-9_]", "_")
  if ($name.Length -gt 45) { $name = $name.Substring(0, 45) }
  if ($name -notmatch "^[A-Za-z_]") { $name = "_$name" }
  return "${name}_$hash"
}

function Convert-ToWixPath([string] $Path) {
  return $Path.Replace("\", "\\")
}

function Get-RelativePath([string] $BasePath, [string] $FullPath) {
  $baseUri = [Uri]((Resolve-Path $BasePath).Path.TrimEnd("\") + "\")
  $fileUri = [Uri](Resolve-Path $FullPath).Path
  return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fileUri).ToString()).Replace("/", "\")
}

$directoryIds = @{ "." = "INSTALLFOLDER" }
Get-ChildItem -Path $distDir -Recurse -Directory | ForEach-Object {
  $relativeDir = Get-RelativePath $distDir $_.FullName
  $directoryIds[$relativeDir] = "dir_" + (Convert-ToWixId $relativeDir)
}

function Get-ChildDirectoryXml([string] $ParentRelative, [int] $Indent) {
  $prefix = " " * $Indent
  $children = $directoryIds.Keys |
    Where-Object {
      $_ -ne "." -and
      ((Split-Path $_ -Parent) -replace "/", "\") -eq $(if ($ParentRelative -eq ".") { "" } else { $ParentRelative })
    } |
    Sort-Object
  $builder = New-Object System.Text.StringBuilder
  foreach ($child in $children) {
    $name = Split-Path $child -Leaf
    [void] $builder.AppendLine("$prefix<Directory Id=`"$($directoryIds[$child])`" Name=`"$name`">")
    [void] $builder.Append((Get-ChildDirectoryXml $child ($Indent + 2)))
    [void] $builder.AppendLine("$prefix</Directory>")
  }
  return $builder.ToString()
}

$installDirsXml = Get-ChildDirectoryXml "." 10

$filesByDir = @{}
Get-ChildItem -Path $distDir -Recurse -File | ForEach-Object {
  $relative = Get-RelativePath $distDir $_.FullName
  $dir = Split-Path $relative -Parent
  if ([string]::IsNullOrWhiteSpace($dir)) { $dir = "." }
  if (-not $filesByDir.ContainsKey($dir)) { $filesByDir[$dir] = @() }
  $filesByDir[$dir] += $_
}

$components = New-Object System.Text.StringBuilder
$componentRefs = New-Object System.Text.StringBuilder
foreach ($dir in ($filesByDir.Keys | Sort-Object)) {
  $directoryId = $directoryIds[$dir]
  [void] $components.AppendLine("    <DirectoryRef Id=`"$directoryId`">")
  foreach ($file in ($filesByDir[$dir] | Sort-Object FullName)) {
    $relative = Get-RelativePath $distDir $file.FullName
    $componentId = "cmp_" + (Convert-ToWixId $relative)
    $fileId = "fil_" + (Convert-ToWixId $relative)
    $source = Convert-ToWixPath $file.FullName
    [void] $components.AppendLine("      <Component Id=`"$componentId`" Guid=`"*`">")
    [void] $components.AppendLine("        <File Id=`"$fileId`" Source=`"$source`" KeyPath=`"yes`" />")
    [void] $components.AppendLine("      </Component>")
    [void] $componentRefs.AppendLine("      <ComponentRef Id=`"$componentId`" />")
  }
  [void] $components.AppendLine("    </DirectoryRef>")
}

$productWxs = Join-Path $wixDir "Product.wxs"
$filesWxs = Join-Path $wixDir "Files.wxs"

@"
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package
    Name="Lumen VPN"
    Manufacturer="Lumen"
    Version="1.0.0.0"
    UpgradeCode="7d2c61a4-5949-4b9b-a0a0-783d7f6d4da7"
    Scope="perMachine">
    <MajorUpgrade DowngradeErrorMessage="A newer version of Lumen VPN is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="Lumen VPN">
$installDirsXml
      </Directory>
    </StandardDirectory>

    <StandardDirectory Id="CommonAppDataFolder">
      <Directory Id="PROGRAMDATAFOLDER" Name="LumenVPN">
        <Component Id="ProgramDataDirs" Guid="*">
          <CreateFolder />
          <CreateFolder Directory="LOGFOLDER" />
          <CreateFolder Directory="RUNTIMEDATAFOLDER" />
          <RegistryValue Root="HKLM" Key="Software\LumenVPN" Name="ProgramData" Type="integer" Value="1" KeyPath="yes" />
        </Component>
        <Directory Id="LOGFOLDER" Name="logs" />
        <Directory Id="RUNTIMEDATAFOLDER" Name="runtime" />
      </Directory>
    </StandardDirectory>

    <Feature Id="MainFeature" Title="Lumen VPN" Level="1">
      <ComponentGroupRef Id="AppFiles" />
      <ComponentRef Id="ProgramDataDirs" />
    </Feature>

    <CustomAction
      Id="InstallLumenService"
      Directory="INSTALLFOLDER"
      Execute="deferred"
      Impersonate="no"
      ExeCommand='powershell.exe -NoProfile -ExecutionPolicy Bypass -File "[INSTALLFOLDER]service\install-service.ps1"'
      Return="check" />

    <InstallExecuteSequence>
      <Custom Action="InstallLumenService" After="InstallFiles" Condition="NOT Installed" />
    </InstallExecuteSequence>
  </Package>
</Wix>
"@ | Set-Content -Path $productWxs -Encoding UTF8

@"
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Fragment>
$components
  </Fragment>
  <Fragment>
    <ComponentGroup Id="AppFiles">
$componentRefs
    </ComponentGroup>
  </Fragment>
</Wix>
"@ | Set-Content -Path $filesWxs -Encoding UTF8

$msi = Join-Path $outDir "LumenVPN-1.0.0-x64.msi"
& $wixExe build -arch x64 -out $msi $productWxs $filesWxs
if ($LASTEXITCODE -ne 0) {
  throw "WiX build failed with exit code $LASTEXITCODE"
}

Write-Host "MSI built: $msi"
Get-Item $msi | Select-Object FullName, Length, LastWriteTime
