# Discord bot

The Discord integration is intentionally lightweight because the bot is not currently in active use. This repository keeps its existing application identity and interaction endpoint, with a branded response layer ready for future activation.

## Brand and interface

- Product identity: **Kingshot Auto Redeemer**
- Visual direction: restrained gold accent, concise copy, consistent author and footer treatment.
- Player lookup: structured profile card with governor, kingdom, power, Town Center, VIP, alliance, kills, coordinates and online state.
- Registration: public, compact success, already-enrolled, or failure response.
- Player profiles include an interactive alliance-roster button when the player response contains a verified alliance tag. The roster is fetched live from MightPulse, validated, paginated in groups of 25, and lets members open another player profile without registering them.
- No message-content intent, prefix commands, persistent Gateway connection, or always-on worker is required for the current HTTP-interaction model.
- Optional DISCORD_BRAND_ICON_URL sets the small brand icon used in response cards. Use a stable HTTPS image URL.

## Existing commands

- /player id:<Kingshot Player ID>
- /register player_id:<Kingshot Player ID>

The allow-list sync script in scripts/sync-discord-commands.mjs can reconcile global commands. It replaces only the global command scope; guild-scoped commands remain separate.

## Runtime configuration

The interaction endpoint requires the existing server-side Vercel variables:

- DISCORD_BOT_TOKEN
- DISCORD_PUBLIC_KEY (or DISCORD_APPLICATION_PUBLIC_KEY)

Do not expose either variable to browser code or use a NEXT_PUBLIC_ prefix. The optional DISCORD_BRAND_ICON_URL is a non-secret HTTPS image URL.

There is deliberately no separate Discord database, telemetry store, bot worker, or duplicate player-registration system in this scope. Player registration continues to use the existing Kingshot backend and its established validation and safeguards.
