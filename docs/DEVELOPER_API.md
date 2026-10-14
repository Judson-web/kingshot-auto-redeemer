# Developer API

Base URL: `https://kingshot-autoredeemer.vercel.app`

## Authentication
Create an API key in [/developer](/developer). Send it as `Authorization: Bearer ks_live_…`. Never put API keys in browser bundles, public repositories, or query parameters.

## Player lookup

`GET /api/v1/player?id=43180889`

Returns `data` containing playerId, name, kingdomId, power, townCenterLevel and avatarUrl, plus `meta` with requestId, timestamp, fetchedAt, source, stale and quota counters.

## Manual redemption

`POST /api/v1/redeem`

Requires a valid API key. JSON body:

```json
{ "playerId": "43180889", "code": "EXAMPLECODE", "kid": "1125" }
```

Example:

```bash
curl -X POST "https://kingshot-autoredeemer.vercel.app/api/v1/redeem" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'
```

A successful HTTP response means the request was processed; inspect `data.status` and `data.errorCategory` for the in-game redemption outcome. API quota/rate-limit headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

## Automatic redemption

The service already has an automatic redemption workflow for players registered through the website. Use `POST /api/kingshot-register` with `playerId` and optional `kingdomId`, `playerName`, and `avatarUrl` to register a player. Automatic processing happens through the internal scheduler.

`/api/kingshot-auto` is an internal worker endpoint, not a public API. Do not call it from clients or expose scheduler tokens. Public, user-authorized start/stop controls are not provided by this route.

## Other endpoints
- `GET /api/kingshot-player?id=PLAYER_ID` — legacy public player lookup, rate limited.
- `POST /api/kingshot-redeem` — legacy website manual-redemption endpoint, rate limited.
- `POST /api/kingshot-register` — register a player for the existing automatic workflow.
- `GET /api/kingshot-health` — public health summary.

## Errors
Errors include a stable `code`, readable `error`, and `meta.requestId` where applicable. Common statuses: 400 invalid input, 401 missing/invalid key, 404 player or route not found, 429 quota/rate limit exceeded, 502 provider unavailable, 503 server not configured, 504 upstream timeout.
