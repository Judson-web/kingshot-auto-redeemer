const COOKIE = "__Host-ks_developer_session";
function clearCookie(res) {
  res.setHeader("Set-Cookie", COOKIE + "=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict");
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", "Wed, 01 Jul 2026 00:00:00 GMT");
  if (req.method === "DELETE") {
    clearCookie(res);
    res.status(200).json({ ok: true, retired: true });
    return;
  }
  res.setHeader("Allow", "DELETE");
  res.status(410).json({
    error: "Legacy developer passkey authentication has been retired.",
    replacement: "/developer",
    message: "Use the existing verified Discord account session and developer account panel."
  });
}
