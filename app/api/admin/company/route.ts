import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getAuthContext, revokeUserSessions } from "@/lib/auth/session";
import { can, requirePermission } from "@/lib/auth/policy";
import { createInvitation } from "@/lib/auth/tokens";
import { writeAuditEvent } from "@/lib/audit";
import { assertSameOrigin } from "@/lib/http/security";
import { appUrl } from "@/lib/http/app-url";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.redirect(appUrl("/login", request.url), 303);
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const sql = getSql();
  if (action === "invite") {
    requirePermission(auth, "organization.invitations.manage");
    await createInvitation({ organizationId: auth.organizationId, email: String(form.get("email") ?? ""), roleId: String(form.get("roleId") ?? ""), employeeId: String(form.get("employeeId") ?? "") || null, invitedByUserId: auth.userId });
  } else if (action === "organization") {
    requirePermission(auth, "organization.settings.manage");
    const prior = await sql<{ name: string; default_timezone: string; profile: Record<string, unknown> }[]>`select name, default_timezone, profile from organizations where id = ${auth.organizationId}`;
    const next = { name: String(form.get("name") ?? "").trim(), timezone: String(form.get("timezone") ?? "UTC").trim(), phone: String(form.get("phone") ?? "").trim() };
    await sql`update organizations set name = ${next.name}, default_timezone = ${next.timezone}, profile = ${sql.json({ ...(prior[0].profile ?? {}), phone: next.phone })}, updated_at = now() where id = ${auth.organizationId}`;
    await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "organization", entityId: auth.organizationId, action: "organization.settings_changed", previousValue: prior[0], newValue: next });
  } else if (action === "membership_role") {
    requirePermission(auth, "organization.memberships.manage");
    const membershipId = String(form.get("membershipId") ?? "");
    const roleId = String(form.get("roleId") ?? "");
    const target = await sql<{ role_id: string; user_id: string }[]>`select role_id, user_id from organization_memberships where id = ${membershipId} and organization_id = ${auth.organizationId}`;
    const role = await sql<{ id: string; name: string }[]>`select id, name from roles where id = ${roleId}`;
    if (!target[0] || !role[0]) throw new Error("Membership or role not found.");
    if (target[0].user_id === auth.userId && role[0].name !== "Owner") throw new Error("You cannot remove your own Owner access.");
    await sql`update organization_memberships set role_id = ${roleId}, updated_at = now() where id = ${membershipId}`;
    await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "organization_membership", entityId: membershipId, action: "membership.role_changed", previousValue: { roleId: target[0].role_id }, newValue: { roleId } });
  } else if (action.startsWith("membership_")) {
    requirePermission(auth, "organization.memberships.manage");
    const membershipId = String(form.get("membershipId") ?? "");
    const target = await sql<{ status: string; user_id: string }[]>`select status, user_id from organization_memberships where id = ${membershipId} and organization_id = ${auth.organizationId}`;
    if (!target[0]) throw new Error("Membership not found.");
    if (target[0].user_id === auth.userId && action !== "membership_activate") throw new Error("You cannot suspend or revoke your own active membership.");
    const status = action === "membership_activate" ? "active" : action === "membership_suspend" ? "suspended" : "revoked";
    await sql`update organization_memberships set status = ${status}, suspended_at = ${status === "suspended" ? new Date() : null}, revoked_at = ${status === "revoked" ? new Date() : null}, updated_at = now() where id = ${membershipId}`;
    if (["suspended", "revoked"].includes(status)) await revokeUserSessions(target[0].user_id, auth.userId, `membership_${status}`);
    await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "organization_membership", entityId: membershipId, action: `membership.${status}`, previousValue: { status: target[0].status }, newValue: { status } });
  } else if (action === "sessions_revoke") {
    requirePermission(auth, "organization.memberships.manage");
    const membershipId = String(form.get("membershipId") ?? "");
    const target = await sql<{ user_id: string }[]>`select user_id from organization_memberships where id = ${membershipId} and organization_id = ${auth.organizationId}`;
    if (target[0]) {
      const count = await revokeUserSessions(target[0].user_id, auth.userId, "organization_admin");
      await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "user", entityId: target[0].user_id, action: "sessions.revoked", newValue: { count } });
    }
  } else if (action.startsWith("invitation_")) {
    requirePermission(auth, "organization.invitations.manage");
    const invitationId = String(form.get("invitationId") ?? "");
    const invitation = await sql<{ email: string; role_id: string; employee_id: string | null; status: string }[]>`select email, role_id, employee_id, status from invitations where id = ${invitationId} and organization_id = ${auth.organizationId}`;
    if (!invitation[0]) throw new Error("Invitation not found.");
    if (action === "invitation_revoke") {
      await sql`update invitations set status = 'revoked', revoked_at = now() where id = ${invitationId}`;
      await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "invitation", entityId: invitationId, action: "invitation.revoked", previousValue: { status: invitation[0].status }, newValue: { status: "revoked" } });
    } else {
      await createInvitation({ organizationId: auth.organizationId, email: invitation[0].email, roleId: invitation[0].role_id, employeeId: invitation[0].employee_id, invitedByUserId: auth.userId });
    }
  } else if (!can(auth, "organization.memberships.manage")) {
    throw new Error("Not authorized.");
  }
  return NextResponse.redirect(appUrl("/settings?saved=1", request.url), 303);
}
