// #4636 — the editor's dialogs: Add a section (every registry block, grouped as
// in the design), New page (format or copy of a page, name, address with the
// reserved / taken check), Publish (change summary and note), History
// (Restore), Delete page (redirect picker) and the share-preview link.
import { useMemo, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { formatDateTime } from "../../lib/formatters";
import { FORMATS, canAdd, pathProblem, pickerGroups, redirectProblem, slugify } from "../../lib/siteEditorModel";
import { FIELD, FIELD_BAD, Hint, Note, TextField } from "./editorUi";

export function BlockPicker({ open, onClose, registry, sections, onPick }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => pickerGroups(registry).map((g) => ({ ...g, blocks: g.blocks.filter((b) => `${b.name} ${b.description}`.toLowerCase().includes(q.trim().toLowerCase())) })).filter((g) => g.blocks.length), [registry, q]);
  return (
    <Modal open={open} onClose={onClose} title="Add a section" size="lg">
      <ModalBody>
        <input className={`${FIELD} mb-3`} placeholder="Search sections" aria-label="Search sections" value={q} onChange={(e) => setQ(e.target.value)} />
        <div data-block-picker="">
          {groups.map((g) => (
            <section key={g.key} className="mb-4">
              <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--a-dim)]">{g.label}</h3>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                {g.blocks.map((b) => {
                  const ok = canAdd(registry, sections, b.key);
                  return (
                    <button key={b.key} type="button" data-pick-block={b.key} disabled={!ok} onClick={() => onPick(b.key)}
                      className="flex flex-col gap-1 rounded-xl border border-[var(--a-line)] bg-[var(--a-panel)] p-2.5 text-left hover:border-[#eb7825] disabled:cursor-not-allowed disabled:opacity-45">
                      <span className="text-sm font-semibold">{b.name}</span>
                      <span className="text-xs text-[var(--a-dim)]">{b.description}</span>
                      {!ok ? <span className="text-[11px] text-[var(--a-stop-ink)]">{sections.length >= 40 ? "This page has 40 sections already." : `Only ${b.maxPerPage} per page.`}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {!groups.length ? <p className="text-sm text-[var(--a-dim)]">No section matches that search.</p> : null}
        </div>
      </ModalBody>
    </Modal>
  );
}

export function NewPageModal({ open, onClose, reserved, takenPaths, copyable, onCreate }) {
  const [format, setFormat] = useState("landing");
  const [copyFrom, setCopyFrom] = useState("");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(null);
  const address = pathTouched ? path : slugify(name);
  const problem = name.trim() ? pathProblem(address, { reserved, taken: takenPaths }) : null;
  const reset = () => { setName(""); setPath(""); setPathTouched(false); setCopyFrom(""); setServerError(null); setFormat("landing"); };
  const create = async () => {
    if (!name.trim()) { setServerError({ field: "name", message: "Give the page a name first." }); return; }
    if (problem) return;
    setBusy(true);
    setServerError(null);
    try {
      await onCreate({ name: name.trim(), path: address, format, copyFrom: copyFrom || null });
      reset();
    } catch (e) {
      setServerError({ field: /path|address/.test(e.code || "") ? "path" : "form", message: e.message });
    } finally { setBusy(false); }
  };
  const pathError = (serverError?.field === "path" && serverError.message) || problem;
  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New page" size="lg">
      <ModalBody>
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--a-dim)]">1. Start from</h3>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button key={f.key} type="button" role="radio" aria-checked={!copyFrom && format === f.key} data-format={f.key} onClick={() => { setFormat(f.key); setCopyFrom(""); }}
              className={`rounded-xl border p-2.5 text-left ${!copyFrom && format === f.key ? "border-[#eb7825] bg-[var(--a-chip)]" : "border-[var(--a-line)] bg-[var(--a-panel)]"}`}>
              <span className="block text-sm font-semibold">{f.name}</span>
              <span className="text-xs text-[var(--a-dim)]">{f.hint}</span>
            </button>
          ))}
        </div>
        <label htmlFor="np-copy" className="mb-1 mt-3 block text-xs font-medium text-[var(--a-text2)]">Or copy the sections of an existing page</label>
        <select id="np-copy" className={FIELD} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
          <option value="">Don't copy a page</option>
          {copyable.map((p) => <option key={p.key} value={p.key}>{p.title} ({p.path})</option>)}
        </select>
        <h3 className="mb-1 mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--a-dim)]">2. Name it</h3>
        <TextField id="np-name" label="Page name" max={70} value={name} placeholder="For example: Summer socials" error={serverError?.field === "name" ? serverError.message : null}
          onChange={(v) => { setName(v); setServerError(null); }} />
        <TextField id="np-path" label="Address" max={80} value={address} error={pathError} hint="usemingla.com + this address. Lowercase, hyphens, at most two parts."
          onChange={(v) => { setPathTouched(true); setPath(v.startsWith("/") ? v : `/${v}`); setServerError(null); }} />
        {serverError?.field === "form" ? <Note tone="bad" className="mt-3">{serverError.message}</Note> : null}
        <Hint className="mt-3">The page starts as a draft. Only staff see it until you publish.</Hint>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
        <Button onClick={create} loading={busy} disabled={Boolean(problem)} data-create-page="">Create draft page</Button>
      </ModalFooter>
    </Modal>
  );
}

export function PublishModal({ open, onClose, title, path, changes, onPublish, busy }) {
  const [note, setNote] = useState("");
  return (
    <Modal open={open} onClose={onClose} title={`Publish ${title}?`} size="sm">
      <ModalBody>
        <p className="text-sm">This goes live on <b>usemingla.com{path}</b> for every visitor within about a minute.</p>
        <h3 className="mb-1 mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--a-dim)]">What changed</h3>
        <ul className="list-disc pl-5 text-sm text-[var(--a-text2)]" data-publish-changes="">
          {changes.length ? changes.map((c) => <li key={c}>{c}</li>) : <li>No changes listed</li>}
        </ul>
        <TextField id="pub-note" label="Note for the history (optional)" max={200} value={note} onChange={setNote} placeholder="For example: new hero video for December" />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Not yet</Button>
        <Button onClick={() => onPublish(note.trim() || changes[0] || null)} loading={busy} data-publish-now="">Publish now</Button>
      </ModalFooter>
    </Modal>
  );
}

export function HistoryModal({ open, onClose, title, history, onRetry, onRestore, busyVersion, canEdit }) {
  return (
    <Modal open={open} onClose={onClose} title={`History of ${title}`} size="md">
      <ModalBody>
        {!history ? <Skeleton height={120} /> : history.error ? <LoadError message={history.error.message} onRetry={onRetry} /> : !history.length ? (
          <p className="rounded-xl border border-dashed border-[var(--a-line)] p-3 text-sm text-[var(--a-dim)]">Nothing published yet. Each publish is kept here and can be restored.</p>
        ) : (
          <ul className="space-y-2" data-page-history="">
            {history.map((v) => (
              <li key={v.version} className="flex items-center gap-3 rounded-xl border border-[var(--a-line)] px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <b className="font-semibold">{v.note || `Version ${v.version}`}</b>
                  <span className="block text-xs text-[var(--a-dim)]">
                    Version {v.version} · {v.published_by_name || "the team"} · {formatDateTime(v.published_at)}{v.restored_from ? ` · restored from version ${v.restored_from}` : ""}{v.is_live ? " · live now" : ""}
                  </span>
                  <span className="block text-xs text-[var(--a-dim)]">{v.settings ? "Menu and footer" : `${(v.sections || []).length} sections`}</span>
                </span>
                {!v.is_live && canEdit ? <Button size="sm" variant="secondary" loading={busyVersion === v.version} onClick={() => onRestore(v.version)} data-restore={v.version}>Restore</Button> : null}
              </li>
            ))}
          </ul>
        )}
        <Hint className="mt-3">Restore makes that version live again as a new version. The current one stays here.</Hint>
      </ModalBody>
    </Modal>
  );
}

export function DeletePageModal({ open, onClose, page, liveTargets, onDelete, busy }) {
  const [to, setTo] = useState("/");
  const problem = redirectProblem(to, page?.path);
  const published = Boolean(page?.custom?.ever_published);
  return (
    <Modal open={open} onClose={onClose} title={`Delete ${page?.title || "this page"}?`} size="sm" destructive>
      <ModalBody>
        {published ? (
          <>
            <p className="text-sm">Visitors to <b>usemingla.com{page?.path}</b> will be sent somewhere else, so no link breaks. Its history stays, and Restore brings it back.</p>
            <label htmlFor="del-to" className="mb-1 mt-3 block text-xs font-medium text-[var(--a-text2)]">Send visitors to</label>
            <select id="del-to" className={FIELD} value={liveTargets.includes(to) ? to : "__other"} onChange={(e) => setTo(e.target.value === "__other" ? "/" : e.target.value)}>
              {liveTargets.filter((p) => p !== page?.path).map((p) => <option key={p} value={p}>{p === "/" ? "Home (/)" : p}</option>)}
              <option value="__other">Another address…</option>
            </select>
            <input aria-label="Redirect address" className={`${FIELD} mt-2 ${problem ? FIELD_BAD : ""}`} value={to} onChange={(e) => setTo(e.target.value)} />
            {problem ? <p role="alert" className="mt-1 text-xs text-[var(--color-error-700)]">{problem}</p> : null}
          </>
        ) : <p className="text-sm">This draft was never published. It and its draft are removed.</p>}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Keep it</Button>
        <Button variant="danger" loading={busy} disabled={published && Boolean(problem)} onClick={() => onDelete(published ? to : "/")} data-delete-page="">Delete page</Button>
      </ModalFooter>
    </Modal>
  );
}

export function ShareLinkModal({ open, onClose, link, expires, onCopy }) {
  return (
    <Modal open={open} onClose={onClose} title="Share a preview" size="sm">
      <ModalBody>
        <p className="text-sm">Anyone with this link sees this draft for one hour{expires ? ` (until ${formatDateTime(expires)})` : ""}. It is never indexed.</p>
        <input readOnly aria-label="Preview link" className={`${FIELD} mt-3 font-mono text-xs`} value={link || ""} onFocus={(e) => e.target.select()} data-share-link="" />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" icon={ExternalLink} onClick={() => window.open(link, "_blank", "noopener,noreferrer")}>Open</Button>
        <Button icon={Copy} onClick={onCopy}>Copy link</Button>
      </ModalFooter>
    </Modal>
  );
}
