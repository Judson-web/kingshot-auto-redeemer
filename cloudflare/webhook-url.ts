const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".test",
  ".invalid",
  ".example",
  ".onion",
  ".lan",
];

export function validDeliveryUrl(value: string): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\\.$/, "");
    const ipv4 = /^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(host);
    const ipv6 = host.includes(":");
    const localHostname = host === "localhost" || BLOCKED_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || ipv4 || ipv6 || localHostname ||
        !host.includes(".") || host.length > 253 || host.startsWith(".") || host.includes("..")) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}
