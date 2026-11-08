// Issue #4270 (Wave 7) — a Brand group whose brand has no host card yet. A
// brand's plan lives on its host card, so the rail offers to create one for
// this brand (Name, Owners) or to link an existing host card that has no
// brand. Host cards already linked to another brand are never offered, and a
// card linked by someone else meanwhile is refused with words, never
// overwritten. Staff without Hosts and Creators access see one line only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { OwnersField } from "../crm/OwnersField";
import { useToast } from "../../context/ToastContext";
import { useCrmConfig } from "../../hooks/useCrmConfig";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import * as crm from "../../services/crmService";
import { errorWords } from "../../lib/crmModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60 ${FOCUS}`;
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";

/** The toast after a host card is linked to a brand (RecordDrawer's words). */
export function linkedWords(answer, name) {
  if (answer?.moved_to === "live") return `Linked. ${name} moved to Live.`;
  if (answer?.moved_to === "onboarded") return `Linked. ${name} moved to Onboarded.`;
  return `Linked. ${name} is this brand's host card.`;
}

export function HostCardEmptyState({ brandName, brandId, canHosts, online = true, onLinked }) {
  const { addToast } = useToast();
  const [mode, setMode] = useState(""); // "" | "create" | "link"
  if (!canHosts) {
    return <p data-host-empty="" className="text-[13px] text-[var(--color-text-secondary)]">This brand has no host card yet.</p>;
  }
  const done = async (title) => {
    addToast({ variant: "success", title });
    setMode("");
    await onLinked?.();
  };
  return (
    <div data-host-empty="" className="flex flex-col gap-2 rounded-xl border border-dashed border-[var(--gray-300)] p-4">
      <p className={`text-[14px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>No host card for {brandName} yet</p>
      <p className={`text-[12.5px] text-[var(--color-text-secondary)] ${WORDS}`}>A brand&apos;s plan lives on its host card. Link one and the plan, To do and pipeline show here.</p>
      {mode === "" && (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={!online} onClick={() => setMode("create")}>Create host card</Button>
          <Button variant="secondary" className="min-h-11" disabled={!online} onClick={() => setMode("link")}>Link existing</Button>
        </div>
      )}
      {mode === "create" && <CreateForm brandName={brandName} brandId={brandId} online={online} onCancel={() => setMode("")} onDone={done} onLinkInstead={() => setMode("link")} />}
      {mode === "link" && <LinkForm brandId={brandId} online={online} onCancel={() => setMode("")} onDone={done} />}
    </div>
  );
}

function CreateForm({ brandName, brandId, online, onCancel, onDone, onLinkInstead }) {
  const cfg = useCrmConfig();
  const directory = usePeopleDirectory();
  const [name, setName] = useState(brandName || "");
  const [owners, setOwners] = useState(() => [directory.me].filter(Boolean));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [duplicate, setDuplicate] = useState(null);
  const keyRef = useRef({ key: null, value: null });
  const submit = async (e) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) { setProblem("Say what the host card is called."); return; }
    if (!online || busy) return;
    const fields = { name: clean, owners: owners.length ? owners : [directory.me].filter(Boolean), brand_id: brandId };
    const value = JSON.stringify(fields);
    // The same form sent twice is the same request: one card, never two.
    if (keyRef.current.value !== value) keyRef.current = { key: crm.newRequestKey(), value };
    setBusy(true); setProblem(""); setDuplicate(null);
    try {
      const answer = await crm.createRecord("hosts", fields, keyRef.current.key);
      if (answer?.status === "duplicate") { setDuplicate(answer.existing || { name: clean }); return; }
      keyRef.current = { key: null, value: null };
      await onDone(linkedWords(answer, answer?.record?.name || clean));
    } catch (err) {
      setProblem(errorWords(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form data-host-create="" onSubmit={submit} noValidate className="mt-1 flex flex-col gap-3">
      <label className="flex flex-col gap-1" htmlFor="brand-group-host-name">
        <span className={LABEL}>Name</span>
        <input id="brand-group-host-name" autoFocus maxLength={160} value={name} disabled={busy} onChange={(e) => { setName(e.target.value); setProblem(""); }} className={INPUT} />
      </label>
      <OwnersField labelId="brand-group-host-owners" team={cfg.config?.team} value={owners} disabled={busy} onChange={setOwners} />
      {duplicate && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-[13px] text-[var(--color-warning-700)]">
          <span className={`min-w-0 flex-1 ${WORDS}`}>A host card called {duplicate.name || name.trim()} already exists.</span>
          <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={onLinkInstead}>Link it</Button>
        </div>
      )}
      {problem && <p role="alert" className="text-[12.5px] text-[var(--color-error-700)]">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="min-h-11" loading={busy} disabled={!online || busy}>Create host card</Button>
      </div>
    </form>
  );
}

function LinkForm({ brandId, online, onCancel, onDone }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const answer = await crm.listRecords("hosts");
      const list = Array.isArray(answer?.records) ? answer.records : Array.isArray(answer) ? answer : [];
      setRecords(list);
    } catch (err) {
      setError(errorWords(err));
    }
  }, []);
  // Loaded when Link existing is pressed (this form mounts then).
  useEffect(() => { void load(); }, [load]);
  const free = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (records || []).filter((r) => r && !r.brand_id && (!needle || String(r.name || "").toLowerCase().includes(needle))).slice(0, 30);
  }, [records, query]);
  const link = async (record) => {
    if (!online || busyId) return;
    setBusyId(record.id); setError("");
    try {
      // Someone may have linked it meanwhile: never overwrite their link.
      const fresh = await crm.getRecord(record.id);
      if (fresh?.record?.brand_id) { setError(`${record.name} was just linked to another brand. Pick another host card.`); await load(); return; }
      const answer = await crm.updateRecord(record.id, { brand_id: brandId });
      await onDone(linkedWords(answer, answer?.record?.name || record.name));
    } catch (err) {
      setError(errorWords(err));
    } finally {
      setBusyId("");
    }
  };
  return (
    <div data-host-link="" className="mt-1 flex flex-col gap-2">
      <label className="flex flex-col gap-1" htmlFor="brand-group-host-link">
        <span className={LABEL}>Host cards with no brand</span>
        <input id="brand-group-host-link" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search host cards" className={INPUT} />
      </label>
      {error && <p role="alert" className="text-[12.5px] text-[var(--color-error-700)]">{error}</p>}
      {records === null && !error ? (
        <p role="status" className="text-[12.5px] text-[var(--color-text-tertiary)]">Loading host cards…</p>
      ) : records && free.length === 0 ? (
        <p className="text-[12.5px] text-[var(--color-text-tertiary)]">No host card without a brand matches.</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {free.map((r) => (
            <li key={r.id}>
              <button type="button" disabled={!online || !!busyId} onClick={() => void link(r)}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 text-left text-[13px] hover:bg-[var(--gray-50)] disabled:opacity-60 ${FOCUS}`}>
                <span className={`min-w-0 flex-1 ${WORDS}`}>{r.name}</span>
                <span className="shrink-0 text-[12px] font-semibold text-[var(--color-brand-700)]">{busyId === r.id ? "Linking…" : "Link"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" className="min-h-11 self-start" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
