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

The app connects directly to the production Cloudflare origin, `https://app.ks-redeemer.workers.dev/`. It uses `GET /api/kingshot-health` for the live secondary-scheduler health summary, the authenticated V4 Developer API for player lookup, manual redemption and redemption history, and the public `POST /api/kingshot-register` route for enrollment. The Developer API key is attached only to `/api/v4/*` requests, never to public health or registration calls.

Create a Developer API key on the official website at `/developer`, then save it in the Players screen's Developer API key section. The key is encrypted with an AES-GCM key held by Android Keystore. It is never embedded in the APK, written to logs, or placed in a URL.

Manual redemptions use a persistent idempotency key. If the network outcome is ambiguous, the app retains the exact request and key and offers a retry of that same attempt. It does not silently create a second redemption.

Automatic redemption remains entirely server-side. The Android app does not call scheduler/worker internals, hold Supabase service credentials, or run competing redemption workers.

## Security notes

- HTTPS only; cleartext traffic is disabled.
- Android backup is disabled to avoid exporting encrypted local credentials without their Keystore key.
- The developer API key is stored encrypted at rest with Android Keystore AES/GCM.
- No service-role key or shared project secret is included.


## Automatic signed releases

GitHub Actions publishes an installable, signed APK to GitHub Releases when a version tag matching `android-v*` is pushed (for example, `android-v1.2.0`). Pull requests continue to publish debug APK artifacts only.

Kingshot uses its own dedicated release keystore, separate from Atomos Device Bridge. Use `Kingshot-Android-Release-Key.jks` with alias `kingshot-release`. Keep the keystore and a secure offline backup; never commit the keystore or passwords:

```bash
base64 -w 0 Kingshot-Android-Release-Key.jks
```

Add these four repository Actions secrets under **Settings → Secrets and variables → Actions**:

- `ANDROID_SIGNING_KEY_BASE64`: the base64 output of the JKS file
- `ANDROID_SIGNING_STORE_PASSWORD`: keystore password
- `ANDROID_SIGNING_KEY_ALIAS`: `kingshot-release`
- `ANDROID_SIGNING_KEY_PASSWORD`: key password

Keep the keystore and passwords backed up securely. Losing the signing key can prevent users from installing updates over an existing installation. Do not reuse the Atomos signing identity. The Kingshot keystore, alias and passwords must remain unique to this app. GitHub repository secrets are scoped to a repository. Secret values cannot be copied or read back through the GitHub API.

After the secrets are configured, push a version tag:

```bash
git tag android-v1.1.0
git push origin android-v1.1.0
```

The workflow runs tests, builds the minified release variant, signs it with the configured key, and attaches `app-release.apk` to the GitHub Release. The workflow can also be started manually with a version input. The release job intentionally fails with a clear message if signing secrets are missing; it never falls back to publishing an unsigned or debug APK as a production release.

Version codes are generated from the GitHub Actions run number and version names come from the release tag.


## Discord accounts and access levels

Version 1.3 adds native Discord sign-in using the existing Supabase Auth Discord provider and the Cloudflare account service. The app creates a PKCE verifier locally, stores it with Android Keystore-backed encrypted storage, and receives the authorization code through the `ksredeemer://discord-callback` app link. The code is exchanged by the existing backend; the app never embeds the Supabase service-role credential or trusts a client-supplied role.

- Guest: public service health and sign-in entry point.
- User: verified Discord profile and standard account experience.
- Developer: existing developer role, based on server-verified active API keys.
- Admin: the existing owner Discord identity, determined by the backend.

The profile session cookie is stored encrypted on-device and sent only to the configured HTTPS API origin. Signing out revokes the server-side session. Admin shortcuts open the existing web administration pages; those pages may require their own browser sign-in because Android app cookies are not shared with the browser.

The native OAuth callback uses the already configured website profile redirect with a `native=1` handoff. No Discord client secret or Supabase privileged key belongs in the APK. The Worker account-auth route must be deployed with the Android OAuth handoff changes before native sign-in can complete.
