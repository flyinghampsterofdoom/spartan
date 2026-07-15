"use client";
/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import { prepareFieldPhoto, uploadPunchPhoto } from "@/lib/client/photo-upload";

export type AttachmentView = { id: string; fileName: string; url: string; context: string; createdAt: string; uploaderName?: string };

const contexts = [
  ["initial_issue", "Before work"], ["work_in_progress", "During work"], ["completion", "Completed work"],
  ["rejection_review", "Review"], ["rework", "Rework"], ["final_completion", "Final photo"], ["general", "Other"],
] as const;
const removalReasons = [
  ["poor_photo", "Poor photo"], ["cleanup", "Cleanup"], ["duplicate", "Duplicate"],
  ["wrong_photo", "Wrong photo"], ["miscellaneous", "Miscellaneous"], ["other", "Other"],
] as const;

export function AttachmentUploader({ ownerId, initial = [], relatedEventId }: { ownerId: string; initial?: AttachmentView[]; relatedEventId?: string | null }) {
  const [items, setItems] = useState(initial);
  const [context, setContext] = useState("initial_issue");
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryFiles, setRetryFiles] = useState<File[]>([]);
  const [removeTarget, setRemoveTarget] = useState<AttachmentView | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removeExplanation, setRemoveExplanation] = useState("");
  const [removing, setRemoving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  async function acceptFiles(files: FileList | File[] | null) {
    if (!files?.length || busy) return;
    const selected = Array.from(files);
    setBusy(true); setMessage("Preparing photo…"); setRetryFiles([]);
    const failures: string[] = [];
    for (const original of selected) {
      try {
        const file = await prepareFieldPhoto(original);
        setMessage("Uploading photo…");
        const uploaded = await uploadPunchPhoto(file, { ownerId, context, relatedEventId }, value => setProgress(value));
        setItems(current => [...current, { id: uploaded.id, fileName: uploaded.fileName, url: uploaded.url, context: String(uploaded.metadata?.context ?? context), createdAt: String(uploaded.createdAt) }]);
      } catch (error) {
        failures.push(`${original.name}: ${error instanceof Error ? error.message : "upload failed"}`);
        setRetryFiles(current => [...current, original]);
      }
    }
    setProgress(null); setBusy(false);
    setMessage(failures.length ? `Photo not uploaded: ${failures.join(" · ")}` : `${selected.length} photo${selected.length === 1 ? "" : "s"} uploaded.`);
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
  }

  function openCamera() { if (cameraRef.current) { cameraRef.current.value = ""; cameraRef.current.click(); } }
  function openLibrary() { if (libraryRef.current) { libraryRef.current.value = ""; libraryRef.current.click(); } }
  function beginRemove(item: AttachmentView) { setRemoveTarget(item); setRemoveReason(""); setRemoveExplanation(""); setMessage(""); }
  function cancelRemove() { if (!removing) { setRemoveTarget(null); setRemoveReason(""); setRemoveExplanation(""); } }

  async function confirmRemove() {
    if (!removeTarget || !removeReason || (removeReason === "other" && !removeExplanation.trim()) || removing) return;
    setRemoving(true); setMessage("Removing photo…");
    try {
      const response = await fetch(removeTarget.url, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: removeReason, explanation: removeExplanation.trim() || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "Photo could not be removed."));
      setItems(current => current.filter(value => value.id !== removeTarget.id));
      setRemoveTarget(null); setRemoveReason(""); setRemoveExplanation(""); setMessage("Photo removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Photo could not be removed."); }
    finally { setRemoving(false); }
  }

  return <section className="attachment-uploader">
    <div className="attachment-toolbar">
      <label>Photo type<select value={context} onChange={event => setContext(event.target.value)} disabled={busy}>{contexts.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
      <div className="attachment-buttons"><button className="primary" type="button" disabled={busy} onClick={openCamera}>{busy ? "Uploading…" : "Take photo"}</button><button className="secondary" type="button" disabled={busy} onClick={openLibrary}>Choose photos</button>{retryFiles.length > 0 && <button className="secondary" type="button" disabled={busy} onClick={() => acceptFiles(retryFiles)}>Retry upload</button>}</div>
      <input ref={cameraRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={event => acceptFiles(event.target.files)}/>
      <input ref={libraryRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={event => acceptFiles(event.target.files)}/>
    </div>
    {progress != null && <div className="upload-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }}/><b>{progress}%</b></div>}
    {message && <p className={message.includes("not uploaded") || message.includes("timed out") || message.includes("could not") ? "upload-message error" : "upload-message"} role="status">{message}</p>}
    <div className="attachment-grid">
      {items.map(item => <article key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><img src={item.url} alt={`${contextLabel(item.context)} — ${item.fileName}`}/></a><div><strong>{contextLabel(item.context)}</strong><small>{item.fileName}</small>
        {removeTarget?.id === item.id ? <div className="attachment-remove-form">
          <label>Reason<select value={removeReason} onChange={event => { setRemoveReason(event.target.value); if (event.target.value !== "other") setRemoveExplanation(""); }} autoFocus disabled={removing} required><option value="">Select a reason…</option>{removalReasons.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          {removeReason === "other" && <label>Explanation<input value={removeExplanation} onChange={event => setRemoveExplanation(event.target.value)} placeholder="Why is this photo being removed?" maxLength={500} disabled={removing} required/></label>}
          <div><button className="secondary" type="button" onClick={cancelRemove} disabled={removing}>Cancel</button><button className="danger" type="button" onClick={confirmRemove} disabled={removing || !removeReason || (removeReason === "other" && !removeExplanation.trim())}>{removing ? "Removing…" : "Remove photo"}</button></div>
        </div> : <button className="text-button danger-link" type="button" onClick={() => beginRemove(item)}>Remove</button>}
      </div></article>)}
      {items.length === 0 && <p className="empty-state">No photos yet.</p>}
    </div>
  </section>;
}

function contextLabel(value: string) { return contexts.find(([key]) => key === value)?.[1] ?? "Photo"; }
