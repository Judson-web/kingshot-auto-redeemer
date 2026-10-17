# Kingshot Auto Redeemer — Developer API

Interactive documentation: https://kingshot-autoredeemer.vercel.app/developer

Current API version: **V3**. This crawler-friendly reference describes integration routes but does not provide credentials.

## Authentication

Send an active developer key over HTTPS in the Authorization header:

    Authorization: Bearer YOUR_API_KEY

Create and revoke keys at https://kingshot-autoredeemer.vercel.app/developer. The key is shown only once and is stored as a SHA-256 hash. Keep keys server-side, never in browser JavaScript, URLs, logs or public repositories.

## V3 player lookup

- Method: GET
- Path: /api/v3/players/{playerId}
- Auth: developer Bearer key
- playerId: string of 5–20 digits
- Limits: 60 requests/minute and 1,000 requests/day per key, plus 120 requests/minute per IP

    curl "https://kingshot-autoredeemer.vercel.app/api/v3/players/43180889" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY"

Success responses contain data and meta. Metadata includes apiVersion, requestId, timestamp, rateLimit and provider freshness fields fetchedAt, providerFresh, providerAgeSeconds and stale. Player fields may be null. Reads use bounded timeouts and at most one retry for transient network/5xx failures; not-found, provider rate-limit and authentication/configuration errors are not automatically retried.

## V3 manual redemption

- Method: POST
- Path: /api/v3/redemptions
- Auth: developer Bearer key
- Content-Type: application/json
- Body: exactly playerId, code and kid as strings

    curl -X POST "https://kingshot-autoredeemer.vercel.app/api/v3/redemptions" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'

playerId must be 5–20 digits, code must contain 1–64 letters/digits/underscores/hyphens, and kid must contain 1–10 digits. Unknown fields are rejected. Inspect data.ok, data.status, data.message, data.errorCategory and data.errCode. HTTP 200 means the operation completed, not necessarily that rewards were granted. A timeout may have an ambiguous upstream outcome; do not blindly retry. V3 does not guarantee idempotent execution and never automatically retries redemptions.

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

Both remain available for existing clients with the legacy response envelope. New integrations should use V3.

## Website enrollment

POST /api/kingshot-register is the public rate-limited website registration workflow. It enrolls a player for scheduled redemption; it does not start or control the worker.

## Security notes

- Use HTTPS and keep keys on a trusted server.
- Do not put keys in query strings, frontend bundles, logs, screenshots or public issue reports.
- Respect quotas; do not rotate IPs or keys to evade restrictions.
- Do not call internal scheduler or worker endpoints from clients.
- Use only Player IDs you are authorized to access.

OpenAPI 3.1: https://kingshot-autoredeemer.vercel.app/openapi.json
Privacy: https://kingshot-autoredeemer.vercel.app/privacy
Terms: https://kingshot-autoredeemer.vercel.app/terms
