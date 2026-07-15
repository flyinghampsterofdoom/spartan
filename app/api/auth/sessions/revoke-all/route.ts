import { NextRequest, NextResponse } from "next/server";
import { getSessionIdentity, revokeUserSessions, SESSION_COOKIE } from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/http/security";
import { cookies } from "next/headers";
import { appUrl } from "@/lib/http/app-url";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const session = await getSessionIdentity();
  if (!session) return NextResponse.redirect(appUrl("/login", request.url), 303);
  const count = await revokeUserSessions(session.userId, session.userId, "user_revoke_all");
  await writeAuditEvent({ organizationId: session.activeOrganizationId, actorUserId: session.userId, entityType: "user", entityId: session.userId, action: "sessions.revoked", newValue: { count } });
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.redirect(appUrl("/login", request.url), 303);
}
