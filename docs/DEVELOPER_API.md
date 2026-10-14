# Developer API

Base URL: `https://kingshot-autoredeemer.vercel.app`

Use HTTPS for every request. API responses are JSON and include a request identifier where applicable. The public `/developer` page contains interactive key management and examples; this document is the copyable reference.

## Authentication

Create a key at [/developer](https://kingshot-autoredeemer.vercel.app/developer). Send it as `Authorization: Bearer YOUR_API_KEY`. Never place keys in query parameters, browser bundles, screenshots, or public repositories. The full key is shown only once; the database stores a SHA-256 hash. Revoke compromised keys from the developer account panel.

## Endpoints at a glance

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/player?id=PLAYER_ID` | Bearer API key | Versioned player lookup |
| `POST` | `/api/v1/redeem` | Bearer API key | Manual redemption request |
| `GET` | `/api/kingshot-player?id=PLAYER_ID` | Public, rate limited | Legacy player lookup |
| `POST` | `/api/kingshot-redeem` | Public, rate limited | Website manual-redemption route |
| `POST` | `/api/kingshot-register` | Public, rate limited | Register a player for existing auto-redemption |
| `GET` | `/api/kingshot-health` | Public | Health summary |

`/api/kingshot-auto` is an internal scheduler/worker endpoint. It is not a public integration API. Do not call it from clients or expose scheduler credentials.

## Player lookup

`GET /api/v1/player?id=43180889`

The `id` query parameter must contain 5–20 digits. Example:

```bash
curl "https://kingshot-autoredeemer.vercel.app/api/v1/player?id=43180889" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Example response shape (values are illustrative):

```json
{
  "data": {
    "playerId": "43180889",
    "name": "Example Player",
    "kingdomId": "1125",
    "power": 123456789,
    "townCenterLevel": 30,
    "avatarUrl": null
  },
  "meta": {
    "requestId": "server-generated-id",
    "timestamp": "2026-10-14T12:00:00.000Z",
    "fetchedAt": "2026-10-14T11:59:58.000Z",
    "source": "provider",
    "stale": false,
    "remaining": 59,
    "dailyRemaining": 999
  }
}
```

Some profile fields may be null when unavailable. Treat `meta.stale` and `meta.fetchedAt` as freshness signals; a successful response can use an explicitly identified cached result if the upstream provider is temporarily unavailable.

## Manual redemption

`POST /api/v1/redeem`

Requires a valid API key. JSON body:

```json
{
  "playerId": "43180889",
  "code": "EXAMPLECODE",
  "kid": "1125"
}
```

Example request:

```bash
curl -X POST "https://kingshot-autoredeemer.vercel.app/api/v1/redeem" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'
```

A successful HTTP status means the API processed the request, not necessarily that the game accepted the code. Inspect `data.status`, `data.errorCategory`, and the returned message for the redemption outcome. Codes may be expired, invalid, already claimed, or limited by the game.

## Existing automatic redemption workflow

Players can opt in to the existing scheduled workflow through `POST /api/kingshot-register`. The registration payload accepts `playerId` and optional `kingdomId`, `playerName`, and `avatarUrl`. The service validates the player and schedules eligible public gift codes through its internal worker.

This is registration for the existing workflow, not a per-key API command to start or stop the worker. The internal scheduler remains private.

## Rate limits and headers

Current documented key quotas:

- 60 requests per minute per API key.
- 1,000 requests per day per API key.
- 120 requests per minute per IP.

Responses may include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`, and request ID metadata. On `429`, respect `Retry-After` when present and retry with exponential backoff. Do not attempt to evade rate limits by rotating IP addresses or keys.

## Errors

| HTTP status | Meaning | Recommended action |
|---:|---|---|
| `400` | Missing or invalid input | Validate the request body and Player ID |
| `401` | Missing, invalid, or revoked API key | Check the Authorization header and key status |
| `404` | Player or route not found | Confirm the Player ID and endpoint |
| `429` | Key quota or IP rate limit exceeded | Back off and check reset headers |
| `502` | Upstream provider unavailable | Retry later with bounded backoff |
| `503` | Server-side integration not configured | Contact the service operator |
| `504` | Upstream request timed out | Retry later; avoid tight loops |

Where provided, error responses contain a stable `code`, readable `error`, and `meta.requestId`. Include the request ID in a support report; do not send your API key.

## Security and responsible use

Use only Player IDs you are authorized to access. Do not probe protected endpoints, bypass authentication, evade quotas, flood upstream services, or expose API keys. The service may throttle or revoke access to protect users and upstream systems.

## Related links

- [Developer portal and API key management](https://kingshot-autoredeemer.vercel.app/developer)
- [Service information](https://kingshot-autoredeemer.vercel.app/info)
- [Privacy notice](https://kingshot-autoredeemer.vercel.app/privacy?service=kingshot-auto)
- [Terms of service](https://kingshot-autoredeemer.vercel.app/terms?service=kingshot-auto)
