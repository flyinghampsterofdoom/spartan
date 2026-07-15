import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getAuthContext, revokeUserSessions } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/auth/policy";
import { writeAuditEvent } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/http/security";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.redirect(new URL("/login", request.url), 303);
  requirePlatformRole(auth, "PLATFORM_ADMIN");
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const sql = getSql();
  if (action.startsWith("organization_")) {
    const organizationId = String(form.get("organizationId") ?? "");
    const prior = await sql<{ status: string; active: boolean }[]>`select status, active from organizations where id = ${organizationId}`;
    if (!prior[0]) throw new Error("Organization not found.");
    const status = action === "organization_suspend" ? "suspended" : "active";
    await sql`update organizations set status = ${status}, active = ${status === "active"}, updated_at = now() where id = ${organizationId}`;
    if (status === "suspended") await sql`update sessions set revoked_at = now(), revoked_by_user_id = ${auth.userId}, revocation_reason = 'organization_suspended' where active_organization_id = ${organizationId} and revoked_at is null`;
    await writeAuditEvent({ organizationId, actorUserId: auth.userId, entityType: "organization", entityId: organizationId, action: `platform.organization_${status}`, previousValue: prior[0], newValue: { status }, reason: "Platform administration" });
  } else {
    const userId = String(form.get("userId") ?? "");
    if (userId === auth.userId && action === "user_disable") throw new Error("You cannot disable your own platform account.");
    if (action === "sessions_revoke") {
      const count = await revokeUserSessions(userId, auth.userId, "platform_admin");
      await writeAuditEvent({ actorUserId: auth.userId, entityType: "user", entityId: userId, action: "platform.sessions_revoked", newValue: { count }, reason: "Platform administration" });
    } else if (["user_disable", "user_activate"].includes(action)) {
      const prior = await sql<{ status: string; active: boolean }[]>`select status, active from users where id = ${userId}`;
      if (!prior[0]) throw new Error("User not found.");
      const status = action === "user_disable" ? "disabled" : "active";
      await sql`update users set status = ${status}, active = ${status === "active"}, disabled_at = ${status === "disabled" ? new Date() : null}, disabled_by_user_id = ${status === "disabled" ? auth.userId : null}, updated_at = now() where id = ${userId}`;
      if (status === "disabled") await revokeUserSessions(userId, auth.userId, "user_disabled");
      await writeAuditEvent({ actorUserId: auth.userId, entityType: "user", entityId: userId, action: `platform.user_${status}`, previousValue: prior[0], newValue: { status }, reason: "Platform administration" });
    }
  }
  return NextResponse.redirect(new URL("/platform-admin?saved=1", request.url), 303);
}
