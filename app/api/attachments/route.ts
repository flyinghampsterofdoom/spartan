import { NextRequest, NextResponse } from "next/server";
import { AttachmentValidationError, isAttachmentAuthorizationError, parseAttachmentContext, uploadAttachment } from "@/lib/attachments";
import { AuthorizationError } from "@/lib/auth/policy";
import { getAuthContext } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http/security";
import { ObjectStorageConfigurationError } from "@/lib/storage/object-storage";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AttachmentValidationError("Select a photo to upload.");
    const attachment = await uploadAttachment(auth, {
      ownerType: String(form.get("ownerType") ?? ""), ownerId: String(form.get("ownerId") ?? ""),
      context: parseAttachmentContext(form.get("context")), relatedEventId: String(form.get("relatedEventId") ?? "") || null, file,
    });
    return NextResponse.json({ attachment: publicAttachment(attachment) }, { status: 201 });
  } catch (error) {
    if (error instanceof ObjectStorageConfigurationError) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (isAttachmentAuthorizationError(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "Upload rejected." }, { status: 400 });
    return NextResponse.json({ error: "The photo could not be uploaded." }, { status: 500 });
  }
}

function publicAttachment(attachment: { id: string; file_name: string; content_type: string; byte_size: number; related_event_id: string | null; metadata: Record<string, unknown>; created_at: Date | string }) {
  return { id: attachment.id, fileName: attachment.file_name, contentType: attachment.content_type, byteSize: attachment.byte_size, relatedEventId: attachment.related_event_id, metadata: attachment.metadata, createdAt: attachment.created_at, url: `/api/attachments/${attachment.id}` };
}
