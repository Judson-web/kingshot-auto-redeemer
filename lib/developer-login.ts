interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): ResponseLike;
}
const COOKIE = "__Host-ks_developer_session";
function clearCookie(res: ResponseLike): void {
  res.setHeader("Set-Cookie", COOKIE + "=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict");
}
export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
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
    message: "Use the existing verified Discord account session and account panel."
  });
}
