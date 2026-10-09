import data from "../../lib/admin-data.js";
import login from "../../lib/admin-login.ts";

interface RequestLike {
  method?: string;
  url?: string;
  query?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ResponseLike {
  setHeader(name: string, value: string | string[]): ResponseLike;
  status(code: number): ResponseLike;
  json(body: unknown): ResponseLike;
}

export default async function handler(
  req: RequestLike,
  res: ResponseLike,
): Promise<unknown> {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const marker = "/api/admin-tools/";
  const route = pathname.startsWith(marker)
    ? pathname.slice(marker.length).replace(/^\/+|\/+$/g, "")
    : "";

  if (route === "login") return login(req, res);
  return data(req, res);
}
