import { getSql } from "@/db";
import { applicationUrl, sendEmail } from "@/lib/email/service";
import { writeAuditEvent } from "@/lib/audit";
import { createOpaqueToken, hashOpaqueToken, hashPassword } from "./crypto";

export async function requestPasswordReset(email: string, ipAddress?: string | null) {
  const sql = getSql();
  const users = await sql<{ id: string; email: string; display_name: string; active: boolean; status: string }[]>`
    select id, email, display_name, active, status from users where lower(email) = ${email.trim().toLowerCase()} limit 1
  `;
  const user = users[0];
  if (!user || !user.active || user.status !== "active") return;
  await sql`update password_reset_tokens set revoked_at = now() where user_id = ${user.id} and consumed_at is null and revoked_at is null`;
  const token = createOpaqueToken();
  await sql`
    insert into password_reset_tokens (user_id, token_hash, expires_at, requested_ip_address)
    values (${user.id}, ${hashOpaqueToken(token)}, now() + interval '30 minutes', ${ipAddress ?? null})
  `;
  const link = applicationUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  await sendEmail({
    type: "password_reset",
    to: user.email,
    subject: "Reset your Spartan password",
    text: `A password reset was requested for your Spartan account. This link expires in 30 minutes and can be used once:\n\n${link}\n\nIf you did not request this, no action is required.`,
    metadata: { userId: user.id },
  });
}

export async function completePasswordReset(token: string, password: string) {
  const sql = getSql();
  const rows = await sql<{ id: string; user_id: string }[]>`
    select id, user_id from password_reset_tokens
    where token_hash = ${hashOpaqueToken(token)} and consumed_at is null and revoked_at is null and expires_at > now()
    limit 1
  `;
  const reset = rows[0];
  if (!reset) return false;
  const passwordHash = await hashPassword(password);
  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as typeof sql;
    await tx`update users set password_hash = ${passwordHash}, password_changed_at = now(), updated_at = now() where id = ${reset.user_id}`;
    await tx`update password_reset_tokens set consumed_at = now() where id = ${reset.id}`;
    await tx`update password_reset_tokens set revoked_at = now() where user_id = ${reset.user_id} and id <> ${reset.id} and consumed_at is null and revoked_at is null`;
    await tx`update sessions set revoked_at = now(), revocation_reason = 'password_reset' where user_id = ${reset.user_id} and revoked_at is null`;
  });
  await writeAuditEvent({ actorUserId: reset.user_id, entityType: "user", entityId: reset.user_id, action: "auth.password_reset_completed" });
  return true;
}

export async function createInvitation(input: {
  organizationId: string;
  email: string;
  roleId: string;
  employeeId?: string | null;
  invitedByUserId: string;
}) {
  const sql = getSql();
  const email = input.email.trim().toLowerCase();
  await sql`
    update invitations set status = 'revoked', revoked_at = now()
    where organization_id = ${input.organizationId} and lower(email) = ${email}
      and status = 'invited' and accepted_at is null and revoked_at is null
  `;
  const token = createOpaqueToken();
  const invitations = await sql<{ id: string; organization_name: string }[]>`
    insert into invitations (
      organization_id, email, role_id, employee_id, token_hash, invited_by_user_id, expires_at, status
    )
    select ${input.organizationId}, ${email}, ${input.roleId}, ${input.employeeId ?? null},
      ${hashOpaqueToken(token)}, ${input.invitedByUserId}, now() + interval '7 days', 'invited'
    from organizations where id = ${input.organizationId}
    returning id, (select name from organizations where id = ${input.organizationId}) as organization_name
  `;
  const invitation = invitations[0];
  const link = applicationUrl(`/invite?token=${encodeURIComponent(token)}`);
  await sendEmail({
    type: "invitation",
    to: email,
    subject: `You are invited to ${invitation.organization_name} in Spartan`,
    text: `You have been invited to join ${invitation.organization_name} in Spartan. This invitation expires in 7 days and can be used once:\n\n${link}`,
    organizationId: input.organizationId,
    metadata: { invitationId: invitation.id },
  });
  await writeAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.invitedByUserId,
    entityType: "invitation",
    entityId: invitation.id,
    action: "invitation.created",
    newValue: { email, roleId: input.roleId, employeeId: input.employeeId ?? null },
  });
  return invitation;
}

export async function acceptInvitation(input: { token: string; displayName: string; password?: string }) {
  const sql = getSql();
  const rows = await sql<{
    id: string;
    organization_id: string;
    email: string;
    role_id: string;
    employee_id: string | null;
    existing_user_id: string | null;
    existing_password_hash: string | null;
  }[]>`
    select i.id, i.organization_id, i.email, i.role_id, i.employee_id,
      u.id as existing_user_id, u.password_hash as existing_password_hash
    from invitations i
    left join users u on lower(u.email) = lower(i.email)
    where i.token_hash = ${hashOpaqueToken(input.token)} and i.status = 'invited'
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    limit 1
  `;
  const invitation = rows[0];
  if (!invitation) return null;
  let userId = invitation.existing_user_id;
  let passwordHash: string | null = invitation.existing_password_hash;
  if (!passwordHash) {
    if (!input.password) throw new Error("A password is required to activate this account.");
    passwordHash = await hashPassword(input.password);
  }
  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as typeof sql;
    if (!userId) {
      const created = await tx<{ id: string }[]>`
        insert into users (email, display_name, password_hash, email_verified_at, status, active, password_changed_at)
        values (${invitation.email}, ${input.displayName.trim()}, ${passwordHash}, now(), 'active', true, now())
        returning id
      `;
      userId = created[0].id;
    } else {
      await tx`
        update users set display_name = ${input.displayName.trim()}, password_hash = ${passwordHash},
          email_verified_at = coalesce(email_verified_at, now()), status = 'active', active = true, updated_at = now()
        where id = ${userId}
      `;
    }
    await tx`
      insert into organization_memberships (
        organization_id, user_id, role_id, employee_id, status, invited_by_user_id, joined_at
      )
      select organization_id, ${userId}, role_id, employee_id, 'active', invited_by_user_id, now()
      from invitations where id = ${invitation.id}
      on conflict (organization_id, user_id) do update set
        role_id = excluded.role_id, employee_id = excluded.employee_id, status = 'active',
        joined_at = coalesce(organization_memberships.joined_at, now()),
        suspended_at = null, revoked_at = null, updated_at = now()
    `;
    if (invitation.employee_id) {
      await tx`update employees set user_id = ${userId}, updated_at = now() where id = ${invitation.employee_id} and organization_id = ${invitation.organization_id} and user_id is null`;
    }
    await tx`
      update invitations set status = 'accepted', accepted_at = now(), consumed_at = now(), accepted_by_user_id = ${userId}
      where id = ${invitation.id}
    `;
  });
  await writeAuditEvent({
    organizationId: invitation.organization_id,
    actorUserId: userId,
    entityType: "invitation",
    entityId: invitation.id,
    action: "invitation.accepted",
  });
  return userId;
}
