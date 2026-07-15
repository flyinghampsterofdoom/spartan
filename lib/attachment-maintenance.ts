import { getSql } from "@/db";
import { getObjectStorage, isObjectStorageConfigured } from "@/lib/storage/object-storage";

const RETRY_INTERVAL_MINUTES = 15;
const RECONCILIATION_INTERVAL_HOURS = 24;

type PendingAttachment = { id: string; organization_id: string; storage_key: string; metadata: Record<string, unknown> };

export function reconcileObjectKeys(objectKeys: string[], expectedKeys: string[], activeKeys: string[]) {
  const objects = new Set(objectKeys);
  const expected = new Set(expectedKeys);
  return {
    orphanKeys: objectKeys.filter(key => !expected.has(key)),
    missingKeys: activeKeys.filter(key => !objects.has(key)),
  };
}

export async function runAttachmentMaintenanceIfDue(now = new Date()) {
  if (!isObjectStorageConfigured()) return { skipped: "storage_not_configured" } as const;
  const sql = getSql();
  const due = await sql<{ due: boolean }[]>`
      select not exists (
        select 1 from audit_events where action='attachment.maintenance.completed'
          and created_at > ${now}::timestamptz - (${RETRY_INTERVAL_MINUTES} * interval '1 minute')
      ) as due
    `;
  if (!due[0]?.due) return { skipped: "not_due" } as const;

    const storage = getObjectStorage();
    const pending = await sql<PendingAttachment[]>`
      select id, organization_id, storage_key, metadata from attachments
      where object_delete_pending=true order by deleted_at nulls last, created_at limit 50
    `;
    let deleted = 0;
    let failed = 0;
    for (const attachment of pending) {
      try {
        await storage.delete(attachment.storage_key);
        await sql`update attachments set object_delete_pending=false, metadata=metadata - 'objectDeleteErrorAt' where id=${attachment.id}`;
        deleted += 1;
      } catch {
        const attempts = Number(attachment.metadata?.objectDeleteAttemptCount ?? 0) + 1;
        await sql`update attachments set metadata=metadata || ${JSON.stringify({ objectDeleteErrorAt: now.toISOString(), objectDeleteAttemptCount: attempts })}::jsonb where id=${attachment.id}`;
        failed += 1;
      }
    }

    const organizations = await sql<{ id: string }[]>`select id from organizations where status <> 'disabled' order by id`;
    let reconciled = 0;
    let reconciliationFailed = 0;
    for (const organization of organizations) {
      const reconciliationDue = await sql<{ due: boolean }[]>`
        select not exists (
          select 1 from audit_events where organization_id=${organization.id} and action='attachment.storage_reconciled'
            and created_at > ${now}::timestamptz - (${RECONCILIATION_INTERVAL_HOURS} * interval '1 hour')
        ) as due
      `;
      if (!reconciliationDue[0]?.due) continue;
      try {
        const records = await sql<{ storage_key: string; deleted_at: Date | null; object_delete_pending: boolean }[]>`
          select storage_key, deleted_at, object_delete_pending from attachments where organization_id=${organization.id}
        `;
        const objectKeys = await storage.list(`${organization.id}/`);
        const expectedKeys = records.filter(record => !record.deleted_at || record.object_delete_pending).map(record => record.storage_key);
        const activeKeys = records.filter(record => !record.deleted_at).map(record => record.storage_key);
        const result = reconcileObjectKeys(objectKeys, expectedKeys, activeKeys);
        await sql`
          insert into audit_events (organization_id, entity_type, entity_id, action, previous_value, new_value)
          values (${organization.id}, 'organization', ${organization.id}, 'attachment.storage_reconciled', '{}'::jsonb,
            ${JSON.stringify({ objectCount: objectKeys.length, expectedCount: expectedKeys.length, orphanCount: result.orphanKeys.length, missingCount: result.missingKeys.length, orphanKeys: result.orphanKeys.slice(0, 100), missingKeys: result.missingKeys.slice(0, 100) })}::jsonb)
        `;
        reconciled += 1;
      } catch (error) {
        reconciliationFailed += 1;
        await sql`
          insert into audit_events (organization_id, entity_type, entity_id, action, previous_value, new_value, reason)
          values (${organization.id}, 'organization', ${organization.id}, 'attachment.storage_reconciliation_failed', '{}'::jsonb,
            ${JSON.stringify({ errorType: error instanceof Error ? error.name : "UnknownError" })}::jsonb,
            ${error instanceof Error ? error.message.slice(0, 500) : "Reconciliation failed."})
        `;
      }
    }
    const markerId = organizations[0]?.id;
    if (markerId) await sql`
      insert into audit_events (organization_id, entity_type, entity_id, action, previous_value, new_value)
      values (${markerId}, 'organization', ${markerId}, 'attachment.maintenance.completed', '{}'::jsonb,
        ${JSON.stringify({ pendingFound: pending.length, deleted, failed, organizationsReconciled: reconciled, reconciliationFailed })}::jsonb)
    `;
  return { pendingFound: pending.length, deleted, failed, organizationsReconciled: reconciled, reconciliationFailed };
}
