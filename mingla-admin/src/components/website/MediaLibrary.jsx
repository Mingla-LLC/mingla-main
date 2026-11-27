// #4636 — the site media library: a searchable grid of pictures and videos,
// upload (pictures re-encoded here with a _thumb.jpg; MP4 up to 50 MB and 60 s
// with a poster frame captured here), alt text, archive (refused while a live
// page uses the file: we then say where), and the 5 GB storage meter (amber
// from 70 %, uploads refused from 90 %). In "pick" mode a click chooses an item.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ImageIcon, RefreshCw, Upload, Video } from "lucide-react";
import { Modal, ModalBody } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { formatBytes, meter, publicUrl } from "../../lib/siteEditorModel";
import { kindOf, preparePicture, prepareVideo } from "../../lib/siteMediaFiles";
import { libraryPaths } from "../../services/siteCmsService";
import { FIELD, Note, TextField } from "./editorUi";

export function StorageMeter({ usage }) {
  if (!usage) return <Skeleton height={34} />;
  const m = meter(usage);
  const bar = m.state === "blocked" ? "bg-[var(--color-error-700)]" : m.state === "warn" ? "bg-[#d97706]" : "bg-[#eb7825]";
  return (
    <div data-storage-meter={m.state}>
      <div className="flex items-baseline justify-between text-xs">
        <b>Storage</b>
        <span className="text-[var(--a-dim)]">{formatBytes(m.bytes)} of {formatBytes(m.limit)} ({Math.round(m.share * 100)}%)</span>
      </div>
      <div className="my-1.5 h-2 overflow-hidden rounded-full bg-[var(--a-soft)]" role="meter" aria-label="Site storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.share * 100)}>
        <i className={`block h-full ${bar}`} style={{ width: `${Math.min(100, m.share * 100)}%` }} />
      </div>
      {m.state === "warn" ? <p className="text-xs text-[var(--a-stop-ink)]">Storage is over 70% full. Archive files you no longer use.</p> : null}
      {m.state === "blocked" ? <p role="alert" className="text-xs text-[var(--color-error-700)]">Storage is 90% full, so uploads are paused. Archive files you no longer use, or ask engineering for more room.</p> : null}
    </div>
  );
}

function Uploader({ cms, usage, accept, onUploaded, canEdit }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [alt, setAlt] = useState("");
  const [state, setState] = useState({ step: "idle", error: null });
  const types = [...(accept.includes("photo") ? ["image/jpeg", "image/png", "image/webp"] : []), ...(accept.includes("video") ? ["video/mp4"] : [])];
  const pick = (f) => {
    setState({ step: "idle", error: null });
    if (!f) return;
    const kind = kindOf(f);
    const okKind = kind && ((kind === "image" && accept.includes("photo")) || (kind === "video" && accept.includes("video")));
    if (!okKind) { setFile(null); setState({ step: "idle", error: accept.includes("video") ? "Pick a JPEG, PNG or WebP picture, or an MP4 video." : "Pick a JPEG, PNG or WebP picture." }); return; }
    if (kind === "video" && f.size > 52428800) { setFile(null); setState({ step: "idle", error: "Videos can be at most 50 MB." }); return; }
    setFile(f);
  };
  const upload = async () => {
    if (!file) return;
    if (!alt.trim()) { setState({ step: "idle", error: "Describe the file in plain words first (alt text)." }); return; }
    const kind = kindOf(file);
    try {
      setState({ step: kind === "video" ? "Reading the video and making its cover…" : "Resizing the picture…", error: null });
      const prepared = kind === "video" ? await prepareVideo(file) : await preparePicture(file);
      const m = meter(usage, prepared.file.size + prepared.still.size);
      if (m.refuse) throw new Error("This upload would take site storage past 90% of 5 GB, so it can't go in. Archive files you no longer use first.");
      const id = globalThis.crypto.randomUUID();
      const paths = libraryPaths(id, kind);
      setState({ step: "Uploading…", error: null });
      await cms.upload(paths.file, prepared.file);
      await cms.upload(paths.still, prepared.still);
      setState({ step: "Saving to the library…", error: null });
      const item = await cms.registerMedia(id, kind, prepared.width, prepared.height, prepared.seconds, alt.trim());
      setFile(null);
      setAlt("");
      if (inputRef.current) inputRef.current.value = "";
      setState({ step: "idle", error: null });
      onUploaded(item);
    } catch (e) {
      setState({ step: "idle", error: e?.message || "The upload didn't finish. Try again." });
    }
  };
  const busy = state.step !== "idle";
  const blocked = usage && meter(usage).state === "blocked";
  return (
    <div className="rounded-2xl border-2 border-dashed border-[var(--a-line)] p-4" data-media-upload="">
      <b className="text-sm">Upload your own</b>
      <p className="mt-1 text-xs text-[var(--a-text2)]">{accept.includes("photo") ? "Pictures: JPEG, PNG or WebP, resized for the web here. " : ""}{accept.includes("video") ? "Videos: MP4, up to 50 MB and 60 seconds; a cover frame is made for you." : ""}</p>
      <input ref={inputRef} type="file" accept={types.join(",")} disabled={!canEdit || busy || blocked} aria-label="Choose a file to upload" className="mt-2 block w-full text-xs" onChange={(e) => pick(e.target.files?.[0] || null)} data-media-file="" />
      <TextField id="media-alt" label="Describe it (alt text, required)" max={200} value={alt} onChange={setAlt} disabled={!canEdit || busy} placeholder="For example: a crowd dancing at a rooftop party" />
      {state.error ? <p role="alert" className="mt-2 text-xs text-[var(--color-error-700)]" data-upload-error="">{state.error}</p> : null}
      <Button className="mt-3" size="sm" icon={Upload} disabled={!canEdit || !file || blocked} loading={busy} onClick={upload} data-media-upload-go="">{busy ? state.step : "Upload"}</Button>
    </div>
  );
}

function Item({ it, supabaseUrl, picking, onPick, canEdit, onSaveAlt, onArchive, busy, problem }) {
  const [alt, setAlt] = useState(it.alt);
  const still = publicUrl(supabaseUrl, "site-media", it.thumb_path);
  return (
    <li className={`overflow-hidden rounded-xl border bg-[var(--a-panel)] ${it.archived_at ? "opacity-60" : ""} border-[var(--a-line)]`} data-media-item={it.id}>
      <button type="button" disabled={!picking || Boolean(it.archived_at)} onClick={() => onPick(it)} className="relative block aspect-[4/3] w-full bg-[var(--a-soft)] enabled:hover:outline enabled:hover:outline-2 enabled:hover:outline-[#eb7825] disabled:cursor-default" aria-label={picking ? `Use ${it.alt}` : it.alt}>
        <img src={still} alt="" loading="lazy" className="h-full w-full object-cover" />
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 font-mono text-[10px] uppercase text-white">
          {it.kind === "video" ? <Video size={10} /> : <ImageIcon size={10} />}{it.kind === "video" ? `${Math.round(it.duration_seconds)} s` : "picture"}
        </span>
      </button>
      <div className="p-2">
        {picking || !canEdit ? <p className="truncate text-xs" title={it.alt}>{it.alt}</p> : (
          <input aria-label="Alt text" className={`${FIELD} text-xs`} value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} onBlur={() => alt.trim() && alt !== it.alt && onSaveAlt(it, alt.trim())} />
        )}
        <p className="mt-1 text-[11px] text-[var(--a-dim)]">{formatBytes(it.bytes)}{it.in_use ? " · in use" : ""}{it.archived_at ? " · archived" : ""}</p>
        {!picking && canEdit && !it.archived_at ? <Button size="sm" variant="ghost" icon={Archive} loading={busy} onClick={() => onArchive(it)} className="mt-1">Archive</Button> : null}
        {problem ? <p role="alert" className="mt-1 text-[11px] text-[var(--color-error-700)]">{problem}</p> : null}
      </div>
    </li>
  );
}

/**
 * mode "pick": choose one item of an allowed kind (accept = ["photo"], ["video"] or both);
 * mode "manage": edit alt text and archive.
 */
export function MediaLibrary({ open, onClose, cms, supabaseUrl, mode = "manage", accept = ["photo", "video"], onPick, canEdit, findUsage }) {
  const [items, setItems] = useState(null);
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(null);
  const [problems, setProblems] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, u] = await Promise.all([cms.mediaList(null, showArchived), cms.mediaUsage()]);
      setItems(list || []);
      setUsage(u);
    } catch (e) { setError(e); }
  }, [cms, showArchived]);
  useEffect(() => { if (open) void Promise.resolve().then(load); }, [open, load]);
  const shown = useMemo(() => (items || []).filter((it) => {
    if (filter === "image" && it.kind !== "image") return false;
    if (filter === "video" && it.kind !== "video") return false;
    if (mode === "pick" && !accept.includes(it.kind === "image" ? "photo" : "video")) return false;
    return !q.trim() || it.alt.toLowerCase().includes(q.trim().toLowerCase());
  }), [items, filter, q, mode, accept]);
  const saveAlt = async (it, alt) => {
    try { const next = await cms.updateMediaAlt(it.id, alt); setItems((l) => l.map((x) => (x.id === it.id ? { ...x, ...next } : x))); setProblems((p) => ({ ...p, [it.id]: null })); }
    catch (e) { setProblems((p) => ({ ...p, [it.id]: e.message })); }
  };
  const archive = async (it) => {
    setBusy(it.id);
    try { await cms.archiveMedia(it.id); await load(); }
    catch (e) {
      let msg = e.message;
      if (e.code === "media_in_use" && findUsage) { const where = await findUsage(it.id).catch(() => []); if (where.length) msg = `A live page uses this file: ${where.join(", ")}. Remove it there and publish first.`; }
      setProblems((p) => ({ ...p, [it.id]: msg }));
    } finally { setBusy(null); }
  };
  const picking = mode === "pick";
  return (
    <Modal open={open} onClose={onClose} title={picking ? `Choose a ${accept.length > 1 ? "picture or video" : accept[0] === "video" ? "video" : "picture"}` : "Media library"} size="lg">
      <ModalBody>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]" data-media-library={mode}>
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input className={`${FIELD} max-w-[220px]`} placeholder="Search by description" aria-label="Search media" value={q} onChange={(e) => setQ(e.target.value)} />
              <div role="group" aria-label="Kind" className="inline-flex rounded-lg bg-[var(--a-soft)] p-0.5">
                {[["all", "All"], ["image", "Pictures"], ["video", "Videos"]].map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 text-xs ${filter === k ? "bg-[var(--a-panel)] font-semibold" : "text-[var(--a-text2)]"}`}>{l}</button>
                ))}
              </div>
              {!picking ? <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label> : null}
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} aria-label="Reload the library" />
            </div>
            {error ? <LoadError message={error.message} onRetry={load} /> : !items ? (
              <div className="grid grid-cols-3 gap-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={120} rounded="12px" />)}</div>
            ) : !shown.length ? (
              <p className="rounded-xl border border-dashed border-[var(--a-line)] p-4 text-sm text-[var(--a-dim)]" data-media-empty="">
                {items.length ? "Nothing matches that search." : "The library is empty. Upload the first picture or video."}
              </p>
            ) : (
              <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(130px,1fr))]">
                {shown.map((it) => <Item key={it.id} it={it} supabaseUrl={supabaseUrl} picking={picking} onPick={(x) => onPick?.(`m:${x.id}`, x)} canEdit={canEdit} onSaveAlt={saveAlt} onArchive={archive} busy={busy === it.id} problem={problems[it.id]} />)}
              </ul>
            )}
          </div>
          <aside className="space-y-3">
            <StorageMeter usage={usage} />
            {canEdit ? <Uploader cms={cms} usage={usage} accept={picking ? accept : ["photo", "video"]} canEdit={canEdit} onUploaded={async (item) => { await load(); if (picking) onPick?.(`m:${item.id}`, item); }} /> : <Note>View only: ask a website editor to upload.</Note>}
          </aside>
        </div>
      </ModalBody>
    </Modal>
  );
}
