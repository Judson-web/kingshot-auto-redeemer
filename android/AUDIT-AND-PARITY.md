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
| `/alliance-registration` | Alliance roster registration and sync workflow | Explore |
| `/gift-codes` | Gift-code catalogue | Explore |
| `/info` | Service information and instructions | Explore |
| `/profile` | Discord profile and account experience | Explore / native Account |
| `/developer` | Developer API portal, keys, usage and documentation | Explore, optional |
| `/dev` | Private developer workspace | Explore, server-gated |
| `/devsupport` | Developer support | Explore, server-gated |
| `/push` | Push notification console | Explore, server-gated |
| `/message` | Custom Discord message experience | Explore, server-gated |
| `/admin/players` | Player administration | Explore, server-gated |
| `/admin/alliance-sync` | Alliance sync administration | Explore, server-gated |
| `/admin/maintenance` | Maintenance administration | Explore, server-gated |
| `/terms`, `/privacy` | Legal information | Website footer / Explore follow-up |

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

### P1: Web content security
- The embedded workspace is HTTPS-only and pinned to the production app host for in-app navigation.
- JavaScript and DOM storage are enabled because the official site is a React application. File/content access and mixed content are disabled; multiple windows and JavaScript-opened windows are disabled.
- External links are handed to Android's normal URL handler. The app does not expose a JavaScript bridge to website content.
- The native Discord profile session cookie is copied to Android WebView's cookie store with Secure, HttpOnly, SameSite and root-path attributes. No API key is copied into WebView cookies.
- OAuth handoff still uses the existing verified native deep link and PKCE flow. The website's own Supabase browser session remains separate from the native profile-session cookie.

### P1: Navigation and recovery
- The native shell retains primary Home, Redeem, Players, History and Account destinations and adds Explore for the wider website feature set.
- Embedded pages support Android back navigation, retry after main-frame load errors, and reuse the official website's responsive/mobile interface.
- Web pages retain their own loading, validation, cancellation and upstream-result handling rather than duplicating it in Kotlin.

### P1: Identity and role separation
- Guest, user, developer and admin roles continue to be derived server-side from verified Discord identity and existing backend entitlements.
- Developer API keys are not used to infer app identity or role.
- Private developer and admin pages are routed through the existing website guards and APIs.

## Verification required before production release

1. Android unit tests and debug assembly on JDK 17 / Gradle 8.9.
2. Manual WebView verification on Android 10 and Android 17: route loading, JavaScript, storage, back navigation, external links, cookie persistence and offline retry.
3. Discord OAuth round trip on a real device, including cancellation, denial, expired verifier, successful profile check and logout.
4. Guest checks: automatic redemption page, manual redemption, player lookup, gift-code catalogue, info and alliance registration.
5. Role checks: standard user cannot access developer/admin operations; developer-only tools remain server-gated; only the owner identity receives admin access.
6. Regression checks for redemption ambiguity: no silent duplicate retry and no new idempotency key for an unresolved native V4 attempt.
7. Release-signing workflow must publish a signed release APK only when the repository's signing secrets are configured.

## Scope note

This change establishes a parity-first Android shell by embedding the official responsive website for workflows that already exist there. It does not claim that every website page has been rewritten as a fully native Compose screen. Native-first implementations can be introduced incrementally where they add meaningful Android value, while keeping one backend contract and one source of truth.
