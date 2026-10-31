# Discord bot

The Kingshot Auto Redeemer Discord integration uses Discord's signed HTTP Interactions API on Vercel. It does not require a persistent Gateway connection, message-content intent, prefix commands, a separate bot host, or a duplicate database.

## Native Discord interface

- Player lookup uses a native Discord embed with structured governor, kingdom, alliance, power, Town Center, VIP, kills, coordinates, and status fields.
- Player embeds show **AUTO-REDEEM** enrollment status by default, sourced from the existing Supabase player registration row. They provide **Refresh profile**, **Register for auto-redeem** (only while not enrolled), and **View alliance** buttons, plus a dashboard link.
- `/bot-info` displays a compact bot feature summary with **Invite bot** and **Open website** links. **View alliance** opens the player's current alliance overview and roster, with a return-to-profile control.
- Alliance overview embeds query the authoritative `alliance_sync_config` table and show whether the alliance is not registered, active, paused, syncing, or needs attention. A temporary database lookup failure is shown as unavailable rather than incorrectly reporting the alliance as unregistered.
- `/alliance kingdom:<number> search:<optional name or tag>` searches the kingdom alliance rankings and opens a native select menu.
- Selecting an alliance opens the detailed alliance/server information embed. The roster is kept out of the message text and is navigated separately through a governor selector and previous/next pagination.
- Selecting a governor opens the same player profile view with a **Back to roster** button. **Back to alliances** returns to the kingdom's alliance selector.
- Roster pages contain up to 10 members, matching Discord's select-menu option limit. No roster member is registered by browsing.
- Refresh updates the existing message rather than posting another card.
- Registration from a player profile posts a public confirmation and removes the registration action after a successful new registration.
- The `/register` command returns a public confirmation embed with the player avatar when the upstream provides an allow-listed image URL.
- No generated player PNG, image-conversion API, hosted card URL, or player-card rendering endpoint is used.
- Player avatars may appear as a small native Discord embed thumbnail when the upstream URL matches the allow-list.

## Commands

- `/player id:<Kingshot Player ID>`
- `/register player_id:<Kingshot Player ID>`
- `/codes`\n- `/set-gift-code-alert-channel channel:<text channel>` (Discord server Administrator)\n- `/announce channel:<text channel> title:<text> message:<text>` (Discord server Administrator)

`/codes` lists only active, unsuppressed codes with `validation_status=verified`, excludes expired codes, and shows successful redemption counts from the last seven days. It is read from the primary Supabase gift-code and redemption tables; it does not treat scraper discovery alone as verification.

`/register` and player-profile registration buttons post public results, including public error and already-registered responses. Alliance names are consistently rendered as `[TAG] Alliance Name`.\n\nAlliance roster pages include a **Register alliance** link. It opens the existing Alliance Registration page with the kingdom and exact alliance tag preselected. The user completes the existing authenticated registration flow there, including its kingdom cap and daily sync safeguards. Browsing the roster never registers members automatically.

The allow-list sync script in `scripts/sync-discord-commands.mjs` reconciles global commands. It replaces only the global command scope; guild-scoped commands remain separate.

## Server administration and announcements

The private website message console supports per-message delivery selection: Discord webhook only, website push only, or both. The combined option is the default. Discord server Administrator checks remain separate from the verified website project-owner session used by the private console.



Discord server **Administrator** permission is not the same as the website/project Admin role or the verified project-owner account. `/set-gift-code-alert-channel` and `/announce` use the native Administrator permission bit (`8`) in the signed interaction payload and repeat authorization when a confirmation button is used. Commands are registered with `default_member_permissions: "8"` and disabled in DMs. Server Administrators can configure gift-code alert destinations and publish announcements, but gain no website Admin privileges or alliance-cap bypass.

The alert destination is stored per Discord server in Supabase. Automatic gift-code events use configured server channels; the legacy webhook remains a fallback when no server has configured a channel. Announcements are previewed privately, require explicit confirmation, expire after 15 minutes, and disable automatic mention parsing.

## Runtime configuration

The interaction endpoint requires the existing server-side Vercel variables:

- `DISCORD_BOT_TOKEN`
- `DISCORD_PUBLIC_KEY` (or `DISCORD_APPLICATION_PUBLIC_KEY`)

The application ID may be supplied as `DISCORD_APPLICATION_ID`; otherwise it is resolved from the authenticated bot session. Optional `DISCORD_BRAND_ICON_URL` sets the small brand icon used in embeds. Keep all credentials server-side and never expose them to browser code.

Player registration continues to use the existing Kingshot backend and its established validation and safeguards. No second registration system or Discord-specific player database is introduced.
\n## Scheduled website announcements\n\nThe private owner-only message console supports one-time and recurring schedules, optional end times, timezone labels, pause/resume/cancel, Discord-only / website-push-only / both delivery, private image attachments (PNG/JPEG/WebP/GIF up to 3 MB), and selected role IDs. Role IDs are checked against the chosen Discord server before a schedule is saved. Scheduled work is persisted in `discord_scheduled_announcements`; the worker claims due rows through an atomic Postgres function and uses leases, bounded retries, and idempotent completion updates. GitHub Actions wakes the worker every five minutes. Set the repository Actions secret `CRON_SECRET` equal to the production `CRON_SECRET`.\n