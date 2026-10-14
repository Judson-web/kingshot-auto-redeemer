# Developer API reference

Base URL: `https://kingshot-autoredeemer.vercel.app`

This reference distinguishes the authenticated developer API from the website's existing automatic-redemption registration workflow. Use HTTPS and JSON. Never put API keys in URLs or browser-side code.

## Endpoint map

| Method | Endpoint | Authentication | What it does |
|---|---|---|---|
| `GET` | `/api/v1/player?id=PLAYER_ID` | Developer Bearer key | Read a player profile |
| `POST` | `/api/v1/redeem` | Developer Bearer key | Manually redeem one gift code for a player |
| `POST` | `/api/kingshot-register` | Public website route; rate limited | Register one player for the existing automatic-redemption workflow |
| `POST` | `/api/kingshot-redeem` | Public website route; rate limited | The website's manual-redemption handler |
| `GET` | `/api/kingshot-player?id=PLAYER_ID` | Public website route; rate limited | Legacy player lookup |
| `GET` | `/api/kingshot-health` | Public | Health summary |

**Important:** `/api/kingshot-register` enrolls a player in the existing automatic workflow; it does not start or control the worker. `/api/kingshot-auto` is an internal scheduler/worker endpoint and must not be called by third-party clients.

## Authentication and keys

Create a developer account at [Developer portal](https://kingshot-autoredeemer.vercel.app/developer) using the supported GitHub sign-in flow. Create an API key from the account panel. The full secret is shown only once; the database stores a hash. Send it on supported versioned endpoints as:

```http
Authorization: Bearer ks_live_YOUR_64_CHARACTER_SECRET
```

Keep the key in a server-side environment variable or secret manager. Do not expose it in a browser bundle, query string, public repository, or screenshot. Revoke a key immediately if it may have leaked.

## 1. Player lookup

`GET /api/v1/player?id=43180889`

The `id` parameter must contain 5–20 digits.

```bash
curl "https://kingshot-autoredeemer.vercel.app/api/v1/player?id=43180889" \
  -H "Authorization: Bearer $KINGSHOT_API_KEY"
```

Example response (illustrative values):

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
    "source": "mightpulse",
    "stale": false,
    "remaining": 59,
    "dailyRemaining": 999
  }
}
```

Use `meta.fetchedAt` and `meta.stale` as freshness signals. Some player fields can be null when the upstream provider does not supply them.

## 2. Manual gift-code redemption

`POST /api/v1/redeem`

This endpoint submits one code for one player. It requires a valid developer Bearer key and JSON body with all three fields:

| Field | Type | Validation |
|---|---|---|
| `playerId` | string | 5–20 digits |
| `code` | string | 1–64 letters, digits, underscores, or hyphens |
| `kid` | string | 1–10 digits; the player's kingdom ID |

Request:

```bash
curl -X POST "https://kingshot-autoredeemer.vercel.app/api/v1/redeem" \
  -H "Authorization: Bearer $KINGSHOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'
```

Example response:

```json
{
  "data": {
    "ok": true,
    "status": "SUCCESS",
    "statusLabel": "Redeemed successfully.",
    "message": "Your gift rewards should be available in-game.",
    "errorCategory": null,
    "errCode": null
  },
  "meta": {
    "requestId": "server-generated-id",
    "timestamp": "2026-10-14T12:00:00.000Z",
    "remaining": 59,
    "dailyRemaining": 999
  }
}
```

The response above is an example, not a guarantee. Read `data.ok`, `data.status`, `data.message`, and `data.errorCategory` to determine the actual outcome. Common outcomes include success, already claimed, expired or invalid code, usage limit reached, player not found, kingdom mismatch, and temporary upstream errors. An HTTP response alone should not be treated as proof that the game awarded rewards.

## 3. Automatic redemption registration

`POST /api/kingshot-register`

This is the website's existing enrollment endpoint. It registers a player for automatic checks of eligible public gift codes. It is rate limited and does not use developer API keys; the website's registration flow should be preferred for normal use.

Request body (one player per request):

```bash
curl -X POST "https://kingshot-autoredeemer.vercel.app/api/kingshot-register" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"43180889","kingdomId":"1125","playerName":"Example Player","avatarUrl":"https://example.com/avatar.png"}'
```

Required field: `playerId`. Optional fields: `kingdomId`, `playerName`, `avatarUrl`. Player ID must contain 5–20 digits. If supplied, `kingdomId` must contain 1–10 digits. Names and avatar URLs are optional display metadata; the service revalidates player/kingdom data where possible.

Example response:

```json
{
  "registered": true,
  "alreadyRegistered": false,
  "registrationStatus": "NEW",
  "kingdomVerified": true,
  "verifiedKingdomId": "1125",
  "player": {}
}
```

Possible fields include `alreadyRegistered`, `registrationStatus`, `kingdomVerified`, `verificationPending`, `stale`, and `verifiedKingdomId`. If the player is already enrolled, the service reports that state rather than creating a second registration. Kingdom verification can be pending if the upstream provider is temporarily unavailable. Registration is not an endpoint to start/stop the worker, force a redemption, or guarantee every code is valid.

The public registration endpoint has a limit of 60 requests per minute per IP. A successful registration means the enrollment was accepted; individual code redemption outcomes are handled later by the internal worker.

## 4. Website manual redemption route

`POST /api/kingshot-redeem`

This is the website's public, rate-limited manual-redemption handler. It accepts the same core fields: `playerId`, `code`, and `kid`. The website UI should be used by people who do not need developer API integration.

```bash
curl -X POST "https://kingshot-autoredeemer.vercel.app/api/kingshot-redeem" \
  -H "Content-Type: application/json" \
  -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'
```

Example result shape:

```json
{
  "ok": true,
  "status": "SUCCESS",
  "statusLabel": "Redeemed successfully.",
  "message": "Your gift rewards should be available in-game.",
  "errorCategory": "SUCCESS",
  "errCode": null,
  "error": null
}
```

The website route is rate limited to 12 requests per minute per IP. For integrations, prefer the versioned `/api/v1/redeem` route because it requires a developer key and returns request IDs and quota metadata.

## Rate limits and response headers

- Versioned developer API: per-key quota enforced by the database authorization RPC; documented default quota is 60 requests/minute and 1,000 requests/day per key.
- Versioned endpoints also apply an IP-level limit and expose rate-limit headers when available.
- Automatic registration: 60 requests/minute per IP.
- Public manual redemption: 12 requests/minute per IP.

Where available, inspect `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`, and `X-Request-Id`. On `429`, back off and honor `Retry-After`; do not rotate IPs or keys to evade limits.

## Errors

| Status | Meaning | Suggested action |
|---:|---|---|
| `400` | Invalid Player ID, code, kingdom, or request body | Validate fields and retry once corrected |
| `401` | Missing, invalid, or revoked developer key | Check the Bearer header and key status |
| `404` | Player not found or endpoint unavailable | Confirm the ID and route |
| `429` | Per-key or per-IP limit exceeded | Back off and inspect reset headers |
| `502` | Upstream provider returned an error | Retry later with bounded backoff |
| `503` | Required integration or trusted IP is unavailable | Retry later; contact the service operator if persistent |
| `504` | Registration/upstream request timed out | Check registration status before repeating |

Versioned API errors include a stable `code`, readable `error`, and `meta.requestId` where applicable. Include the request ID in support reports, never the API key.

## Security and operational boundaries

- Use only Player IDs you are authorized to access.
- Do not expose API keys or server-side signing secrets.
- Do not call the internal `/api/kingshot-auto` worker endpoint from integrations.
- Automatic enrollment does not imply that every gift code is eligible, active, or redeemable for that player.
- Use bounded retries and respect all rate limits.

## Related links

- [Automatic redemption page](https://kingshot-autoredeemer.vercel.app/auto)
- [Manual redemption page](https://kingshot-autoredeemer.vercel.app/manual)
- [Developer portal and API keys](https://kingshot-autoredeemer.vercel.app/developer)
- [How the service works](https://kingshot-autoredeemer.vercel.app/info)
- [Privacy notice](https://kingshot-autoredeemer.vercel.app/privacy?service=kingshot-auto)
- [Terms of service](https://kingshot-autoredeemer.vercel.app/terms?service=kingshot-auto)
