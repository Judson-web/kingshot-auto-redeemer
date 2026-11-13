# Kingshot Auto Redeemer for Android

Official Android companion for the Kingshot Auto Redeemer website. Built with Kotlin, Jetpack Compose, Retrofit and Android WebView.

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

## Official app architecture

The Android app is a native shell around the same production website and Cloudflare backend. Home, manual redemption, player lookup and the Explore catalogue use the official responsive website workflows. This keeps registration, redemption, gift-code, alliance and administration behavior aligned with the website instead of maintaining a second, drifting implementation.

The embedded workspace is pinned to `https://app.ks-redeemer.workers.dev`. It permits in-app navigation only on that HTTPS host, disables mixed content and file/content access, does not expose a JavaScript bridge, and sends external links to Android's URL handler. The website continues to enforce authorization on the server.

## Developer API key is optional

A Developer API key is **not required** for ordinary app use. Normal users use the official backend workflows for automatic redemption, manual redemption, player lookup, registration, gift codes, alliance registration and other website features.

The optional key is only for external tools or integrations that deliberately call the public V4 Developer API. It is encrypted with Android Keystore and attached only to `/api/v4/*` requests. It is never embedded in the APK or sent to public website routes.

Create a key only if you need the V4 Developer API, from the official website's `/developer` portal. The key format is validated before saving.

## Discord account

Native Discord sign-in uses the existing Supabase Auth Discord provider and Cloudflare account service. The app creates a PKCE verifier locally, stores it with Android Keystore-backed encrypted storage, and receives the authorization code through the `ksredeemer://discord-callback` app link. The code is exchanged by the existing backend; the app never embeds the Supabase service-role credential or trusts a client-supplied role.

- Guest: public site workflows and sign-in entry point.
- User: verified Discord profile and standard account experience.
- Developer: existing developer role, based on server-verified active API keys.
- Admin: existing owner Discord identity, determined by the backend.

The profile session cookie is stored encrypted on-device and copied into the WebView cookie store only for the production HTTPS origin. Signing out revokes the server-side session. The website may still maintain its own Supabase browser session for web-specific flows.

## Security notes

- HTTPS only; cleartext traffic is disabled.
- Android backup is disabled to avoid exporting encrypted local credentials without their Keystore key.
- The Developer API key is stored encrypted at rest with Android Keystore AES/GCM.
- The native profile cookie is scoped to the production origin and marked Secure, HttpOnly and SameSite.
- No service-role key, Discord client secret or shared project secret is included.
- Automatic redemption remains entirely server-side.

## Audit

See [AUDIT-AND-PARITY.md](./AUDIT-AND-PARITY.md) for the feature inventory, findings, remediation and release verification checklist.

## Signed releases

GitHub Actions publishes a signed release APK on version tags matching `android-v*`. The release job requires the repository's configured Android signing secrets and does not fall back to an unsigned release. Keep the dedicated Kingshot signing keystore and offline backup safe; losing it can prevent in-place app updates.
