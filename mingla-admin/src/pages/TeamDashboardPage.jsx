// Issue #3802 (Wave 1) — the Team dashboard (#/team-dashboard), for an owner
// or admin: the team's pipelines, everything due, and the monthly host
// targets (set, changed and removed here).
//
// Issue #4130 (Wave 1) — one row of numbers first (hosts contacted, hosts
// onboarded against the target, events coming up with a runway warning,
// creators moved to Booked, new beta leads, cards waiting on a person), then
// how the hosts and creators pipelines moved, the due and overdue list, the
// targets, and the event runway collapsed at the bottom. The one-time
// settings (automatic steps, brands without a host card, turning next steps
// into cards) moved to Settings (components/ops/TeamSettingsPanels.jsx); the
// per-person sprint table lives on Work.
//
// Every number was counted by the server (crm_team_summary, crm_team_pulse,
// ops_team_overview, ops_work_list). The page id has no entry in
// lib/access.js, so only an owner or admin can open it; the server refuses
// everyone else as well.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useCrmConfig } from "../hooks/useCrmConfig";
import { useCrmSummary } from "../hooks/useCrmSummary";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { canOpenPage } from "../lib/access";
import { displayName, dueTotals, errorWords, loadErrorWords, localToday, ownerLabel } from "../lib/crmModel";
import { buildCrmHash, buildTeamSearch, parseTeamSearch } from "../lib/crmUrl";
import { fetchTeamPulse, setTarget } from "../services/crmService";
import { Segmented } from "../components/crm/fields";
import { DueList, LINK_BUTTON_CLASS } from "../components/crm/home/DueList";
import { GONE_REGION, TargetsCard } from "../components/crm/home/TargetsCard";
import { TargetAddForm, TargetRowControls } from "../components/crm/home/TargetEditor";
import { RunwayPanel } from "../components/ops/TeamOpsPanels";
import { useOpsPoll, useOpsTeamOverview } from "../hooks/useOpsWork";
import * as ops from "../services/opsService";
import { opsErrorWords, todayIso } from "../lib/opsModel";
import { trendTone } from "../lib/trendTone";
import { PULSE_PERIODS, pulseRange, pulseTiles, stageMoves } from "../lib/teamPulse";

const PAGE_ID = "team-dashboard";

const UNDO_MS = 8000;
const OFFLINE_WORDS = "You're offline. You can look around, but the numbers won't update and targets can't be changed until you're back.";
const NOT_READY_WORDS = "The team dashboard isn't switched on yet. Try again in a few minutes, or tell an admin.";
const PIPELINES = [
  { value: "hosts", label: "Hosts" },
  { value: "creators", label: "Creators" },
];
const DOT = String.fromCharCode(183);

function Kpi({ tile }) {
  const tone = trendTone(tile.up);
  return (
    <a href={tile.href} data-kpi={tile.key} className="flex min-w-0 flex-col gap-0.5 px-4 py-3 no-underline hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)]">
      <span className="text-[12px] text-[var(--color-text-tertiary)]">{tile.label}</span>
      <span className={`text-[20px] font-bold tabular-nums ${tile.alert ? "text-[var(--color-error-700)]" : "text-[var(--color-text-primary)]"}`}>{tile.value === null ? "–" : tile.value}</span>
      {tile.note ? <span className={`text-[12px] ${tile.up === undefined ? "text-[var(--color-text-tertiary)]" : tone.className}`}>{tile.note}</span> : null}
    </a>
  );
}

function MovesChart({ title, pipeline, rows, periodWords }) {
  const none = rows.every((r) => r.moved === 0);
  return (
    <SectionCard title={title} subtitle={`moved into each stage, ${periodWords}`} action={<a href={buildCrmHash(pipeline, {})} className={`${LINK_BUTTON_CLASS} sm:h-8 sm:px-3 sm:text-xs`}>Open board</a>}>
      {none ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Nobody moved stage {periodWords}. Each move to a new stage is counted here.</p>
      ) : (
        <div className="h-[220px] min-w-0" role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.moved}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--gray-200)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={96} tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "var(--gray-100)" }} />
              <Bar dataKey="moved" name="Moved" fill={pipeline === "creators" ? "var(--color-info-500)" : "var(--color-brand-500)"} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
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
  const [period, setPeriod] = useState("week");
  const dueRef = useRef(null);
  // #4130: the row of numbers, the runway and the waiting cards.
  const pulse = useOpsPoll(() => { const r = pulseRange(period); return fetchTeamPulse(r.from.toISOString(), r.to.toISOString()); }, { key: `${access?.email || ""}|team-pulse|${period}`, intervalMs: 120_000 });
  const overview = useOpsTeamOverview();
  const waiting = useOpsPoll(() => ops.listWork({ status: ["person"], done_days: 0, limit: 1, today: todayIso() }), { key: `${access?.email || ""}|team-waiting`, intervalMs: 60_000 });
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

  const due = data?.due?.[pipeline];
  const dueAll = dueTotals(due);
  const allRows = Array.isArray(due?.rows) ? due.rows : [];
  const rows = picked ? allRows.filter((r) => Array.isArray(r.owners) && r.owners.includes(picked)) : allRows;
  const withDue = people.filter((p) => Number(p.overdue) + Number(p.due_today) > 0);
  const chips = picked && !withDue.some((p) => p.email === picked) ? [...withDue, people.find((p) => p.email === picked)] : withDue;
  const plural = pipeline === "creators" ? "Creators" : "Hosts";
  const def = config?.pipelines?.[pipeline] || null;
  const hostIcps = config?.pipelines?.hosts?.icps || [];
  const periodWords = period === "30d" ? "in the last 30 days" : "this week";
  const tiles = pulseTiles({
    pulse: pulse.data,
    targets: data?.targets,
    runway: overview.data?.runway,
    waiting: waiting.data ? Number(waiting.data?.counts?.person ?? 0) : null,
    config,
    period,
  });
  const atRisk = Array.isArray(overview.data?.runway?.at_risk) ? overview.data.runway.at_risk.length : 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Team dashboard"
        description={name ? `Hi ${name}. How the pipelines are moving. Settings are in Settings; cards are on Work.` : "How the pipelines are moving. Settings are in Settings; cards are on Work."}
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented label="Period" options={PULSE_PERIODS} value={period} onChange={setPeriod} />
            {canOpenPage(access, "admin") ? (
              <a href="#/admin" className={LINK_BUTTON_CLASS}>
                Team and roles
              </a>
            ) : null}
          </div>
        }
      />

      {!online && <AlertCard variant="warning">{OFFLINE_WORDS}</AlertCard>}

      {pulse.error && !pulse.data ? (
        <LoadError title="Couldn’t load the team’s numbers" message={loadErrorWords(pulse.error)} onRetry={() => pulse.refetch()} />
      ) : pulse.loading || summary.loading ? (
        <div aria-busy="true" aria-label="Loading the team’s numbers"><Skeleton height={84} /></div>
      ) : (
        <section aria-label="The team’s numbers" className="grid min-w-0 grid-cols-2 divide-[var(--gray-200)] overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)] sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-[var(--gray-200)] [&>*]:border-b xl:[&>*]:border-b-0 xl:[&>*:not(:first-child)]:border-l">
          {tiles.map((t) => <Kpi key={t.key} tile={t} />)}
        </section>
      )}
      {(overview.error && !overview.data) || (waiting.error && !waiting.data) ? (
        <LoadError title="Some numbers didn’t load" message={opsErrorWords(overview.error || waiting.error)} onRetry={() => { overview.refetch(); waiting.refetch(); }} />
      ) : null}

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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton height={220} />
            <Skeleton height={220} />
          </div>
          <DueList title="Due and overdue, whole team" pipeline="hosts" loading />
          <TargetsCard loading />
        </>
      ) : (
        <>
          {pulse.data ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MovesChart title="Hosts pipeline" pipeline="hosts" rows={stageMoves(config, "hosts", pulse.data.now?.moves?.hosts)} periodWords={periodWords} />
              <MovesChart title="Creators pipeline" pipeline="creators" rows={stageMoves(config, "creators", pulse.data.now?.moves?.creators)} periodWords={periodWords} />
            </div>
          ) : null}

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

      {/* #4130: the runway, collapsed; it opens by itself when an event is short on promotion time. */}
      {overview.data ? (
        <details data-runway="" open={atRisk > 0} className="group rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-[15px] font-semibold text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)] sm:px-5">
            <span>Event runway</span>
            <span className="text-[12px] font-normal text-[var(--color-text-tertiary)]">{atRisk > 0 ? `${atRisk} ${atRisk === 1 ? "event is" : "events are"} short on promotion time` : "every event in the next 90 days is on time"}</span>
          </summary>
          <div className="border-t border-[var(--gray-200)] p-3">
            <RunwayPanel runway={overview.data.runway} />
          </div>
        </details>
      ) : null}
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
