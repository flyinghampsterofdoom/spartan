import { NextRequest, NextResponse } from "next/server";
import { getSessionIdentity, selectOrganization } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http/security";
import { appUrl } from "@/lib/http/app-url";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const session = await getSessionIdentity();
  if (!session) return NextResponse.redirect(appUrl("/login", request.url), 303);
  const form = await request.formData();
  const organizationId = String(form.get("organizationId") ?? "");
  const allowed = await selectOrganization(session.sessionId, session.userId, organizationId);
  return NextResponse.redirect(appUrl(allowed ? "/" : "/select-organization?error=access", request.url), 303);
}
