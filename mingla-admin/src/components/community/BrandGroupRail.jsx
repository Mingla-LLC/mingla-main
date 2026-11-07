// Issue #4270 (Wave 7) — the right rail of a Brand group: Plan, Host, Media and
// People. Plan and Host are the host card's own blocks (the brand's plan, To
// do, On Mingla, pipeline) for staff with Hosts and Creators access; every item
// in them opens in the side panel beside the chat (PanelLinksContext ->
// openFresh), never by leaving the page. Media and People are for every staff
// member who can open the group.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "../ui/Button";
import { PanelLinksContext } from "../ui/PanelStack";
import { HostPlanSection } from "../crm/HostPlanSection";
import { HostToDoSection } from "../crm/HostToDoSection";
import { OnMinglaSection } from "../crm/OnMinglaSection";
import { HostCardEmptyState } from "./HostCardEmptyState";
import { GroupAvatar } from "./BrandGroupList";
import { useCrmConfig } from "../../hooks/useCrmConfig";
import { useHostOnMingla } from "../../hooks/useHostOnMingla";
import * as crm from "../../services/crmService";
import { listOfficialBrandGroupMedia, openOfficialBrandGroupFile } from "../../services/communityService";
import { errorWords, regionName, stageLabel } from "../../lib/crmModel";
import { BRAND_ROLE_WORDS, todayIso } from "../../lib/opsModel";
import { planDay } from "../../lib/brandPlan";
import { initialsOf } from "../../lib/brandGroupInbox";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const INPUT = `min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] disabled:opacity-60 ${FOCUS}`;
const GHOST = `inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] disabled:opacity-50 ${FOCUS}`;

export const RAIL_TAB_WORDS = Object.freeze({ plan: "Plan", host: "Host", media: "Media", people: "People" });

/** The tabs a teammate sees: Media and People only without Hosts and Creators access. */
export function railTabs(canHosts) {
  return canHosts ? ["plan", "host", "media", "people"] : ["media", "people"];
}

/** Tab keys: Left/Right move, Home/End jump; the new tab is chosen and focused. */
export function railKeyTarget(tabs, current, key) {
  const i = Math.max(0, tabs.indexOf(current));
  if (key === "ArrowRight") return tabs[(i + 1) % tabs.length];
  if (key === "ArrowLeft") return tabs[(i - 1 + tabs.length) % tabs.length];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[tabs.length - 1];
  return null;
}

/** The host card record behind a Brand group: { status, record, reload }. */
function useHostRecord(recordId) {
  const [state, setState] = useState({ status: recordId ? "loading" : "none", record: null, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!recordId) { setState({ status: "none", record: null, error: null }); return; }
    const mine = ++seq.current;
    try {
      const data = await crm.getRecord(recordId);
      if (mine === seq.current) setState({ status: data?.record ? "ready" : "none", record: data?.record || null, error: null });
    } catch (error) {
      if (mine === seq.current) setState((prev) => ({ status: prev.record ? "ready" : "error", record: prev.record, error }));
    }
  }, [recordId]);
  useEffect(() => {
    setState({ status: recordId ? "loading" : "none", record: null, error: null });
    void load();
  }, [load, recordId]);
  return { ...state, reload: load };
}

function RailLoading() {
  return <div role="status" className="flex flex-col gap-2"><span className="sr-only">Loading the host card…</span><div className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)]" /><div className="h-24 animate-pulse rounded-lg bg-[var(--gray-100)]" /></div>;
}

function RailError({ error, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
      <span className={`min-w-0 ${WORDS}`}>Couldn’t load the host card. {errorWords(error)}</span>
      <Button variant="secondary" size="sm" className="min-h-11" onClick={onRetry}>Try again</Button>
    </div>
  );
}

/** Plan tab: the brand's plan (the host card's Plan block) and its Calendar. */
function PlanTab({ group, host, online, openFresh, prefill, onChanged, onLinked }) {
  const rec = useHostRecord(host?.record_id || "");
  const links = useMemo(() => ({ openSide: openFresh }), [openFresh]);
  if (!host) return <HostCardEmptyState brandName={group.brand_name} brandId={group.brand_id} canHosts online={online} onLinked={onLinked} />;
  if (rec.status === "loading") return <RailLoading />;
  if (rec.status === "error" || !rec.record) return <RailError error={rec.error} onRetry={rec.reload} />;
  const empty = host.plan && !host.plan.next && Number(host.plan.this_week) === 0;
  return (
    <PanelLinksContext.Provider value={links}>
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">Marketing plan</p>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">Shared with the host · an item opens beside the chat</p>
        </div>
        {empty && (
          <p data-plan-empty-hint="" className={`rounded-lg bg-[var(--gray-100)] px-3 py-2 text-[12.5px] text-[var(--color-text-secondary)] ${WORDS}`}>
            Nothing on {group.brand_name}&apos;s plan for the next 4 weeks. Their next event on Mingla shows here with its date. Start with a lineup or menu post the week before.
          </p>
        )}
        <HostPlanSection record={rec.record} online={online} onChanged={onChanged} prefill={prefill} />
        <button type="button" className={`${GHOST} self-start`} onClick={() => openFresh({ kind: "calendar", id: rec.record.id })}>Calendar</button>
      </div>
    </PanelLinksContext.Provider>
  );
}

function KeyNumber({ label, value }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg bg-[var(--gray-50)] px-2.5 py-2">
      <span className="text-[11px] text-[var(--color-text-tertiary)]">{label}</span>
      <span className={`text-[13.5px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{value}</span>
    </div>
  );
}

/** Next action and its due date, saved on the host card when the field is left. */
function PipelineFields({ record, online, onSaved }) {
  const [nextAction, setNextAction] = useState(record.next_action || "");
  const [due, setDue] = useState(record.due_on || "");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => { setNextAction(record.next_action || ""); setDue(record.due_on || ""); }, [record.id, record.next_action, record.due_on]);
  const save = async (field, value) => {
    const current = field === "next_action" ? record.next_action || "" : record.due_on || "";
    if (value === current || !online) return;
    setBusy(field); setProblem("");
    try {
      await crm.updateRecord(record.id, { [field]: value === "" ? null : value });
      await onSaved?.();
    } catch (err) {
      setProblem(errorWords(err));
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <label className="flex min-w-0 flex-col gap-1" htmlFor={`rail-next-${record.id}`}>
        <span className={LABEL}>Next action</span>
        <input id={`rail-next-${record.id}`} maxLength={200} value={nextAction} disabled={!online || busy === "next_action"}
          onChange={(e) => setNextAction(e.target.value)} onBlur={() => void save("next_action", nextAction.trim())} className={INPUT} />
      </label>
      <label className="flex min-w-0 flex-col gap-1" htmlFor={`rail-due-${record.id}`}>
        <span className={LABEL}>Next action due</span>
        <input id={`rail-due-${record.id}`} type="date" value={due} disabled={!online || busy === "due_on"}
          onChange={(e) => setDue(e.target.value)} onBlur={() => void save("due_on", due)} className={INPUT} />
      </label>
      {problem && <p role="alert" className="text-[12.5px] text-[var(--color-error-700)]">{problem}</p>}
    </>
  );
}

/** Host tab: who the brand is to us, the work on it, what it has on Mingla. */
function HostTab({ group, host, online, canBrands, openFresh, workPrefill, canAssign, assigning, onAssign, onChanged, onLinked }) {
  const rec = useHostRecord(host?.record_id || "");
  const record = rec.record;
  const read = useHostOnMingla(record?.id || "", record?.brand_id || "");
  const { config } = useCrmConfig();
  const links = useMemo(() => ({ openSide: openFresh }), [openFresh]);
  if (!host) return <HostCardEmptyState brandName={group.brand_name} brandId={group.brand_id} canHosts online={online} onLinked={onLinked} />;
  if (rec.status === "loading") return <RailLoading />;
  if (rec.status === "error" || !record) return <RailError error={rec.error} onRetry={rec.reload} />;
  const def = config?.pipelines?.hosts || null;
  const today = todayIso();
  const events = (Array.isArray(read.data?.events) ? read.data.events : []).filter((e) => e?.start_on && (e.start_on >= today || e.live));
  const nextEvent = events.slice().sort((a, b) => String(a.start_on).localeCompare(String(b.start_on)))[0] || null;
  const openTodos = (Array.isArray(read.data?.todo) ? read.data.todo : []).filter((c) => c && c.status !== "done").length;
  const owners = Array.isArray(host.owners) ? host.owners : [];
  const brand = read.data?.brand || null;
  const where = [brand?.slug ? `/${brand.slug}` : "", regionName(config?.regions, record.region_id)].filter(Boolean).join(" · ");
  const refresh = async () => { await rec.reload(); await read.retry(); onChanged?.(); };
  return (
    <PanelLinksContext.Provider value={links}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--gray-200)] p-3">
          <div className="flex items-center gap-3">
            <GroupAvatar group={group} />
            <div className="min-w-0 flex-1">
              <p className={`text-[14px] font-bold text-[var(--color-text-primary)] ${WORDS}`}>{group.brand_name}</p>
              {where && <p className="truncate text-[12px] text-[var(--color-text-tertiary)]">{where}</p>}
            </div>
            <span className="shrink-0 rounded-md bg-[var(--color-success-50)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-success-700)]">{stageLabel(def, record.stage)}</span>
          </div>
          <div data-host-key-numbers="" className="grid grid-cols-3 gap-2">
            <KeyNumber label="Stage" value={stageLabel(def, record.stage) || "—"} />
            <KeyNumber label="Next event" value={read.loading ? "…" : nextEvent ? planDay(nextEvent.start_on) : "None yet"} />
            <KeyNumber label="Open to-dos" value={read.loading ? "…" : String(openTodos)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={GHOST} onClick={() => openFresh({ kind: "host", id: record.id })}>Open host card beside</button>
            {canBrands && group.brand_id && <button type="button" className={GHOST} onClick={() => openFresh({ kind: "brand", id: group.brand_id })}>Brand</button>}
          </div>
        </div>
        {owners.length === 0 && (
          <div data-no-owner-alert="" role="status" className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--color-error-50)] px-3 py-2">
            <p className={`min-w-0 flex-1 text-[12.5px] text-[var(--color-error-700)] ${WORDS}`}><strong>No Mingla owner.</strong> Nobody on the team gets this brand&apos;s follow-ups.</p>
            {canAssign && <button type="button" className={GHOST} disabled={!online || assigning} onClick={onAssign}>{assigning ? "Assigning…" : "Assign to me"}</button>}
          </div>
        )}
        <HostToDoSection record={record} read={read} online={online} onAdded={() => { void read.retry(); onChanged?.(); }} prefill={workPrefill} />
        <OnMinglaSection record={record} read={read} online={online} />
        <section aria-labelledby={`rail-pipeline-${record.id}`} className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3">
          <h3 id={`rail-pipeline-${record.id}`} className="text-[14px] font-semibold text-[var(--color-text-primary)]">Pipeline</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-[var(--color-text-secondary)]">Stage: <strong className="text-[var(--color-text-primary)]">{stageLabel(def, record.stage)}</strong></span>
            <button type="button" className={GHOST} onClick={() => openFresh({ kind: "host", id: record.id })}>Change stage</button>
          </div>
          <PipelineFields record={record} online={online} onSaved={refresh} />
        </section>
        <p className={`text-[11.5px] text-[var(--color-text-tertiary)] ${WORDS}`}>Edits here save to the host card. Every item opens in the side panel beside the chat.</p>
      </div>
    </PanelLinksContext.Provider>
  );
}

const TILE_WORDS = { image: "Photo", video: "Video", file: "File" };

/** One media tile: the thumbnail when it is ready, else a labelled tile. */
function MediaTile({ row, onOpen, urls }) {
  const url = urls[row.fileId];
  const label = row.mime === "application/pdf" ? "PDF" : TILE_WORDS[row.kind] || "File";
  return (
    <button type="button" onClick={() => onOpen(row)} aria-label={`Open ${row.name}`}
      className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-[var(--gray-100)] text-[12px] font-semibold text-[var(--color-text-secondary)] hover:opacity-90 ${FOCUS}`}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span>{label}</span>}
    </button>
  );
}

/** Media tab: photos and videos, or files, shared in the group. */
function MediaTab({ conversationId, onPreview }) {
  const [kind, setKind] = useState("media");
  const [state, setState] = useState({ loading: true, rows: [], totals: { media: 0, files: 0 }, nextCursor: null, error: null });
  const [urls, setUrls] = useState({});
  const urlsRef = useRef({});
  useEffect(() => () => { for (const u of Object.values(urlsRef.current)) URL.revokeObjectURL(u); }, []);
  const load = useCallback(async (cursor = null) => {
    try {
      const page = await listOfficialBrandGroupMedia(conversationId, kind, cursor);
      setState((prev) => ({ loading: false, rows: cursor ? [...prev.rows, ...page.rows] : page.rows, totals: page.totals, nextCursor: page.nextCursor, error: null }));
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error }));
    }
  }, [conversationId, kind]);
  useEffect(() => { setState((prev) => ({ ...prev, loading: true, rows: [], nextCursor: null, error: null })); void load(null); }, [load]);
  // Thumbnails of ready photos and videos (the same small images the Host app uses).
  useEffect(() => {
    let live = true;
    for (const row of state.rows) {
      if (row.kind === "file" || row.thumbState !== "ready" || urlsRef.current[row.fileId]) continue;
      urlsRef.current[row.fileId] = "";
      openOfficialBrandGroupFile(row.fileId, { thumb: true }).then((url) => {
        if (!live) { URL.revokeObjectURL(url); return; }
        urlsRef.current[row.fileId] = url;
        setUrls((prev) => ({ ...prev, [row.fileId]: url }));
      }, () => { delete urlsRef.current[row.fileId]; });
    }
    return () => { live = false; };
  }, [state.rows]);
  // The panel's preview dialog says itself when a file cannot be opened.
  const open = (row) => { void onPreview({ file_id: row.fileId, file_name: row.name, file_mime: row.mime }); };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">Photos, videos and files shared in this group</p>
      <div role="group" aria-label="Show" className="flex gap-1 rounded-lg bg-[var(--gray-100)] p-1">
        {[["media", `Media · ${state.totals.media}`], ["files", `Files · ${state.totals.files}`]].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={kind === id ? "true" : "false"} onClick={() => setKind(id)}
            className={`min-h-9 flex-1 rounded-md text-[12.5px] ${kind === id ? "bg-[var(--color-background-primary)] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]" : "text-[var(--color-text-secondary)]"} ${FOCUS}`}>{label}</button>
        ))}
      </div>
      {state.loading ? (
        <div role="status" className="grid grid-cols-3 gap-2"><span className="sr-only">Loading…</span>{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-square animate-pulse rounded-lg bg-[var(--gray-100)]" />)}</div>
      ) : state.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
          <span>Couldn’t load what was shared. {state.error.message || ""}</span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => void load(null)}>Try again</Button>
        </div>
      ) : state.rows.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-tertiary)]">{kind === "files" ? "No files shared in this group yet." : "No photos or videos shared in this group yet."}</p>
      ) : kind === "files" ? (
        <ul className="flex flex-col gap-1.5">
          {state.rows.map((row) => (
            <li key={row.fileId}>
              <button type="button" onClick={() => open(row)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg border border-[var(--gray-200)] px-3 text-left text-[13px] hover:bg-[var(--gray-50)] ${FOCUS}`}>
                <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-3 gap-2">{state.rows.map((row) => <MediaTile key={row.fileId} row={row} urls={urls} onOpen={open} />)}</div>
      )}
      {state.nextCursor && <Button variant="secondary" className="min-h-11 self-start" onClick={() => void load(state.nextCursor)}>Load more</Button>}
    </div>
  );
}

/** People tab: the brand team by name and role, and the Mingla staff here. */
function PeopleTab({ people, peopleError, staff, memberCount }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">Brand team · {people.length || memberCount || 0}</p>
      {peopleError ? <p role="alert" className="text-[12.5px] text-[var(--color-error-700)]">Couldn’t load the brand team. {peopleError}</p> : null}
      <ul className="flex flex-col gap-1.5">
        {people.map((p) => (
          <li key={p.user_id} data-person="" className="flex items-center gap-2.5">
            <span aria-hidden="true" className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-info-50)] text-[12px] font-bold text-[var(--color-info-700)]">{initialsOf(p.display_name).slice(0, 1)}</span>
            <span className={`min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)] ${WORDS}`}>{p.display_name}</span>
            <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">{BRAND_ROLE_WORDS[p.role] || "Team"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] font-semibold text-[var(--color-text-primary)]">Mingla staff in this group</p>
      {staff.length ? (
        <ul className="flex flex-col gap-1.5">
          {staff.map((name) => (
            <li key={name} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-brand-100)] text-[12px] font-bold text-[var(--color-brand-700)]">{initialsOf(name).slice(0, 1)}</span>
              <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)]">{name}</span>
              <span className="shrink-0 text-[12px] text-[var(--color-text-tertiary)]">Mingla Support</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[12.5px] text-[var(--color-text-tertiary)]">No Mingla staff have written here yet.</p>}
      <p className={`text-[11.5px] text-[var(--color-text-tertiary)] ${WORDS}`}>Every Mingla Support teammate gets a push for each message unless they mute the group.</p>
    </div>
  );
}

export function BrandGroupRail({
  group, tab, onTab, canHosts, canBrands, host, online, openFresh, planPrefill, workPrefill,
  canAssign, assigning, onAssign, onChanged, onLinked, onPreview, people, peopleError, staff,
}) {
  const tabs = railTabs(canHosts);
  const active = tabs.includes(tab) ? tab : tabs[0];
  const tabRefs = useRef({});
  if (!group) return null;
  const pick = (next) => { onTab(next); tabRefs.current[next]?.focus(); };
  return (
    <div data-rail="" className="flex min-h-0 flex-1 flex-col bg-[var(--color-background-secondary)]">
      <div className="shrink-0 px-3.5 pb-2 pt-3">
        <div role="tablist" aria-label="Brand context" className="flex gap-1 rounded-[10px] bg-[var(--gray-100)] p-1">
          {tabs.map((id) => (
            <button key={id} ref={(el) => { tabRefs.current[id] = el; }} type="button" role="tab" id={`rail-tab-${id}`} aria-selected={active === id ? "true" : "false"} aria-controls={`rail-panel-${id}`}
              tabIndex={active === id ? 0 : -1}
              onClick={() => onTab(id)}
              onKeyDown={(e) => { const next = railKeyTarget(tabs, active, e.key); if (next) { e.preventDefault(); pick(next); } }}
              className={`min-h-9 flex-1 rounded-lg text-[13px] ${active === id ? "bg-[var(--color-background-primary)] font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]" : "text-[var(--color-text-secondary)]"} ${FOCUS}`}>
              {RAIL_TAB_WORDS[id]}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={`rail-panel-${active}`} aria-labelledby={`rail-tab-${active}`} data-scroll="rail" className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4">
        {active === "plan" && <PlanTab key={group.conversation_id} group={group} host={host} online={online} openFresh={openFresh} prefill={planPrefill} onChanged={onChanged} onLinked={onLinked} />}
        {active === "host" && <HostTab key={group.conversation_id} group={group} host={host} online={online} canBrands={canBrands} openFresh={openFresh} workPrefill={workPrefill} canAssign={canAssign} assigning={assigning} onAssign={onAssign} onChanged={onChanged} onLinked={onLinked} />}
        {active === "media" && <MediaTab key={group.conversation_id} conversationId={group.conversation_id} onPreview={onPreview} />}
        {active === "people" && <PeopleTab people={people} peopleError={peopleError} staff={staff} memberCount={group.member_count} />}
      </div>
    </div>
  );
}
