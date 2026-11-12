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
