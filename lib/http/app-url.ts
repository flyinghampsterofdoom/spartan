export function appUrl(path: string, requestUrl?: string | URL) {
  const configured = process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim();
  const base = configured || (requestUrl ? new URL(requestUrl).origin : "http://localhost:3000");
  return new URL(path, base).toString();
}
