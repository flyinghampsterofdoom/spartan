"use client";
/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";

export type AttachmentView = { id: string; fileName: string; url: string; context: string; createdAt: string; uploaderName?: string };

const contexts = [
  ["initial_issue", "Initial issue"], ["work_in_progress", "Work in progress"], ["completion", "Completion"],
  ["rejection_review", "Review / rejection"], ["rework", "Rework"], ["final_completion", "Final completion"], ["general", "General"],
] as const;

export function AttachmentUploader({ ownerId, initial = [], relatedEventId }: { ownerId: string; initial?: AttachmentView[]; relatedEventId?: string | null }) {
  const [items, setItems] = useState(initial);
  const [context, setContext] = useState("initial_issue");
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  async function acceptFiles(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true); setMessage("");
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const attachment = await upload(file, value => setProgress(value));
        setItems(current => [...current, attachment]);
      } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`); }
    }
    setProgress(null); setBusy(false);
    setMessage(failures.length ? `The punch action remains saved. Photo issue: ${failures.join(" · ")}` : `${files.length} photo${files.length === 1 ? "" : "s"} uploaded.`);
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
  }

  function upload(file: File, onProgress: (value: number) => void) {
    return new Promise<AttachmentView>((resolve, reject) => {
      const form = new FormData();
      form.set("ownerType", "punch_item"); form.set("ownerId", ownerId); form.set("context", context); form.set("file", file);
      if (relatedEventId) form.set("relatedEventId", relatedEventId);
      const request = new XMLHttpRequest();
      request.open("POST", "/api/attachments");
      request.upload.onprogress = event => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
      request.onload = () => {
        const body = parseResponse(request.responseText);
        if (request.status >= 200 && request.status < 300 && body.attachment) resolve({ id: body.attachment.id, fileName: body.attachment.fileName, url: body.attachment.url, context: String(body.attachment.metadata?.context ?? context), createdAt: String(body.attachment.createdAt) });
        else reject(new Error(String(body.error ?? "Upload failed.")));
      };
      request.onerror = () => reject(new Error("Connection lost during upload. You can retry the photo without recreating the item."));
      request.send(form);
    });
  }

  async function remove(item: AttachmentView) {
    const reason = window.prompt("Why should this photo be removed? Its audit record will be retained.");
    if (!reason) return;
    const response = await fetch(item.url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(String(body.error ?? "Photo could not be removed.")); return; }
    setItems(current => current.filter(value => value.id !== item.id));
    setMessage("Photo removed; its metadata and audit history were retained.");
  }

  return <section className="attachment-uploader"><div className="attachment-toolbar"><label>Photo context<select value={context} onChange={event => setContext(event.target.value)} disabled={busy}>{contexts.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><div className="attachment-buttons"><button className="primary" type="button" disabled={busy} onClick={() => cameraRef.current?.click()}>Take photo</button><button className="secondary" type="button" disabled={busy} onClick={() => libraryRef.current?.click()}>Choose photos</button></div><input ref={cameraRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={event => acceptFiles(event.target.files)}/><input ref={libraryRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={event => acceptFiles(event.target.files)}/></div>{progress != null && <div className="upload-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }}/><b>{progress}%</b></div>}{message && <p className={message.includes("issue") || message.includes("could not") ? "upload-message error" : "upload-message"} role="status">{message}</p>}<div className="attachment-grid">{items.map(item => <article key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt={`${contextLabel(item.context)} — ${item.fileName}`}/></a><div><strong>{contextLabel(item.context)}</strong><small>{item.fileName}</small><button className="text-button danger-link" type="button" onClick={() => remove(item)}>Remove</button></div></article>)}{items.length === 0 && <p className="empty-state">No photos yet. Add the first field photo without leaving this item.</p>}</div></section>;
}

function contextLabel(value: string) { return contexts.find(([key]) => key === value)?.[1] ?? "Photo"; }
function parseResponse(value: string) { try { return JSON.parse(value) as { attachment?: { id: string; fileName: string; url: string; metadata?: Record<string, unknown>; createdAt: string }; error?: string }; } catch { return { error: "Unexpected server response." }; } }
