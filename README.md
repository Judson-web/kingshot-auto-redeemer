<div align="center">

<img src="./.github/assets/readme-banner.svg" alt="Kingshot Auto Redeemer">

# Kingshot Auto Redeemer

**An independent community service for discovering and redeeming eligible Kingshot gift codes.**

[![Live Website Status](https://kingshot-autoredeemer.vercel.app/api/kingshot-health?badge=1)](https://kingshot-autoredeemer.vercel.app/)
[![Live Site](https://img.shields.io/badge/Live%20Site-Open%20Service-2563EB?style=for-the-badge&logo=vercel&logoColor=white)](https://kingshot-autoredeemer.vercel.app/)
[![Verification](https://github.com/Judson-web/kingshot-auto-redeemer/actions/workflows/verify.yml/badge.svg)](https://github.com/Judson-web/kingshot-auto-redeemer/actions/workflows/verify.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24.x-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111827)](https://react.dev/)
[![Vite 6](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=111827)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deployment-Vercel-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com/)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-2DA44E?style=flat-square)](./LICENSE)

[**Open the service →**](https://kingshot-autoredeemer.vercel.app/) · [**How it works →**](https://kingshot-autoredeemer.vercel.app/info) · [**Privacy →**](https://kingshot-autoredeemer.vercel.app/privacy) · [**Terms →**](https://kingshot-autoredeemer.vercel.app/terms)

</div>

> **Independent community software.** This project is not affiliated with, endorsed by, or operated by Century Games.

## Maintainer & contact

Created and maintained by **Judson** (`@judson00713` on Discord). For account, registration, or redemption issues, use the website's in-app Support Centre so the request stays attached to a support conversation. For developer API questions or project feedback, use the public contact options provided by the service. Response times may vary.

---

## Overview

Kingshot Auto Redeemer helps players discover eligible public gift codes and redeem them through automatic or manual workflows. It combines a web application with server-side processing, persistent application state, player lookup, and safeguards designed to reduce duplicate work and clarify uncertain outcomes.

| Capability | Description |
|---|---|
| Gift-code discovery | Collects and normalizes eligible codes from configured public sources. |
| Automatic redemption | Processes registered Player IDs through coordinated server-side workflows. |
| Manual redemption | Lets players submit a code and see the result, with guidance when a timeout makes the outcome uncertain. |
| Player profiles | Displays supported player information, including available avatar and Town Center details. |
| Alliance registration | Finds an alliance roster and supports registering eligible members in batches or selecting members individually. |
| Scheduled alliance sync | Adds newly discovered eligible members on a schedule without automatically removing previously registered players. |
| Notifications | Optional web push for verified gift-code alerts and relevant service announcements. |
| Support | Provides a workflow for reporting problems and following up. |
| Administration | Restricted tools for authorized operational tasks. |
| Reliability | Uses persistent coordination, input validation, rate-aware upstream requests, and automated checks. |

## Live website

The public application is available at [kingshot-autoredeemer.vercel.app](https://kingshot-autoredeemer.vercel.app/). Use the site's navigation for current routes and features. Administrative and developer tools may require a verified session and server-side authorization; a URL alone does not grant access.

## Alliance registration and sync

Alliance registration is available from the website and directly inside Discord. In Discord, use /alliance, choose a kingdom and alliance, inspect the paginated roster, then select **Register alliance**. The bot uses the Discord user identity from the signed interaction payload and starts the server-side alliance-sync workflow. No website sign-in, alliance membership, alliance leadership role, or R5/R4 permission is required.

The normal limit is **four registered alliance configurations per kingdom**. The verified project owner Discord account (871756466900598815) has a server-enforced bypass of this cap. The bypass is determined from the Discord user ID in the Ed25519-verified interaction payload and is never accepted from a button parameter, client request, or user-editable profile field. All other users remain subject to the four-alliance cap. The database performs the cap check and insertion atomically, preventing concurrent requests from exceeding the limit. Duplicate alliance configurations are rejected for everyone, including the owner.

Discord registration records the initiating Discord account for audit, while the sync worker runs independently of that user's continued presence or permissions. Registration uses the existing player registry and skips already-registered or banned players rather than creating duplicate player records. The initial roster is validated before registration; suspiciously incomplete, stale, or malformed rosters fail closed. Successful syncs continue on the existing 24-hour schedule, with the existing per-alliance lease preventing overlapping runs. The website and Discord share the same server-side sync configuration and worker safeguards.

The alliance page fetches and validates the selected roster, checks registration status, and processes eligible players in bounded batches. The admin **Sync now** action runs the same server-side reconciliation path, with a 300-second Vercel execution budget for larger rosters. Each run validates a fresh provider roster against the alliance's reported member count and rejects suspiciously incomplete responses before changing registration state. The worker batch-checks the authoritative Supabase player registry and player-ban registry (up to 100 IDs per query), then skips already-registered and banned players before attempting registration. Per-alliance seen-player state records outcomes for audit and incremental processing; it is not the authoritative count of globally registered players. If a manual sync fails, the server records a retry due in five minutes. The GitHub Actions scheduler wakes the existing worker every five minutes to pick up due syncs and retries; Supabase's daily cron remains a backup wake-up. Both scheduler paths use the same per-alliance database lease, preventing overlapping runs for the same alliance. Successful syncs advance the next scheduled run by 24 hours. Scheduled sync adds newly discovered eligible members; it does not automatically deregister players who leave an alliance.

## Discord bot

The Discord bot provides player profiles with the player's auto-redeem enrollment state, alliance navigation and registration status, verified gift-code lookup, and server alert controls. Use `/bot-info` in Discord for a compact feature summary and an invite link. Player enrollment state is read from the existing Supabase `kingshot_autoredeem` records. A failed lookup is shown as unavailable rather than guessed, and an alliance explicitly marked `unregistered` is not mislabeled as paused.

Discord server Administrator permission is separate from website/project Admin access. Discord-side commands use Discord's native Administrator permission; website announcement administration uses the verified project-owner session.

## Discord bot administration

Discord server **Administrator** permission is separate from the website/project **Admin** role and the verified project-owner bypass. `/set-gift-code-alert-channel` and `/announce` require Discord’s native Administrator permission, checked server-side from the signed interaction payload. The commands are also registered with `default_member_permissions: "8"` and disabled in DMs. A Discord server Administrator can configure that server’s alert destination and publish announcements, but gains no website Admin access, operational privileges, project-owner status, or alliance-registration cap bypass. The project-owner bypass remains a separate exact Discord-account check.

`/set-gift-code-alert-channel channel:#channel` configures the destination for automated gift-code alerts in that server. `/announce channel:#channel title:<title> message:<message>` creates a private preview with **Publish announcement** and **Cancel** controls. Publishing is a separate confirmed action, expires after 15 minutes, suppresses automatic mentions, and rechecks the current server Administrator permission.

## Notifications

Web push is optional. The notification experience includes clearer verified gift-code alerts, concise announcement previews, and duplicate handling intended to replace repeated copies of the same code batch rather than filling the notification tray. Supported notifications can provide actions to open the relevant page or dismiss the alert, depending on browser capabilities.

Administrators can review an announcement's content and destination in an in-app confirmation dialog before sending a broadcast. Browser and operating-system notification features vary, and delivery is not guaranteed. Notification permissions and preferences can be managed through the service and the browser's own settings.

## Developer API

**V4 is the recommended API for new integrations.** It provides player lookup, manual redemption, alliance roster/ranking lookup, read-only redemption history, webhook subscriptions, and compact usage information. Responses use a consistent `success`, `data`, `error`, and `meta` envelope.

- [Interactive developer portal](https://kingshot-autoredeemer.vercel.app/developer)
- [V4 API reference](https://kingshot-autoredeemer.vercel.app/developer-v4.md)
- [OpenAPI 3.1 specification](https://kingshot-autoredeemer.vercel.app/openapi.json)

V4 endpoints include:

| Endpoint | Purpose |
|---|---|
| `GET /api/v4/players/{playerId}` | Look up supported player information. |
| `POST /api/v4/redemptions` | Submit a manual gift-code redemption with idempotency support. |
| `GET /api/v4/alliances` | Read an alliance roster or kingdom alliance rankings. |
| `GET /api/v4/redemption-history` | Read stored redemption history without submitting a new redemption. |
| `GET /api/v4/webhooks` | List webhook subscriptions for the authenticated key. |
| `POST /api/v4/webhooks` | Create a webhook subscription for supported redemption events. |
| `DELETE /api/v4/webhooks/{webhookId}` | Disable a webhook subscription. |
| `GET /api/v4/usage` | Read compact usage counters for the authenticated key. |

Developer keys support permission scopes and optional expiry. Usage counters and last-used information are shown inline in the existing Developer API panel; there is no separate analytics or quota dashboard. Webhook signing secrets are shown once when created. Subscribers should verify the documented HMAC signature and deduplicate events by event ID.

V3 remains available for compatibility. V1 routes are deprecated. For redemption responses, check `data.ok` for the in-game result: an HTTP 200 response means the API request was processed, not necessarily that rewards were granted. For an ambiguous redemption timeout, retry only with the same `Idempotency-Key` and request body, as described in the API documentation.

## How it works

1. **Discover:** configured sources are checked for public gift codes and supported roster data.
2. **Validate:** data is normalized and checked before it is eligible for processing.
3. **Coordinate:** persistent state helps coordinate concurrent work and reduce duplicate operations.
4. **Process:** eligible requests are sent through server-side workflows.
5. **Record:** outcomes are stored so the application can show status and handle recoverable failures.
6. **Notify:** subscribed users may receive supported code alerts or service announcements.

Upstream availability, code validity, player eligibility, and provider rate limits can affect results. The service cannot guarantee that every code will work or every notification will be delivered.

## Cancellation and network safety

Registration workflows provide cancellation controls for work that has not started. Results already received are preserved, and an in-flight request may need to settle because stopping a browser request cannot reliably undo work already accepted by a server.

Manual redemption provides a way to stop waiting for a stalled request. If a redemption may already have reached Kingshot, its outcome can be unknown; the interface should not automatically submit it again. Check the in-game result before retrying. A lost connection or timeout does not prove that the upstream service did nothing. API integrations should follow the documented idempotency guidance.

These controls improve recovery from slow or unreliable connections, but they cannot guarantee cancellation or rollback of an already accepted upstream request.

## Data, reliability, and security

The service uses server-side persistence for registrations, alliance-sync state, redemption records, and queued work. Background jobs coordinate scheduled processing and retry recoverable failures. Implementation details and provider credentials are intentionally omitted here; this README describes the public architecture rather than private deployment topology or recovery procedures.

Security practices include:

- keeping privileged credentials on the server and in managed secret stores;
- enforcing authorization for restricted operations on the server;
- validating external inputs and applying reasonable upstream request limits;
- using browser security headers where supported;
- testing security-sensitive behavior and important workflows;
- running build, type-check, and regression checks through the configured development workflow.

These measures reduce risk but do not guarantee that the service is free from vulnerabilities. Do not submit secrets, authentication tokens, private account information, production logs, or real user data in public issues.

### Reporting a security issue

Use the website's support channel to report a suspected vulnerability. Avoid posting exploit details or sensitive reproduction data publicly. Request a private follow-up channel when sensitive details are required.

## Privacy

The service handles information needed to provide its features. Depending on how you use it, this may include a Player ID, supported provider profile data, redemption status, support messages, account information used for sign-in, push-notification subscriptions, and limited operational telemetry. See the [Privacy notice](https://kingshot-autoredeemer.vercel.app/privacy) for the service's current explanation of data handling.

## Technology

| Layer | Technology |
|---|---|
| Frontend | React 19 |
| Build tooling | Vite 6 |
| Runtime | Node.js 24.x |
| Language | JavaScript/JSX and TypeScript |
| Hosting | Vercel |
| Primary application database and alliance-registration state | Supabase PostgreSQL |
| Redemption recovery journal | Neon PostgreSQL, accessed by server-side redemption handlers |
| Scheduled worker trigger | GitHub Actions and Vercel server-side functions |
| License | GNU Affero General Public License v3.0 (AGPL-3.0) |

The repository contains both JavaScript/JSX and TypeScript. Type checking is part of the available verification workflow; this does not mean every source file has been migrated to TypeScript.

## Local development

### Requirements

- Node.js **24.x**
- npm

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Preview a production build

```bash
npm run preview
```

### Run tests

```bash
npm test
```

### Run TypeScript checks

```bash
npm run typecheck
```

### Run UI regression checks

```bash
npm run test:ui
```

Some features require server-side environment configuration and access to the relevant service projects. Use a development environment for local experiments and do not point them at production data unless authorized.

## Environment configuration

Deployment credentials belong in the appropriate server-side environment or secret store. Keep development and production credentials separate, use least-privilege access, and rotate a credential promptly if it may have been exposed.

Never commit:

- database service credentials or privileged API keys;
- provider credentials;
- Discord client secrets, bot tokens, or webhook URLs;
- authentication, scheduler, or signing secrets;
- session tokens, private user data, or recovery encryption material.

Values included in browser-delivered code must be considered public, regardless of their variable names. Only publish configuration explicitly intended for client-side use.

## Acceptable use

Use only Player IDs you are authorized to submit and legitimate public gift codes. Do not use this project to bypass authentication, evade provider rate limits, flood upstream services, harvest private data, or automate accounts without authorization. Access may be limited when necessary to protect users, the service, or upstream systems.

## Contributing

Changes to redemption behavior, worker coordination, authentication, database access, and recovery workflows can affect production reliability. Keep changes focused and review their consequences before proposing operational changes.

Before submitting a change, run:

```bash
npm test
npm run typecheck
npm run build
```

Run `npm run test:ui` when changing user-interface behavior. The configured verification workflow also runs a dependency audit, security regression checks, tests, type checking, a production build, a production smoke test, and accessibility/responsive/visual UI regression checks. Whether those checks passed for a particular commit must be verified in GitHub Actions. Include regression tests when practical. Never attach credentials, user identifiers, database dumps, production logs, or recovery artifacts to public issues or pull requests.

## Project status

This README describes intended public-facing behavior and is not a live status dashboard. It should not be used to infer current upstream availability, deployment health, or recovery readiness. Check the live service and the repository's workflow status for current information.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](./LICENSE).

AGPL-3.0 includes source-sharing obligations for modified versions made available to users over a network.

---

<div align="center">

**Built for reliable, boring redemption.**

<sub>Independent community software · Not affiliated with Century Games</sub>

</div>

## Frontend accessibility and visual regression

The `ui-regression` verification job runs the built frontend with deterministic API fixtures. It checks accessibility rules, mobile and desktop overflow and overlay geometry, and committed screenshots for key application pages. See [the UI regression guide](docs/ui-regression.md) for local setup and intentional baseline updates.
\n\n### Scheduled announcements\n\nThe private website announcement console can send immediately or schedule a one-time or recurring announcement. Schedules persist in Supabase, support pause/resume/cancel, optional end times, a local timezone label, Discord-only / website-push-only / combined delivery, private image uploads, and validated Discord role mentions. A GitHub Actions worker wakes every five minutes using `CRON_SECRET`; delivery claims are atomic and leased, retries are bounded, and one-time schedules complete after delivery. Configure the repository Actions secret `CRON_SECRET` to match the production environment variable.\n

## Public Kingshot player profiles

Open `/user/{playerId}` for a detailed public Kingshot player profile. The page reuses the existing `/api/kingshot-player` handler and shared MightPulse API-key/quota pool. It does not add a serverless function or expose provider credentials to the browser.

The profile includes public base stats, alliance context and a public alliance roster sorted by power, kingdom-wide context (population, age, activity and aggregate power categories), the recorded arena-defence lineup and its gear, exclusive hero gear, governor gear (including an explicit hidden state), and available kingdom rankings. The kingdom section is explicitly labelled as kingdom-wide data, not an individual governor's power breakdown. Arena defence is not the player's complete owned-hero collection. Provider freshness and cached age are displayed where available. Live online and last-active indicators are omitted because the game no longer supplies reliable activity updates. Missing or hidden sections are labelled rather than represented as zero or empty inventory.

Player profile URLs are discoverable from the navigation drawer at `/user`. Individual `/user/{playerId}` links return server-rendered Open Graph, Twitter Card and Schema.org metadata through the existing `/api/og` handler. The same handler generates a share-card image using the public base profile. No additional serverless function is introduced.
