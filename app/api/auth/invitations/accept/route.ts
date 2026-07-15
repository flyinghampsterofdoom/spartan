import { NextRequest, NextResponse } from "next/server";
import { acceptInvitation } from "@/lib/auth/tokens";
import { createSession } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http/security";
import { appUrl } from "@/lib/http/app-url";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const displayName = String(form.get("displayName") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");
  if (!displayName || (password && password !== confirmPassword)) return NextResponse.redirect(appUrl(`/invite?token=${encodeURIComponent(token)}&error=1`, request.url), 303);
  try {
    const userId = await acceptInvitation({ token, displayName, password: password || undefined });
    if (!userId) throw new Error("Invalid invitation.");
    const session = await createSession(userId);
    return NextResponse.redirect(appUrl(session.activeOrganizationId ? "/" : "/select-organization", request.url), 303);
  } catch {
    return NextResponse.redirect(appUrl(`/invite?token=${encodeURIComponent(token)}&error=1`, request.url), 303);
  }
}
