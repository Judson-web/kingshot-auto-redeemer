# Kingshot Auto Redeemer — Developer API

Canonical interactive documentation: https://kingshot-autoredeemer.vercel.app/developer

This document is a plain-text, crawler-friendly companion to the interactive developer portal. It describes the public integration routes; it does not grant access to them.

## Authentication

For the versioned developer API, send an active API key in the HTTPS request header:

`Authorization: Bearer YOUR_API_KEY`

Create and revoke keys in the [developer portal](https://kingshot-autoredeemer.vercel.app/developer). The full key is shown only once. Store it server-side, never in browser JavaScript, public repositories, URLs, or client-visible build variables.

## Player lookup

- **Method:** `GET`
- **Path:** `/api/v1/player?id=PLAYER_ID`
- **Query:** `id` — numeric Kingshot Player ID (5–20 digits)
- **Authentication:** Bearer API key required
- **Quota:** 60 requests/minute and 1,000 requests/day per key, plus a shared 120 requests/minute per-IP limit.

Example:

```sh
curl "https://kingshot-autoredeemer.vercel.app/api/v1/player?id=43180889" \
  -H "Authorization: Bearer $KINGSHOT_API_KEY"
```

Successful responses contain a `data` object with player profile fields and a `meta` object with request/quota metadata. Provider-dependent fields can be null. Example values are illustrative, not live player data.

## Manual redemption

- **Method:** `POST`
- **Path:** `/api/v1/redeem`
- **Authentication:** Bearer API key required
- **Content type:** `application/json`

Example request body:

```json
{
  "playerId": "43180889",
  "code": "EXAMPLECODE",
  "kid": "1125"
}
```

Validate `data.ok`, `data.status`, `data.message`, and `data.errorCategory`. An HTTP-success response alone does not guarantee that rewards were granted. Never blindly retry an ambiguous upstream result.

## Automatic redemption enrollment

- **Method:** `POST`
- **Path:** `/api/kingshot-register`
- **Content type:** `application/json`
- **Authentication:** This is the public website enrollment flow, separate from developer Bearer-key API access.

Example request body:

```json
{
  "playerId": "43180889",
  "kingdomId": "1125",
  "playerName": "Example Player"
}
```

The required field is `playerId`; `kingdomId`, `playerName`, and `avatarUrl` are optional. Enrollment does not start or control the worker and does not guarantee any particular code is valid.

## Common response codes

| HTTP | Meaning |
|---|---|
| 200 | Request completed; inspect the response body for the operation result |
| 400 | Missing or invalid input |
| 401 | Missing, invalid, or revoked API key (for protected developer endpoints) |
| 404 | Player or route not found |
| 429 | Rate limit or quota exceeded; honor `Retry-After` when present |
| 502 | Upstream provider unavailable |

## Security and integration notes

- Use HTTPS and keep keys on a trusted server.
- Do not place keys in query strings, frontend bundles, logs, or public issue reports.
- Respect rate limits; on 429, back off rather than retrying aggressively.
- Do not use internal scheduler or worker endpoints from clients.
- Only look up player data and redeem codes for accounts you are authorized to use.

## Machine-readable schema

OpenAPI 3.1: https://kingshot-autoredeemer.vercel.app/openapi.json

Privacy: https://kingshot-autoredeemer.vercel.app/privacy
Terms: https://kingshot-autoredeemer.vercel.app/terms
Source repository: https://github.com/Judson-web/kingshot-auto-redeemer
