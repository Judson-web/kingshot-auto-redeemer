# Kingshot Auto Redeemer Developer API — V4

Interactive documentation: https://kingshot-autoredeemer.vercel.app/developer  
OpenAPI 3.1: https://kingshot-autoredeemer.vercel.app/openapi.json

V4 is the current API for player lookup and manual gift-code redemption. It provides a consistent JSON envelope for success and errors. V3 remains available for existing integrations; V1 is deprecated.

## Authentication

Create an API key from the developer account panel at /developer. Send it only over HTTPS using the Bearer scheme:

    curl "https://kingshot-autoredeemer.vercel.app/api/v4/players/43180889" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY"

Keep the key on a trusted server. Do not put it in browser JavaScript, URLs, logs, screenshots, or public repositories. Revoked keys stop authorizing requests.

## V4 response contract

Every JSON response uses the same top-level keys: success, data, error, meta, and dev.

- success reports whether the API request was processed at the HTTP/API layer.
- data contains the endpoint payload. It is always null on an API error.
- error is always present. It is null on success; otherwise it contains stable code and human-readable message fields.
- meta always includes apiVersion: "4", requestId, and an ISO-8601 timestamp. Depending on the request, it can also contain rate-limit values, provider-cache freshness, a retry reset time, or documentation hints.
- dev is project-maintainer attribution, not an authentication credential or permission grant.

### Success example

    {
      "success": true,
      "data": {
        "playerId": "43180889",
        "name": "Example Player",
        "kingdomId": "1125",
        "power": 123456789,
        "townCenterLevel": 30,
        "avatarUrl": null,
        "allianceName": "Example Alliance",
        "allianceTag": "EXA"
      },
      "error": null,
      "meta": {
        "apiVersion": "4",
        "requestId": "server-generated-id",
        "timestamp": "2026-10-26T10:00:00.000Z",
        "source": "mightpulse",
        "stale": false,
        "rateLimit": {
          "perMinuteLimit": 60,
          "perMinuteRemaining": 59,
          "perDayLimit": 1000,
          "perDayRemaining": 999
        }
      },
      "dev": {
        "name": "Judson",
        "discord": "@judson00713",
        "url": "https://discord.com/users/871756466900598815"
      }
    }

### Error example

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

Use meta.requestId when reporting an issue. It is also returned in the X-Request-Id response header. The X-API-Version header is 4.

## Player lookup

- Method: GET
- Path: /api/v4/players/{playerId}
- Authentication: active developer Bearer key
- Player ID: a string containing 5–20 digits
- Limits: 60 requests per minute and 1,000 per day per key, plus an IP-level limit

    curl "https://kingshot-autoredeemer.vercel.app/api/v4/players/43180889" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY"

Player fields such as name, kingdomId, power, townCenterLevel, avatarUrl, allianceName, and allianceTag can be null when the source does not provide them. Freshness metadata tells clients whether a cached provider result was used.

## Manual redemption

- Method: POST
- Path: /api/v4/redemptions
- Authentication: active developer Bearer key
- Content type: application/json
- Body: exactly playerId, code, and kid, all supplied as strings

    curl -X POST "https://kingshot-autoredeemer.vercel.app/api/v4/redemptions" \
      -H "Authorization: Bearer $KINGSHOT_API_KEY" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: redeem-43180889-example-001" \
      -d '{"playerId":"43180889","code":"EXAMPLECODE","kid":"1125"}'

Validation rules: playerId must contain 5–20 digits, code must contain 1–64 letters/digits/underscores/hyphens, and kid must contain 1–10 digits. Unknown fields and non-string values are rejected.

A redemption response with HTTP 200 means the API processed the operation; it does not mean rewards were granted. Inspect data.ok, data.status, data.statusLabel, data.message, data.errorCategory, and data.errCode. It is valid for the envelope's success to be true while data.ok is false, for example when the game rejects an already-used code.

### Idempotency and ambiguous outcomes

Supply an Idempotency-Key of 8–128 safe ASCII characters for redemption requests. Repeating the same key with the same request body replays the recorded outcome; reusing it with a different body returns HTTP 409. V4 idempotency records use a separate namespace from V3. If a timeout or upstream error makes the result ambiguous, retry only with the same key and body. Do not submit a new key for the same uncertain operation. Idempotency helps avoid accidental duplicate attempts but cannot guarantee exactly-once execution by the upstream game service.

## Errors, quotas, and retry guidance

Common HTTP statuses:

| Status | Meaning |
| --- | --- |
| 400 | Invalid Player ID, request body, or idempotency key |
| 401 | Missing, invalid, or revoked API key |
| 404 | Player not found |
| 405 | Unsupported HTTP method |
| 409 | Idempotency key reused with a different body, or same-key request still processing |
| 415 | Redemption body must use application/json |
| 429 | Per-key, per-IP, or daily quota reached |
| 502 | Upstream provider unavailable or returned invalid data |
| 503 | Authorization, configuration, or idempotency storage temporarily unavailable |
| 504 | Upstream timeout; redemption outcome may be ambiguous |

Rate-limit response headers can include X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Daily-Limit, and X-RateLimit-Daily-Remaining. On HTTP 429, honor Retry-After and use bounded backoff. Do not retry invalid requests or revoked keys automatically. Read-only provider lookups may retry bounded transient network or 5xx failures; redemptions are not automatically retried.

## Version compatibility

- V4: current contract, GET /api/v4/players/{playerId} and POST /api/v4/redemptions.
- V3: retained for existing integrations; response format remains unchanged.
- V1: deprecated and retained temporarily. New integrations should not use it.

## Security and responsible use

Use HTTPS, protect the key as a secret, respect quotas, do not rotate IPs or keys to evade restrictions, and access only player data you are authorized to retrieve. Never call internal scheduler or worker endpoints from clients.

## Maintainer and contact

Built and maintained by **Judson** (@judson00713 on Discord). For API integration questions, contact the [maintainer on Discord](https://discord.com/users/871756466900598815). Direct messages depend on privacy settings and availability; response times may vary. For account, registration, or redemption issues, use the in-app Support Centre. Never send passwords, API keys, session tokens, or sign-in codes through Discord.
