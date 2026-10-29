export type HeaderValue = string | string[] | undefined;
export type JsonRecord = Record<string, unknown>;
export interface V3Request {
  method?: string;
  url?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
  query?: Record<string, unknown>;
  apiVersionAdapter?: 4;
}
export interface V3Response {
  status(code: number): V3Response;
  json(body: unknown): V3Response;
  setHeader(name: string, value: string): void;
  end?: () => V3Response;
}
export interface V3AuthorizationContext extends JsonRecord {
  rateLimit: JsonRecord;
}
