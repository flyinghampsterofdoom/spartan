import { NextRequest, NextResponse } from "next/server";
import { authenticateCredentials, createSession } from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/http/security";
import { clearFailedLogins, isLoginAllowed, recordFailedLogin } from "@/lib/auth/rate-limit";
import { appUrl } from "@/lib/http/app-url";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!await isLoginAllowed(email, ipAddress)) return NextResponse.redirect(appUrl("/login?error=credentials", request.url), 303);
  const user = await authenticateCredentials(email, password);
  if (!user) {
    await recordFailedLogin(email, ipAddress);
    return NextResponse.redirect(appUrl("/login?error=credentials", request.url), 303);
  }
  await clearFailedLogins(email, ipAddress);
  const session = await createSession(user.id);
  await writeAuditEvent({ organizationId: session.activeOrganizationId, actorUserId: user.id, entityType: "user", entityId: user.id, action: "auth.login" });
  return NextResponse.redirect(appUrl(session.activeOrganizationId ? "/" : "/select-organization", request.url), 303);
}
