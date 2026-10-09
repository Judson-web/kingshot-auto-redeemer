import data from "../../lib/admin-data.js";

interface RequestLike {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ResponseLike {
  setHeader(name: string, value: string | string[]): unknown;
  status(code: number): ResponseLike;
  json(body: unknown): ResponseLike;
}

export default async function handler(
  req: RequestLike,
  res: ResponseLike,
): Promise<unknown> {
  return data(req, res);
}
