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
        "message": "No player was found for this ID.",
        "retryable": false,
        "retryHint": "do_not_retry"
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

Use meta.requestId when reporting an issue. It is also returned in the X-Request-Id response header. V4 treats requestId and timestamp as metadata for the current HTTP attempt, even when a stored redemption outcome is replayed. The X-API-Version header is 4.

## Response headers

V4 returns these headers alongside JSON responses:

- `X-API-Version: 4`: API contract version.
- `X-Request-Id`: unique identifier that matches `meta.requestId`.
- Rate-limit headers such as `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Daily-Limit`, and `X-RateLimit-Daily-Remaining`, when provided by the quota service.
- `Retry-After`: delay in seconds to honor on HTTP 429 when a reset is known.
- `Idempotency-Replayed: true`: a stored redemption response was replayed for the same V4 idempotency key.

Use `meta.requestId` when reporting an error or contacting support. Do not share the API key itself.

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

Supply an Idempotency-Key of 8–128 ASCII characters matching [A-Za-z0-9._:-] for redemption requests. Repeating the same key with the same request body replays the recorded outcome; reusing it with a different body returns HTTP 409. V4 idempotency records use a separate namespace from V3. If a timeout or upstream error makes the result ambiguous, retry only with the same key and body. Do not submit a new key for the same uncertain operation. Idempotency helps avoid accidental duplicate attempts but cannot guarantee exactly-once execution by the upstream game service.

## Node.js client pattern

This example uses Node.js 18+ built-in fetch. Keep the API key in a server-side environment variable, never in browser code. It throws on HTTP errors or an unsuccessful V4 envelope, attaches the request ID for logs, and does not automatically retry operations.

    import { randomUUID } from "node:crypto";

    const API_BASE = "https://kingshot-autoredeemer.vercel.app";
    const API_KEY = process.env.KINGSHOT_API_KEY;
    if (!API_KEY) throw new Error("KINGSHOT_API_KEY is not configured");

    async function v4Request(path, { method = "GET", body, idempotencyKey } = {}) {
      const headers = { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

      const response = await fetch(new URL(path, API_BASE), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);
      const requestId = payload?.meta?.requestId || response.headers.get("X-Request-Id");

      if (!response.ok || payload?.success !== true) {
        const failure = new Error(payload?.error?.message || `API request failed (HTTP ${response.status})`);
        failure.status = response.status;
        failure.code = payload?.error?.code || "request_failed";
        failure.retryable = payload?.error?.retryable === true;
        failure.retryHint = payload?.error?.retryHint || "do_not_retry";
        failure.retryAfterSeconds = payload?.error?.retryAfterSeconds ||
          Number(response.headers.get("Retry-After")) || undefined;
        failure.requestId = requestId;
        throw failure;
      }
      return payload;
    }

    // Create once per logical operation. Reuse this same key and exact body on retry.
    const redemptionBody = { playerId: "43180889", code: "EXAMPLECODE", kid: "1125" };
    const idempotencyKey = randomUUID();
    const result = await v4Request("/api/v4/redemptions", {
      method: "POST", body: redemptionBody, idempotencyKey
    });

    if (!result.data.ok) {
      console.log("Game rejected redemption:", result.data.status, result.data.message);
    } else {
      console.log("Redemption accepted.");
    }

When catching the error, use its `retryHint` rather than retrying every failure. For `same_idempotency_key`, retry with the exact same key and request body; do not mint a new key. Do not blindly retry a redemption when no idempotency key was sent.

## Python client pattern

    import os
    import uuid
    import requests

    api_key = os.environ["KINGSHOT_API_KEY"]
    body = {"playerId": "43180889", "code": "EXAMPLECODE", "kid": "1125"}
    key = str(uuid.uuid4())  # generate once for this logical redemption
    response = requests.post(
        "https://kingshot-autoredeemer.vercel.app/api/v4/redemptions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Idempotency-Key": key,
        },
        json=body,
        timeout=20,
    )
    payload = response.json()
    if not response.ok or payload.get("success") is not True:
        error = payload.get("error") or {}
        raise RuntimeError(
            f"{error.get('code', 'request_failed')}: "
            f"{error.get('message', 'Request failed')} "
            f"(requestId={payload.get('meta', {}).get('requestId')})"
        )
    if not payload["data"]["ok"]:
        print("Game rejected redemption:", payload["data"]["status"], payload["data"]["message"])

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

V4 error objects keep `code` and `message` and add two client-oriented hints:

| Field | Meaning |
| --- | --- |
| `retryable` | Whether retrying may be reasonable. Always check `retryHint`; it is not an exactly-once guarantee. |
| `retryHint: do_not_retry` | Fix the request or credentials first. Do not retry this error unchanged. |
| `retryHint: honor_retry_after` | Wait for `Retry-After` or `retryAfterSeconds` before trying again. |
| `retryHint: bounded_backoff` | A transient read/service error may be retried with a small, bounded exponential backoff. |
| `retryHint: same_idempotency_key` | Retry a redemption only with the same key and identical body. If no key was supplied originally, do not blindly retry the write. |
| `retryAfterSeconds` | Optional server-calculated wait, present when a quota reset is known. |

Rate-limit response headers can include X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Daily-Limit, and X-RateLimit-Daily-Remaining. Honor Retry-After before retrying a limited request. Never retry validation failures or revoked keys automatically. Player lookups are read-only and may use bounded backoff for transient failures; redemptions are never automatically re-submitted by the server. For an ambiguous redemption result, generate one high-entropy Idempotency-Key per logical redemption and reuse that same key and body on every retry.

## Version compatibility

- V4: current contract, GET /api/v4/players/{playerId} and POST /api/v4/redemptions.
- V3: retained for existing integrations; response format remains unchanged.
- V1: deprecated and retained temporarily. New integrations should not use it.

## Security and responsible use

Use HTTPS, protect the key as a secret, respect quotas, do not rotate IPs or keys to evade restrictions, and access only player data you are authorized to retrieve. Never call internal scheduler or worker endpoints from clients.

## Maintainer and contact

Built and maintained by **Judson** (@judson00713 on Discord). For API integration questions, contact the [maintainer on Discord](https://discord.com/users/871756466900598815). Direct messages depend on privacy settings and availability; response times may vary. For account, registration, or redemption issues, use the in-app Support Centre. Never send passwords, API keys, session tokens, or sign-in codes through Discord.
