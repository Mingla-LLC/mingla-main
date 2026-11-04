// Issue #4270 (Wave 3) — Plan on a host card: the brand's one plan, shared
// with its hosts. It reads the brand's dated Calendar posts, the Work cards
// the host can see, the brand's events, experiences and trips, and promised
// events (staff only, "Promised"). Nothing is copied: a post's date moves it
// here, and a card's due date moves it here.
//
// Each item shows its plan link as a button with the site name ("↗
// canva.com"); staff add, change or remove the link on any post or task
// (D12). "+ Add to plan" adds a Post (a Calendar Idea for this brand) or a
// Task (a Work card the host can see), with owners, watchers, a date, an
// optional link and a note.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { SideLink } from "../ui/PanelStack";
import { FixesList } from "../ops/FixesList";
import { PeopleField } from "../people/PeopleField";
import { useToast } from "../../context/ToastContext";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import * as ops from "../../services/opsService";
import { opsErrorWords, requestKey, todayIso } from "../../lib/opsModel";
import {
  KIND_HELP,
  PLAN_KIND_WORDS,
  emptyPlanForm,
  linkSite,
  planAddItem,
  planAddedWords,
  planDay,
  planFormProblems,
  planLinkProblem,
  planWeeks,
} from "../../lib/brandPlan";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60 ${FOCUS}`;
const CHIP = "rounded-full px-2 py-px text-[11px] font-semibold";
const TONE = {
  planned: "bg-[var(--gray-100)] text-[var(--color-text-secondary)]",
  being_made: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  in_review: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  scheduled: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  posted: "bg-[var(--gray-100)] text-[var(--color-text-secondary)]",
  live: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  promised: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
};

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The host card's plan read: { loading, data, error, retry }. */
function useBrandPlan(recordId, brandId) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!recordId) return;
    const mine = ++seq.current;
    const today = todayIso();
    try {
      const data = await ops.fetchBrandPlan(recordId, addDays(today, -7), addDays(today, 90), today);
      if (mine === seq.current) setState({ loading: false, data, error: null });
    } catch (error) {
      if (mine === seq.current) setState((prev) => ({ loading: false, data: prev.data, error }));
    }
  }, [recordId]);
  useEffect(() => { setState({ loading: true, data: null, error: null }); load(); }, [load, brandId]);
  return { ...state, retry: load };
}

function itemHref(item) {
  if (item.kind === "task") return `#/work-board?card=${item.id}`;
  if (item.kind === "post") return `#/content-calendar?item=${item.id}`;
  if (item.kind === "promised") return `#/content-calendar?event=expected:${item.id}`;
  return `#/content-calendar?event=event:${item.id}`;
}
function itemSide(item) {
  if (item.kind === "task") return { kind: "card", id: item.id };
  if (item.kind === "post") return { kind: "content", id: item.id };
  if (item.kind === "promised") return { kind: "expected", id: item.id };
  return { kind: "event", id: item.id };
}

/** The link button and its editor: "↗ canva.com", "+ Add link", "Change link". */
export function PlanLinkRow({ item, online, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.link?.url || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (next) => {
    const v = String(next ?? value).trim();
    const problem = planLinkProblem(v);
    if (problem) { setError(problem); return; }
    setBusy(true);
    const ok = await onSave(item, v);
    setBusy(false);
    if (ok) { setEditing(false); setError(""); }
  };
  const fid = `plan-link-${item.kind}-${item.id}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {item.link?.url && (
          <a data-plan-link="" href={item.link.url} target="_blank" rel="noopener noreferrer"
            className={`inline-flex min-h-11 max-w-full items-center gap-1 rounded-lg bg-[var(--color-info-50)] px-3 text-[12.5px] font-semibold text-[var(--color-info-700)] hover:underline ${FOCUS}`}>
            <span aria-hidden="true">↗</span>
            <span className="min-w-0 break-all">{item.link.site || linkSite(item.link.url)}</span>
            <span className="sr-only">Open the link for {item.title} (opens in a new tab)</span>
          </a>
        )}
        {item.can_link && !editing && (
          <button type="button" data-plan-link-edit="" disabled={!online} onClick={() => { setValue(item.link?.url || ""); setEditing(true); }}
            className={`inline-flex min-h-11 items-center rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] disabled:opacity-50 ${FOCUS}`}>
            {item.link?.url ? "Change link" : "+ Add link"}
          </button>
        )}
      </div>
      {editing && (
        <form className="flex min-w-0 flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1" htmlFor={fid}>
            <span className="sr-only">Plan link for {item.title}</span>
            <input id={fid} type="url" inputMode="url" autoFocus maxLength={2000} placeholder="https://" value={value} disabled={busy}
              aria-invalid={error ? "true" : undefined} aria-describedby={error ? `${fid}-err` : undefined}
              onChange={(e) => { setValue(e.target.value); setError(""); }} className={INPUT} />
            {error && <span id={`${fid}-err`} role="alert" className="text-[12px] text-[var(--color-error-700)]">{error}</span>}
          </label>
          <Button type="submit" className="min-h-11" disabled={!online || busy}>{busy ? "Saving…" : "Save"}</Button>
          {item.link?.url && <Button type="button" variant="ghost" className="min-h-11" disabled={!online || busy} onClick={() => save("")}>Remove</Button>}
          <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel</Button>
        </form>
      )}
    </div>
  );
}

/** One plan row: date, kind, title (wraps), state, From Host app, link. */
export function PlanRow({ item, online, onSaveLink }) {
  return (
    <div data-plan-item={item.kind} className="flex min-w-0 flex-col gap-1 rounded-lg border border-[var(--gray-200)] px-3 py-2">
      <SideLink side={itemSide(item)} href={itemHref(item)} className={`flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md hover:bg-[var(--gray-50)] ${FOCUS}`}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`text-[13px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{item.title}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
            <span className="font-semibold text-[var(--color-text-secondary)]">{PLAN_KIND_WORDS[item.kind] || "Event"}</span>
            <span>· {planDay(item.on)}</span>
            {item.by === "host" && (item.kind === "post" || item.kind === "task") && <span data-from-host-app="" className={`${CHIP} bg-[var(--color-info-50)] text-[var(--color-info-700)]`}>From Host app</span>}
          </span>
        </span>
        {item.state_words && <span className={`${CHIP} shrink-0 ${TONE[item.state] || "bg-[var(--gray-100)] text-[var(--color-text-secondary)]"}`}>{item.state_words}</span>}
      </SideLink>
      {(item.can_link || item.link?.url) && <PlanLinkRow item={item} online={online} onSave={onSaveLink} />}
    </div>
  );
}

export function HostPlanSection({ record, online, onChanged }) {
  const { addToast } = useToast();
  const directory = usePeopleDirectory();
  const team = directory.people;
  const me = directory.me || "";
  const id = record?.id;
  const read = useBrandPlan(id, record?.brand_id || "");
  const hostOwners = useMemo(() => (record?.owners || []).slice(), [record?.owners]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => emptyPlanForm());
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(null);
  const [failed, setFailed] = useState("");
  const keyRef = useRef({ key: null, value: null });
  const today = todayIso();
  const data = read.data;
  const weeks = useMemo(() => planWeeks(data?.items, data?.today || today), [data, today]);
  const problems = planFormProblems(form, today);
  const problemFor = (field) => (tried ? problems.find((p) => p.field === field)?.message || "" : "");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const fid = (key) => `host-plan-${id}-${key}`;
  // Post: owned by you; Task: owned by the host card's owners (D6).
  const ownersFor = (type) => (type === "task" ? hostOwners : [me].filter(Boolean));

  const open = () => { setForm(emptyPlanForm(ownersFor("post"))); setTried(false); setRefused(null); setFailed(""); setAdding(true); };
  const pickType = (type) => set({ type, owners: ownersFor(type), watchers: type === "post" ? [] : form.watchers });

  const saveLink = async (item, link) => {
    try {
      await ops.setBrandPlanLink(item.kind, item.id, link, item.revision);
      addToast({ variant: "success", title: link ? "Link saved. The host sees it on their plan." : "Link removed." });
      await read.retry();
      onChanged?.();
      return true;
    } catch (error) {
      if (error?.token === "stale_write") { addToast({ variant: "warning", title: "This changed. Showing the latest." }); await read.retry(); }
      else addToast({ variant: "error", title: "Link not saved", description: opsErrorWords(error) });
      return false;
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    setFailed("");
    if (!online || busy) return;
    if (problems.length) {
      document.getElementById(fid(problems[0].field))?.focus?.();
      return;
    }
    const item = planAddItem(form);
    const value = JSON.stringify(item);
    if (keyRef.current.value !== value) keyRef.current = { key: requestKey("web_plan"), value };
    setBusy(true);
    try {
      const answer = await ops.addBrandPlanItem(id, item, keyRef.current.key);
      if (answer?.status === "added") {
        keyRef.current = { key: null, value: null };
        addToast({ variant: "success", title: planAddedWords(answer) });
        setAdding(false);
        setRefused(null);
        await read.retry();
        onChanged?.();
      } else {
        setRefused(answer || { status: "refused", fixes: [] });
      }
    } catch (error) {
      // What was typed stays; the line says what failed.
      setFailed(opsErrorWords(error));
    } finally {
      setBusy(false);
    }
  };

  const fixes = refused?.status === "refused" ? refused.fixes || [] : [];
  return (
    <section aria-labelledby={`host-plan-${id}`} data-host-section="plan" className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3">
      <h3 id={`host-plan-${id}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
        <span>Plan</span>
        <span className="text-[12.5px] font-medium text-[var(--color-text-tertiary)]">Shared with the host</span>
      </h3>
      {!record?.brand_id ? (
        <p className="text-[13px] text-[var(--color-text-tertiary)]">The plan starts when this host has a brand on Mingla.</p>
      ) : read.loading ? (
        <div role="status" className="flex flex-col gap-2"><span className="sr-only">Loading the plan…</span><div className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)]" /><div className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)]" /></div>
      ) : read.error && !data ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
          <span className={`min-w-0 ${WORDS}`}>Couldn’t load the plan. {opsErrorWords(read.error)}</span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={read.retry}>Try again</Button>
        </div>
      ) : (data?.items || []).length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-tertiary)]">Nothing planned yet. Add the first post or task you want.</p>
      ) : (
        <ol className="flex min-w-0 flex-col gap-3">
          {weeks.map((w) => (
            <li key={w.key} className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>{w.label}</span>
              <ul className="flex min-w-0 flex-col gap-1.5">
                {w.items.map((item, index) => (
                  <li key={`${item.kind}-${item.id}`} className="min-w-0">
                    {w.today && index === w.todayIndex && <TodayLine />}
                    <PlanRow item={item} online={online} onSaveLink={saveLink} />
                  </li>
                ))}
                {w.today && w.todayIndex >= w.items.length && <li><TodayLine /></li>}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {record?.brand_id && (adding ? (
        <form data-plan-add-form="" onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-3">
          {!online && <p role="status" className="text-[12.5px] font-semibold text-[var(--color-warning-700)]">You’re offline</p>}
          {fixes.length > 0 && <FixesList title={`Not added: ${fixes.length} ${fixes.length === 1 ? "thing" : "things"} to fix`} fixes={fixes} />}
          {refused?.status === "duplicate" && <p role="alert" className="rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-[13px] text-[var(--color-warning-700)]">{refused.message}</p>}
          {failed && (
            <div role="alert" className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-[var(--color-error-50)] px-3 py-2 text-[13px] text-[var(--color-error-700)]">
              <span className={`min-w-0 flex-1 ${WORDS}`}>Couldn’t add it. {failed}</span>
              <Button type="submit" variant="secondary" size="sm" className="min-h-11" disabled={!online || busy}>Try again</Button>
            </div>
          )}
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className={LABEL}>Type</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {["post", "task"].map((t) => (
                <label key={t} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-semibold ${form.type === t ? "border-[var(--color-brand-700)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)] text-[var(--color-text-primary)]"}`}>
                  <input type="radio" name={fid("type")} value={t} checked={form.type === t} disabled={busy} onChange={() => pickType(t)} className="h-4 w-4" />
                  {t === "post" ? "Post" : "Task"}
                </label>
              ))}
            </div>
            <p data-kind-help="" className={`text-[12.5px] text-[var(--color-text-secondary)] ${WORDS}`}>{KIND_HELP[form.type]}</p>
          </fieldset>
          <label className="flex min-w-0 flex-col gap-1" htmlFor={fid("title")}>
            <span className={LABEL}>What</span>
            <input id={fid("title")} autoFocus maxLength={160} value={form.title} disabled={busy} placeholder="e.g. Dress code post"
              aria-invalid={!!problemFor("title") || undefined} aria-describedby={problemFor("title") ? fid("title-err") : undefined}
              onChange={(e) => set({ title: e.target.value })} className={INPUT} />
            {problemFor("title") && <span id={fid("title-err")} className="text-[12px] text-[var(--color-error-700)]">{problemFor("title")}</span>}
          </label>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1" htmlFor={fid("on")}>
              <span className={LABEL}>Due</span>
              <input id={fid("on")} type="date" min={today} value={form.on} disabled={busy}
                aria-invalid={!!problemFor("on") || undefined} aria-describedby={problemFor("on") ? fid("on-err") : undefined}
                onChange={(e) => set({ on: e.target.value })} className={INPUT} />
              {problemFor("on") && <span id={fid("on-err")} className="text-[12px] text-[var(--color-error-700)]">{problemFor("on")}</span>}
            </label>
            <label className="flex min-w-0 flex-col gap-1" htmlFor={fid("link")}>
              <span className={LABEL}>Link (optional)</span>
              <input id={fid("link")} type="url" inputMode="url" maxLength={2000} value={form.link} disabled={busy} placeholder="https://"
                aria-invalid={!!problemFor("link") || undefined} aria-describedby={problemFor("link") ? fid("link-err") : fid("link-help")}
                onChange={(e) => set({ link: e.target.value })} className={INPUT} />
              <span id={fid("link-help")} className="text-[11.5px] text-[var(--color-text-tertiary)]">Staff and the brand’s hosts see this link.</span>
              {problemFor("link") && <span id={fid("link-err")} className="text-[12px] text-[var(--color-error-700)]">{problemFor("link")}</span>}
            </label>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <PeopleField id={fid("owners")} label="Owners" value={form.owners} team={team} me={me} suggested={ownersFor(form.type)} exclude={form.watchers} onChange={(owners) => set({ owners })} />
              {problemFor("owners") && <span role="alert" className="text-[12px] text-[var(--color-error-700)]">{problemFor("owners")}</span>}
            </div>
            {form.type === "task" && (
              <PeopleField id={fid("watchers")} label="Watchers" value={form.watchers} team={team} me={me} suggested={[me].filter(Boolean)} exclude={form.owners} onChange={(watchers) => set({ watchers })} />
            )}
          </div>
          <label className="flex min-w-0 flex-col gap-1" htmlFor={fid("note")}>
            <span className={LABEL}>Note (optional)</span>
            <input id={fid("note")} maxLength={500} value={form.note} disabled={busy} onChange={(e) => set({ note: e.target.value })} className={INPUT} />
            {problemFor("note") && <span className="text-[12px] text-[var(--color-error-700)]">{problemFor("note")}</span>}
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" className="min-h-11" loading={busy} disabled={!online || busy}>{busy ? "Adding…" : "Add to plan"}</Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" className="min-h-11 self-start" icon={Plus} disabled={!online} onClick={open}>Add to plan</Button>
      ))}
    </section>
  );
}

function TodayLine() {
  return (
    <div data-plan-today="" className="my-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-700)]">
      <span className="h-px flex-1 bg-[var(--color-brand-700)]" aria-hidden="true" />Today<span className="h-px flex-1 bg-[var(--color-brand-700)]" aria-hidden="true" />
    </div>
  );
}
