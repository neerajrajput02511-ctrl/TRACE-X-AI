param([string]$GradlePath = (Join-Path $PSScriptRoot "gradlew.bat"))
$ErrorActionPreference = "Stop"
$sdkRoot = $env:ANDROID_HOME
if (-not $sdkRoot) { $sdkRoot = Join-Path $env:LOCALAPPDATA "Android/Sdk" }
$env:ANDROID_HOME = $sdkRoot
$androidRoot = $PSScriptRoot
$webRoot = Join-Path (Split-Path $androidRoot -Parent) "dist"
foreach ($required in @("console.html", "console.css", "console.js", "engine.js")) {
    if (-not (Test-Path -LiteralPath (Join-Path $webRoot $required))) { throw "Missing web asset $required" }
}
$buildTools = Join-Path $sdkRoot "build-tools/36.0.0"
$signDir = Join-Path $env:LOCALAPPDATA "TraceX/signing"
New-Item -ItemType Directory -Force $signDir | Out-Null
$keystore = Join-Path $signDir "field.p12"
$protectedPassword = Join-Path $signDir "field.credential"
if (-not (Test-Path -LiteralPath $protectedPassword)) {
    if (Test-Path -LiteralPath $keystore) { throw "Restore the field signing credential for this existing key." }
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $secret = ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
    ConvertFrom-SecureString $secret | Set-Content -LiteralPath $protectedPassword
}
$secret = Get-Content -LiteralPath $protectedPassword -Raw | ForEach-Object { ConvertTo-SecureString $_.Trim() }
$credential = [PSCredential]::new("field", $secret)
$env:TRACEX_SIGNING_PASSWORD = $credential.GetNetworkCredential().Password
$env:TRACEX_SIGNING_STORE = $keystore
Push-Location $androidRoot
try {
    if (-not (Test-Path -LiteralPath $keystore)) {
        & keytool -genkeypair -storetype PKCS12 -keystore $keystore -alias trace-x -keyalg RSA -keysize 3072 -validity 10000 -storepass:env TRACEX_SIGNING_PASSWORD -dname "CN=TRACE-X Field App, OU=Team SHYNE"
        if ($LASTEXITCODE -ne 0) { throw "Field signing key creation failed" }
    }
    & $GradlePath "--no-daemon" "-Pandroid.aapt2FromMavenOverride=$buildTools/aapt2.exe" "-PdemoDistribution" ":app:assembleRelease"
    if ($LASTEXITCODE -ne 0) { throw "Android build failed" }
    $apk = Join-Path $androidRoot "app/build/outputs/apk/release/app-release.apk"
    & (Join-Path $buildTools "apksigner.bat") verify --verbose $apk
    if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }
    $downloads = Join-Path $webRoot "downloads"
    New-Item -ItemType Directory -Force $downloads | Out-Null
    Copy-Item -LiteralPath $apk -Destination (Join-Path $downloads "trace-x.apk") -Force
} finally {
    Remove-Item -Path Env:TRACEX_SIGNING_PASSWORD,Env:TRACEX_SIGNING_STORE -ErrorAction SilentlyContinue
    Pop-Location
}
