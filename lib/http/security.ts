import { NextRequest } from "next/server";

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const trustedOrigins = new Set([request.nextUrl.origin]);
  for (const configuredUrl of [process.env.APP_URL, process.env.RENDER_EXTERNAL_URL]) {
    if (!configuredUrl?.trim()) continue;
    try {
      trustedOrigins.add(new URL(configuredUrl).origin);
    } catch {
      // Invalid deployment configuration must not broaden the trusted origin set.
    }
  }
  if (origin && !trustedOrigins.has(origin)) throw new Error("Cross-origin request rejected.");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) throw new Error("Cross-site request rejected.");
}
