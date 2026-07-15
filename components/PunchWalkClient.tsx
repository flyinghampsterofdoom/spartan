"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";

type Option = { id: string; name: string };
type Project = Option & { projectNumber: string };
type List = Option & { projectId: string };
type Area = Option & { projectId: string };
type Assignee = Option & { kind: "employee" | "crew" };

type Defaults = { projectId: string; listId: string; areaId: string; categoryId: string; assignee: string; priority: string };
const storageKey = "spartan:punch-walk:defaults";

export function PunchWalkClient({ projects, initialLists, areas, categories, assignees, initialProjectId = "" }: { projects: Project[]; initialLists: List[]; areas: Area[]; categories: Option[]; assignees: Assignee[]; initialProjectId?: string }) {
  const [defaults, setDefaults] = useState<Defaults>({ projectId: initialProjectId, listId: "", areaId: "", categoryId: "", assignee: "", priority: "normal" });
  const [lists, setLists] = useState(initialLists);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [newListName, setNewListName] = useState("");
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<{ itemId: string; eventId: string | null; file: File } | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { defaults?: Defaults; count?: number } | null;
        if (saved?.defaults) setDefaults(current => ({ ...current, ...saved.defaults, projectId: initialProjectId || saved.defaults!.projectId }));
        if (typeof saved?.count === "number") setCount(saved.count);
      } catch { /* Device-local defaults are optional. */ }
      setDefaultsLoaded(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialProjectId]);
  useEffect(() => { if (defaultsLoaded) sessionStorage.setItem(storageKey, JSON.stringify({ defaults, count })); }, [defaults, count, defaultsLoaded]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const projectLists = useMemo(() => lists.filter(list => list.projectId === defaults.projectId), [lists, defaults.projectId]);
  const projectAreas = useMemo(() => areas.filter(area => area.projectId === defaults.projectId), [areas, defaults.projectId]);
  const project = projects.find(value => value.id === defaults.projectId);

  function update<K extends keyof Defaults>(key: K, value: Defaults[K]) { setDefaults(current => ({ ...current, [key]: value })); }
  function selectProject(value: string) { setDefaults(current => ({ ...current, projectId: value, listId: "", areaId: "" })); }
  function selectPhoto(value: File | null) { if (preview) URL.revokeObjectURL(preview); setFile(value); setPreview(value ? URL.createObjectURL(value) : ""); setMessage(""); }

  async function createList() {
    if (!defaults.projectId || !newListName.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/punch-walk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_create", projectId: defaults.projectId, name: newListName, description: "Created during Punch Walk" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Punch list could not be created.");
      const next = { id: String(body.list.id), projectId: defaults.projectId, name: newListName.trim() };
      setLists(current => [...current, next]); update("listId", next.id); setNewListName(""); setMessage("Punch list created. Ready to capture items.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Punch list could not be created."); } finally { setBusy(false); }
  }

  async function saveItem() {
    if (!defaults.projectId || !defaults.listId || !description.trim() || busy || pendingPhoto) return;
    setBusy(true); setMessage("Saving item…");
    const assignee = defaults.assignee.split(":");
    try {
      const response = await fetch("/api/punch-walk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "item_create", punchListId: defaults.listId, itemNumber: `PW-${requestId.current.slice(0, 8).toUpperCase()}`,
        description: description.trim(), priority: defaults.priority, areaId: defaults.areaId, workCategoryId: defaults.categoryId,
        assignedEmployeeId: assignee[0] === "employee" ? assignee[1] : "", assignedCrewId: assignee[0] === "crew" ? assignee[1] : "", clientRequestId: requestId.current,
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Punch item could not be saved.");
      const saved = { itemId: String(body.itemId), eventId: body.eventId ? String(body.eventId) : null };
      setCount(value => value + 1); requestId.current = crypto.randomUUID();
      if (file) {
        try { await uploadPhoto(saved.itemId, saved.eventId, file); finishCapture("Item and initial-condition photo saved. Ready for the next item."); }
        catch (error) { setPendingPhoto({ ...saved, file }); setMessage(`Item saved. Photo failed: ${error instanceof Error ? error.message : "upload failed"}. Retry it or continue without the photo.`); }
      } else finishCapture(body.duplicate ? "Existing submission recovered safely. Ready for the next item." : "Item saved. Ready for the next item.");
    } catch (error) { setMessage(`${error instanceof Error ? error.message : "Save failed."} Your entry is still on this screen and can be retried.`); } finally { setBusy(false); setProgress(null); }
  }

  async function retryPhoto() {
    if (!pendingPhoto || busy) return;
    setBusy(true); setMessage("Retrying photo…");
    try { await uploadPhoto(pendingPhoto.itemId, pendingPhoto.eventId, pendingPhoto.file); setPendingPhoto(null); finishCapture("Photo attached to the saved item. Ready for the next item."); }
    catch (error) { setMessage(`Item remains saved. Photo retry failed: ${error instanceof Error ? error.message : "upload failed"}.`); }
    finally { setBusy(false); setProgress(null); }
  }

  function continueWithoutPhoto() { setPendingPhoto(null); finishCapture("Item kept without its photo. Ready for the next item."); }
  function finishCapture(nextMessage: string) { setDescription(""); selectPhoto(null); setMessage(nextMessage); }

  function uploadPhoto(itemId: string, eventId: string | null, selected: File) {
    return new Promise<void>((resolve, reject) => {
      const form = new FormData(); form.set("ownerType", "punch_item"); form.set("ownerId", itemId); form.set("context", "initial_issue"); form.set("file", selected); if (eventId) form.set("relatedEventId", eventId);
      const request = new XMLHttpRequest(); request.open("POST", "/api/attachments");
      request.upload.onprogress = event => event.lengthComputable && setProgress(Math.round((event.loaded / event.total) * 100));
      request.onload = () => { const body = parseBody(request.responseText); if (request.status >= 200 && request.status < 300) resolve(); else reject(new Error(body.error ?? "Upload rejected.")); };
      request.onerror = () => reject(new Error("connection lost")); request.send(form);
    });
  }

  return <div className="punch-walk-shell"><header className="walk-header"><div><span className="section-mark">ACTIVE WALK</span><h1>{project?.name ?? "Select a project"}</h1><p>Capture the deficiency, save, and stay ready for the next item.</p></div><div className="walk-count"><strong>{count}</strong><span>captured</span></div></header><section className="panel walk-defaults"><span className="section-mark">PERSISTENT WALK DEFAULTS</span><div className="walk-default-grid"><label>Project<select value={defaults.projectId} onChange={event => selectProject(event.target.value)}><option value="">Select project</option>{projects.map(value => <option value={value.id} key={value.id}>{value.projectNumber} · {value.name}</option>)}</select></label><label>Punch list<select value={defaults.listId} onChange={event => update("listId", event.target.value)} disabled={!defaults.projectId}><option value="">Select list</option>{projectLists.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label><label>Area<select value={defaults.areaId} onChange={event => update("areaId", event.target.value)} disabled={!defaults.projectId}><option value="">Unspecified</option>{projectAreas.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label><label>Category<select value={defaults.categoryId} onChange={event => update("categoryId", event.target.value)}><option value="">General</option>{categories.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label><label>Assignee<select value={defaults.assignee} onChange={event => update("assignee", event.target.value)}><option value="">Unassigned</option>{assignees.map(value => <option value={`${value.kind}:${value.id}`} key={`${value.kind}:${value.id}`}>{value.name}</option>)}</select></label><label>Priority<select value={defaults.priority} onChange={event => update("priority", event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>{defaults.projectId && <details className="walk-new-list"><summary>Create a new punch list</summary><div><input value={newListName} onChange={event => setNewListName(event.target.value)} placeholder="Walkthrough list name"/><button type="button" className="secondary" disabled={busy || !newListName.trim()} onClick={createList}>Create and select</button></div></details>}</section><section className="panel walk-capture"><span className="section-mark">CAPTURE NEXT ITEM</span><label className="walk-description">Short description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} enterKeyHint="done" placeholder="Tap and describe the issue. Use the keyboard microphone for voice-to-text." disabled={busy || Boolean(pendingPhoto)}/></label><div className="walk-photo-zone">{preview ? <img src={preview} alt="Selected punch item"/> : <button type="button" className="walk-camera-placeholder" onClick={() => cameraRef.current?.click()} disabled={busy || Boolean(pendingPhoto)}><b>＋ Photo</b><span>Camera or photo library</span></button>}<div><button type="button" className="secondary" onClick={() => cameraRef.current?.click()} disabled={busy || Boolean(pendingPhoto)}>Take photo</button><button type="button" className="text-button" onClick={() => libraryRef.current?.click()} disabled={busy || Boolean(pendingPhoto)}>Choose library</button>{file && !pendingPhoto && <button type="button" className="text-button danger-link" onClick={() => selectPhoto(null)}>Remove selection</button>}</div><input ref={cameraRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={event => selectPhoto(event.target.files?.[0] ?? null)}/><input ref={libraryRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => selectPhoto(event.target.files?.[0] ?? null)}/></div>{progress != null && <div className="upload-progress"><span style={{ width: `${progress}%` }}/><b>{progress}%</b></div>}{message && <p className={`walk-message ${message.includes("failed") || message.includes("rejected") ? "error" : ""}`} role="status">{message}</p>}{pendingPhoto ? <div className="partial-failure-actions"><button className="primary" type="button" disabled={busy} onClick={retryPhoto}>Retry saved item photo</button><button className="secondary" type="button" disabled={busy} onClick={continueWithoutPhoto}>Continue without photo</button></div> : <button className="primary walk-save" type="button" disabled={busy || !defaults.projectId || !defaults.listId || !description.trim()} onClick={saveItem}>{busy ? "Saving…" : "Save + capture next"}</button>}</section></div>;
}

function parseBody(value: string) { try { return JSON.parse(value) as { error?: string }; } catch { return { error: "Unexpected server response." }; } }
