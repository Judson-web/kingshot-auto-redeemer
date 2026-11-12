# Kingshot Auto Redeemer for Android

Native Android client built with Kotlin, Jetpack Compose, Material 3 and Retrofit.

## Requirements

- JDK 17
- Android SDK 35
- Gradle 8.9
- Android Studio with Kotlin/Compose support

## Build

From the repository root:

```bash
cd android
gradle testDebugUnitTest assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Production integration

The app connects to `https://app.ks-redeemer.workers.dev/` and uses the existing V4 Developer API for player lookup, manual redemption and redemption history. Public service health and player enrollment use their existing public endpoints.

Create a Developer API key on the official website at `/developer`, then save it in Settings. The key is encrypted with an AES-GCM key held by Android Keystore. It is never embedded in the APK, written to logs, or placed in a URL.

Manual redemptions use a persistent idempotency key. If the network outcome is ambiguous, the app retains the exact request and key and offers a retry of that same attempt. It does not silently create a second redemption.

Automatic redemption remains entirely server-side. The Android app does not call scheduler/worker internals, hold Supabase service credentials, or run competing redemption workers.

## Security notes

- HTTPS only; cleartext traffic is disabled.
- Android backup is disabled to avoid exporting encrypted local credentials without their Keystore key.
- The developer API key is stored encrypted at rest with Android Keystore AES/GCM.
- No service-role key or shared project secret is included.


## Automatic signed releases

GitHub Actions publishes an installable, signed APK to GitHub Releases when a version tag matching `android-v*` is pushed (for example, `android-v1.1.0`). Pull requests continue to publish debug APK artifacts only.

Before the first release, create a dedicated Android upload/release keystore and keep a secure offline backup. Never commit the keystore or passwords:

```bash
keytool -genkeypair -v -keystore kingshot-android-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias kingshot-release
base64 -w 0 kingshot-android-release.jks
```

Add these four repository Actions secrets under **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64`: the base64 output of the JKS file
- `ANDROID_KEYSTORE_PASSWORD`: keystore password
- `ANDROID_KEY_ALIAS`: `kingshot-release` (or the alias chosen above)
- `ANDROID_KEY_PASSWORD`: key password

Keep the keystore and passwords backed up securely. Losing the signing key can prevent users from installing updates over an existing installation. Do not regenerate it for subsequent releases.

After the secrets are configured, push a version tag:

```bash
git tag android-v1.1.0
git push origin android-v1.1.0
```

The workflow runs tests, builds the minified release variant, signs it with the configured key, and attaches `app-release.apk` to the GitHub Release. The workflow can also be started manually with a version input. The release job intentionally fails with a clear message if signing secrets are missing; it never falls back to publishing an unsigned or debug APK as a production release.

Version codes are generated from the GitHub Actions run number and version names come from the release tag.
