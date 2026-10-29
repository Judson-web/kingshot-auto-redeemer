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

Created and maintained by **Judson** (`@judson00713` on Discord). [Contact the maintainer on Discord](https://discord.com/users/871756466900598815) for developer API questions, integration help, or project feedback. For account, registration, or redemption issues, use the website's in-app Support Centre so the request stays attached to a support conversation. Response times may vary.

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

The production service is available at [kingshot-autoredeemer.vercel.app](https://kingshot-autoredeemer.vercel.app/).

| Route | Purpose |
|---|---|
| `/` | Home page |
| `/auto` | Automatic redemption |
| `/alliance-registration` | Find an alliance and register eligible roster members |
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

Restricted pages and actions require the appropriate server-side authorization. Listing a route here does not mean it is available to anonymous visitors.

## Alliance registration and sync

Alliance registration fetches the selected alliance roster, then lets users register eligible members in batches or select members individually. Existing registrations are checked before new ones are created, and server-side safeguards help prevent duplicate player records or duplicate sync configurations.

Whole-alliance sync is limited to **three registered alliance configurations per kingdom**. This limit applies to alliance-sync registrations only. It does not prevent registering players from the same kingdom through Auto Redeem, Manual Redeem, or individual-member registration. When a kingdom has reached its alliance-sync limit, the whole-alliance registration option is unavailable while individual-member registration remains available.

Scheduled sync is additions-only: it can register newly discovered eligible members, but does not automatically deregister players who leave an alliance. A provider failure or an incomplete roster should not be treated as proof that every player is new. Registration changes and removal requests are handled through the supported website workflows.

## Notifications

Web push is optional. The notification experience includes clearer verified gift-code alerts, concise announcement previews, and duplicate handling intended to replace repeated copies of the same code batch rather than filling the notification tray. Supported notifications can provide actions to open the relevant page or dismiss the alert, depending on browser capabilities.

Administrators can review an announcement's content and destination in an in-app confirmation dialog before sending a broadcast. Browser and operating-system notification features vary, and delivery is not guaranteed. Notification permissions and preferences can be managed through the service and the browser's own settings.

## Developer API

**V4 is the recommended API for new integrations.** It provides player lookup at `GET /api/v4/players/{playerId}` and manual redemption at `POST /api/v4/redemptions`, with a consistent `success`, `data`, `error`, and `meta` response envelope.

- [Interactive developer portal](https://kingshot-autoredeemer.vercel.app/developer)
- [V4 API reference](https://kingshot-autoredeemer.vercel.app/developer-v4.md)
- [OpenAPI 3.1 specification](https://kingshot-autoredeemer.vercel.app/openapi.json)

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

Supabase PostgreSQL is the primary application data store for registration and related application state. Server-side workflows coordinate registration and processing, while automated checks help protect important behavior. Supporting infrastructure may change over time, so this README intentionally describes the public-facing architecture rather than private deployment topology or operational procedures.

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
| Primary application database | Supabase PostgreSQL |
| Additional components | GitHub Actions and supporting server-side services |
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

Run `npm run test:ui` when changing user-interface behavior. Include regression tests when practical. Never attach credentials, user identifiers, database dumps, production logs, or recovery artifacts to public issues or pull requests.

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
