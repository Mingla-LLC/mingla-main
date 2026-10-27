// Issue #3872 — Programs › Creators. A pipeline of every creator by where they
// stand (Setting up, Needs a person, Verified, Suspended), and a record drawer
// with the six setup checks, flags, history and the decision: Verify, Ask for
// more (note required), Decline (reason required) or Suspend (reason required).
//
// Reads admin_creator_queue(p_status); decides through admin_creator_decide.
// A {ok:false} answer is a failure and is shown next to the note, never as a
// success.

import { useCallback, useMemo, useState } from "react";
import { useProgramLoad } from "../hooks/useProgramLoad";
import { Check, X as XIcon, RefreshCw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { Textarea } from "../components/ui/Input";
import { AlertCard } from "../components/ui/Card";
import { useToast } from "../context/ToastContext";
import { decideCreator, listCreatorQueue } from "../services/creatorProgramsService";
import {
  CREATOR_COLUMNS,
  CREATOR_DECISIONS,
  CREATOR_FILTERS,
  checksProgress,
  creatorColumnFor,
  decisionNoteError,
  decisionsFor,
  flagLines,
  programErrorMessage,
  shortDateTime,
  verificationWord,
} from "../lib/creatorPrograms";

const VERIFICATION_TONE = {
  verified: "success",
  review: "warning",
  needs_more: "info",
  declined: "default",
  suspended: "error",
};

function CreatorCard({ creator, onOpen }) {
  const progress = checksProgress(creator.checks);
  const flags = flagLines(creator.flags);
  return (
    <button
      type="button"
      onClick={() => onOpen(creator)}
      className="w-full cursor-pointer rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--color-brand-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
    >
      <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{creator.display_name || "Unnamed creator"}</p>
      <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
        {flags[0] ?? `${progress.text}${creator.city ? ` · ${creator.city}` : ""}`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {creator.verification === "needs_more" ? <Badge variant="info">Asked for more</Badge> : null}
        {flags.length > 1 ? <Badge variant="warning">{flags.length} flags</Badge> : null}
        {creator.verification === "verified" ? <Badge variant="success">Visible to hosts</Badge> : null}
      </div>
    </button>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">{title}</h3>
      {children}
    </section>
  );
}

function CreatorDrawer({ creator, onClose, onDecided }) {
  const { addToast } = useToast();
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!creator) return null;
  const checks = Array.isArray(creator.checks) ? creator.checks : [];
  const flags = flagLines(creator.flags);
  const history = Array.isArray(creator.history) ? creator.history : [];
  const allowed = decisionsFor(creator.verification);

  const confirm = async () => {
    const problem = decisionNoteError(decision, note);
    if (problem) { setNoteError(problem); return; }
    setSaving(true);
    setNoteError("");
    try {
      await decideCreator(creator.creator_id, decision, note);
      addToast({ variant: "success", title: CREATOR_DECISIONS[decision].done });
      onDecided();
    } catch (cause) {
      setNoteError(programErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="space-y-3">
      {decision ? (
        <>
          <Textarea
            label={CREATOR_DECISIONS[decision].noteLabel}
            className="font-sans"
            value={note}
            maxLength={1000}
            onChange={(e) => { setNote(e.target.value); setNoteError(""); }}
            error={noteError || undefined}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => { setDecision(null); setNoteError(""); }} disabled={saving}>Back</Button>
            <Button
              variant={decision === "decline" || decision === "suspend" ? "danger" : "primary"}
              loading={saving}
              onClick={() => void confirm()}
            >
              {CREATOR_DECISIONS[decision].label}
            </Button>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {allowed.map((id) => (
            <Button
              key={id}
              variant={id === "verify" ? "primary" : "secondary"}
              onClick={() => { setDecision(id); setNote(""); setNoteError(""); }}
            >
              {CREATOR_DECISIONS[id].label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Drawer open={!!creator} onClose={onClose} title={creator.display_name || "Creator"} footer={footer}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Badge variant={VERIFICATION_TONE[creator.verification] ?? "default"} dot>{verificationWord(creator.verification)}</Badge>
          {creator.city ? <span>{creator.city}</span> : null}
          {creator.updated_at ? <span>· Updated {shortDateTime(creator.updated_at)}</span> : null}
        </div>
        {creator.review_note ? <AlertCard variant="info" title="We asked for">{creator.review_note}</AlertCard> : null}
        {creator.declined_reason ? <AlertCard variant="warning" title="Declined because">{creator.declined_reason}</AlertCard> : null}

        <Section title="Verification">
          <ul className="space-y-1.5" aria-label="Setup checks">
            {checks.map((check) => (
              <li key={check.key} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${check.done ? "bg-[var(--color-brand-500)] text-white" : "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]"}`}
                  aria-hidden="true"
                >
                  {check.done ? <Check className="h-3.5 w-3.5" /> : <XIcon className="h-3.5 w-3.5" />}
                </span>
                <span>{check.label}</span>
                <span className="sr-only">{check.done ? "done" : "not done"}</span>
              </li>
            ))}
            {!checks.length ? <li className="text-sm text-[var(--color-text-secondary)]">No setup checks reported yet.</li> : null}
          </ul>
        </Section>

        <Section title="Flags">
          {flags.length ? (
            <ul className="space-y-1">
              {flags.map((flag) => <li key={flag} className="text-sm text-[var(--color-warning-700)]">{flag}</li>)}
            </ul>
          ) : <p className="text-sm text-[var(--color-text-secondary)]">None</p>}
        </Section>

        <Section title="History">
          {history.length ? (
            <ol className="space-y-2">
              {history.map((item, i) => (
                <li key={item.id ?? `${item.at}-${i}`} className="text-sm">
                  <span className="text-[var(--color-text-primary)]">{item.label ?? verificationWord(item.verification ?? item.decision)}</span>
                  {item.note ? <span className="text-[var(--color-text-secondary)]"> · {item.note}</span> : null}
                  <span className="block text-xs text-[var(--color-text-tertiary)]">{shortDateTime(item.at)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-[var(--color-text-secondary)]">No decisions yet.</p>}
        </Section>
      </div>
    </Drawer>
  );
}

export function ProgramCreatorsPage() {
  const [filter, setFilter] = useState("needs_person");
  const [selected, setSelected] = useState(null);

  const fetchBoard = useCallback(async () => {
    const [list, needs] = await Promise.all([
      listCreatorQueue(filter),
      filter === "needs_person" ? null : listCreatorQueue("needs_person"),
    ]);
    return { rows: list, needsCount: (needs ?? list).length };
  }, [filter]);
  const board = useProgramLoad(fetchBoard);
  const rows = useMemo(() => board.data?.rows ?? [], [board.data]);
  const needsCount = board.data?.needsCount ?? null;
  const loading = board.loading;
  const error = board.error ? programErrorMessage(board.error, "Couldn't load creators. Try again.") : "";
  const refresh = board.reload;
  const changeFilter = setFilter;

  const columns = useMemo(() => {
    const byColumn = Object.fromEntries(CREATOR_COLUMNS.map((c) => [c.id, []]));
    byColumn.declined = [];
    for (const row of rows) byColumn[creatorColumnFor(row.verification)].push(row);
    const shown = filter === "all" ? [...CREATOR_COLUMNS] : CREATOR_COLUMNS.filter((c) => c.id === filter);
    if (filter === "all" && byColumn.declined.length) shown.push({ id: "declined", label: "Declined" });
    return shown.map((c) => ({ ...c, rows: byColumn[c.id] }));
  }, [rows, filter]);

  const tabs = CREATOR_FILTERS.map((t) => (
    t.id === "needs_person" && needsCount != null ? { ...t, label: `${t.label} · ${needsCount}` } : t
  ));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Creators"
        description="Every creator in the program, by where they stand. Open one to see their checks and decide."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={refresh} loading={loading}>Refresh</Button>}
        tabs={<Tabs tabs={tabs} activeTab={filter} onChange={changeFilter} />}
      />
      {error ? <AlertCard variant="error" title="Couldn't load creators">{error}</AlertCard> : null}
      <div className={columns.length > 1 ? "grid gap-3 md:grid-cols-2 xl:grid-cols-4" : "grid"} aria-busy={loading}>
        {columns.map((column) => (
          <section key={column.id} className="min-w-0 rounded-xl bg-[var(--gray-50)] p-3" aria-label={column.label}>
            <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-[var(--color-text-primary)]">
              {column.label}
              <span className="text-xs font-medium text-[var(--color-text-tertiary)]">{column.rows.length}</span>
            </h2>
            <div className={columns.length > 1 ? "space-y-2" : "grid gap-2 sm:grid-cols-2 xl:grid-cols-3"}>
              {column.rows.map((creator) => <CreatorCard key={creator.creator_id} creator={creator} onOpen={setSelected} />)}
              {!column.rows.length && !loading ? <p className="px-1 py-2 text-xs text-[var(--color-text-tertiary)]">Nobody here.</p> : null}
            </div>
          </section>
        ))}
      </div>
      <CreatorDrawer
        key={selected?.creator_id ?? "none"}
        creator={selected}
        onClose={() => setSelected(null)}
        onDecided={() => { setSelected(null); refresh(); }}
      />
    </div>
  );
}
