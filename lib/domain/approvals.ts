import { getSql } from "@/db";
import { writeAuditEvent } from "@/lib/audit";
import { assertNotSelfApproval } from "@/lib/auth/policy";
import type { AuthContext } from "@/lib/auth/types";
import { authorizeResource } from "@/lib/auth/authorization";
import { approveTime } from "@/lib/timekeeping";

export async function approveTimeEntry(context: AuthContext, timeEntryId: string) {
  await approveTime(context, timeEntryId);
}

export async function approvePunchItem(context: AuthContext, punchItemId: string) {
  const sql = getSql();
  const rows = await sql<{ assigned_employee_id: string | null; organization_id: string; project_id: string; verification_status: string }[]>`
    select pi.assigned_employee_id, p.organization_id, pi.project_id, pi.verification_status
    from punch_items pi join projects p on p.id = pi.project_id where pi.id = ${punchItemId} limit 1
  `;
  const item = rows[0];
  if (!item) throw new Error("Punch item not found.");
  await authorizeResource(context, "punch.approve", { organizationId: item.organization_id, employeeId: item.assigned_employee_id, projectId: item.project_id });
  if (item.assigned_employee_id) assertNotSelfApproval(context, item.assigned_employee_id, "punch");
  await sql`update punch_items set verification_status = 'approved', approved_at = now(), updated_at = now() where id = ${punchItemId}`;
  await sql`insert into punch_item_events (punch_item_id, event_type, actor_user_id, notes) values (${punchItemId}, 'approved', ${context.userId}, 'Approved in Spartan')`;
  await writeAuditEvent({ organizationId: context.organizationId, actorUserId: context.userId, entityType: "punch_item", entityId: punchItemId, action: "punch.approved", previousValue: { verificationStatus: item.verification_status }, newValue: { verificationStatus: "approved" } });
}
