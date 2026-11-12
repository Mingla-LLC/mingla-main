// Issue #3872 / #4402 — Programs › Creators.
//
// Board: every creator by where they stand (Needs a person, Setting up,
// Waiting on creator, Verified, Declined or suspended, All), with search, city
// and missing-step filters. Read once from admin_creator_queue('all').
//
// Record (#4402, Seth approved a full page): #/program-creators?creatorId=<id>.
// One read, admin_creator_detail. Review tab: the 9:16 showcase player beside
// Setup steps, Social accounts (approve / reject one handle at a time through
// admin_creator_handle_decide), Rates, About, Mingla Local and Person.
// Conversation and History are their own tabs. The decision bar decides
// through admin_creator_decide; Verify stays locked (aria-disabled, with the
// reason) until all six steps pass, and the server refuses it too.
// A {ok:false} answer is a failure and is shown, never toasted as a success.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, Clock, ExternalLink, Lock, RefreshCw, Search, User, X as XIcon,
} from "lucide-react";
import { useProgramLoad } from "../hooks/useProgramLoad";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Textarea } from "../components/ui/Input";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Skeleton } from "../components/ui/Skeleton";
import { ProgramConversationPanel } from "../components/programs/ProgramConversationPanel";
import { CreatorShowcasePlayer } from "../components/programs/CreatorShowcasePlayer";
import { CreatorStepMeter } from "../components/programs/CreatorStepMeter";
import { useToast } from "../context/ToastContext";
import {
  changeCreatorHandleBand, decideCreator, decideCreatorHandle, getCreatorDetail, listCreatorQueue,
} from "../services/creatorProgramsService";
import {
  CREATOR_COLUMNS,
  CREATOR_DECISIONS,
  CREATOR_FILTERS,
  FOLLOWER_BANDS,
  HANDLE_REJECT_REASONS,
  STEP_KEYS,
  VERIFICATION_TONE,
  askMoreSuggestions,
  audienceCompare,
  bandWord,
  cardStepTones,
  checksProgress,
  creatorCardLine,
  creatorColumnFor,
  creatorFlagGroups,
  creatorStepRows,
  decisionNoteError,
  decisionsFor,
  handleRejectNote,
  handleState,
  historyLine,
  localSeatWord,
  missingSteps,
  money,
  platformWord,
  profileUrl,
  programErrorMessage,
  shortDateTime,
  stepWord,
  verificationWord,
  verifyLabel,
  verifyLockedLine,
  verifyResultMessage,
} from "../lib/creatorPrograms";

const BASE_HASH = "#/program-creators";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]";

// ── Routing: the record is a full page under the same hash route ──────────

function readCreatorHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const tab = params.get("tab");
  return {
    creatorId: params.get("creatorId"),
    tab: CREATOR_FILTERS.some((f) => f.id === tab) ? tab : "needs_person",
  };
}

function creatorHash({ tab, creatorId }) {
  const params = new URLSearchParams();
  if (tab && tab !== "needs_person") params.set("tab", tab);
  if (creatorId) params.set("creatorId", creatorId);
  const query = params.toString();
  return query ? `${BASE_HASH}?${query}` : BASE_HASH;
}

function useCreatorRoute() {
  const [route, setRoute] = useState(readCreatorHash);
  useEffect(() => {
    const onHash = () => setRoute(readCreatorHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((next) => {
    const hash = creatorHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute({ creatorId: next.creatorId ?? null, tab: next.tab ?? "needs_person" });
  }, []);
  return [route, go];
}

// ── Board ─────────────────────────────────────────────────────────────────

function CreatorCard({ creator, onOpen }) {
  const line = creatorCardLine(creator);
  const progress = checksProgress(creator.checks);
  const handle = creator.handle?.handle ? ` · @${creator.handle.handle}` : "";
  return (
    <button
      type="button"
      onClick={() => onOpen(creator)}
      aria-label={`${creator.display_name || "Unnamed creator"}, ${verificationWord(creator.verification)}. ${line}`}
      className={`flex w-full cursor-pointer gap-3 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--color-brand-300)] ${FOCUS}`}
    >
      <span aria-hidden="true" className="h-12 w-9 shrink-0 rounded-md bg-[var(--gray-200)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-[var(--color-text-primary)]">{creator.display_name || "Unnamed creator"}</span>
        <span className="block truncate text-xs text-[var(--color-text-tertiary)]">
          {creator.city || "No home city"}{handle}{creator.updated_at ? ` · ${shortDateTime(creator.updated_at)}` : ""}
        </span>
        <span className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
          <Badge variant={VERIFICATION_TONE[creator.verification] ?? "default"} dot>{verificationWord(creator.verification)}</Badge>
          <span className="tabular-nums">{progress.text}</span>
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">{line}</span>
        <span className="mt-2 block"><CreatorStepMeter tones={cardStepTones(creator)} /></span>
      </span>
    </button>
  );
}

function CardSkeleton() {
  return (
    <div aria-hidden="true" className="flex gap-3 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3">
      <Skeleton width={36} height={48} />
      <div className="flex-1 space-y-2"><Skeleton height={12} width="70%" /><Skeleton height={10} width="50%" /><Skeleton height={4} /></div>
    </div>
  );
}

function boardMatches(row, { query, city, missing }) {
  if (query) {
    const q = query.toLowerCase().replace(/^@/, "");
    const name = String(row.display_name ?? "").toLowerCase();
    const handle = String(row.handle?.handle ?? "").toLowerCase();
    if (!name.includes(q) && !handle.includes(q)) return false;
  }
  if (city && row.city !== city) return false;
  if (missing && !missingSteps(row.checks).includes(missing)) return false;
  return true;
}

function CreatorBoard({ board, tab, onTab, onOpen }) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [missing, setMissing] = useState("");
  const rows = useMemo(() => board.data ?? [], [board.data]);
  const loading = board.loading && !board.data;
  const filters = { query: query.trim(), city, missing };
  const anyFilter = Boolean(filters.query || city || missing);
  const shown = rows.filter((row) => boardMatches(row, filters));
  const counts = Object.fromEntries(CREATOR_COLUMNS.map((c) => [c.id, rows.filter((r) => creatorColumnFor(r.verification) === c.id).length]));
  counts.all = rows.length;
  const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))].sort();
  const columns = tab === "all" ? CREATOR_COLUMNS : CREATOR_COLUMNS.filter((c) => c.id === tab);
  const tabs = CREATOR_FILTERS.map((t) => ({ ...t, label: `${t.label} · ${board.data ? counts[t.id] : "·"}` }));
  const clear = () => { setQuery(""); setCity(""); setMissing(""); };
  const noMatch = !loading && anyFilter && !columns.some((c) => shown.some((r) => creatorColumnFor(r.verification) === c.id));
  const emptyNeeds = !loading && !anyFilter && tab === "needs_person" && counts.needs_person === 0 && !board.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Creators"
        description="Every creator in the program, by where they stand. Open one to watch their video, check their handle and decide."
        actions={<Button variant="secondary" icon={RefreshCw} onClick={board.reload} loading={board.loading}>Refresh</Button>}
        tabs={<Tabs tabs={tabs} activeTab={tab} onChange={onTab} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search creators</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          <input
            className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] pl-9 pr-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
            placeholder="Search name or @handle"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">City</span>
          <select className="h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Missing step</span>
          <select className="h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]" value={missing} onChange={(e) => setMissing(e.target.value)}>
            <option value="">Any step</option>
            {STEP_KEYS.map((k) => <option key={k} value={k}>Missing: {stepWord(k)}</option>)}
          </select>
        </label>
        {anyFilter ? <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button> : null}
        <span className="ml-auto text-xs tabular-nums text-[var(--color-text-tertiary)]">
          {loading ? "Loading creators…" : `${shown.length} of ${rows.length} creators`}
        </span>
      </div>

      {board.error ? (
        <AlertCard
          variant="error"
          title="Couldn't load creators"
          action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={board.reload}>Try again</Button>}
        >
          {programErrorMessage(board.error, "The server didn't answer. Nothing you did was lost.")}
        </AlertCard>
      ) : null}

      {emptyNeeds ? (
        <SectionCard>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">Nobody needs a person right now.</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Creators show up here when a handle check needs eyes or all six steps pass.</p>
        </SectionCard>
      ) : noMatch ? (
        <SectionCard>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">No creators match these filters.</p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={clear}>Clear filters</Button>
        </SectionCard>
      ) : (
        <div
          className={columns.length > 1 ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" : "grid"}
          aria-busy={board.loading}
          style={board.error && board.data ? { opacity: 0.6 } : undefined}
        >
          {columns.map((column) => {
            const items = shown.filter((r) => creatorColumnFor(r.verification) === column.id);
            return (
              <section key={column.id} className="min-w-0 rounded-xl bg-[var(--gray-50)] p-3" aria-label={column.label}>
                <h2 className="flex items-center justify-between text-sm font-semibold text-[var(--color-text-primary)]">
                  {column.label}
                  <span className="text-xs font-medium text-[var(--color-text-tertiary)]">{loading ? "" : items.length}</span>
                </h2>
                <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">{column.why}</p>
                <div className={columns.length > 1 ? "space-y-2" : "grid gap-2 sm:grid-cols-2 xl:grid-cols-3"}>
                  {loading ? [0, 1, 2].map((i) => <CardSkeleton key={i} />) : items.map((creator) => (
                    <CreatorCard key={creator.creator_id} creator={creator} onOpen={onOpen} />
                  ))}
                  {!loading && !items.length ? <p className="px-1 py-2 text-xs text-[var(--color-text-tertiary)]">{anyFilter ? "No matches here." : "Nobody here."}</p> : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Record: dialogs ───────────────────────────────────────────────────────

function ReasonDialog({ kind, name, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const decline = kind === "decline";
  const consequences = decline
    ? ["The creator sees your reason in Creator setup.", "They can't take gigs.", "The decision and reason go into History."]
    : ["Hosts can no longer find or hire them.", "Gigs already under way are not cancelled automatically.", "You can lift the suspension later. All six steps must still pass."];
  const submit = async () => {
    const problem = decisionNoteError(kind, reason);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError("");
    try {
      await onConfirm(reason.trim());
    } catch (cause) {
      setError(programErrorMessage(cause));
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={saving ? () => {} : onClose} title={decline ? `Decline ${name}?` : `Suspend ${name}?`} destructive size="sm">
      <ModalBody className="space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">{decline ? "They won't be shown to hosts. You can reconsider later." : "Hosts stop seeing them straight away."}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text-secondary)]">{consequences.map((c) => <li key={c}>{c}</li>)}</ul>
        <Textarea
          autoFocus
          label={CREATOR_DECISIONS[kind].noteLabel}
          className="font-sans"
          maxLength={1000}
          value={reason}
          onChange={(e) => { setReason(e.target.value); setError(""); }}
          error={error || undefined}
          helper="Required. The button unlocks when you add a reason."
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="danger" loading={saving} disabled={!reason.trim()} onClick={() => void submit()}>
          {decline ? "Decline creator" : "Suspend creator"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ApproveHandleDialog({ handle, onClose, onConfirm }) {
  const compare = audienceCompare(handle);
  const [seen, setSeen] = useState(false);
  // The band comes only from the admin (Seth, 12 Nov 2026): no preselection.
  const [band, setBand] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const url = profileUrl(handle.platform, handle.handle);
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await onConfirm({ band, note: `Saw ${handle.verify_code} in the bio` });
    } catch (cause) {
      setError(programErrorMessage(cause));
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={saving ? () => {} : onClose} title={`Approve @${handle.handle}?`} size="sm">
      <ModalBody className="space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">This passes the social account step. You're confirming the account belongs to this creator.</p>
        <label className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={seen} onChange={(e) => setSeen(e.target.checked)} autoFocus />
          <span>
            I opened {url ? <a className="text-[var(--color-brand-600)] underline" href={url} target="_blank" rel="noopener noreferrer">{platformWord(handle.platform)} @{handle.handle}</a> : `@${handle.handle}`} and saw <span className="font-mono">{handle.verify_code}</span> in the bio.
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[var(--color-text-primary)]">Audience band you saw</span>
          <select className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm" value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="">Choose the band you saw</option>
            {FOLLOWER_BANDS.map((b) => <option key={b} value={b}>{bandWord(b)}</option>)}
          </select>
          <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">
            Required. The creator said "{bandWord(compare.selfReported)}". Hosts see only the band you record.
          </span>
        </label>
        {error ? <p role="alert" className="text-sm text-[var(--color-error-700)]">{error}</p> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button loading={saving} disabled={!seen || !band} onClick={() => void submit()} icon={Check}>Approve handle</Button>
      </ModalFooter>
    </Modal>
  );
}

// #4402 (Seth's live pass): fix a band recorded by mistake. Same picker,
// prefilled; a reason is required; the handle stays approved.
export function ChangeAudienceDialog({ handle, onClose, onConfirm }) {
  const compare = audienceCompare(handle);
  const [band, setBand] = useState(handle.follower_band ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const unchanged = band === (handle.follower_band ?? "");
  const submit = async () => {
    if (!reason.trim()) { setError("Say why you're changing it, in a few words."); return; }
    setSaving(true);
    setError("");
    try {
      await onConfirm({ band, note: reason.trim() });
    } catch (cause) {
      setError(programErrorMessage(cause));
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={saving ? () => {} : onClose} title={`Change audience for @${handle.handle}?`} size="sm">
      <ModalBody className="space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">The handle stays approved. Hosts see the band you record, and History keeps the old one.</p>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[var(--color-text-primary)]">Audience band you saw</span>
          <select aria-label="Audience band you saw" className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm" value={band} onChange={(e) => { setBand(e.target.value); setError(""); }} autoFocus>
            {FOLLOWER_BANDS.map((b) => <option key={b} value={b}>{bandWord(b)}</option>)}
          </select>
          <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">
            Now recorded: {bandWord(handle.follower_band)}. The creator said "{bandWord(compare.selfReported)}".
          </span>
        </label>
        <Textarea
          label="Reason (required)"
          className="font-sans"
          maxLength={500}
          value={reason}
          onChange={(e) => { setReason(e.target.value); setError(""); }}
          error={error || undefined}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button loading={saving} disabled={unchanged || !reason.trim()} onClick={() => void submit()}>Change audience</Button>
      </ModalFooter>
    </Modal>
  );
}

function RejectHandleDialog({ handle, onClose, onConfirm }) {
  const [reason, setReason] = useState(HANDLE_REJECT_REASONS[0]);
  const [extra, setExtra] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const verified = Boolean(handle.verified_at);
  const draft = handleRejectNote(reason, extra);
  const submit = async () => {
    const result = handleRejectNote(reason, extra);
    if (result.error) { setError(result.error); return; }
    setSaving(true);
    setError("");
    try {
      await onConfirm({ note: result.note });
    } catch (cause) {
      setError(programErrorMessage(cause));
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={saving ? () => {} : onClose} title={`${verified ? "Revoke" : "Reject"} @${handle.handle}?`} destructive size="sm">
      <ModalBody className="space-y-4">
        <p className="text-sm text-[var(--color-text-secondary)]">The creator sees standard wording with the reason below. It stays rejected until you reopen it.</p>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">Reason</legend>
          {HANDLE_REJECT_REASONS.map((r, i) => (
            <label key={r} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
              <input type="radio" name="handle-reject-reason" value={r} checked={reason === r} onChange={() => { setReason(r); setError(""); }} autoFocus={i === 0} />
              {r}
            </label>
          ))}
        </fieldset>
        <Textarea
          label={reason === "Something else" ? "Note for the creator (required)" : "Note for the creator (optional)"}
          className="font-sans"
          maxLength={500}
          value={extra}
          onChange={(e) => { setExtra(e.target.value); setError(""); }}
          error={error || undefined}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="danger" loading={saving} disabled={Boolean(draft.error)} onClick={() => void submit()}>
          {verified ? "Revoke handle" : "Reject handle"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Record: sections ──────────────────────────────────────────────────────

const STEP_ICON = {
  done: { Icon: Check, cls: "bg-[var(--color-success-50)] text-[var(--color-success-700)]" },
  you: { Icon: User, cls: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]" },
  bad: { Icon: XIcon, cls: "bg-[var(--color-error-50)] text-[var(--color-error-700)]" },
  creator: { Icon: Clock, cls: "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]" },
};
const STEP_TAG = { done: "success", you: "warning", bad: "error", creator: "default" };

function SetupSteps({ detail }) {
  const rows = creatorStepRows(detail);
  const done = rows.filter((r) => r.tone === "done").length;
  return (
    <SectionCard title="Setup steps" subtitle={`${done} of 6 pass`}>
      <div className="mb-4"><CreatorStepMeter tones={rows.map((r) => r.tone)} size="lg" /></div>
      <ul className="space-y-3" aria-label="Setup checks">
        {rows.map((row) => {
          const { Icon, cls } = STEP_ICON[row.tone] ?? STEP_ICON.creator;
          return (
            <li key={row.key} className="flex items-start gap-3">
              <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${cls}`} aria-hidden="true"><Icon className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-text-primary)]">{stepWord(row.key)}</span>
                <span className="block text-xs text-[var(--color-text-secondary)]">{row.text}</span>
              </span>
              <Badge variant={STEP_TAG[row.tone] ?? "default"}>{row.tone === "done" ? "Done" : row.tag}</Badge>
              <span className="sr-only">{row.tone === "done" ? "done" : "not done"}</span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

export function HandleRow({ handle, canAct, onApprove, onReject, onReopen, onChangeBand }) {
  const state = handleState(handle);
  const rejected = handle.last_check_status === "rejected";
  const compare = audienceCompare(handle);
  const url = profileUrl(handle.platform, handle.handle);
  const verified = Boolean(handle.verified_at) && !handle.review_required;
  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{platformWord(handle.platform)} · @{handle.handle}</span>
        <Badge variant={state.tone} dot>{state.text}</Badge>
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)]">
        Bio code <span className="font-mono">{handle.verify_code}</span>
        {handle.verify_expires_at ? ` · expires ${shortDateTime(handle.verify_expires_at)}` : ""}
        {` · ${handle.last_checked_at ? `last checked ${shortDateTime(handle.last_checked_at)}` : "not checked yet"}`}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--gray-200)] p-3">
          <p className="text-xs text-[var(--color-text-tertiary)]">Creator said</p>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{bandWord(compare.selfReported)}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">Self-reported at setup</p>
        </div>
        <div className={`rounded-lg border p-3 ${compare.mismatch ? "border-[var(--color-warning-700)] bg-[var(--color-warning-50)]" : "border-[var(--gray-200)]"}`}>
          <p className="text-xs text-[var(--color-text-tertiary)]">{compare.source ?? "Checked by Mingla"}</p>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{compare.checked ? bandWord(compare.checked) : "Not recorded yet"}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{compare.checked ? "Recorded when the handle was approved" : "You record it when you approve the handle"}</p>
        </div>
      </div>
      {compare.mismatch ? <p className="text-xs text-[var(--color-warning-700)]">The band doesn't match what the creator said. Hosts see the band Mingla checked.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {url ? (
          <a className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`} href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />View profile
          </a>
        ) : null}
        {canAct && !verified && !rejected ? <Button size="sm" icon={Check} onClick={() => onApprove(handle)}>Approve handle</Button> : null}
        {canAct && rejected ? <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => onReopen(handle)}>Reopen handle</Button> : null}
        {canAct && verified ? <Button size="sm" variant="secondary" onClick={() => onChangeBand(handle)}>Change audience</Button> : null}
        {canAct && !rejected ? (
          <Button size="sm" variant="ghost" className="text-[var(--color-error-700)]" icon={XIcon} onClick={() => onReject(handle)}>{verified ? "Revoke handle" : "Reject handle"}</Button>
        ) : null}
        {canAct && !verified && !rejected ? <span className="text-xs text-[var(--color-text-tertiary)]">Look for <span className="font-mono">{handle.verify_code}</span> in the bio.</span> : null}
        {canAct && rejected ? <span className="text-xs text-[var(--color-text-tertiary)]">Stays rejected until you reopen it. Reopening sends it back to review and lets the creator get a new code.</span> : null}
      </div>
    </li>
  );
}

function SocialAccounts({ detail, onApprove, onReject, onReopen, onChangeBand }) {
  const handles = Array.isArray(detail.handles) ? detail.handles : [];
  const canAct = !["declined", "suspended"].includes(detail.verification);
  return (
    <SectionCard title="Social accounts" subtitle={`${handles.length} added`}>
      {handles.length ? (
        <ul className="divide-y divide-[var(--gray-200)]">
          {handles.map((h) => <HandleRow key={h.id} handle={h} canAct={canAct} onApprove={onApprove} onReject={onReject} onReopen={onReopen} onChangeBand={onChangeBand} />)}
        </ul>
      ) : <p className="text-sm text-[var(--color-text-secondary)]">No social account added yet. The creator adds one in Creator setup.</p>}
    </SectionCard>
  );
}

function Rates({ detail }) {
  const packages = Array.isArray(detail.packages) ? detail.packages : [];
  return (
    <SectionCard title="Rates" subtitle="What hosts pay" noPadding>
      {packages.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-[var(--gray-50)] text-left text-xs text-[var(--color-text-tertiary)]">
              <tr><th className="px-4 py-2 font-medium">Package</th><th className="px-4 py-2 font-medium">Platforms</th><th className="px-4 py-2 text-right font-medium">Price</th><th className="px-4 py-2 text-right font-medium">Turnaround</th><th className="px-4 py-2 text-right font-medium">Usage included</th><th className="px-4 py-2 text-right font-medium">Extra usage</th><th className="px-4 py-2 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--gray-200)]">
              {packages.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{p.format_label || stepWord(p.format_key)}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{(p.platforms ?? []).map(platformWord).join(", ")}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--color-text-primary)]">{money(p.price_minor, p.currency)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">{p.turnaround_days} day{p.turnaround_days === 1 ? "" : "s"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">{p.includes_usage_days} days</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[var(--color-text-secondary)]">{p.extra_usage_price_minor ? money(p.extra_usage_price_minor, p.currency) : "None"}</td>
                  <td className="px-4 py-2.5"><Badge variant={p.active ? "success" : "default"}>{p.active ? "Active" : "Off"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="p-4 text-sm text-[var(--color-text-secondary)] sm:p-5">No rates yet. A creator needs at least one active rate to be verified.</p>}
    </SectionCard>
  );
}

function Facts({ items }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
          <dd className="min-w-0 text-[var(--color-text-primary)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function About({ detail }) {
  const about = detail.about ?? {};
  const chips = (list) => (Array.isArray(list) && list.length
    ? <span className="flex flex-wrap gap-1">{list.map((x) => <Badge key={x}>{stepWord(x)}</Badge>)}</span>
    : <span className="text-[var(--color-text-tertiary)]">None given</span>);
  return (
    <SectionCard title="About" subtitle="As hosts will see it">
      <Facts items={[
        ["Bio", about.bio ? <p className="whitespace-pre-line">{about.bio}</p> : <span className="text-[var(--color-text-tertiary)]">No bio</span>],
        ["Niches", chips(about.niches)],
        ["Languages", chips(about.languages)],
        ["Home city", about.home_city?.name ? `${about.home_city.name}${about.home_city.is_live === false ? " (not live yet)" : ""}` : <span className="text-[var(--color-text-tertiary)]">Not set</span>],
        ["Age", about.age_18_plus ? "18 or over (date of birth on file, not shown)" : about.date_of_birth_present ? "Under 18" : "Not given yet"],
      ]} />
    </SectionCard>
  );
}

function LocalAndPerson({ detail }) {
  const local = detail.local ?? {};
  const gigs = detail.gigs ?? {};
  const handles = Object.entries(local.application_handles ?? {}).filter(([, v]) => typeof v === "string" && v);
  return (
    <SectionCard title="Mingla Local and person">
      <Facts items={[
        ["Mingla Local", localSeatWord(local)],
        ...(handles.length ? [["Local application", handles.map(([k, v]) => `${platformWord(k)} ${String(v).startsWith("@") ? v : `@${v}`}`).join(" · ")]] : []),
        ...(detail.account_name && detail.account_name !== detail.display_name ? [["Account name", detail.account_name]] : []),
        ["Email", detail.person?.email_masked ?? "Not on file"],
        ["Mingla since", detail.person?.created_at ? shortDateTime(detail.person.created_at) : "Unknown"],
        ["Gigs", `${gigs.contracts_total ?? 0} contract${gigs.contracts_total === 1 ? "" : "s"} · ${gigs.contracts_active ?? 0} under way`],
      ]} />
    </SectionCard>
  );
}

function History({ detail }) {
  const items = Array.isArray(detail.history) ? [...detail.history].reverse() : [];
  return (
    <SectionCard title="History" subtitle="Mingla decisions on this creator" className="max-w-[760px]">
      {items.length ? (
        <ol className="space-y-3">
          {items.map((item, i) => (
            <li key={`${item.at}-${i}`} className="text-sm">
              <span className="text-[var(--color-text-primary)]">{historyLine(item)}</span>
              {item.note ? <span className="text-[var(--color-text-secondary)]"> · {item.note}</span> : null}
              <span className="block text-xs text-[var(--color-text-tertiary)]">{shortDateTime(item.at)}{item.actor_name ? ` · ${item.actor_name}` : ""}</span>
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-[var(--color-text-secondary)]">No decisions yet.</p>}
    </SectionCard>
  );
}

// ── Record: decision bar ──────────────────────────────────────────────────

function DecisionBar({ detail, onDecided }) {
  const { addToast } = useToast();
  const [dialog, setDialog] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState("");
  const [askError, setAskError] = useState("");
  const [saving, setSaving] = useState(null);
  const barRef = useRef(null);
  const allowed = decisionsFor(detail.verification);
  const name = detail.display_name || "this creator";
  const blockers = [...(detail.missing ?? []), ...((detail.needs_person ?? []).length ? ["handle_review"] : [])];
  const canVerify = detail.can_verify === true;
  const lockedLine = verifyLockedLine(detail.verification, blockers);

  // Toasts sit above the sticky bar (the Drawer footer pattern).
  useEffect(() => {
    const root = document.documentElement;
    const lift = () => root.style.setProperty("--toast-lift", `${barRef.current ? barRef.current.offsetHeight : 0}px`);
    lift();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(lift) : null;
    if (observer && barRef.current) observer.observe(barRef.current);
    return () => { if (observer) observer.disconnect(); root.style.removeProperty("--toast-lift"); };
  }, []);

  const verify = async () => {
    if (!canVerify) {
      addToast({ variant: "warning", title: lockedLine });
      return;
    }
    setSaving("verify");
    try {
      const result = await decideCreator(detail.creator_id, "verify", null);
      addToast({ variant: result?.verification === "verified" ? "success" : "warning", title: verifyResultMessage(result?.verification) });
      onDecided();
    } catch (cause) {
      addToast({ variant: "error", title: programErrorMessage(cause) });
      onDecided();
    } finally {
      setSaving(null);
    }
  };

  const sendAsk = async () => {
    const problem = decisionNoteError("ask_more", askNote);
    if (problem) { setAskError(problem); return; }
    setSaving("ask_more");
    setAskError("");
    try {
      await decideCreator(detail.creator_id, "ask_more", askNote);
      addToast({ variant: "success", title: `Asked ${name} for more.` });
      setAsking(false);
      setAskNote("");
      onDecided();
    } catch (cause) {
      setAskError(programErrorMessage(cause));
    } finally {
      setSaving(null);
    }
  };

  let why;
  if (detail.verification === "verified") {
    why = <><Check className="h-4 w-4 shrink-0 text-[var(--color-success-700)]" aria-hidden="true" /><span><b>Verified.</b> Hosts can find and hire {name}.</span></>;
  } else if (canVerify) {
    why = <><Check className="h-4 w-4 shrink-0 text-[var(--color-success-700)]" aria-hidden="true" /><span id="creator-verify-why"><b>All six steps pass.</b> {detail.verification === "suspended" ? "Lifting the suspension shows them to hosts again." : "Verifying shows them to hosts."}</span></>;
  } else {
    why = <><Lock className="h-4 w-4 shrink-0" aria-hidden="true" /><span id="creator-verify-why">{lockedLine}</span></>;
  }

  return (
    <>
      {asking ? (
        <div className="space-y-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]" role="region" aria-label="Ask for more">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">What should {name} send? <span className="font-normal text-[var(--color-text-tertiary)]">They see this in the app.</span></p>
          <div className="flex flex-wrap gap-1.5">
            {askMoreSuggestions(detail.missing, detail.handles).map((line) => (
              <button
                key={line}
                type="button"
                className={`rounded-full border border-[var(--gray-300)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)] ${FOCUS}`}
                onClick={() => { setAskNote((n) => (n.trim() ? `${n.trim()} ${line}` : line)); setAskError(""); }}
              >
                + {line}
              </button>
            ))}
          </div>
          <Textarea
            autoFocus
            label="Request"
            className="font-sans"
            maxLength={1000}
            value={askNote}
            onChange={(e) => { setAskNote(e.target.value); setAskError(""); }}
            error={askError || undefined}
            helper="Up to 1,000 characters."
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setAsking(false); setAskNote(""); setAskError(""); }} disabled={saving === "ask_more"}>Cancel</Button>
            <Button loading={saving === "ask_more"} onClick={() => void sendAsk()}>Send request</Button>
          </div>
        </div>
      ) : null}
      <div
        ref={barRef}
        role="region"
        aria-label="Decision"
        className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--gray-200)] bg-[var(--color-background-primary)] px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] rounded-t-xl sm:px-6"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2 text-sm text-[var(--color-text-secondary)]">{why}</div>
        <div className="flex flex-wrap gap-2">
          {allowed.includes("suspend") ? <Button variant="ghost" className="text-[var(--color-error-700)]" onClick={() => setDialog("suspend")}>Suspend</Button> : null}
          {allowed.includes("decline") ? <Button variant="secondary" onClick={() => setDialog("decline")}>Decline</Button> : null}
          {allowed.includes("ask_more") ? <Button variant="secondary" aria-expanded={asking} onClick={() => setAsking((a) => !a)}>Ask for more</Button> : null}
          {allowed.includes("verify") ? (
            <Button
              icon={canVerify ? Check : Lock}
              loading={saving === "verify"}
              aria-disabled={canVerify ? undefined : "true"}
              aria-describedby="creator-verify-why"
              className={canVerify ? "" : "opacity-50 cursor-not-allowed"}
              onClick={() => void verify()}
            >
              {verifyLabel(detail.verification)}
            </Button>
          ) : null}
        </div>
      </div>
      {dialog ? (
        <ReasonDialog
          kind={dialog}
          name={name}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await decideCreator(detail.creator_id, dialog, reason);
            addToast({ variant: "success", title: CREATOR_DECISIONS[dialog].done });
            setDialog(null);
            onDecided();
          }}
        />
      ) : null}
    </>
  );
}

// ── Record page ───────────────────────────────────────────────────────────

const RECORD_TABS = [
  { id: "review", label: "Review" },
  { id: "conversation", label: "Conversation" },
  { id: "history", label: "History" },
];

function RecordSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton height={14} width={90} />
      <Skeleton height={26} width={260} />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Skeleton height={480} rounded="xl" />
        <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} height={140} rounded="xl" />)}</div>
      </div>
    </div>
  );
}

function CreatorRecord({ creatorId, onBack, onChanged }) {
  const { addToast } = useToast();
  const fetchDetail = useCallback(() => getCreatorDetail(creatorId), [creatorId]);
  const record = useProgramLoad(fetchDetail);
  const [tab, setTab] = useState("review");
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [changingBand, setChangingBand] = useState(null);
  const detail = record.data;

  const refresh = useCallback(() => { record.reload(); onChanged(); }, [record, onChanged]);

  const back = { label: "Creators", onClick: onBack };

  if (!detail && record.loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Creator" back={back} />
        <RecordSkeleton />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-6">
        <PageHeader title="Creator" back={back} />
        <AlertCard
          variant="error"
          title="Couldn't load this creator"
          action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" icon={RefreshCw} onClick={record.reload}>Try again</Button><Button size="sm" variant="ghost" onClick={onBack}>Back to creators</Button></div>}
        >
          {programErrorMessage(record.error, "The server didn't answer. Check your connection and try again.")}
        </AlertCard>
      </div>
    );
  }

  const name = detail.display_name || "Creator";
  const flags = creatorFlagGroups(detail.needs_person?.map((n) => `handle_review:${n.platform}`) ?? []);
  const done = (detail.checks ?? []).filter((c) => c.done).length;
  const city = detail.about?.home_city?.name;
  const localShown = detail.local && detail.local.status !== "none";

  const approve = async ({ band, note }) => {
    const result = await decideCreatorHandle(approving.id, "approve", { band, note });
    setApproving(null);
    addToast({
      variant: "success",
      title: Array.isArray(result?.missing) && result.missing.length === 0 && result?.verification !== "verified"
        ? "Handle approved. All six steps pass, so you can verify the creator now."
        : "Handle approved. The social account step passes.",
    });
    refresh();
  };
  const reject = async ({ note }) => {
    await decideCreatorHandle(rejecting.id, "reject", { note });
    setRejecting(null);
    addToast({ variant: "success", title: "Handle rejected. The creator sees why. It stays rejected until you reopen it." });
    refresh();
  };
  const changeBand = async ({ band, note }) => {
    await changeCreatorHandleBand(changingBand.id, band, note);
    setChangingBand(null);
    addToast({ variant: "success", title: "Audience band changed. Hosts now see the new band." });
    refresh();
  };
  const reopen = async (handle) => {
    try {
      await decideCreatorHandle(handle.id, "reopen");
      addToast({ variant: "success", title: `@${handle.handle} reopened. It's back in review, and the creator can get a new code.` });
      refresh();
    } catch (cause) {
      addToast({ variant: "error", title: programErrorMessage(cause) });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={name}
        meta={<Badge variant={VERIFICATION_TONE[detail.verification] ?? "default"} dot>{verificationWord(detail.verification)}</Badge>}
        description={[
          city || "No home city",
          `${done} of 6 steps`,
          detail.created_at ? `Creator since ${shortDateTime(detail.created_at)}` : null,
          detail.updated_at ? `Updated ${shortDateTime(detail.updated_at)}` : null,
        ].filter(Boolean).join(" · ")}
        actions={(
          <>
            <a className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`} href={`#/people?view=record&userId=${encodeURIComponent(detail.creator_id)}`}>
              <User className="h-3.5 w-3.5" aria-hidden="true" />Open person
            </a>
            {localShown ? (
              <a className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`} href="#/program-locals">
                Open Mingla Locals · {localSeatWord(detail.local)}
              </a>
            ) : null}
            <span className="inline-flex h-8 items-center rounded-lg border border-[var(--gray-200)] px-3 text-xs text-[var(--color-text-secondary)]">
              Gigs · {detail.gigs?.contracts_total ?? 0}
            </span>
          </>
        )}
        tabs={<Tabs tabs={RECORD_TABS} activeTab={tab} onChange={setTab} />}
      />

      {tab === "review" ? (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-[76px] lg:self-start">
            <SectionCard
              title="Showcase video"
              badge={detail.showcase?.[0] ? <Badge variant={detail.showcase[0].status === "ready" ? "success" : detail.showcase[0].status === "failed" ? "error" : "default"}>{detail.showcase[0].status === "ready" ? "Ready" : detail.showcase[0].status === "failed" ? "Failed" : "Processing"}</Badge> : null}
            >
              <CreatorShowcasePlayer key={detail.showcase?.[0]?.job_id ?? "none"} job={detail.showcase?.[0] ?? null} onRefresh={record.reload} refreshing={record.loading} />
            </SectionCard>
          </div>
          <div className="min-w-0 space-y-4">
            {detail.verification === "needs_more" && detail.review_note ? <AlertCard variant="info" title={`You asked for more${detail.reviewed_at ? ` on ${shortDateTime(detail.reviewed_at)}` : ""}`}>{detail.review_note}</AlertCard> : null}
            {detail.verification === "declined" && detail.declined_reason ? <AlertCard variant="warning" title={`Declined${detail.reviewed_at ? ` on ${shortDateTime(detail.reviewed_at)}` : ""}`}>{detail.declined_reason}</AlertCard> : null}
            {detail.verification === "suspended" ? <AlertCard variant="error" title="Suspended · hidden from hosts">{detail.review_note || "No reason recorded."}</AlertCard> : null}
            {flags.needsPerson.length ? (
              <AlertCard variant="warning" title="Needs a person">
                <ul>{flags.needsPerson.map((line) => <li key={line}>{line}</li>)}</ul>
              </AlertCard>
            ) : null}
            <SetupSteps detail={detail} />
            <SocialAccounts detail={detail} onApprove={setApproving} onReject={setRejecting} onReopen={(h) => void reopen(h)} onChangeBand={setChangingBand} />
            <Rates detail={detail} />
            <About detail={detail} />
            <LocalAndPerson detail={detail} />
          </div>
        </div>
      ) : null}

      {tab === "conversation" ? (
        <SectionCard title={`Conversation with ${name}`} subtitle="They reply from Chats in the app" className="max-w-[760px]">
          <ProgramConversationPanel key={detail.creator_id} programKind="creator" targetUserId={detail.creator_id} recipientName={name} />
        </SectionCard>
      ) : null}

      {tab === "history" ? <History detail={detail} /> : null}

      {record.error ? <p role="alert" className="text-sm text-[var(--color-error-700)]"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden="true" />{programErrorMessage(record.error, "Couldn't refresh this creator.")}</p> : null}

      {tab !== "conversation" ? <DecisionBar key={`${detail.creator_id}-${detail.verification}`} detail={detail} onDecided={refresh} /> : null}

      {approving ? <ApproveHandleDialog handle={approving} onClose={() => setApproving(null)} onConfirm={approve} /> : null}
      {rejecting ? <RejectHandleDialog handle={rejecting} onClose={() => setRejecting(null)} onConfirm={reject} /> : null}
      {changingBand ? <ChangeAudienceDialog handle={changingBand} onClose={() => setChangingBand(null)} onConfirm={changeBand} /> : null}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export function ProgramCreatorsPage() {
  const [route, go] = useCreatorRoute();
  const fetchBoard = useCallback(() => listCreatorQueue("all"), []);
  const board = useProgramLoad(fetchBoard);

  if (route.creatorId) {
    return (
      <CreatorRecord
        key={route.creatorId}
        creatorId={route.creatorId}
        onBack={() => go({ tab: route.tab, creatorId: null })}
        onChanged={board.reload}
      />
    );
  }
  return (
    <CreatorBoard
      board={board}
      tab={route.tab}
      onTab={(tab) => go({ tab, creatorId: null })}
      onOpen={(creator) => go({ tab: route.tab, creatorId: creator.creator_id })}
    />
  );
}
