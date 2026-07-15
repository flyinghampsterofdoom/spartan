import { getSql } from "@/db";
import { writeAuditEvent } from "@/lib/audit";
import { AuthorizationError } from "@/lib/auth/policy";
import type { AuthContext } from "@/lib/auth/types";
import { authorizePunchItemAction, PunchValidationError } from "@/lib/punch";
import { getObjectStorage } from "@/lib/storage/object-storage";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_CONTEXTS = ["initial_issue", "work_in_progress", "completion", "rejection_review", "rework", "final_completion", "general"] as const;
export type AttachmentContext = typeof ATTACHMENT_CONTEXTS[number];
export const ATTACHMENT_REMOVAL_REASONS = ["poor_photo", "cleanup", "duplicate", "wrong_photo", "miscellaneous", "other"] as const;
export type AttachmentRemovalReason = typeof ATTACHMENT_REMOVAL_REASONS[number];

const removalReasonLabels: Record<AttachmentRemovalReason, string> = {
  poor_photo: "Poor photo", cleanup: "Cleanup", duplicate: "Duplicate", wrong_photo: "Wrong photo",
  miscellaneous: "Miscellaneous", other: "Other",
};

export class AttachmentValidationError extends Error {
  constructor(message: string) { super(message); this.name = "AttachmentValidationError"; }
}

export type AttachmentRecord = {
  id: string; organization_id: string; owner_type: string; owner_id: string; storage_key: string; file_name: string;
  content_type: string; byte_size: number; checksum_sha256: string; visibility: string; related_event_id: string | null;
  metadata: Record<string, unknown>; uploaded_by_user_id: string; uploader_name?: string; created_at: Date | string;
  deleted_at: Date | string | null; deletion_reason: string | null; object_delete_pending: boolean;
};

function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export function parseAttachmentContext(value: unknown): AttachmentContext {
  const context = String(value ?? "general") as AttachmentContext;
  if (!ATTACHMENT_CONTEXTS.includes(context)) throw new AttachmentValidationError("Photo context is invalid.");
  return context;
}

export function parseAttachmentRemoval(input: { reason?: unknown; explanation?: unknown }) {
  const reason = String(input.reason ?? "") as AttachmentRemovalReason;
  const explanation = String(input.explanation ?? "").trim();
  if (!ATTACHMENT_REMOVAL_REASONS.includes(reason)) throw new AttachmentValidationError("Select a valid removal reason.");
  if (explanation.length > 500) throw new AttachmentValidationError("The removal explanation must be 500 characters or fewer.");
  if (reason === "other" && !explanation) throw new AttachmentValidationError("Explain why this photo is being removed.");
  return { reason, reasonLabel: removalReasonLabels[reason], explanation: explanation || null };
}

export function uploadPermissionsForContext(context: AttachmentContext) {
  if (context === "rejection_review") return ["punch.approve", "punch.manage"];
  if (context === "general") return ["punch.work", "punch.manage", "punch.approve"];
  return ["punch.work", "punch.manage"];
}

export function deletePermissionsForAttachment(isUploader: boolean, context: AttachmentContext) {
  return isUploader ? uploadPermissionsForContext(context) : ["punch.manage"];
}

export function attachmentAccessAllowed(authOrganizationId: string, recordOrganizationId: string, underlyingRecordAllowed: boolean) {
  return authOrganizationId === recordOrganizationId && underlyingRecordAllowed;
}

export function eventTypesForAttachmentContext(context: AttachmentContext) {
  const eventTypes: Record<AttachmentContext, string[]> = {
    initial_issue: ["item.created"], work_in_progress: ["execution.in_progress"], completion: ["execution.work_complete"],
    rejection_review: ["approval.rework_required", "approval.approved"], rework: ["execution.in_progress"],
    final_completion: ["execution.work_complete"], general: [],
  };
  return eventTypes[context];
}

export function validateImageSignature(contentType: string, bytes: Uint8Array) {
  if (bytes.length === 0) throw new AttachmentValidationError("The selected photo is empty.");
  const jpeg = contentType === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = contentType === "image/png" && bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value);
  const webp = contentType === "image/webp" && bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  const heicBrand = bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && ["heic","heix","hevc","hevx","mif1","msf1"].includes(ascii(bytes, 8, 12));
  const heic = ["image/heic", "image/heif"].includes(contentType) && heicBrand;
  if (!jpeg && !png && !webp && !heic) throw new AttachmentValidationError("Only valid JPEG, PNG, WebP, HEIC, or HEIF images are supported.");
}

function ascii(bytes: Uint8Array, start: number, end: number) { return String.fromCharCode(...bytes.slice(start, end)); }

export function attachmentObjectKey(organizationId: string, ownerType: string, ownerId: string, uniqueId = crypto.randomUUID()) {
  if (!validUuid(organizationId) || !validUuid(ownerId) || !validUuid(uniqueId) || !/^[a-z][a-z0-9_]{1,40}$/.test(ownerType)) throw new AttachmentValidationError("Attachment target is invalid.");
  return `${organizationId}/${ownerType}/${ownerId}/${uniqueId}`;
}

async function authorizeTarget(auth: AuthContext, ownerType: string, ownerId: string, permissions: string[]) {
  if (!validUuid(ownerId)) throw new AttachmentValidationError("Attachment target is invalid.");
  if (ownerType === "punch_item") return authorizePunchItemAction(auth, ownerId, permissions);
  throw new AttachmentValidationError("This attachment target type is not supported yet.");
}

async function resolveRelatedEvent(ownerId: string, suppliedId: string | null, context: AttachmentContext) {
  const sql = getSql();
  if (suppliedId) {
    if (!validUuid(suppliedId)) throw new AttachmentValidationError("Related event is invalid.");
    const rows = await sql<{ id: string }[]>`select id from punch_item_events where id=${suppliedId} and punch_item_id=${ownerId}`;
    if (!rows[0]) throw new AttachmentValidationError("Related event does not belong to this punch item.");
    return suppliedId;
  }
  const types = eventTypesForAttachmentContext(context);
  if (!types.length) return null;
  const rows = await sql<{ id: string }[]>`select id from punch_item_events where punch_item_id=${ownerId} and event_type in ${sql(types)} order by created_at desc limit 1`;
  return rows[0]?.id ?? null;
}

export async function uploadAttachment(auth: AuthContext, input: { ownerType: string; ownerId: string; context: AttachmentContext; relatedEventId?: string | null; file: File }) {
  await authorizeTarget(auth, input.ownerType, input.ownerId, uploadPermissionsForContext(input.context));
  if (!(input.file instanceof File)) throw new AttachmentValidationError("Select a photo to upload.");
  if (input.file.size <= 0 || input.file.size > MAX_IMAGE_BYTES) throw new AttachmentValidationError("Photos must be between 1 byte and 10 MB.");
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  validateImageSignature(input.file.type, bytes);
  const relatedEventId = input.ownerType === "punch_item" ? await resolveRelatedEvent(input.ownerId, input.relatedEventId ?? null, input.context) : null;
  const checksum = toHex(await crypto.subtle.digest("SHA-256", bytes));
  const storageKey = attachmentObjectKey(auth.organizationId, input.ownerType, input.ownerId);
  const originalName = input.file.name.replaceAll("\\", "/").split("/").pop()?.slice(0, 255) || "photo";
  const objectStorage = getObjectStorage();
  await objectStorage.put(storageKey, bytes, input.file.type, { organization: auth.organizationId, owner: input.ownerId });
  const sql = getSql();
  let attachment: AttachmentRecord;
  try {
    attachment = await sql.begin(async transaction => {
      const tx = transaction as unknown as typeof sql;
      const rows = await tx<AttachmentRecord[]>`
        insert into attachments (organization_id, owner_type, owner_id, storage_key, file_name, content_type, byte_size, checksum_sha256, visibility, related_event_id, metadata, uploaded_by_user_id)
        values (${auth.organizationId}, ${input.ownerType}, ${input.ownerId}, ${storageKey}, ${originalName}, ${input.file.type}, ${bytes.length}, ${checksum}, 'internal', ${relatedEventId}, ${JSON.stringify({ context: input.context })}::jsonb, ${auth.userId}) returning *
      `;
      const saved = rows[0];
      if (input.ownerType === "punch_item") await tx`
        insert into punch_item_events (punch_item_id, event_type, actor_user_id, notes, metadata)
        values (${input.ownerId}, 'attachment.uploaded', ${auth.userId}, ${originalName}, ${JSON.stringify({ attachmentId: saved.id, relatedEventId, context: input.context })}::jsonb)
      `;
      return saved;
    });
  } catch (error) {
    await objectStorage.delete(storageKey).catch(() => undefined);
    throw error;
  }
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "attachment", entityId: attachment.id, action: "attachment.created", newValue: { ownerType: input.ownerType, ownerId: input.ownerId, relatedEventId, context: input.context, contentType: input.file.type, byteSize: bytes.length, checksum } });
  return attachment;
}

function toHex(buffer: ArrayBuffer) { return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, "0")).join(""); }

export async function getAttachmentForRead(auth: AuthContext, attachmentId: string) {
  if (!validUuid(attachmentId)) throw new AttachmentValidationError("Attachment is invalid.");
  const sql = getSql();
  const rows = await sql<AttachmentRecord[]>`select * from attachments where id=${attachmentId} and organization_id=${auth.organizationId} and deleted_at is null`;
  const attachment = rows[0];
  if (!attachment) throw new AttachmentValidationError("Attachment not found.");
  await authorizeTarget(auth, attachment.owner_type, attachment.owner_id, ["punch.view", "punch.work", "punch.manage", "punch.approve"]);
  return attachment;
}

export async function listPunchAttachments(auth: AuthContext, itemIds: string[]) {
  if (!itemIds.length) return [];
  const sql = getSql();
  return sql<AttachmentRecord[]>`
    select a.*, u.display_name as uploader_name from attachments a join users u on u.id=a.uploaded_by_user_id
    where a.organization_id=${auth.organizationId} and a.owner_type='punch_item' and a.owner_id in ${sql(itemIds)} and a.deleted_at is null
    order by a.created_at
  `;
}

export async function deleteAttachment(auth: AuthContext, attachmentId: string, removalInput: { reason?: unknown; explanation?: unknown }) {
  if (!validUuid(attachmentId)) throw new AttachmentValidationError("Attachment is invalid.");
  const removal = parseAttachmentRemoval(removalInput);
  const sql = getSql();
  const rows = await sql<AttachmentRecord[]>`select * from attachments where id=${attachmentId} and organization_id=${auth.organizationId} and deleted_at is null`;
  const attachment = rows[0];
  if (!attachment) throw new AttachmentValidationError("Attachment not found.");
  const context = parseAttachmentContext(attachment.metadata?.context);
  const permissions = deletePermissionsForAttachment(attachment.uploaded_by_user_id === auth.userId, context);
  await authorizeTarget(auth, attachment.owner_type, attachment.owner_id, permissions);
  await sql.begin(async transaction => {
    const tx = transaction as unknown as typeof sql;
    const updated = await tx<{ id: string }[]>`update attachments set deleted_at=now(), deleted_by_user_id=${auth.userId}, deletion_reason=${removal.reasonLabel}, object_delete_pending=true,
      metadata=metadata || ${JSON.stringify({ removalReason: removal.reason, removalExplanation: removal.explanation, objectDeleteAttemptCount: 0 })}::jsonb
      where id=${attachmentId} and deleted_at is null returning id`;
    if (!updated[0]) throw new AttachmentValidationError("Attachment was already deleted.");
    if (attachment.owner_type === "punch_item") await tx`
      insert into punch_item_events (punch_item_id, event_type, actor_user_id, notes, metadata)
      values (${attachment.owner_id}, 'attachment.deleted', ${auth.userId}, ${removal.explanation ?? removal.reasonLabel}, ${JSON.stringify({ attachmentId, removalReason: removal.reason, removalReasonLabel: removal.reasonLabel, removalExplanation: removal.explanation })}::jsonb)
    `;
  });
  await writeAuditEvent({ organizationId: auth.organizationId, actorUserId: auth.userId, entityType: "attachment", entityId: attachmentId, action: "attachment.deleted", previousValue: { ownerType: attachment.owner_type, ownerId: attachment.owner_id, storageKey: attachment.storage_key }, newValue: { deleted: true, removalReason: removal.reason, removalReasonLabel: removal.reasonLabel, removalExplanation: removal.explanation }, reason: removal.explanation ?? removal.reasonLabel });
  try {
    await getObjectStorage().delete(attachment.storage_key);
    await sql`update attachments set object_delete_pending=false where id=${attachmentId}`;
  } catch {
    await sql`update attachments set metadata=metadata || ${JSON.stringify({ objectDeleteErrorAt: new Date().toISOString(), objectDeleteAttemptCount: 1 })}::jsonb where id=${attachmentId}`;
  }
  return { deleted: true };
}

export function isAttachmentAuthorizationError(error: unknown) {
  return error instanceof AttachmentValidationError || error instanceof AuthorizationError || error instanceof PunchValidationError;
}
