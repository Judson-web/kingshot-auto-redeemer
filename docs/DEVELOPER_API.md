# Kingshot Auto Redeemer — Developer API

Base URL: https://kingshot-autoredeemer.vercel.app

**Current version: V3.** Use HTTPS and JSON. V1 endpoints remain available for existing integrations; new integrations should use V3. Never place API keys in URLs, browser bundles, client-visible environment variables, or logs.

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

Success responses contain data and meta. The data object has playerId, name, kingdomId, power, townCenterLevel and avatarUrl. Some fields may be null. Metadata includes apiVersion, requestId, timestamp, and upstream freshness fields fetchedAt, providerFresh, providerAgeSeconds and stale. The provider may return cached data, so do not assume every response reflects a real-time lookup.

## V3 manual redemption

POST /api/v3/redemptions

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

Unknown properties and non-string field values are rejected. A completed redemption operation returns HTTP 200 and places the actual game result in data.ok, data.status, data.message, data.errorCategory and data.errCode. HTTP 200 means the operation completed, not that rewards were necessarily granted. V3 does not promise idempotent or exactly-once execution; an upstream timeout may leave an ambiguous outcome, so do not automatically retry it.

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
| 400 | Invalid path parameter or JSON body |
| 401 | Missing, invalid or revoked developer key |
| 404 | Player or route not found |
| 405 | Unsupported HTTP method |
| 415 | Redemption request must use application/json |
| 429 | Per-key or per-IP limit exceeded |
| 502 | Upstream provider unavailable |
| 503 | Authorization, trusted-IP or provider configuration unavailable |
| 504 | Upstream player lookup or redemption timed out |

Responses include X-Request-Id and X-API-Version. Quota headers include X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset when available. On 429, honor Retry-After and use bounded backoff. Include the request ID in support reports, never the API key.

## Rate limits

- Per developer key: 60 requests per minute and 1,000 per UTC day.
- Shared per-IP API limit: 120 requests per minute.
- Website registration: 60 requests per minute per IP.
- Website manual redemption: 12 requests per minute per IP.

Quota accounting for the developer API is database-backed and shared across serverless instances. Do not rotate IPs or keys to bypass limits.

## V1 compatibility

GET /api/v1/player?id=PLAYER_ID and POST /api/v1/redeem remain available for existing clients and retain their legacy response envelope. Use V3 for the REST-style player path, nested error envelope and explicit upstream freshness metadata.

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

## Related links

- Automatic redemption: https://kingshot-autoredeemer.vercel.app/auto
- Manual redemption: https://kingshot-autoredeemer.vercel.app/manual
- Developer portal: https://kingshot-autoredeemer.vercel.app/developer
- OpenAPI 3.1: https://kingshot-autoredeemer.vercel.app/openapi.json
- Privacy: https://kingshot-autoredeemer.vercel.app/privacy?service=kingshot-auto
- Terms: https://kingshot-autoredeemer.vercel.app/terms?service=kingshot-auto
