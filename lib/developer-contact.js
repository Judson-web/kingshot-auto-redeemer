/**
 * Public maintainer attribution for documented API responses. Contact metadata only.
 * It never grants privileges or implies affiliation with the game publisher.
 */
export const DEVELOPER_ATTRIBUTION = Object.freeze({
  name: "Judson",
  discord: "@judson00713",
  url: "https://discord.com/users/871756466900598815"
});

export function withDevMetadata(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  return { ...body, dev: DEVELOPER_ATTRIBUTION };
}

/** Attach the same top-level dev object to JSON responses from public endpoints. */
export function attachDevMetadata(res) {
  if (!res || typeof res.json !== "function" || res.__devMetadataAttached) return res;
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(withDevMetadata(body));
  try { Object.defineProperty(res, "__devMetadataAttached", { value: true, configurable: true }); } catch {}
  return res;
}
