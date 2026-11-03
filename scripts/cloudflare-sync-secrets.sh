#!/usr/bin/env bash
set +x
set -euo pipefail

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "::error::CLOUDFLARE_API_TOKEN is missing."
  exit 1
fi

MAIN_SETTINGS="$(curl --fail --silent --show-error \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/kingshot-autoredeemer-edge/settings")"
SHARD_SETTINGS="$(curl --fail --silent --show-error \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/kingshot-autoredeemer-shard/settings")"
printf '%s' "$MAIN_SETTINGS" | jq -e '.success == true' >/dev/null
printf '%s' "$SHARD_SETTINGS" | jq -e '.success == true' >/dev/null
MAIN_EXISTING="$(printf '%s' "$MAIN_SETTINGS" | jq -r '.result.bindings[]? | select(.type == "secret_text") | .name')"
SHARD_EXISTING="$(printf '%s' "$SHARD_SETTINGS" | jq -r '.result.bindings[]? | select(.type == "secret_text") | .name')"

MAIN_BOUND=()
SHARD_BOUND=()
MAIN_SKIPPED=()
SHARD_SKIPPED=()
MAIN_MISSING=()
SHARD_MISSING=()
NAMES=(
  SUPABASE_SERVICE_ROLE_KEY SUPABASE_SECRET_KEY SUPABASE_PUBLISHABLE_KEY SUPABASE_ANON_KEY
  NEON_RECOVERY_DATABASE_URL DISCORD_BOT_TOKEN DISCORD_PUBLIC_KEY DISCORD_APPLICATION_PUBLIC_KEY
  DISCORD_APPLICATION_ID DISCORD_BRAND_ICON_URL DISCORD_KINGSHOT_WEBHOOK_URL DISCORD_SCRAPER_WEBHOOK_URL
  CRON_SECRET ALLIANCE_SYNC_CRON_SECRET KINGSHOT_AGGREGATOR_API_KEY
  MIGHTPULSE_API_KEY MIGHTPULSE_API_KEY_2 MIGHTPULSE_API_KEY_3 MIGHTPULSE_API_KEY_4 MIGHTPULSE_API_KEY_5 MIGHTPULSE_API_KEY_6
  V4_WEBHOOK_ENCRYPTION_KEY V4_WEBHOOK_WORKER_SECRET
  WEB_PUSH_VAPID_PUBLIC_KEY WEB_PUSH_VAPID_PRIVATE_KEY WEB_PUSH_VAPID_SUBJECT
  CUSTOM_MESSAGE_DESTINATIONS CUSTOM_MESSAGE_WEBHOOK_1494360495694549134_URL
)

for name in "${NAMES[@]}"; do
  value="${!name:-}"
  if printf '%s\n' "$MAIN_EXISTING" | grep -Fxq "$name"; then
    MAIN_SKIPPED+=("$name")
  elif [ -n "$value" ]; then
    printf '%s' "$value" | npx --yes wrangler@4 secret put "$name" --name kingshot-autoredeemer-edge >/dev/null
    MAIN_BOUND+=("$name")
  else
    MAIN_MISSING+=("$name")
  fi

  if printf '%s\n' "$SHARD_EXISTING" | grep -Fxq "$name"; then
    SHARD_SKIPPED+=("$name")
  elif [ -n "$value" ]; then
    printf '%s' "$value" | npx --yes wrangler@4 secret put "$name" --name kingshot-autoredeemer-shard >/dev/null
    SHARD_BOUND+=("$name")
  else
    SHARD_MISSING+=("$name")
  fi
done

MAIN_AVAILABLE="$(printf '%s\n' "$MAIN_EXISTING"; printf '%s\n' "${MAIN_BOUND[@]}")"
SHARD_AVAILABLE="$(printf '%s\n' "$SHARD_EXISTING"; printf '%s\n' "${SHARD_BOUND[@]}")"
REQUIRED=(SUPABASE_SERVICE_ROLE_KEY CRON_SECRET ALLIANCE_SYNC_CRON_SECRET NEON_RECOVERY_DATABASE_URL)
for name in "${REQUIRED[@]}"; do
  if ! printf '%s\n' "$MAIN_AVAILABLE" | grep -Fxq "$name"; then
    echo "::error::Required main Worker secret $name is unavailable; refusing to deploy."
    exit 1
  fi
  if ! printf '%s\n' "$SHARD_AVAILABLE" | grep -Fxq "$name"; then
    echo "::error::Required shard Worker secret $name is unavailable; refusing to deploy."
    exit 1
  fi
done

if ! printf '%s\n' "$MAIN_AVAILABLE" | grep -Eq '^MIGHTPULSE_API_KEY(_[2-6])?$'; then
  echo "::error::No MightPulse API key is available on the main Worker; refusing to deploy."
  exit 1
fi
if ! printf '%s\n' "$SHARD_AVAILABLE" | grep -Eq '^MIGHTPULSE_API_KEY(_[2-6])?$'; then
  echo "::error::No MightPulse API key is available on the shard Worker; refusing to deploy."
  exit 1
fi

{
  echo "## Cloudflare Worker secret sync"
  echo
  echo "Main Worker: preserved ${#MAIN_SKIPPED[@]}, bound ${#MAIN_BOUND[@]}, missing optional ${#MAIN_MISSING[@]}"
  echo "Shard Worker: preserved ${#SHARD_SKIPPED[@]}, bound ${#SHARD_BOUND[@]}, missing optional ${#SHARD_MISSING[@]}"
  echo "Secret values were never printed. Existing Worker secrets were not overwritten."
} >> "$GITHUB_STEP_SUMMARY"
printf 'Main Worker bound: %s\n' "${MAIN_BOUND[*]:-none}"
printf 'Shard Worker bound: %s\n' "${SHARD_BOUND[*]:-none}"
printf 'Optional secrets missing from Actions: %s\n' "${MAIN_MISSING[*]:-none}"
