# Android application audit and feature-parity plan

## Executive finding

The previous native client was a compact five-screen Compose client, not a complete counterpart to the production website. It exposed health, manual redemption, player lookup/registration, history and Discord account screens, but it treated the V4 Developer API key as the normal transport for several core tasks. That made a developer credential look mandatory for an ordinary user and split the app from the website's established public workflows.

The official Android app must use the same first-party production backend and permission model as the website. A Developer API key is an optional integration credential for external V4 consumers, not an app login and not a prerequisite for normal users.

## Existing website feature inventory

| Website route | Purpose | Android access |
|---|---|---|
| `/` and `/auto` | Automatic redemption home and service experience | Home |
| `/manual` and `/redeem` | Manual gift-code redemption, player lookup and game-result handling | Redeem |
| `/user` | Public player profile lookup | Players |
| `/alliance-registration` | Alliance roster registration and sync workflow | Native Compose |
| `/gift-codes` | Verified gift-code catalogue | Native Compose |
| `/info` | Service information and instructions | Native Compose |
| `/profile` | Discord profile and account experience | Native Account |
| `/developer` | Developer API settings and documentation | Native optional key settings; full portal not ported |
| `/dev` | Private developer workspace | Not yet ported natively |
| `/devsupport` | Developer support | Not yet ported natively |
| `/push` | Push notification console | Not yet ported natively |
| `/message` | Custom Discord message experience | Not yet ported natively |
| `/admin/players` | Player administration | Not yet ported natively |
| `/admin/alliance-sync` | Alliance sync administration | Native Compose, authenticated existing sync API |
| `/admin/maintenance` | Maintenance administration | Not yet ported natively |
| `/terms`, `/privacy` | Legal information | Not yet ported natively |

## Findings and remediation

### P0: Credential model was wrong for the consumer app
- Before this work, native lookup and manual redemption called V4 endpoints and were disabled without a saved `ks_live_...` key.
- The website already has first-party public routes for player lookup, registration and manual redemption. These use the existing server-side integrations and do not ask ordinary users for Developer API keys.
- Core Android destinations now load the official production workflows. The Developer API key has a separate optional settings surface and is explicitly described as an external-integration credential.
- The app must never bundle Supabase service credentials, Discord client secrets, provider keys, or the backend's signing secrets.

### P0: Feature parity gap
- The previous app had no native entry point for alliance registration, gift-code catalogue, information, announcements, support, push console, custom message, developer workspace or admin workspaces.
- The Explore catalogue now exposes the website's existing routes from inside the Android shell. Server-side role and authorization checks remain authoritative; hiding a route in the UI is not treated as security.
- This approach deliberately reuses the production website and backend rather than creating a second implementation of sensitive workflows in Android.

### P1: Native transport security
- All native API calls use the pinned HTTPS production origin. No WebView or JavaScript bridge is used.
- The encrypted Discord profile session cookie is attached only to the first-party profile/alliance-sync API path. No cookie or Developer API key is sent to public lookup, redemption or gift-code endpoints.
- OAuth handoff uses the existing verified native deep link and PKCE flow.

### P1: Navigation and recovery
- The native shell retains primary Home, Redeem, Players, History and Account destinations and adds Explore for the wider website feature set.
- Embedded pages support Android back navigation, retry after main-frame load errors, and reuse the official website's responsive/mobile interface.
- Web pages retain their own loading, validation, cancellation and upstream-result handling rather than duplicating it in Kotlin.

### P1: Identity and role separation
- Guest, user, developer and admin roles continue to be derived server-side from verified Discord identity and existing backend entitlements.
- Developer API keys are not used to infer app identity or role.
- The V4 redemption-history endpoint remains an explicitly optional Developer API feature and is placed under Explore rather than the primary consumer navigation. Automatic redemption, manual redemption, player lookup and registration do not require a V4 key.
- Private developer and admin pages are routed through the existing website guards and APIs.

## Verification required before production release

1. Android unit tests and debug assembly on JDK 17 / Gradle 8.9.
2. Manual native workflow verification on Android 10 and Android 17, including navigation, lifecycle, offline retry and rotation.
3. Discord OAuth round trip on a real device, including cancellation, denial, expired verifier, successful profile check and logout.
4. Guest checks: public player lookup, manual redemption, gift-code catalogue and alliance discovery.
5. Signed-in checks: alliance preview, capacity enforcement, registration, progress and history.
6. Role checks: standard user cannot access developer/admin operations; developer-only tools remain server-gated; only the owner identity receives admin access.
7. Redemption ambiguity checks: no blind retries after unresolved outcomes; server-side recovery journal remains authoritative.
8. Release-signing workflow must publish a signed release APK only after all checks pass.

## Scope note

The native consumer workflows are implemented without WebView. Private developer and administrative tools are not represented as complete until their backend contracts and native screens are implemented. Unsupported controls are not presented as functional, and privileged operations continue to depend on server-side authorization.
