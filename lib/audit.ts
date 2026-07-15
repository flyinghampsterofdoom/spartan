import { getSql } from "@/db";

type AuditInput = {
  organizationId?: string | null;
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  reason?: string | null;
};

export async function writeAuditEvent(input: AuditInput) {
  const sql = getSql();
  await sql`
    insert into audit_events (
      organization_id, actor_user_id, entity_type, entity_id, action,
      previous_value, new_value, reason
    ) values (
      ${input.organizationId ?? null}, ${input.actorUserId ?? null}, ${input.entityType},
      ${input.entityId}, ${input.action}, ${JSON.stringify(input.previousValue ?? {})}::jsonb,
      ${JSON.stringify(input.newValue ?? {})}::jsonb, ${input.reason ?? null}
    )
  `;
}
