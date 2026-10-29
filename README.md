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

Created and maintained by **Judson** (`@judson00713` on Discord). [Contact the maintainer on Discord](https://discord.com/users/871756466900598815) for developer API questions, integration help, or project feedback. For account-specific, registration, or redemption issues, use the website's in-app Support Centre so the request stays attached to a support conversation. Direct messages depend on Discord privacy settings and availability; response times may vary.

---

## Overview

Kingshot Auto Redeemer helps players discover eligible public gift codes and redeem them through automatic or manual workflows. It combines a web application with server-side processing, persistent state, player lookup, and operational safeguards.

| Capability | Description |
|---|---|
| Gift-code discovery | Collects and normalizes eligible codes from configured public sources. |
| Automatic redemption | Processes registered Player IDs through coordinated server-side workers. |
| Manual redemption | Lets a player submit a code and receive a clear result, with guidance if a network timeout leaves the outcome uncertain. |
| Player profiles | Displays available player information, including supported avatar and Town Center details. |
| Code and player status | Distinguishes common registration and redemption outcomes so users can understand what happened. |
| Support | Provides a support workflow for reporting problems and following up. |
| Web push | Optional notifications for relevant service updates and verified new codes. |
| Administration | Restricted operational tools, including dedicated maintenance controls. |
| Reliability | Uses persistent coordination, rate-aware upstream requests, validation, and automated checks. |

## Live website

The production service is available at [kingshot-autoredeemer.vercel.app](https://kingshot-autoredeemer.vercel.app/).

| Route | Purpose |
|---|---|
| `/` | Home page |
| `/auto` | Automatic redemption |
| `/alliance-registration` | Search and select an alliance; the roster is fetched automatically. Register all eligible members in batches or manually choose individual members. A single additions-only 24-hour sync is configured for the alliance, with existing Supabase registrations skipped. |
| `/manual` | Manual redemption |
| `/redeem` | Redemption experience |
| `/gift-codes` | Gift-code information |
| `/info` | Service information |
| `/profile` | Shared account profile and settings |
| `/message` | Public message page |
| `/developer` | Developer API and key management |
| `/devsupport` | Developer support |
| `/push` | Restricted push-notification tools |
| `/admin/maintenance` | Restricted maintenance controls |
| `/terms` | Terms of service |
| `/privacy` | Privacy notice |

Restricted pages and actions require the appropriate server-side authorization. A route being listed here does not mean it is available to anonymous visitors.

## Automatic alliance sync

Enabled alliance sync configurations are checked by a server-side worker on a frequent schedule, with per-alliance leases, fresh-roster validation, duplicate-registration checks against Supabase, and retry backoff. The GitHub Actions scheduler requires the `ALLIANCE_SYNC_CRON_SECRET` repository secret to match the Vercel worker secret. See [Automatic Alliance Sync Scheduler](./docs/alliance-sync-scheduler.md) for setup and verification.

## Developer API

**V4 is the current API for new integrations.** It provides player lookup at `GET /api/v4/players/{playerId}` and manual redemption at `POST /api/v4/redemptions`, with a consistent `success`, `data`, `error`, and `meta` response envelope.

- [Interactive developer portal](https://kingshot-autoredeemer.vercel.app/developer)
- [V4 API reference](https://kingshot-autoredeemer.vercel.app/developer-v4.md)
- [OpenAPI 3.1 specification](https://kingshot-autoredeemer.vercel.app/openapi.json)

V3 remains available without changing its existing response shape for compatibility. V1 routes are deprecated. For redemption responses, check `data.ok` for the in-game result: an HTTP 200 response means the API request was processed, not necessarily that rewards were granted. For an ambiguous redemption timeout, retry only with the same `Idempotency-Key` and request body.


## How it works

1. **Discover:** configured sources are checked for public gift codes.
2. **Validate:** discovered data is normalized, checked, and deduplicated before it is eligible for processing.
3. **Coordinate:** persistent database state coordinates worker activity and helps prevent duplicate work across concurrent executions.
4. **Redeem:** eligible requests are sent through the server-side redemption workflow.
5. **Record:** outcomes are stored so the application can show status and handle recoverable failures.
6. **Notify:** optional web-push notifications can alert subscribed users to supported updates.

Upstream availability, code validity, player eligibility, and provider rate limits can affect results. The service cannot guarantee that every code will work or that every notification will be delivered.

## Registration cancellation and network safety

Whole-alliance registration processes eligible members in bounded batches and provides a cooperative **Cancel remaining** control. Individual-member registration and automatic-registration batches also provide the same control. Cancellation stops the next unstarted player from being submitted and preserves results already received; an in-flight request is allowed to settle because stopping the browser request cannot reliably undo work already accepted by the server. Closing or refreshing a tab is only a best-effort stop signal, not a durable server-side cancellation guarantee.

Manual redemption provides a **Stop waiting** action for a stalled request. If the player lookup is cancelled before a gift code is submitted, the code is not sent by that flow. If the redemption request may already have reached Kingshot, the result is treated as unknown: the UI does not automatically resubmit it. Check the in-game result before trying again. A lost connection or timeout does not prove that the upstream service did nothing. For API integrations, follow the documented idempotency guidance and reuse the same `Idempotency-Key` and request body when retrying an ambiguous request.

These controls improve recovery from slow or unreliable connections, but they cannot guarantee cancellation of an already accepted upstream request. Never interpret a browser-side stop as proof that a server-side action was rolled back.

## Database and worker architecture

Supabase PostgreSQL is the authoritative registry for player registrations and application account state, and it stores automatic alliance-sync configurations, run history, leases, seen-player status, and durable manual-registration queue state. Neon PostgreSQL is retained only for the independent redemption-recovery journal. Alliance sync checks Supabase before attempting registration and skips IDs already registered there; the existing registration RPC remains the final guard for new registrations.

Alliance member registration supports two explicit paths: **Register entire alliance** fetches the selected alliance roster and processes all eligible IDs in batches of up to 100; **Register selected members** lets the user manually choose individual IDs. The roster is fetched when an alliance is selected, and the user can refresh it before submitting. Already-registered IDs are checked against Supabase and skipped. Alliance-wide registration creates one durable scheduler configuration and immediately runs the roster through the same server-side sync engine. Each kingdom is limited to four registered alliance-sync configurations, enforced during creation and exposed through an authenticated capacity check. This cap applies only to whole-alliance sync registration: it does not restrict player registration from any alliance through Auto Redeem, Manual Redeem, or individual-member registration. When all four slots are used, the UI hides the whole-alliance registration option but keeps individual-member registration available. Already-registered alliances display a persistent **Alliance registered** status rather than another registration option. Scheduler configurations cannot be deleted through the UI or API; users can pause/resume sync, and any removal request must go through Support's **Registration removal** topic. Choosing an already-registered alliance runs the same guarded sync instead of creating another scheduler or duplicate player records. The scheduled worker refreshes the provider roster every 24 hours and adds only newly discovered, unregistered members. It never deregisters departed members. A provider failure, stale/incomplete roster, or unverifiable Supabase status fails closed rather than treating every player as new. The scheduled worker is separate from the redemption worker, and both routes are consolidated through the existing player API entrypoint to stay within the deployment platform's serverless-function limits.

Public documentation deliberately omits secret names and values, database identifiers, private user records, and recovery artifacts. Keep the Neon connection strings, Supabase service credentials, and scheduler authorization secret in the deployment secret store only.

## Reliability and upstream request handling

The worker uses database-backed coordination rather than relying only on in-memory process state. The service includes retry and recovery handling, health checks, and regression tests for important workflows.

MightPulse requests use a server-side pool of configured credentials where available. The pool coordinates request budgets and cooldowns, avoids duplicate configured credentials, and can move to another eligible credential when an upstream response makes that appropriate. Usage information and upstream rate limits are treated as constraints—not as something to bypass. If available request capacity is exhausted, work should wait or fail safely rather than trigger a retry storm.

Only configure credentials that have actually been issued to the service operator. Optional unused slots can remain unset; do not create additional accounts or duplicate credentials just to fill them. The obsolete unnumbered KSS configuration is not part of the intended setup. **Never put provider credentials in this README, browser code, public issues, logs, or commits.**

Production application state is held in Supabase/PostgreSQL. Separate recovery and archive systems may support operational recovery, but their current freshness and availability are not guaranteed by this README. This public documentation intentionally omits internal identifiers, live recovery checkpoints, secret names and values, and detailed operational procedures.

## Privacy and security

The service handles the information needed to provide its features, which may include a Player ID, player/profile data returned by supported providers, redemption status, support messages, account information used for sign-in, and limited operational telemetry. The exact data collected and applicable retention details are described in the [Privacy notice](https://kingshot-autoredeemer.vercel.app/privacy).

Security practices include:

- keeping privileged credentials on the server and in managed secret stores;
- enforcing authorization for restricted operations on the server;
- validating external inputs and limiting upstream requests;
- using restrictive browser security headers;
- checking security-sensitive behavior with automated regression tests;
- running build, type-check, smoke-test, and workflow verification where configured.

These measures reduce risk but do not guarantee that the service is free from vulnerabilities. Do not submit secrets, authentication tokens, private account information, production logs, or real user data in public issues.

### Reporting a security issue

Use the website's support channel to report a suspected vulnerability. Avoid posting exploit details or sensitive reproduction data publicly. Request a private follow-up channel when the report requires sensitive details.

## Technology

| Layer | Technology |
|---|---|
| Frontend | React 19 |
| Build tooling | Vite 6 |
| Runtime | Node.js 24.x |
| Language | JavaScript/JSX and TypeScript |
| Hosting | Vercel |
| Primary application database | Supabase PostgreSQL |
| Redemption-recovery journal | Neon PostgreSQL, accessed only from server-side handlers |
| Additional components | Supabase Storage, GitHub Actions, and supporting server-side services |
| License | GNU Affero General Public License v3.0 (AGPL-3.0) |

The repository contains both JavaScript/JSX and TypeScript. Type checking is part of the available verification workflow; this should not be interpreted as a claim that every source file has been migrated to TypeScript.

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

Some application features require server-side environment configuration and access to the relevant service projects. Do not point local experiments at production data unless you are authorized and intend to do so.

## Environment configuration

Deployment credentials are managed through the appropriate server-side environment or secret store. Keep development and production credentials separate, use least-privilege access, and rotate a credential promptly if it may have been exposed.

Never commit:

- Supabase service-role or secret keys;
- MightPulse/Kingshot provider credentials;
- Discord client secrets, bot tokens, or webhook URLs;
- authentication, scheduler, or signing secrets;
- session tokens, private user data, or recovery encryption material.

Values included in browser-delivered code must be considered public, regardless of their variable names. Only publish configuration explicitly intended for client-side use.

## Acceptable use

Use only Player IDs you are authorized to submit and legitimate public gift codes. Do not use this project to bypass authentication, evade provider rate limits, rotate IP addresses to circumvent restrictions, flood upstream services, harvest private data, or automate accounts without authorization. Access may be limited when necessary to protect users, the service, or upstream systems.

## Contributing

Changes to redemption behavior, worker coordination, authentication, database access, and recovery workflows can affect production reliability. Keep changes focused and review the consequences before proposing operational changes.

Before submitting a change, run:

```bash
npm test
npm run typecheck
npm run build
```

Include regression tests when practical. Never attach credentials, user identifiers, database dumps, production logs, or recovery artifacts to public issues or pull requests.

## Project status

The service is deployed as a production community project. Development is intentionally kept conservative when the service is stable: documentation and necessary maintenance can proceed, while feature work and operational changes should be deliberate. This repository README describes the intended public-facing behavior; it is not a live status dashboard and should not be used to infer current upstream availability or backup freshness.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](./LICENSE).

AGPL-3.0 includes source-sharing obligations for modified versions made available to users over a network.

---

<div align="center">

**Built for reliable, boring redemption.**

<sub>Independent community software · Not affiliated with Century Games</sub>

</div>


## Frontend accessibility and visual regression

The `ui-regression` verification job runs the built frontend with deterministic API fixtures. It checks WCAG A/AA accessibility rules, mobile/desktop overflow and overlay geometry, and committed screenshots for the homepage, Support Centre, Profile, Developer API and protected player database. See [the UI regression guide](docs/ui-regression.md) for local setup and intentional baseline updates.
