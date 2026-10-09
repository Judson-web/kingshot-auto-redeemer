import health from "../../lib/health.ts";
import support from "../../lib/support.ts";

interface RequestLike {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ResponseLike {
  setHeader(name: string, value: string | string[]): ResponseLike;
  status(code: number): ResponseLike;
  json(body: unknown): ResponseLike;
  send(body: string): ResponseLike;
}

export default async function handler(
  req: RequestLike,
  res: ResponseLike,
): Promise<unknown> {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const marker = "/api/ops-tools/";
  const route = pathname.startsWith(marker)
    ? pathname.slice(marker.length).replace(/^\/+|\/+$/g, "")
    : "";

  if (route === "support") return support(req, res);
  return health(req, res);
}
