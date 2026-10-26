# Kingshot Auto Redeemer — Developer API

Interactive documentation: https://kingshot-autoredeemer.vercel.app/developer

Current API version: **V4**. Full V4 reference: https://kingshot-autoredeemer.vercel.app/developer-v4.md. This crawler-friendly reference describes integration routes but does not provide credentials.

## Response attribution

Documented public JSON responses include a top-level `dev` object on success and error responses:

    "dev": {
      "name": "Judson",
      "discord": "@judson00713",
      "url": "https://discord.com/users/871756466900598815"
    }

This is project-maintainer contact information, not an API key or permission grant. V4 responses use a consistent success/data/error/meta envelope. V3 and V1 compatibility routes retain their existing response formats.

## Authentication

Send an active developer key over HTTPS in the Authorization header:

    Authorization: Bearer YOUR_API_KEY

Create and revoke keys at https://kingshot-autoredeemer.vercel.app/developer. The key is shown only once and is stored as a SHA-256 hash. Keep keys server-side, never in browser JavaScript, URLs, logs or public repositories.

## V4 current API

V4 is the recommended version for new integrations. Full documentation: https://kingshot-autoredeemer.vercel.app/developer-v4.md

### Player lookup

- Method: GET
- Path: /api/v4/players/{playerId}
- Auth: developer Bearer key
- playerId: string of 5–20 digits

    curl "https://kingshot-autoredeemer.vercel.app/api/v4/players/43180889" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY"

### Manual redemption

- Method: POST
- Path: /api/v4/redemptions
- Auth: developer Bearer key
- Content-Type: application/json
- Body: exactly playerId, code and kid, all strings

    curl -X POST "https://kingshot-autoredeemer.vercel.app/api/v4/redemptions" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: redeem-43180889-example-001" \
      -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'

Use an Idempotency-Key of 8–128 safe ASCII characters for redemption requests. Reusing the same key and body replays the recorded outcome; a different body with the same key returns 409. V4 idempotency keys are namespaced separately from V3. For an ambiguous timeout, retry only with the same key and body. This reduces duplicate attempts but cannot guarantee exactly-once execution by the upstream game.

### V4 response envelope

V4 JSON success and error responses use the same top-level fields: success, data, error, meta and dev. The meta object always includes apiVersion ("4"), requestId and timestamp. The X-Request-Id and X-API-Version headers mirror request tracing and version metadata.

- On a successful API operation: success is true, data contains the endpoint result, and error is null.
- On an API error: success is false, data is null, and error contains a stable code and human-readable message.
- For redemption specifically, success means the API request was processed. Check data.ok and data.status for the in-game result; a processed redemption can return HTTP 200 while data.ok is false.

Example API error:

    {
      "success": false,
      "data": null,
      "error": {
        "code": "player_not_found",
        "message": "No player was found for this ID."
      },
      "meta": {
        "apiVersion": "4",
        "requestId": "server-generated-id",
        "timestamp": "2026-10-26T10:00:00.000Z"
      },
      "dev": {
        "name": "Judson",
        "discord": "@judson00713",
        "url": "https://discord.com/users/871756466900598815"
      }
    }

On HTTP 429, honor Retry-After and use bounded backoff. Do not automatically retry invalid requests, revoked keys, or redemption calls with a new idempotency key.

## V3 compatibility: player lookup

- Method: GET
- Path: /api/v3/players/{playerId}
- Auth: developer Bearer key
- playerId: string of 5–20 digits
- Limits: 60 requests/minute and 1,000 requests/day per key, plus 120 requests/minute per IP

    curl "https://kingshot-autoredeemer.vercel.app/api/v3/players/43180889" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY"

Success responses contain data and meta. Metadata includes apiVersion, requestId, timestamp, rateLimit and provider freshness fields fetchedAt, providerFresh, providerAgeSeconds and stale. Player fields may be null. Reads use bounded timeouts and at most one retry for transient network/5xx failures; not-found, provider rate-limit and authentication/configuration errors are not automatically retried.

## V3 compatibility: manual redemption

- Method: POST
- Path: /api/v3/redemptions
- Auth: developer Bearer key
- Content-Type: application/json
- Body: exactly playerId, code and kid as strings

    curl -X POST "https://kingshot-autoredeemer.vercel.app/api/v3/redemptions" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'

playerId must be 5–20 digits, code must contain 1–64 letters/digits/underscores/hyphens, and kid must contain 1–10 digits. Unknown fields are rejected. Inspect data.ok, data.status, data.message, data.errorCategory and data.errCode. HTTP 200 means the operation completed, not necessarily that rewards were granted. V3 never automatically retries redemptions. For safer retries, send an optional Idempotency-Key (8–128 safe ASCII characters): the same key and same body replay the stored outcome, while the same key with a different body returns 409. Replays preserve the original redemption outcome but refresh meta.requestId, meta.timestamp and rateLimit to describe the current HTTP attempt; the request ID in the body therefore matches X-Request-Id. Duplicate Idempotency-Key header values are rejected. For an ambiguous timeout, retry only with the same key and same body. This prevents an identical key/body from triggering a second provider call, but cannot guarantee exactly-once execution if the upstream result itself is ambiguous.

## V3 errors

Errors have this shape:

    {
      "error": { "code": "invalid_player_id", "message": "The playerId path parameter must contain 5–20 digits." },
      "meta": { "apiVersion": "3", "requestId": "server-generated-id", "timestamp": "2026-10-17T12:00:00.000Z" }
    }

Typical statuses: 400 invalid input; 401 missing/invalid/revoked key; 404 not found; 405 unsupported method; 415 wrong content type; 429 quota exceeded; 502 invalid provider response/provider unavailable; 503 configuration/authorization/provider rate limit unavailable; 504 timeout. Check Retry-After on 429 and use bounded backoff.

## V1 compatibility

- GET /api/v1/player?id=PLAYER_ID
- POST /api/v1/redeem

Both are deprecated and emit migration headers while they remain operational. New integrations must use V4. V3 remains available for existing integrations.

## Website enrollment

POST /api/kingshot-register is the public rate-limited website registration workflow. It enrolls a player for scheduled redemption; it does not start or control the worker.

## Security notes

- Use HTTPS and keep keys on a trusted server.
- Do not put keys in query strings, frontend bundles, logs, screenshots or public issue reports.
- Respect quotas; do not rotate IPs or keys to evade restrictions.
- Do not call internal scheduler or worker endpoints from clients.
- Use only Player IDs you are authorized to access.

## Maintainer and contact

Built and maintained by **Judson** (`@judson00713` on Discord). For API integration questions, developer feedback, or project-related issues, contact the maintainer through the [Discord profile](https://discord.com/users/871756466900598815). Direct messages depend on Discord privacy settings and availability; response times may vary.

For account, registration, or redemption issues, use the in-app Support Centre so the request can be followed in its own conversation. Never send passwords, API keys, session tokens, or sign-in codes through Discord.

OpenAPI 3.1: https://kingshot-autoredeemer.vercel.app/openapi.json
Developer contact: https://discord.com/users/871756466900598815
Privacy: https://kingshot-autoredeemer.vercel.app/privacy
Terms: https://kingshot-autoredeemer.vercel.app/terms
