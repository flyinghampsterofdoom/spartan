import { NextRequest, NextResponse } from "next/server";
import { AttachmentValidationError, deleteAttachment, getAttachmentForRead, isAttachmentAuthorizationError } from "@/lib/attachments";
import { AuthorizationError } from "@/lib/auth/policy";
import { getAuthContext } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http/security";
import { getObjectStorage, ObjectStorageConfigurationError } from "@/lib/storage/object-storage";

type Context = { params: Promise<{ attachmentId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  try {
    const attachment = await getAttachmentForRead(auth, (await context.params).attachmentId);
    const object = await getObjectStorage().get(attachment.storage_key);
    const body = Uint8Array.from(object.body).buffer;
    return new Response(body, { headers: {
      "Content-Type": attachment.content_type || object.contentType || "application/octet-stream",
      "Content-Length": String(body.byteLength), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { reason?: string; explanation?: string };
    await deleteAttachment(auth, (await context.params).attachmentId, body);
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}

function errorResponse(error: unknown) {
  if (error instanceof ObjectStorageConfigurationError) return NextResponse.json({ error: error.message }, { status: 503 });
  if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof AttachmentValidationError) return NextResponse.json({ error: error.message }, { status: error.message.includes("not found") ? 404 : 400 });
  if (isAttachmentAuthorizationError(error)) return NextResponse.json({ error: error instanceof Error ? error.message : "Attachment rejected." }, { status: 400 });
  return NextResponse.json({ error: "The attachment request could not be completed." }, { status: 500 });
}
