# Kingshot Auto Redeemer for Android

Official Android companion for the Kingshot Auto Redeemer website. Built with Kotlin, Jetpack Compose and Retrofit. Core screens use native Android UI and call the first-party Cloudflare backend directly.

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

The Android app uses native Jetpack Compose screens and calls the same production Cloudflare backend as the website. It does not embed the website in a WebView. Home, manual redemption, player lookup, alliance discovery/roster preview/registration, authenticated alliance-sync management, verified gift-code catalogue and Discord account are native. Alliance registration is revalidated by the existing server-side sync handler, which retains the four-alliance kingdom cap and owner bypass.

Native screens communicate with the pinned HTTPS production API. The app does not create a JavaScript bridge or embed remote web content. Backend authorization remains authoritative.

## Developer API key is optional

A Developer API key is **not required** for ordinary app use. Normal users use the official backend workflows for automatic redemption, manual redemption, player lookup, player registration, verified gift codes and alliance registration. Private admin and developer workspaces are not yet ported as native screens.

The optional key is only for external tools or integrations that deliberately call the public V4 Developer API. It is encrypted with Android Keystore and attached only to `/api/v4/*` requests. It is never embedded in the APK or sent to public website routes.

Create a key only if you need the V4 Developer API, from the official website's `/developer` portal. The key format is validated before saving.

## Discord account

Native Discord sign-in uses the existing Supabase Auth Discord provider and Cloudflare account service. The app creates a PKCE verifier locally, stores it with Android Keystore-backed encrypted storage, and receives the authorization code through the `ksredeemer://discord-callback` app link. The code is exchanged by the existing backend; the app never embeds the Supabase service-role credential or trusts a client-supplied role.

- Guest: public site workflows and sign-in entry point.
- User: verified Discord profile and standard account experience.
- Developer: existing developer role, based on server-verified active API keys.
- Admin: existing owner Discord identity, determined by the backend.

The profile session cookie is stored encrypted on-device and attached only to first-party profile and alliance-sync API requests. Signing out revokes the server-side session.

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
