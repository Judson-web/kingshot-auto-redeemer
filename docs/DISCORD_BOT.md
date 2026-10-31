# Discord bot

The Kingshot Auto Redeemer Discord integration uses Discord's signed HTTP Interactions API on Vercel. It does not require a persistent Gateway connection, message-content intent, prefix commands, a separate bot host, or a duplicate database.

## Native Discord interface

- Player lookup uses a native Discord embed with structured governor, kingdom, alliance, power, Town Center, VIP, kills, coordinates, and status fields.
- Player embeds provide interactive **Refresh profile** and **Register for auto-redeem** buttons, plus a dashboard link.
- `/alliance kingdom:<number> search:<optional name or tag>` searches the kingdom alliance rankings and opens a native select menu.
- Selecting an alliance opens its roster, with a governor selector, roster summary, and previous/next pagination.
- Selecting a governor opens the same player profile view with a **Back to roster** button. **Back to alliances** returns to the kingdom's alliance selector.
- Roster pages contain up to 10 members, matching Discord's select-menu option limit. No roster member is registered by browsing.
- Refresh updates the existing message rather than posting another card.
- Registration from a player profile uses an ephemeral confirmation and removes the registration action after a successful new registration.
- The `/register` command returns a public confirmation embed with the player avatar when the upstream provides an allow-listed image URL.
- No generated player PNG, image-conversion API, hosted card URL, or player-card rendering endpoint is used.
- Player avatars may appear as a small native Discord embed thumbnail when the upstream URL matches the allow-list.

## Commands

- `/player id:<Kingshot Player ID>`
- `/register player_id:<Kingshot Player ID>`\n- `/codes`\n\n`/codes` lists only active, unsuppressed codes with `validation_status=verified`, excludes expired codes, and shows successful redemption counts from the last seven days. It is read from the primary Supabase gift-code and redemption tables; it does not treat scraper discovery alone as verification.\n\n`/register` posts a public result by default. Registration button interactions from a player profile remain private confirmations.

The allow-list sync script in `scripts/sync-discord-commands.mjs` reconciles global commands. It replaces only the global command scope; guild-scoped commands remain separate.

## Runtime configuration

The interaction endpoint requires the existing server-side Vercel variables:

- `DISCORD_BOT_TOKEN`
- `DISCORD_PUBLIC_KEY` (or `DISCORD_APPLICATION_PUBLIC_KEY`)

The application ID may be supplied as `DISCORD_APPLICATION_ID`; otherwise it is resolved from the authenticated bot session. Optional `DISCORD_BRAND_ICON_URL` sets the small brand icon used in embeds. Keep all credentials server-side and never expose them to browser code.

Player registration continues to use the existing Kingshot backend and its established validation and safeguards. No second registration system or Discord-specific player database is introduced.
