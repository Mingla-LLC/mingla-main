// Issue #4255 (W3) — a card's Files and links: pictures (thumbnails), documents
// (type and size) and links (friendly name and site). Drop files on the zone
// or click it; paste a picture into the description; add a link. 25 MB per
// file (refused before upload), 50 per card. Pictures open in a viewer and
// documents in a new tab, both through 5-minute signed links from the private
// ops-work-files bucket. The card's Files section also lists files posted in
// its thread. No image transformations (spend cap, #1643): a thumbnail is the
// picture itself, scaled by the browser.
import { useEffect, useRef, useState } from "react";
import { FileText, Link2, Paperclip, RotateCcw, X } from "lucide-react";
import { Modal, ModalBody } from "../ui/Modal";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import { opsErrorWords, requestKey } from "../../lib/opsModel";
import { FILES_PER_CARD, docTypeLabel, linkFriendlyName, linkHost, linkProblem, sizeLabel } from "../../lib/workBoardModel";
import { useOpenFile, useThumbnails } from "../../hooks/useCardFiles";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

/** One file as a tile. */
export function FileTile({ file, thumb, onOpen, onRemove, compact = false }) {
  const meta = file.kind === "image" ? `Picture · ${sizeLabel(file.size_bytes)}` : file.kind === "document" ? `${docTypeLabel(file.mime)} · ${sizeLabel(file.size_bytes)}` : linkHost(file.url);
  return (
    <li data-file={file.id} data-file-kind={file.kind} className={`group relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] ${compact ? "w-40" : ""}`}>
      <button type="button" onClick={() => onOpen(file)} aria-label={`Open ${file.name}`} className={`flex min-w-0 flex-col text-left ${FOCUS}`}>
        <span className="grid h-20 place-items-center overflow-hidden bg-[var(--gray-100)]">
          {file.kind === "image" && thumb
            ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
            : <span className="rounded-md bg-[var(--color-background-primary)] px-2 py-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-secondary)]">{file.kind === "link" ? "LINK" : file.kind === "image" ? "PICTURE" : docTypeLabel(file.mime).toUpperCase()}</span>}
        </span>
        <span className="flex min-w-0 flex-col px-2 py-1.5">
          <span className="truncate text-[12.5px] font-semibold text-[var(--color-text-primary)]">{file.kind === "link" ? (file.name && file.name !== linkHost(file.url) ? file.name : linkFriendlyName(file.url)) : file.name}</span>
          <span className="truncate text-[11.5px] text-[var(--color-text-tertiary)]">{meta}</span>
        </span>
      </button>
      {onRemove && !file.from_files_url && (
        <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file)} className={`absolute right-1 top-1 inline-grid h-7 w-7 place-items-center rounded-full bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] opacity-80 shadow hover:opacity-100 ${FOCUS}`}><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
      )}
    </li>
  );
}

/** A picture, full size, in a viewer. */
export function ImageViewer({ file, onClose, resolveUrl = ops.openableFileUrl }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    // #4255 W4: a team chat picture signs through team_attachment_sign.
    resolveUrl(file.id).then((u) => { if (live) setUrl(u); }).catch((e) => { if (live) setError(opsErrorWords(e)); });
    return () => { live = false; };
  }, [file.id, resolveUrl]);
  return (
    <Modal open onClose={onClose} title={file.name} size="lg">
      <ModalBody>
        {error ? <p role="alert" className="text-[13px] text-[var(--color-error-700)]">{error}</p>
          : url ? <img src={url} alt={file.name} className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain" />
          : <p aria-busy="true" className="text-[13px] text-[var(--color-text-tertiary)]">Opening…</p>}
      </ModalBody>
    </Modal>
  );
}

export function PendingChips({ pending, onRetry, onDrop }) {
  if (!pending.length) return null;
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Uploading">
      {pending.map((p) => (
        <li key={p.key} data-pending-file="" data-state={p.state} className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] ${p.state === "failed" ? "border-[var(--color-error-500)] text-[var(--color-error-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)]"}`}>
          <Paperclip aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="max-w-[12rem] truncate">{p.file.name}</span>
          <span className="shrink-0">{p.state === "failed" ? "· didn’t upload" : "· uploading…"}</span>
          {p.state === "failed" && <button type="button" aria-label={`Retry ${p.file.name}`} onClick={() => onRetry(p)} className={`inline-flex min-h-7 items-center gap-0.5 rounded px-1 font-semibold underline ${FOCUS}`}><RotateCcw aria-hidden="true" className="h-3 w-3" />Retry</button>}
          {p.state === "failed" && <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => onDrop(p)} className={`inline-grid h-7 w-7 place-items-center rounded ${FOCUS}`}><X aria-hidden="true" className="h-3 w-3" /></button>}
        </li>
      ))}
    </ul>
  );
}

export function CardFiles({ card, files = [], disabled, onChanged, uploads }) {
  const { addToast } = useToast();
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [removing, setRemoving] = useState(null);
  const thumbs = useThumbnails(files);
  const opener = useOpenFile();
  const full = files.length >= FILES_PER_CARD;
  const addLink = async (e) => {
    e.preventDefault();
    const v = url.trim();
    const p = linkProblem(v);
    if (p) { setLinkError(p); return; }
    try {
      await ops.addCardLink(card.id, v, linkFriendlyName(v), requestKey("web_link"));
      setUrl(""); setLinking(false); setLinkError("");
      addToast({ variant: "success", title: "Link added" });
      onChanged?.();
    } catch (error) { setLinkError(opsErrorWords(error)); }
  };
  const remove = async (file) => {
    try { await ops.archiveFile(file.id); addToast({ variant: "success", title: `${file.name} removed` }); onChanged?.(); }
    catch (error) { addToast({ variant: "error", title: `Couldn’t remove ${file.name}`, description: opsErrorWords(error) }); }
    finally { setRemoving(null); }
  };
  return (
    <section aria-labelledby={`files-${card.id}`} data-card-files="" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 id={`files-${card.id}`} className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Files and links</h3>
        <span className="text-[11.5px] text-[var(--color-text-tertiary)]">Pictures, documents, links · 25 MB each</span>
      </div>
      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {files.map((f) => <FileTile key={f.id} file={f} thumb={thumbs[f.id]} onOpen={opener.open} onRemove={disabled ? null : (x) => setRemoving(x)} />)}
        {!disabled && !full && (
          <li className="min-w-0">
            <div
              data-drop-zone=""
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); uploads.add(e.dataTransfer?.files); }}
              className={`flex h-full min-h-[7.5rem] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-2 text-center ${over ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-300)]"}`}
            >
              <button type="button" onClick={() => inputRef.current?.click()} className={`flex flex-col items-center gap-1 rounded-md px-1 text-[12px] text-[var(--color-text-secondary)] ${FOCUS}`}>
                <FileText aria-hidden="true" className="h-4 w-4" /> Drop files or click to upload
              </button>
              <button type="button" onClick={() => setLinking(true)} className={`inline-flex items-center gap-1 rounded-md px-1 text-[12px] font-semibold text-[var(--color-brand-700)] ${FOCUS}`}><Link2 aria-hidden="true" className="h-3.5 w-3.5" /> Add a link</button>
              <input ref={inputRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
                accept="image/jpeg,image/png,image/webp,image/gif,image/heic,.heic,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.key,.numbers,.pages"
                onChange={(e) => { uploads.add(e.target.files); e.target.value = ""; }} />
            </div>
          </li>
        )}
      </ul>
      {full && <p className="text-[12px] text-[var(--color-text-tertiary)]">A card holds 50 files. Remove one, or share a folder link.</p>}
      <PendingChips pending={uploads.pending} onRetry={uploads.retry} onDrop={uploads.drop} />
      {linking && (
        <form onSubmit={addLink} className="flex min-w-0 flex-wrap items-start gap-2">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <span className="sr-only">Link address</span>
            <input autoFocus type="url" inputMode="url" maxLength={2000} value={url} placeholder="https://" onChange={(e) => { setUrl(e.target.value); setLinkError(""); }}
              aria-invalid={linkError ? "true" : undefined}
              className={`min-h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] ${FOCUS}`} />
            {linkError && <span role="alert" className="text-[12px] text-[var(--color-error-700)]">{linkError}</span>}
          </label>
          <button type="submit" className={`min-h-10 rounded-lg bg-[var(--color-brand-500)] px-3 text-[13px] font-semibold text-white ${FOCUS}`}>Add link</button>
          <button type="button" onClick={() => { setLinking(false); setUrl(""); setLinkError(""); }} className={`min-h-10 rounded-lg px-3 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>Cancel</button>
        </form>
      )}
      {removing && (
        <div role="alertdialog" aria-label={`Remove ${removing.name}?`} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-[var(--color-error-50)] px-3 py-2 text-[13px]">
          <span className="min-w-0 flex-1 text-[var(--color-text-primary)]">Remove {removing.name}? It stops being served at once.</span>
          <button type="button" onClick={() => remove(removing)} className={`min-h-9 rounded-md px-2 font-semibold text-[var(--color-error-700)] underline ${FOCUS}`}>Remove</button>
          <button type="button" onClick={() => setRemoving(null)} className={`min-h-9 rounded-md px-2 text-[var(--color-text-secondary)] underline ${FOCUS}`}>Keep</button>
        </div>
      )}
      {opener.viewing && <ImageViewer file={opener.viewing} onClose={opener.close} />}
    </section>
  );
}
