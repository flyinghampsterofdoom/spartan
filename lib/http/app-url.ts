import { headers } from "next/headers";

export function appUrl(path: string, requestUrl?: string | URL) {
  const configured = process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim();
  const requestOrigin = requestUrl ? new URL(requestUrl).origin : undefined;
  const base = configured || requestOrigin || "http://localhost:3000";
  const url = new URL(path, base);
  if (process.env.NODE_ENV === "production" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    url.protocol = "https:";
  }
  return url.toString();
}

export async function serverAppUrl(path: string) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim()
    || requestHeaders.get("host")?.trim();
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim()
    || (process.env.NODE_ENV === "production" ? "https" : "http");
  const requestUrl = host ? `${protocol}://${host}` : undefined;
  return appUrl(path, requestUrl);
}
