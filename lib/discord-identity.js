/** Privileged Discord-owner checks use provider identity verified by Supabase Auth only. */
export function verifiedDiscordId(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const identity = identities.find((item) => item?.provider === "discord");
  return String(identity?.identity_data?.provider_id || identity?.identity_data?.sub ||
    identity?.identity_data?.id || identity?.identity_data?.user_id || identity?.id || "");
}
export function isDiscordOwner(user, expectedDiscordId) {
  if (!expectedDiscordId) return false;
  const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const hasDiscord = providers.includes("discord") || identities.some((item) => item?.provider === "discord");
  const actual = verifiedDiscordId(user);
  return hasDiscord && actual.length > 0 && actual === String(expectedDiscordId);
}
