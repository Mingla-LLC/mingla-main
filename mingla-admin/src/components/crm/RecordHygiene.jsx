// Issue #4571 W6 — on the host or creator card: the archive state (Archive,
// Unarchive, or where a merged card went), Merge a duplicate into this card,
// the card's merges with Undo (7 days), a reply that suggests Replied (W6b,
// computed by the server, never applied), and the cadence round (W6c). Every
// write goes through crmService; the server refuses agents and stale cards.
import { useEffect, useState } from "react";
import { Archive, ArrowRight, GitMerge, Mail, RotateCcw } from "lucide-react";
import { Button } from "../ui/Button";
import { useToast } from "../../context/ToastContext";
import { CONTROL_CLASS } from "./fields";
import {
  archiveRecord, duplicateCheck, mergeRecords, newRequestKey, recordMerges, unarchiveRecord, unmergeRecords,
} from "../../services/crmService";
import { cadenceWords, errorWords, loadErrorWords } from "../../lib/crmModel";
import { mergeConfirmWords, mergeMovedWords } from "../../lib/sopTools";
import { localWhen } from "../../lib/opsModel";

const BOX = "flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3";

function useMerges(recordId, tick) {
  const [state, setState] = useState({ loading: true, error: null, rows: [] });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    recordMerges(recordId).then(
      (rows) => { if (live) setState({ loading: false, error: null, rows: Array.isArray(rows) ? rows : [] }); },
      (error) => { if (live) setState({ loading: false, error, rows: [] }); },
    );
    return () => { live = false; };
  }, [recordId, tick, again]);
  return { ...state, retry: () => setAgain((n) => n + 1) };
}

/** #4571 final gate: the merge confirmation, which names the logged emails that move. */
export function MergeConfirmLine({ pick }) {
  return (
    <p data-merge-confirm="" className="text-[12px] text-[var(--color-text-tertiary)]">
      {mergeConfirmWords(pick.name, pick.email_count)}
    </p>
  );
}

/**
 * #4571 design v5: the panel header's "..." menu asks for Merge or Archive
 * (`request` = { mode, tick }); the inline buttons and the cadence line then
 * stay out of the body (`inMenu`), since the Follow-up grid shows the round.
 */
export function RecordHygiene({ record, pipeline, disabled, onChanged, onRequestMove, onOpenCard, request = null, inMenu = false }) {
  const { addToast } = useToast();
  const [mode, setMode] = useState(""); // "" | "archive" | "merge"
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [tick, setTick] = useState(0);
  const [cands, setCands] = useState({ loading: false, error: null, rows: [] });
  const [pick, setPick] = useState(null);
  const merges = useMerges(record.id, tick);
  const archived = Boolean(record.archived_at);
  const merged = record.merged_into || null;
  const cadence = cadenceWords(record);
  const reply = record.suggest_replied || null;
  const changed = () => { setTick((n) => n + 1); onChanged(); };

  const openMerge = async () => {
    setMode("merge");
    setPick(null);
    setCands({ loading: true, error: null, rows: [] });
    try {
      const res = await duplicateCheck(pipeline, record.name, record.id);
      const rows = [res?.exact, ...(Array.isArray(res?.similar) ? res.similar : [])].filter((r) => r && !r.archived);
      setCands({ loading: false, error: null, rows });
    } catch (error) {
      setCands({ loading: false, error, rows: [] });
    }
  };
  const doArchive = async () => {
    setBusy("archive");
    try {
      await archiveRecord(record.id, reason.trim());
      addToast({ variant: "success", title: `${record.name} is archived. It is off the board and out of the nightly sweep.` });
      setMode("");
      setReason("");
      changed();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't archive this card", description: errorWords(err) });
    } finally { setBusy(""); }
  };
  const doUnarchive = async () => {
    setBusy("unarchive");
    try {
      await unarchiveRecord(record.id);
      addToast({ variant: "success", title: `${record.name} is back on the board.` });
      changed();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't unarchive this card", description: errorWords(err) });
    } finally { setBusy(""); }
  };
  const doMerge = async () => {
    if (!pick) return;
    setBusy("merge");
    try {
      const res = await mergeRecords(record.id, pick.id, newRequestKey());
      addToast({
        variant: "success",
        title: `Merged ${pick.name} into this card`,
        description: [mergeMovedWords(res?.moved), res?.stage_note].filter(Boolean).join(" "),
      });
      setMode("");
      setPick(null);
      changed();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't merge the cards", description: errorWords(err) });
    } finally { setBusy(""); }
  };
  const doUnmerge = async (m) => {
    setBusy(m.merge_id);
    try {
      const res = await unmergeRecords(m.merge_id);
      addToast({ variant: "success", title: `Undid the merge of ${m.drop_name}`, description: res?.stage_note || "Everything it moved went back." });
      changed();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't undo the merge", description: errorWords(err) });
    } finally { setBusy(""); }
  };

  const requestTick = request?.tick || 0;
  useEffect(() => {
    if (!requestTick || !request?.mode || archived) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the header menu asks once per tick
    if (request.mode === "merge") openMerge();
    else if (request.mode === "archive") setMode("archive");
  }, [requestTick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-label="Archive and merge" data-record-section="hygiene" className="flex min-w-0 flex-col gap-2">
      {archived && (
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-[var(--gray-100)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          <Archive aria-hidden="true" className="h-4 w-4 shrink-0" />
          {merged ? (
            <>
              <span className="min-w-0 flex-1">Merged into <b className="text-[var(--color-text-primary)]">{merged.name}</b>. This card is archived.</span>
              {onOpenCard && <Button size="sm" variant="secondary" className="min-h-11" iconRight={ArrowRight} onClick={() => onOpenCard(merged.id)}>Open {merged.name}</Button>}
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 break-words">Archived: {record.archived_reason}</span>
              <Button size="sm" variant="secondary" className="min-h-11" loading={busy === "unarchive"} disabled={disabled} onClick={doUnarchive}>Unarchive</Button>
            </>
          )}
        </div>
      )}
      {reply && !archived && (
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-[var(--color-info-50)] px-3 py-2 text-[13px] text-[var(--color-info-700)]">
          <Mail aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">
            They replied by email {localWhen(reply.at)}{reply.subject ? `: "${reply.subject}"` : ""}. Move to Replied?
          </span>
          <Button size="sm" className="min-h-11" disabled={disabled} onClick={() => onRequestMove(record, "replied")}>Move to Replied</Button>
        </div>
      )}
      {cadence && !archived && !inMenu && (
        <p className="text-[12.5px] text-[var(--color-text-secondary)]" data-cadence="">{cadence}</p>
      )}
      {!archived && mode === "" && !inMenu && (
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" className="min-h-11" icon={GitMerge} disabled={disabled} onClick={openMerge}>Merge a duplicate…</Button>
          <Button variant="ghost" size="sm" className="min-h-11" icon={Archive} disabled={disabled} onClick={() => setMode("archive")}>Archive…</Button>
        </div>
      )}
      {mode === "archive" && (
        <div className={BOX}>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-[var(--color-text-primary)]">
            Why archive {record.name}?
            <input type="text" maxLength={300} value={reason} autoFocus onChange={(e) => setReason(e.target.value)}
              placeholder="For example: pruned in the monthly clean-up" className={`${CONTROL_CLASS} h-11 font-normal`} />
          </label>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">It leaves the board, My calls today and the nightly sweep. Search and the duplicate check still find it, and you can unarchive it.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11" loading={busy === "archive"} disabled={disabled || !reason.trim()} onClick={doArchive}>Archive</Button>
            <Button size="sm" variant="ghost" className="min-h-11" disabled={busy === "archive"} onClick={() => { setMode(""); setReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}
      {mode === "merge" && (
        <div className={BOX}>
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">Merge a duplicate into {record.name}</p>
          {cands.loading ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]" aria-busy="true">Looking for cards like this one…</p>
          ) : cands.error ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
              <span>Couldn’t look for duplicates. {loadErrorWords(cands.error)}</span>
              <Button size="sm" variant="secondary" className="min-h-11" onClick={openMerge}>Try again</Button>
            </div>
          ) : cands.rows.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No card with a similar name. Open the duplicate pairs view on the board to see cards that share an email or phone.</p>
          ) : (
            <div role="radiogroup" aria-label="The duplicate to merge in" className="flex flex-col gap-1">
              {cands.rows.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={pick?.id === c.id} onClick={() => setPick(c)}
                  className={`min-h-11 rounded-md border px-3 text-left text-[13px] ${pick?.id === c.id ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-200)] hover:bg-[var(--gray-50)]"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {pick && <MergeConfirmLine pick={pick} />}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11" loading={busy === "merge"} disabled={disabled || !pick} onClick={doMerge}>
              {pick ? `Merge ${pick.name} into this card` : "Pick the duplicate"}
            </Button>
            <Button size="sm" variant="ghost" className="min-h-11" disabled={busy === "merge"} onClick={() => { setMode(""); setPick(null); }}>Cancel</Button>
          </div>
        </div>
      )}
      {merges.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--color-error-700)]">
          <span>Couldn’t load this card’s merges. {loadErrorWords(merges.error)}</span>
          <Button size="sm" variant="secondary" className="min-h-11" onClick={merges.retry}>Try again</Button>
        </div>
      ) : merges.rows.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px] text-[var(--color-text-secondary)]" aria-label="Merges">
          {merges.rows.map((m) => (
            <li key={m.merge_id} className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                {m.keep_id === record.id ? `${m.drop_name} merged in` : `Merged into ${m.keep_name}`} by {m.merged_by_name}, {localWhen(m.merged_at)}.
                {m.unmerged_at ? " Undone." : ` ${mergeMovedWords(m.moved)}`}
              </span>
              {m.can_undo && m.keep_id === record.id && (
                <Button size="sm" variant="ghost" className="min-h-11" icon={RotateCcw} loading={busy === m.merge_id} disabled={disabled} onClick={() => doUnmerge(m)}>Undo</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
