# Build TRACE-X AI for Android

The Android project uses a native Java activity and WebView. The connected mode opens the same web console and uses the same session and case APIs as the desktop browser. The APK also contains a read-only synthetic case. Android 8.0 or newer is supported.

## Debug APK on Windows

Install JDK 17 and the Android SDK with platform 36, build-tools 36.0.0, and platform-tools. The Gradle wrapper uses Gradle 8.14.3. Use PowerShell from the repository root. For a standard Android Studio installation, the following commands locate the SDK and build the APK.

```powershell
java -version
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
Push-Location .\android
.\gradlew.bat "-Pandroid.aapt2FromMavenOverride=$env:ANDROID_HOME/build-tools/36.0.0/aapt2.exe" :app:assembleDebug
Pop-Location
```

The output is `android\app\build\outputs\apk\debug\app-debug.apk`. The engine and synthetic sample are packaged from `dist`. If Android Studio is absent, install the same SDK components with the Android command-line tools.

Use ADB with a USB-debugging device or emulator:

```powershell
$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb devices
& $adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
& $adb shell am start -W -n in.shyne.tracex.debug/in.shyne.tracex.MainActivity
```

The debug variant permits explicit HTTP connections to private IPv4 addresses for local synthetic demos. The variant has a separate package ID so it can be installed alongside the signed release.

## Signed release APK

Use a trusted HTTPS server for field deployment. From the repository root, run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\android\build-demo.ps1
```

This script uses the Gradle wrapper, signs `android\app\build\outputs\apk\release\app-release.apk`, verifies the signature with Android build-tools, and copies the signed output to `dist\downloads\trace-x.apk`. It creates a local signing key under `%LOCALAPPDATA%\TraceX\signing` on first run. The signing password is protected by Windows and tied to the current user. Back up the key and signing credential securely so updates can retain the same signing identity.

The release app accepts HTTPS origins and uses Android's certificate verification. Each installation stores the chosen server origin in app settings. Issued user credentials remain on the team server. The offline mode uses bundled synthetic records. See [Connect a phone](ANDROID_PHONE_CONNECT.md).

## Verify the origin policy

From the repository root, compile and run the policy checks with JDK 17. The checks cover debug LAN addresses, release HTTPS enforcement, and blocked cross-origin requests.

```powershell
$testOut = Join-Path $env:TEMP ('tracex-origin-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testOut | Out-Null
javac -d $testOut android/app/src/main/java/in/shyne/tracex/TeamOrigin.java android/tests/TeamOriginCheck.java
java -cp $testOut in.shyne.tracex.TeamOriginCheck
```
