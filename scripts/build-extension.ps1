param(
  [string]$ApiUrl = "https://www.replypals.in",
  [string]$MixpanelToken = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "extension"
$distRoot = Join-Path $root "dist"
$dist = Join-Path $distRoot "extension"

Write-Host "Cleaning dist..."
if (Test-Path $dist) {
  Remove-Item -Recurse -Force $dist
}
New-Item -ItemType Directory -Path $dist | Out-Null

Write-Host "Copying extension files..."
Copy-Item -Recurse -Force (Join-Path $src "*") $dist

# Remove known dev-only files if present
$devOnly = @("new_logic.js", "temp.txt", "build2.js", "voice-test.html")
foreach ($name in $devOnly) {
  $p = Join-Path $dist $name
  if (Test-Path $p) {
    Remove-Item -Force $p
  }
}

Write-Host "Injecting build placeholders..."
$bgPath = Join-Path $dist "background.js"
$content = Get-Content -Raw $bgPath
$content = $content.Replace("__REPLYPAL_API_URL__", $ApiUrl)
$content = $content.Replace("__MIXPANEL_TOKEN__", $MixpanelToken)
Set-Content -Path $bgPath -Value $content -NoNewline

Write-Host "Creating zip..."
$zipPath = Join-Path $distRoot "replypal-extension-v1.2.0.zip"
if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}
Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zipPath

Write-Host ""
Write-Host "Build complete:"
Write-Host " - Extension folder: $dist"
Write-Host " - Zip file: $zipPath"
Write-Host " - API base: $ApiUrl"
if ([string]::IsNullOrWhiteSpace($MixpanelToken)) {
  Write-Host " - Mixpanel: disabled (empty token)"
} else {
  Write-Host " - Mixpanel: enabled"
}
