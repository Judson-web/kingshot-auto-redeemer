# Kingshot Auto Redeemer — Developer API

Base URL: https://kingshot-autoredeemer.vercel.app

**Current version: V3.** Use HTTPS and JSON. V1 developer routes are deprecated. Migrate existing integrations to V3 now; new integrations must use V3. Never place API keys in URLs, browser bundles, client-visible environment variables, or logs.

## Endpoints

| Method | Endpoint | Auth |
|---|---|---|
| GET | /api/v3/players/{playerId} | Developer Bearer key |
| POST | /api/v3/redemptions | Developer Bearer key |
| GET | /api/v1/player?id=PLAYER_ID | Developer Bearer key; legacy |
| POST | /api/v1/redeem | Developer Bearer key; legacy |
| POST | /api/kingshot-register | Public website flow; rate limited |
| POST | /api/kingshot-redeem | Public website flow; rate limited |
| GET | /api/kingshot-health | Public status |

The registration endpoint enrolls a player in the existing workflow; it does not start or control the worker. /api/kingshot-auto is an internal scheduler/worker endpoint and must not be used as a third-party API.

## Authentication

Create a developer account at https://kingshot-autoredeemer.vercel.app/developer using Discord sign-in, then create a key. The full key is displayed only once; the database stores a SHA-256 hash of it. Send it in the Authorization header:

    Authorization: Bearer ks_live_YOUR_64_CHARACTER_SECRET

Store the key server-side. Revoke it immediately if it may have leaked. Developer API keys are separate from website sign-in cookies.

## V3 player lookup

GET /api/v3/players/43180889

The playerId path parameter must be a string containing 5–20 digits.

    curl "https://kingshot-autoredeemer.vercel.app/api/v3/players/43180889" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY"

Success responses contain data and meta. The data object has playerId, name, kingdomId, power, townCenterLevel, avatarUrl, allianceName and allianceTag. The alliance fields are nullable when the provider has no alliance data. Fields that are missing or invalid at the provider may be null. Metadata includes apiVersion, requestId, timestamp, and provider freshness fields fetchedAt, providerFresh, providerAgeSeconds and stale. The provider may return cached data, so do not assume every response reflects a real-time lookup.

V3 bounds each upstream player-read attempt and retries at most once after a transient network or 5xx failure. It does not retry player-not-found, authentication/configuration failures or provider rate limits. If the bounded attempts fail, the API returns a structured error rather than waiting on an unbounded provider request. A 504 means the provider read did not complete within the bounded time budget; use bounded client backoff for another lookup.

## V3 manual redemption

POST /api/v3/redemptions

Optional `Idempotency-Key` (8–128 safe ASCII characters) enables durable replay protection for 24 hours, scoped to the developer key. Same key and body replays the stored response; a different body returns 409. Concurrent requests return 409. A stale in-progress request becomes an explicit unknown outcome rather than being submitted again. Storage failures reject keyed requests before redemption. Requests without this header retain legacy non-idempotent behavior.

    curl -X POST "https://kingshot-autoredeemer.vercel.app/api/v3/redemptions" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'

The JSON body must contain exactly these string fields:

| Field | Validation |
|---|---|
| playerId | 5–20 digits |
| code | 1–64 letters, digits, underscores or hyphens |
| kid | 1–10 digits |

Unknown properties and non-string field values are rejected. A completed redemption operation returns HTTP 200 and places the actual game result in data.ok, data.status, data.message, data.errorCategory and data.errCode. HTTP 200 means the operation completed, not that rewards were necessarily granted. V3 does not promise exactly-once execution by the upstream game provider. With an Idempotency-Key, this API prevents the same key/body from triggering another provider call and replays the stored result. A timeout or crash can still leave an ambiguous outcome; reuse the same key and never use a new key to blindly repeat the redemption.

## V3 error format

Errors have a stable nested shape:

    {
      "error": {
        "code": "invalid_player_id",
        "message": "The playerId path parameter must contain 5–20 digits."
      },
      "meta": {
        "apiVersion": "3",
        "requestId": "server-generated-id",
        "timestamp": "2026-10-17T12:00:00.000Z"
      }
    }

| HTTP | Meaning |
|---:|---|
| 400 | Invalid path parameter, JSON body, or idempotency key |\n| 409 | Idempotency key conflict or request still processing |
| 401 | Missing, invalid or revoked developer key |
| 404 | Player or route not found |
| 405 | Unsupported HTTP method |
| 415 | Redemption request must use application/json |
| 429 | Per-key or per-IP limit exceeded |
| 502 | Invalid provider response or provider unavailable |
| 503 | Authorization, trusted-IP, provider authentication/configuration or provider rate-limit issue |
| 504 | Upstream player lookup or redemption timed out |

Responses include X-Request-Id and X-API-Version. Quota headers include X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Daily-Limit and X-RateLimit-Daily-Remaining when available. On 429, honor Retry-After and use bounded backoff. Include the request ID in support reports, never the API key.

## Rate limits

- Per developer key: 60 requests per minute and 1,000 per UTC day.
- Shared per-IP API limit: 120 requests per minute.
- Website registration: 60 requests per minute per IP.
- Website manual redemption: 12 requests per minute per IP.

Quota accounting for the developer API is database-backed and shared across serverless instances. Do not rotate IPs or keys to bypass limits.

## Deprecated V1 routes

`GET /api/v1/player?id=PLAYER_ID` and `POST /api/v1/redeem` are deprecated. They currently remain operational during migration and emit `Deprecation: true` plus a `Link` header pointing to the relevant V3 endpoint and migration documentation. They retain their legacy response envelope during this transition; no retirement date is published yet. Do not build new integrations on V1.

Migrate as follows:

- Player lookup: `GET /api/v3/players/{playerId}`
- Manual redemption: `POST /api/v3/redemptions` with JSON fields `playerId`, `code`, and `kid`

V3 provides the normalized response envelope, request IDs, quota metadata, and player-provider freshness metadata.

## Automatic redemption enrollment

POST /api/kingshot-register registers a player for scheduled processing. It does not start or stop the worker, force an individual redemption, or guarantee a code is eligible. It does not use developer Bearer-key authentication.

    curl -X POST "https://kingshot-autoredeemer.vercel.app/api/kingshot-register" \
      -H "Content-Type: application/json" \
      -d '{"playerId":"43180889","kingdomId":"1125","playerName":"Example Player"}'

## Security

- Use only Player IDs you are authorized to access.
- Keep API keys on trusted servers and revoke leaked keys.
- Never call internal scheduler/worker endpoints from integrations.
- Read redemption response bodies and avoid blind retries after ambiguous timeouts.
- Respect rate limits and HTTPS.

## Maintainer and contact

This project is built and maintained by **Judson** (`@judson00713` on Discord). For V3 integration questions, API feedback, or project-related development questions, [contact the maintainer on Discord](https://discord.com/users/871756466900598815). This opens the Discord profile; direct messages depend on account privacy settings and availability, and response times may vary.

For private account, player-registration, or redemption issues, use the website's in-app Support Centre instead of sending player details, credentials, API keys, or tokens in a Discord DM. That keeps the issue attached to a support conversation.

## Related links

- Maintainer / Discord: https://discord.com/users/871756466900598815
- Automatic redemption: https://kingshot-autoredeemer.vercel.app/auto
- Manual redemption: https://kingshot-autoredeemer.vercel.app/manual
- Developer portal: https://kingshot-autoredeemer.vercel.app/developer
- OpenAPI 3.1: https://kingshot-autoredeemer.vercel.app/openapi.json
- Privacy: https://kingshot-autoredeemer.vercel.app/privacy?service=kingshot-auto
- Terms: https://kingshot-autoredeemer.vercel.app/terms?service=kingshot-auto
