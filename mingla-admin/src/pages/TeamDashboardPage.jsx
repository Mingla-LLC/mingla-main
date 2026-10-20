// Issue #3802 (Wave 1) — the Team dashboard (#/team-dashboard), for an owner
// or admin: the team's pipelines by stage, everything due, this week by
// person, and the monthly host targets (set, changed and removed here).
// Issue #3980 adds the Runway and Sprint panels above them (and, for the
// owner, turning next steps into cards) from components/ops/TeamOpsPanels.
//
// Every number was counted by the server (crm_team_summary, through
// hooks/useCrmSummary.js). The page id has no entry in lib/access.js, so only
// an owner or admin can open it; the server refuses everyone else as well.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useCrmConfig } from "../hooks/useCrmConfig";
import { useCrmSummary } from "../hooks/useCrmSummary";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { canOpenPage } from "../lib/access";
import { displayName, dueTotals, errorWords, loadErrorWords, localToday, ownerLabel } from "../lib/crmModel";
import { buildCrmHash, buildTeamSearch, parseTeamSearch } from "../lib/crmUrl";
import { setTarget } from "../services/crmService";
import { Segmented } from "../components/crm/fields";
import { StatTile, StatTileRow, StatTileSkeleton } from "../components/crm/home/StatTile";
import { DueList, LINK_BUTTON_CLASS } from "../components/crm/home/DueList";
import { StageFunnel } from "../components/crm/home/StageFunnel";
import { GONE_REGION, TargetsCard } from "../components/crm/home/TargetsCard";
import { TargetAddForm, TargetRowControls } from "../components/crm/home/TargetEditor";
import { WeekByPerson } from "../components/crm/home/WeekByPerson";
import { TeamOpsPanels } from "../components/ops/TeamOpsPanels";
import { PeopleField } from "../components/people/PeopleField";
import { usePeopleDirectory } from "../hooks/usePeopleDirectory";
import { useOpsPoll } from "../hooks/useOpsWork";
import * as ops from "../services/opsService";
import {
  BRAND_CONFIRM_MAX, BRAND_PAGE_SIZE, brandActionChip, brandDecidedWords, brandDefaultPicked, brandFirstPicked, brandResultWords,
  brandSelectable, brandTogglePick, opsErrorWords, requestKey,
} from "../lib/opsModel";
import { OpsChip } from "../components/ops/OpsChip";

const PAGE_ID = "team-dashboard";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

// #3980 (R2, R4) — the owner's switches for the steps Mingla makes by itself
// and the host cards it makes for new brands, and who owns marketing steps.
// Off until the owner switches them on; turning one off stops new cards.
function AutomaticSteps({ online }) {
  const { access } = useAuth();
  const { addToast } = useToast();
  const people = usePeopleDirectory();
  const read = useOpsPoll(() => ops.fetchOpsSettings(), { key: `${access?.email || ""}|ops-settings`, intervalMs: 0 });
  const [busy, setBusy] = useState("");
  const settings = read.data;
  if (!settings?.can_edit) return null;
  const set = async (key, value, words) => {
    setBusy(key);
    try { await ops.setOpsSetting(key, value); await read.refetch({ quiet: true }); addToast({ variant: "success", title: words }); }
    catch (error) { addToast({ variant: "error", title: "Not changed", description: opsErrorWords(error) }); }
    finally { setBusy(""); }
  };
  // A real switch (a track and a thumb), not a checkbox: role="switch" with
  // aria-checked, the whole row is the touch target.
  const switchRow = (id, label, on) => (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-lg px-1 py-1">
      <label htmlFor={id} id={`${id}-label`} className="min-w-0 cursor-pointer break-normal text-[13.5px] text-[var(--color-text-primary)]">{label}</label>
      <button id={id} type="button" role="switch" aria-checked={!!on} aria-labelledby={`${id}-label`} disabled={!online || !!busy}
        onClick={() => set(id === "switch-auto-steps" ? "auto_steps" : "brand_auto_cards", !on, !on ? "Switched on." : "Switched off. Cards already made stay.")}
        className={`group inline-grid min-h-11 min-w-14 shrink-0 cursor-pointer place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}>
        <span aria-hidden="true" className={`relative block h-6 w-11 rounded-full transition-colors ${on ? "bg-[var(--color-brand-800)]" : "bg-[var(--gray-300)]"}`}>
          <span className={`absolute top-0.5 block h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
        </span>
      </button>
    </div>
  );
  return (
    <section aria-labelledby="automatic-steps-heading" className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <h3 id="automatic-steps-heading" className="border-b border-[var(--gray-200)] px-4 py-3.5 text-[15px] font-semibold text-[var(--color-text-primary)] sm:px-5">Automatic steps</h3>
      <div className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:px-5">
        {switchRow("switch-auto-steps", "Make steps from every host’s events", settings.auto_steps)}
        {switchRow("switch-brand-cards", "Make a host card for every new brand", settings.brand_auto_cards)}
        <div className="max-w-md">
          <PeopleField id="marketing-owner" label="Marketing owner" max={1} value={settings.marketing_owner?.email ? [settings.marketing_owner.email] : []}
            team={people.people} me={people.me} suggested={[people.me].filter(Boolean)} disabled={!online || !!busy}
            onChange={(next) => set("marketing_owner", next[0] || null, next[0] ? "Marketing owner saved." : "No marketing owner: marketing steps go to the host's owners.")} />
        </div>
        <p className="break-normal text-[12.5px] text-[var(--color-text-tertiary)]">Off until you switch it on. Turning it off stops new cards; cards already made stay.</p>
        <p className="break-normal text-[12.5px] text-[var(--color-text-tertiary)]">Engineering follow-through (merged but not live, release records, live checks) starts from the moment you first switch on automatic steps{settings.follow_through_since ? ` (that was ${new Date(settings.follow_through_since).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })})` : ""}. Earlier merges and issues only show their status.</p>
      </div>
    </section>
  );
}
// #3980 Wave 4 (P3) — "Brands without a host card". The owner previews what
// brand auto-link would do for every brand that has no host card (nothing is
// written), ticks the brands to act on and confirms. The server runs the same
// brand auto-link for exactly those brands, once per confirm.
// Opening the page reads only the count; the preview runs on Preview, a page
// of 50 at a time, and never more than 100 brands are ticked (one confirm's
// limit).
function BrandCardsBackfill({ online }) {
  const { access } = useAuth();
  const settingsRead = useOpsPoll(() => ops.fetchOpsSettings(), { key: `${access?.email || ""}|ops-settings`, intervalMs: 0 });
  const canEdit = !!settingsRead.data?.can_edit;
  const [count, setCount] = useState(null);
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState([]);
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirmKey, setConfirmKey] = useState(null);
  useEffect(() => {
    if (!canEdit) return undefined;
    let live = true;
    ops.countBrandCards().then((answer) => { if (live) setCount(Number(answer?.total ?? 0)); }).catch(() => { if (live) setCount(null); });
    return () => { live = false; };
  }, [canEdit]);
  if (!canEdit) return null;
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  const chosen = picked.filter((id) => rows.some((r) => r.brand_id === id && brandSelectable(r)));
  const atCap = chosen.length >= BRAND_CONFIRM_MAX;
  const more = !!preview?.page?.more;
  const load = async () => {
    setState("loading"); setError(null); setResult(null);
    try {
      const answer = await ops.previewBrandCards();
      setPreview(answer);
      setCount(Number(answer?.totals?.total ?? 0));
      setPicked(brandDefaultPicked(answer?.rows));
      setState("preview");
    } catch (e) { setError(e); setState("idle"); }
  };
  const loadMore = async () => {
    if (!preview) return;
    setState("more"); setError(null);
    try {
      const answer = await ops.previewBrandCardsPage(rows.length, BRAND_PAGE_SIZE);
      const seen = new Set(rows.map((r) => r.brand_id));
      const added = (Array.isArray(answer?.rows) ? answer.rows : []).filter((r) => !seen.has(r.brand_id));
      setPreview({ ...answer, rows: [...rows, ...added] });
      setCount(Number(answer?.totals?.total ?? 0));
      setPicked([...chosen, ...brandDefaultPicked(added, BRAND_CONFIRM_MAX - chosen.length)]);
      setState("preview");
    } catch (e) { setError(e); setState("preview"); }
  };
  const confirm = async () => {
    if (state !== "confirm" || chosen.length === 0) return;
    setState("working"); setError(null);
    try {
      const answer = await ops.confirmBrandCards(chosen, confirmKey);
      setResult(answer);
      setConfirmKey(null);
      const fresh = await ops.previewBrandCards();
      setPreview(fresh); setCount(Number(fresh?.totals?.total ?? 0)); setPicked([]);
      setState("preview");
    } catch (e) { setError(e); setState("confirm"); }
  };
  const busy = state === "working" || state === "loading" || state === "more";
  return (
    <section aria-labelledby="brand-cards-heading" className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <h3 id="brand-cards-heading" className="border-b border-[var(--gray-200)] px-4 py-3.5 text-[15px] font-semibold text-[var(--color-text-primary)] sm:px-5">
        Brands without a host card{count !== null ? ` (${count})` : ""}
      </h3>
      <div className="grid min-w-0 grid-cols-1 gap-4 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="break-normal text-[13px] text-[var(--color-text-secondary)]">Brands on Mingla with no host card yet. Preview shows what Mingla would do for each: link the one card with exactly its email, handle or phone, add a new card, or leave it for a person to pick. A brand a person already decided about is left as it is. Nothing changes until you confirm.</p>
          {error && <p role="alert" className="break-words text-[13px] text-[var(--color-error-700)]">{opsErrorWords(error)}</p>}
          {result && <p role="status" className="break-normal text-[13px] font-semibold text-[var(--color-text-primary)]">{brandResultWords(result)}</p>}
          {preview && (
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <OpsChip tone="success">{rows.filter((r) => r.action === "link" && !r.decided).length} link</OpsChip>
              <OpsChip tone="info">{rows.filter((r) => r.action === "create" && !r.decided).length} add card</OpsChip>
              <OpsChip tone="warning">{rows.filter((r) => (r.action === "pick" || r.action === "reopen") && !r.decided).length} for a person</OpsChip>
              {rows.some((r) => r.decided) && <OpsChip tone="default">{rows.filter((r) => r.decided).length} decided</OpsChip>}
            </div>
          )}
          {preview && rows.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <p role="status" className="break-normal text-[13px] text-[var(--color-text-secondary)]">
                {chosen.length} of {rows.length} shown chosen{count !== null && count > rows.length ? ` (${count} in all)` : ""}.{atCap ? ` One confirm takes at most ${BRAND_CONFIRM_MAX}.` : ""}
              </p>
              <span className="flex flex-wrap gap-2">
                <Button variant="ghost" className="min-h-11" disabled={busy || chosen.length === 0} onClick={() => setPicked([])}>Select none</Button>
                <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setPicked(brandFirstPicked(rows))}>First {BRAND_CONFIRM_MAX}</Button>
              </span>
            </div>
          )}
          {state === "confirm" || state === "working" ? (
            <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] p-3">
              <p className="break-normal text-[13px] text-[var(--color-warning-700)]">Act on {chosen.length} {chosen.length === 1 ? "brand" : "brands"} now? Each is checked again first; links and new cards are logged on the host card.</p>
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11" disabled={!online || state === "working" || chosen.length === 0} onClick={confirm}>{state === "working" ? "Working…" : `Yes, confirm ${chosen.length}`}</Button>
                <Button variant="ghost" className="min-h-11" disabled={state === "working"} onClick={() => setState("preview")}>Not yet</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="min-h-11" disabled={!online || busy} onClick={load}>{state === "loading" ? "Loading…" : preview ? "Preview again" : "Preview"}</Button>
              {preview && <Button className="min-h-11" disabled={!online || busy || chosen.length === 0} onClick={() => { setConfirmKey(requestKey("brand_cards")); setState("confirm"); }}>Confirm selected ({chosen.length})</Button>}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          {!preview ? (
            <p className="break-normal text-[13px] text-[var(--color-text-tertiary)]">Press Preview to see each brand, what would happen and the matching card.</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">Every brand has a host card.</p>
          ) : (
            <ul className="flex max-h-[440px] min-w-0 flex-col divide-y divide-[var(--gray-100)] overflow-y-auto rounded-lg border border-[var(--gray-200)]">
              {rows.map((r) => {
                const chip = brandActionChip(r.action);
                const can = brandSelectable(r);
                const on = can && picked.includes(r.brand_id);
                return (
                  <li key={r.brand_id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 px-3 py-2">
                    <label className="-my-2 -ml-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                      <input type="checkbox" className="h-5 w-5" disabled={!can || state === "working" || (!on && atCap)} checked={on}
                        aria-label={`${r.decided ? "Decided" : chip.label}: ${r.name}`}
                        onChange={(e) => setPicked(brandTogglePick(chosen, r.brand_id, e.target.checked))} />
                    </label>
                    <span className="min-w-0">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 break-normal text-[13px] font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{r.name}</span>
                        {r.decided ? <OpsChip tone="default">Decided</OpsChip> : <OpsChip tone={chip.tone}>{chip.label}</OpsChip>}
                      </span>
                      {r.decided ? (
                        <span className="block break-words text-[12px] text-[var(--color-text-secondary)]">{brandDecidedWords(r.decided)}. Mingla leaves this brand as it is.</span>
                      ) : (
                        <span className="block break-words text-[12px] text-[var(--color-text-secondary)]">{r.words}</span>
                      )}
                      {r.open_card && <span className="block break-words text-[12px] text-[var(--color-text-tertiary)]">A card already asks a person: {r.open_card.title}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {preview && more && (
            <Button variant="secondary" className="min-h-11 self-start" disabled={!online || busy} onClick={loadMore}>
              {state === "more" ? "Loading…" : `Show ${Math.min(BRAND_PAGE_SIZE, Math.max(0, (count ?? 0) - rows.length)) || BRAND_PAGE_SIZE} more`}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

const UNDO_MS = 8000;
const OFFLINE_WORDS = "You're offline. You can look around, but the numbers won't update and targets can't be changed until you're back.";
const NOT_READY_WORDS = "The team dashboard isn't switched on yet. Try again in a few minutes, or tell an admin.";
const PIPELINES = [
  { value: "hosts", label: "Hosts" },
  { value: "creators", label: "Creators" },
];
const DOT = String.fromCharCode(183);

function overdueNote(totals) {
  return totals.overdue > 0 ? `${totals.overdue} overdue` : "";
}

export function TeamDashboardPage() {
  const { access } = useAuth();
  const { addToast } = useToast();
  const online = useOnline();
  const cfg = useCrmConfig();
  const summary = useCrmSummary("team");
  const config = cfg.config;
  const data = summary.data;

  const [search, setSearch] = useHashQuery(PAGE_ID);
  const person = useMemo(() => parseTeamSearch(search).person, [search]);
  const [pipeline, setPipeline] = useState("hosts");
  const dueRef = useRef(null);
  const targetsRef = useRef(null);

  const name = data?.me?.display_name || displayName(access?.email || "");
  const today = data?.today || localToday();
  const error = summary.error || cfg.error;
  const loading = !error && (summary.loading || cfg.loading);
  const retry = () => {
    if (cfg.error) cfg.retry();
    summary.refetch();
  };

  const people = useMemo(() => (Array.isArray(data?.by_person) ? data.by_person : []), [data]);
  const picked = person && people.some((p) => p.email === person) ? person : "";
  // Whatever the address carries that names nobody on the list (a person who
  // left, a value that is not an address, any other parameter) is dropped
  // from the address quietly, and the default view is shown.
  useEffect(() => {
    if (!data) return;
    const clean = buildTeamSearch({ person: picked });
    if (search !== clean) setSearch(clean, { replace: true });
  }, [data, search, picked, setSearch]);
  const personName = (email) => ownerLabel(email, people);

  const showDue = useCallback(() => {
    const el = dueRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, []);
  const pickPerson = useCallback(
    (email) => {
      setSearch(buildTeamSearch({ person: email }), { replace: true });
      showDue();
    },
    [setSearch, showDue]
  );
  const tileTo = (which) => (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setPipeline(which);
    showDue();
  };

  // ── Targets ─────────────────────────────────────────────────────────────
  const { patch, refetch } = summary;
  // The Undo in a target's toast calls the same writer, a moment later.
  const writeAgain = useRef(null);
  const writeTarget = useCallback(
    async (regionId, icp, number, { where, undo = true } = {}) => {
      if (!online) return { ok: false, message: "You're offline, so that didn't go through. Try again once you're back." };
      let res;
      try {
        res = await setTarget(regionId, icp, number);
      } catch (err) {
        if (err?.token === "forbidden") refetch({ quiet: false });
        return { ok: false, message: errorWords(err) };
      }
      // Show the server's answer straight away, then read everything again.
      patch((d) => {
        const rest = (d.targets || []).filter((t) => !(t.region_id === regionId && t.icp === icp));
        return { ...d, targets: res.target ? [...rest, res.target] : rest };
      });
      refetch({ quiet: true });
      const label = where || [res.target?.region_name, res.target?.icp_label].filter(Boolean).join(` ${DOT} `);
      const previous = res.previous ?? null;
      addToast({
        variant: res.changed ? "success" : "info",
        title: !res.changed
          ? `Target for ${label} is already ${number === null ? "removed" : number}`
          : number === null
            ? `Target for ${label} removed`
            : `Target for ${label} set to ${number}`,
        duration: UNDO_MS,
        action:
          undo && res.changed
            ? {
                label: "Undo",
                // After Undo from the keyboard, focus goes to the targets,
                // where the change just happened, not to nowhere.
                focusAfter: () => targetsRef.current,
                onClick: async () => {
                  const back = await writeAgain.current(regionId, icp, previous, { where: label, undo: false });
                  if (!back.ok) addToast({ variant: "error", title: "Couldn't undo that", description: back.message });
                },
              }
            : undefined,
      });
      return { ok: true };
    },
    [online, patch, refetch, addToast]
  );
  useEffect(() => {
    writeAgain.current = writeTarget;
  }, [writeTarget]);

  const hostsDue = dueTotals(data?.due?.hosts);
  const creatorsDue = dueTotals(data?.due?.creators);
  const due = data?.due?.[pipeline];
  const dueAll = dueTotals(due);
  const allRows = Array.isArray(due?.rows) ? due.rows : [];
  const rows = picked ? allRows.filter((r) => Array.isArray(r.owners) && r.owners.includes(picked)) : allRows;
  const withDue = people.filter((p) => Number(p.overdue) + Number(p.due_today) > 0);
  const chips = picked && !withDue.some((p) => p.email === picked) ? [...withDue, people.find((p) => p.email === picked)] : withDue;
  const plural = pipeline === "creators" ? "Creators" : "Hosts";
  const def = config?.pipelines?.[pipeline] || null;
  const hostIcps = config?.pipelines?.hosts?.icps || [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Team dashboard"
        description={name ? `Hi ${name}. Here is the team.` : "Here is the team."}
        actions={
          canOpenPage(access, "admin") ? (
            <a href="#/admin" className={LINK_BUTTON_CLASS}>
              Team and roles
            </a>
          ) : null
        }
      />

      {!online && <AlertCard variant="warning">{OFFLINE_WORDS}</AlertCard>}

      <AutomaticSteps online={online} />
      <BrandCardsBackfill online={online} />
      <TeamOpsPanels online={online} />

      {error ? (
        error.token === "forbidden" ? (
          <AlertCard
            variant="error"
            title="You can't open the team dashboard any more"
            action={
              <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          >
            {errorWords(error)}
          </AlertCard>
        ) : (
          <AlertCard
            variant="error"
            title="Couldn't load the team dashboard"
            action={
              <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={retry}>
                Retry
              </Button>
            }
          >
            {error.token === "not_ready" ? NOT_READY_WORDS : loadErrorWords(error)}
          </AlertCard>
        )
      ) : loading ? (
        <>
          <StatTileRow label="Loading">
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </StatTileRow>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <StageFunnel title="Hosts by stage" pipeline="hosts" loading />
            <StageFunnel title="Creators by stage" pipeline="creators" loading />
          </div>
          <DueList title="Due and overdue, whole team" pipeline="hosts" loading />
          <WeekByPerson loading />
          <TargetsCard loading />
        </>
      ) : (
        <>
          <StatTileRow label="The team's numbers">
            <StatTile
              href={buildCrmHash("hosts", { view: "list" })}
              onClick={tileTo("hosts")}
              value={hostsDue.total}
              label="Hosts due"
              note={overdueNote(hostsDue)}
            />
            <StatTile
              href={buildCrmHash("creators", { view: "list" })}
              onClick={tileTo("creators")}
              value={creatorsDue.total}
              label="Creators due"
              note={overdueNote(creatorsDue)}
            />
            <StatTile href="#/beta-leads?show=new" value={data.beta_leads_new ?? 0} label="New beta leads" />
          </StatTileRow>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <StageFunnel title="Hosts by stage" pipeline="hosts" stages={data.stages?.hosts} />
            <StageFunnel title="Creators by stage" pipeline="creators" stages={data.stages?.creators} />
          </div>

          <section ref={dueRef} tabIndex={-1} aria-label="Due and overdue, whole team" className="flex scroll-mt-20 flex-col gap-3 outline-none">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label="Pipeline" options={PIPELINES} value={pipeline} onChange={setPipeline} />
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Whose cards to list">
              <button
                type="button"
                aria-pressed={!picked}
                onClick={() => setSearch("", { replace: true })}
                className={chipClass(!picked)}
              >
                Everyone
              </button>
              {chips.filter(Boolean).map((p) => (
                <button
                  key={p.email}
                  type="button"
                  aria-pressed={picked === p.email}
                  title={p.email}
                  onClick={() => setSearch(buildTeamSearch({ person: p.email }), { replace: true })}
                  className={chipClass(picked === p.email)}
                >
                  {personName(p.email)}
                  <span className="tabular-nums opacity-80">{Number(p.overdue) + Number(p.due_today)}</span>
                </button>
              ))}
            </div>
            <DueList
              title="Due and overdue, whole team"
              pipeline={pipeline}
              def={def}
              rows={rows}
              total={picked ? rows.length : dueAll.total}
              regions={config.regions}
              team={config.team}
              today={today}
              who="owners"
              moreHref={buildCrmHash(pipeline, { view: "list" })}
              emptyText={
                picked
                  ? `Nothing is due or overdue for ${personName(picked)} in ${plural}.`
                  : "Nothing is due or overdue."
              }
              action={
                picked ? (
                  <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => setSearch("", { replace: true })}>
                    Show everyone
                  </Button>
                ) : null
              }
            />
            {picked && due?.truncated ? (
              <p className="text-xs text-[var(--color-text-tertiary)]">
                Only the first {allRows.length} due {plural.toLowerCase()} are searched here.{" "}
                <a href={buildCrmHash(pipeline, { view: "list" })} className="font-semibold underline">
                  Open the list
                </a>{" "}
                to see every one.
              </p>
            ) : null}
          </section>

          <WeekByPerson
            byPerson={people}
            selected={picked}
            hrefFor={(email) => `#/${PAGE_ID}?${buildTeamSearch({ person: email })}`}
            onPick={pickPerson}
          />

          <section ref={targetsRef} tabIndex={-1} aria-label="Targets this month" className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]">
          <TargetsCard
            targets={data.targets}
            subtitle="Hosts that reached Onboarded or Live this month, against the monthly number"
            emptyHint="Add the first one below."
            renderControls={(t) => (
              <TargetRowControls
                target={t}
                offline={!online}
                onSave={(number) => writeTarget(t.region_id, t.icp, number, { where: targetWhere(t) })}
                onRemove={() => writeTarget(t.region_id, t.icp, null, { where: targetWhere(t) })}
              />
            )}
            footer={
              <TargetAddForm
                regions={config.regions}
                icps={hostIcps}
                targets={data.targets}
                offline={!online}
                onSave={(regionId, icp, number) => writeTarget(regionId, icp, number)}
              />
            }
          />
          </section>
        </>
      )}
    </div>
  );
}

function targetWhere(t) {
  return `${t.region_name || GONE_REGION} ${DOT} ${t.icp_label}`;
}

function chipClass(pressed) {
  return [
    "inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-150 max-sm:h-11",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
    pressed
      ? "cursor-default border-transparent bg-[var(--color-brand-500)] text-white"
      : "cursor-pointer border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
  ].join(" ");
}
