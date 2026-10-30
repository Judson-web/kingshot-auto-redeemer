# Discord bot subsystem

The Discord integration remains part of the main Kingshot Auto Redeemer repository and keeps the existing Discord application identity. Its operational data is isolated in the separate Supabase project `kingshot-discord-bot`.

## Database isolation

Configure these server-side Vercel environment variables for the existing production project:

- `DISCORD_SUPABASE_URL`: `https://sfntksruilzncahytxve.supabase.co`
- `DISCORD_SUPABASE_SERVICE_ROLE_KEY`: the new project's service-role/secret key. Keep it server-only. Never use a `NEXT_PUBLIC_` prefix or expose it to browser code.

The interaction handler continues to use the main application for player registration and existing player services. The Discord database is only for bot-specific guild state and telemetry. No player-account, redemption, alliance-registration, or main authentication data is copied.

The new schema contains:

- `discord_guilds`: guild presence and lifecycle.
- `discord_guild_settings`: per-guild JSON settings.
- `discord_command_events`: minimal command outcome and latency telemetry.
- `discord_audit_log`: structured administrative audit events.

All four tables have RLS enabled and no client-facing policies. Access is intended only through the server-side service-role key. Never put that key in a browser bundle.

## Slash command reconciliation

The canonical command allow-list is in `scripts/sync-discord-commands.mjs` and matches the current interaction handler:

- `/player id:<Kingshot Player ID>`
- `/register player_id:<Kingshot Player ID>`

Run with the existing bot token and application ID:

```sh
DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... node scripts/sync-discord-commands.mjs
```

This replaces the **global command scope** with the two canonical commands, removing stale global commands. Guild-scoped commands are separate in Discord and are not affected. To reconcile one test guild only, also set `DISCORD_GUILD_ID`; this replaces only that guild's command scope. Do not run guild-scoped sync against production guilds until the intended scope is confirmed.

The script reports the before/after counts and resulting command names. It does not delete the bot, change its permissions, or alter its guild membership.

## Required environment setup

The current integration still requires the existing `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY` (or `DISCORD_APPLICATION_PUBLIC_KEY`), and the Discord application's interaction endpoint configuration. The command sync script additionally needs `DISCORD_APPLICATION_ID`. Do not rotate the existing bot token as part of the database split.

Telemetry is best-effort: if the isolated database is not configured or temporarily unavailable, player lookup and registration continue to work. The database call is bounded by a short timeout and its errors are not allowed to fail Discord interactions.
