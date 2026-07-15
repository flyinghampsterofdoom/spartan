"use client";

export type UploadedAttachment = {
  id: string;
  fileName: string;
  url: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type UploadFields = {
  ownerId: string;
  context: string;
  relatedEventId?: string | null;
};

const MAX_FIELD_PHOTO_EDGE = 1920;
const JPEG_QUALITY = 0.82;
const UPLOAD_TIMEOUT_MS = 90_000;

export async function prepareFieldPhoto(file: File) {
  if (!file.type.startsWith("image/")) return file;

  try {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_FIELD_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.size <= 2 * 1024 * 1024 && file.type !== "image/heic" && file.type !== "image/heif") return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export function uploadPunchPhoto(file: File, fields: UploadFields, onProgress: (value: number) => void) {
  return new Promise<UploadedAttachment>((resolve, reject) => {
    const form = new FormData();
    form.set("ownerType", "punch_item");
    form.set("ownerId", fields.ownerId);
    form.set("context", fields.context);
    form.set("file", file);
    if (fields.relatedEventId) form.set("relatedEventId", fields.relatedEventId);

    const request = new XMLHttpRequest();
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    request.open("POST", "/api/attachments");
    request.timeout = UPLOAD_TIMEOUT_MS;
    request.upload.onprogress = event => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    request.onload = () => {
      if (settled) return;
      const body = parseResponse(request.responseText);
      if (request.status >= 200 && request.status < 300 && body.attachment) {
        settled = true;
        resolve(body.attachment);
      } else fail(String(body.error ?? `Upload failed (${request.status || "no response"}).`));
    };
    request.onerror = () => fail("The connection ended before the photo finished uploading. Try again.");
    request.ontimeout = () => fail("The photo upload timed out. Try again on a stronger connection.");
    request.onabort = () => fail("The photo upload was interrupted. Try again.");
    request.send(form);
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Photo preview unavailable.")); };
    image.src = url;
  });
}

function parseResponse(value: string) {
  try { return JSON.parse(value) as { attachment?: UploadedAttachment; error?: string }; }
  catch { return { error: "Unexpected server response." }; }
}
