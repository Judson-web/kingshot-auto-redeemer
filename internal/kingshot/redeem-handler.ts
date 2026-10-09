import { redeemKingshot, type RedeemKingshotInput } from "./redeem.ts";

interface RequestLike {
  method?: string;
  body?: RedeemKingshotInput;
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): ResponseLike;
  setHeader(name: string, value: string): void;
}
interface Dependencies {
  rateLimit: (
    req: { headers: Record<string, string | string[] | undefined> },
    res: { setHeader(name: string, value: string): void },
    scope: string,
    limit: number,
    windowMs: number
  ) => boolean;
}

export async function handleRedemptionRequest(
  req: RequestLike,
  res: ResponseLike & { setHeader(name: string, value: string): void },
  dependencies: Dependencies
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!dependencies.rateLimit(req, res, "redeem", 12, 60000)) {
    res.status(429).json({ error: "Too many redemption requests. Please try again shortly." });
    return;
  }

  const result = await redeemKingshot(req.body || {});
  res.status(result.httpStatus).json({
    ok: result.ok,
    status: result.status,
    statusLabel: result.statusLabel,
    message: result.message,
    errorCategory: result.errorCategory,
    errCode: result.errCode ?? null,
    error: result.error
  });
}
