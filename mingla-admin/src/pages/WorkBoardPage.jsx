// Issue #3980 (R7, R8) — Work: what needs doing, who's on it, and what's
// slipping.
//
// Issue #4130 (Wave 1) — Board (default), Today, This week and This month.
//
// Issue #4255 (Wave 2) — one row of four tabs and ONE filter bar above them
// (Owner, Show, Linked to, search) that filters every tab the same way
// (lib/workViews.js workFilter). Needs attention is a Show option and Agent
// activity sits at the foot of Today (D9). Today, This week and This month
// share one layout: per person, Done, Doing, Blocked and Waiting on a person,
// and every "+N more" opens up. A card opens in panel one; a host, creator,
// post, event or other card linked from it opens in panel two beside it
// (components/ui/PanelStack), so nothing typed in the card is lost.
import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Plus } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Drawer } from "../components/ui/Drawer";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { Tabs } from "../components/ui/Tabs";
import { FilterSelect } from "../components/ui/FilterSelect";
import { PanelLinksContext, PanelStack } from "../components/ui/PanelStack";
import { SidePanel } from "../components/panels/SidePanel";
import { SprintStrip } from "../components/ops/SprintStrip";
import { WorkColumns } from "../components/ops/WorkColumns";
import { WorkCardDrawer } from "../components/ops/WorkCardDrawer";
import { WorkAddForm } from "../components/ops/WorkAddForm";
import { PeriodView } from "../components/ops/WorkViews";
import { loadPeriod, loadToday } from "../components/ops/workToday";
import { DraftsPage } from "./DraftsPage";
import { useHashQuery } from "../hooks/useHashQuery";
import { usePanelStack } from "../hooks/usePanelStack";
import { useOnline } from "../hooks/useCrmPipeline";
import { useOpsPoll, useOpsWork } from "../hooks/useOpsWork";
import { useOpsConfig } from "../hooks/useOpsConfig";
import { usePeopleDirectory } from "../hooks/usePeopleDirectory";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import * as ops from "../services/opsService";
import * as drafts from "../services/draftService";
import { draftErrorWords } from "../lib/draftModel";
import { addDays, cardReasons, mondayOf, opsErrorWords, parseWorkSearch, todayIso } from "../lib/opsModel";
import { WORK_LINKED, WORK_SHOW, WORK_VIEWS, parseWorkView, periodWindow, splitDrafts, standupPeople, standupRows, standupText, workFilter } from "../lib/workViews";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
// Panel one is one of these at a time; opening one closes the others and panel two.
const FIRST_PANEL_KEYS = ["card", "add", "draft", "record", "drafts"];

/** The status counts of the cards on the board, for the sprint strip. */
function statusCounts(cards) {
  const out = { todo: 0, doing: 0, person: 0, done: 0 };
  for (const c of cards) if (Object.hasOwn(out, c.status)) out[c.status] += 1;
  return out;
}

export function WorkBoardPage() {
  const [search, setSearch] = useHashQuery("work-board");
  const query = useMemo(() => parseWorkSearch(search), [search]);
  const view = useMemo(() => parseWorkView(search), [search]);
  const stack = usePanelStack(search, setSearch);
  const online = useOnline();
  const { access } = useAuth();
  const { addToast } = useToast();
  const config = useOpsConfig();
  const people = usePeopleDirectory();
  const today = todayIso();
  // The old "Mine" (who=mine) is my own owner choice.
  const ownerFilter = view.owner || (new URLSearchParams(search).get("who") === "mine" ? people.me : null);
  const who = view.show === "watch" ? "watching" : "all";
  const onBoard = view.view === "board";
  const list = useOpsWork({ who, week: query.week, owner: ownerFilter, q: view.q, enabled: onBoard });
  const win = useMemo(() => (onBoard ? null : periodWindow(view.view)), [onBoard, view.view]);
  const period = useOpsPoll(() => loadPeriod(win, { owner: ownerFilter, who, q: view.q }), {
    key: `${access?.email || ""}|period|${view.view}|${win ? win.from.toISOString() : ""}|${ownerFilter || ""}|${who}|${view.q}`,
    intervalMs: view.view === "today" ? 60_000 : 120_000,
    enabled: !onBoard,
  });
  const thisWeek = mondayOf(today);
  // What is typed in the search box, until it is sent; a new address resets it.
  const [typing, setTyping] = useState({ q: view.q, text: view.q });
  const typed = typing.q === view.q ? typing.text : view.q;
  const setTyped = (text) => setTyping({ q: view.q, text });

  // My waiting message drafts: the ones no open card carries sit in Waiting
  // on a person on their own (they are mine, so only on my board).
  const showDrafts = onBoard && who === "all" && !view.show && !view.linked && (!ownerFilter || ownerFilter === people.me);
  const myDrafts = useOpsPoll(() => drafts.listDrafts({ state: "waiting", limit: 100 }), { key: `${access?.email || ""}|board-drafts`, intervalMs: 30_000, enabled: showDrafts });
  const refetchDrafts = myDrafts.refetch;
  useEffect(() => {
    const refresh = () => { refetchDrafts?.({ quiet: true }); };
    window.addEventListener("mingla:drafts-changed", refresh);
    return () => window.removeEventListener("mingla:drafts-changed", refresh);
  }, [refetchDrafts]);

  // One address for the page: change only what the patch names.
  const go = (patch, opts) => {
    const p = new URLSearchParams(search);
    for (const [k, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === false || value === "" || (k === "view" && value === "board")) p.delete(k);
      else p.set(k, value === true ? "1" : String(value));
    }
    // Old addresses are rewritten into the one filter bar the first time it changes.
    if (Object.hasOwn(patch, "view") || Object.hasOwn(patch, "show")) { p.delete("tab"); p.delete("att"); }
    if (Object.hasOwn(patch, "owner") || Object.hasOwn(patch, "show")) p.delete("who");
    // One panel one at a time; a new one starts without a panel two.
    if (FIRST_PANEL_KEYS.some((k) => patch[k])) {
      for (const k of FIRST_PANEL_KEYS) if (!Object.hasOwn(patch, k)) p.delete(k);
      p.delete("side");
    }
    setSearch(p.toString(), opts);
  };
  const filters = { owner: ownerFilter, show: view.show, linked: view.linked, q: view.q, me: people.me, today, reasonsOf: cardReasons };
  const setFilter = (patch) => go(patch, { replace: true });
  const filtersOn = !!(view.owner || view.show || view.linked || view.q || new URLSearchParams(search).get("who"));
  const clearFilters = () => { setTyped(""); go({ owner: null, show: null, linked: null, q: null, who: null }, { replace: true }); };

  const openCard = (id) => go({ card: id });
  const closeDrawer = () => {
    const id = query.card;
    go({ card: null, add: null, draft: null, record: null, drafts: null, side: null });
    if (id) requestAnimationFrame(() => document.querySelector(`[data-card-id="${id}"]`)?.focus?.());
  };

  const allCards = list.data?.cards || [];
  const cards = useMemo(() => workFilter(allCards, filters), [allCards, filters.owner, filters.show, filters.linked, filters.q, filters.me, filters.today]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodCards = useMemo(() => workFilter(period.data?.cards || [], filters), [period.data, filters.owner, filters.show, filters.linked, filters.q, filters.me, filters.today]); // eslint-disable-line react-hooks/exhaustive-deps
  // With Show or Linked to on, the strip counts the cards the board shows.
  const counts = view.show || view.linked ? statusCounts(cards) : list.data?.counts || {};
  const sprint = list.data?.sprint || config.data?.sprint?.current || { starts_on: query.week || thisWeek };
  const overdue = cards.filter((c) => c.overdue).length;
  const me = config.data?.me || {};
  const draftRows = Array.isArray(myDrafts.data?.drafts) ? myDrafts.data.drafts : [];
  const split = splitDrafts(showDrafts ? draftRows : [], cards);
  const qWords = view.q.trim().toLowerCase();
  const looseDrafts = split.loose.filter((d) => !qWords || String(d.record?.name || "").toLowerCase().includes(qWords));
  const team = people.people.filter((p) => !p.invited);

  const copyStandup = async () => {
    try {
      const data = await loadToday(ownerFilter);
      const rows = standupRows(standupPeople(people.people, ownerFilter), data.cards, data.standup?.by_person);
      await navigator.clipboard.writeText(standupText(rows));
      addToast({ variant: "success", title: "Standup copied.", description: "Paste it into the team chat." });
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t copy the standup", description: error?.token ? opsErrorWords(error) : "Your browser blocked copying. Open Today and copy it from there." });
    }
  };
  const refreshAll = () => { list.refetch({ quiet: true }); period.refetch({ quiet: true }); refetchDrafts?.({ quiet: true }); };

  const first = query.cardInvalid ? (
    <Drawer open onClose={closeDrawer} title="That card isn’t here">
      <Button variant="secondary" className="min-h-11" onClick={closeDrawer}>Back to Work</Button>
    </Drawer>
  ) : query.add ? (
    <Drawer open onClose={() => go({ add: null })} title="Add card">
      <WorkAddForm
        key="add"
        config={config.data}
        online={online}
        onCancel={() => go({ add: null })}
        onAdded={(card) => { refreshAll(); go({ add: null, card: card.id }); }}
        onOpenCard={(id) => id && go({ add: null, card: id })}
      />
    </Drawer>
  ) : view.draft || view.record || view.allDrafts ? (
    <Drawer open onClose={closeDrawer} title={view.allDrafts ? "All my message drafts" : view.record ? "Message drafts for this host or creator" : "Message draft"}>
      <DraftsPage key={view.draft || view.record || "all"} embedded={{ search: view.draft ? `draft=${view.draft}` : view.record ? `record=${view.record}` : "" }} />
    </Drawer>
  ) : query.card ? (
    <WorkCardDrawer cardId={query.card} config={config.data} online={online} onClose={closeDrawer} onChanged={refreshAll} />
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Work"
        description="Every piece of team work is a card. Filter once and every tab follows; open a card and anything linked to it opens beside it."
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="secondary" className="min-h-11" icon={ClipboardCopy} disabled={!online} onClick={copyStandup}>Copy standup</Button>
            <Button className="min-h-11" icon={Plus} disabled={!online} onClick={() => go({ add: true })}>Add card</Button>
          </div>
        }
      />
      {!online && <AlertCard variant="warning" title="You’re offline">You’re offline. You can read Work; adding and changes need a connection.</AlertCard>}

      {/* #4255: the one filter bar; it filters every tab. */}
      <div data-work-filters="" className="flex min-w-0 flex-wrap items-center gap-2">
        <form role="search" className="flex min-w-0 flex-1 basis-[200px] sm:max-w-[280px]" onSubmit={(e) => { e.preventDefault(); setFilter({ q: typed.trim().slice(0, 160) }); }}>
          <label className="sr-only" htmlFor="work-search">Search cards</label>
          <input id="work-search" type="search" value={typed} maxLength={160} placeholder="Search cards" onChange={(e) => { setTyped(e.target.value); if (!e.target.value) setFilter({ q: null }); }}
            onBlur={() => { if (typed.trim() !== view.q) setFilter({ q: typed.trim().slice(0, 160) }); }}
            className={`min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] ${FOCUS}`} />
        </form>
        <FilterSelect name="owner" label="Owner" value={ownerFilter || ""} onChange={(v) => setFilter({ owner: v || null })}
          options={[{ value: "", label: "Everyone" }, ...(people.me ? [{ value: people.me, label: "Me" }] : []), ...team.filter((p) => p.email !== people.me).map((p) => ({ value: p.email, label: p.name }))]} />
        <FilterSelect name="show" label="Show" value={view.show} options={WORK_SHOW} onChange={(v) => setFilter({ show: v || null })} />
        <FilterSelect name="linked" label="Linked to" value={view.linked} options={WORK_LINKED} onChange={(v) => setFilter({ linked: v || null })} />
        {filtersOn && <Button variant="ghost" className="min-h-11" onClick={clearFilters}>Clear filters</Button>}
      </div>

      <Tabs tabs={WORK_VIEWS.map((v) => ({ id: v.value, label: v.label }))} activeTab={view.view} onChange={(v) => go({ view: v }, { replace: true })} />

      <div role="tabpanel" id={`tabpanel-${view.view}`} aria-labelledby={`tab-${view.view}`} className="min-w-0">
        {onBoard ? (
          <div className="flex min-w-0 flex-col gap-3">
            <SprintStrip
              sprint={sprint}
              counts={counts}
              overdue={overdue}
              online={online}
              canEditGoal={!!me.can_override}
              isThisWeek={!query.week || query.week === thisWeek}
              onWeek={(d) => go({ week: addDays(query.week || thisWeek, d) === thisWeek ? null : addDays(query.week || thisWeek, d) }, { replace: true })}
              onThisWeek={() => go({ week: null }, { replace: true })}
              onGoal={async (goal) => {
                try { await ops.setSprintGoal(query.week || thisWeek, goal); await list.refetch({ quiet: true }); addToast({ variant: "success", title: "Sprint goal saved" }); }
                catch (error) { addToast({ variant: "error", title: "Goal not saved", description: opsErrorWords(error) }); }
              }}
            />
            {list.stale && <AlertCard variant="warning" title="The board may be out of date" action={<Button variant="secondary" className="min-h-11" onClick={() => list.refetch()}>Try again</Button>} />}
            {showDrafts && myDrafts.error && !myDrafts.data && <LoadError title="Couldn’t load your message drafts" message={draftErrorWords(myDrafts.error)} onRetry={() => myDrafts.refetch()} />}
            {list.loading ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading the board"><Skeleton height={160} /><Skeleton height={160} /><Skeleton height={160} /><Skeleton height={160} /></div>
            ) : list.error ? (
              <LoadError title="Couldn’t load the board" message={opsErrorWords(list.error)} onRetry={() => list.refetch()} />
            ) : cards.length === 0 && looseDrafts.length === 0 && !filtersOn && !query.week ? (
              <SectionCard><p className="text-[13px] text-[var(--color-text-secondary)]">No cards yet. Add one, or set a host’s next event on their card: its steps appear here by themselves.</p></SectionCard>
            ) : (
              <WorkColumns cards={cards}
                selectedId={query.card}
                onSelect={(card) => openCard(card.id)}
                drafts={looseDrafts}
                draftsByCard={split.byCard}
                selectedDraftId={view.draft}
                onOpenDraft={(d) => go({ draft: d.id })}
                allDraftsHref={showDrafts ? "#/work-board?drafts=all" : null}
              />
            )}
          </div>
        ) : (
          <PeriodView win={win} read={period} cards={periodCards} people={people.people} onOpenCard={openCard} />
        )}
      </div>

      <PanelLinksContext.Provider value={stack.links}>
        <PanelStack
          stack={stack}
          first={first}
          second={stack.side ? <SidePanel side={stack.side} onClose={stack.closeSide} onChanged={refreshAll} /> : null}
        />
      </PanelLinksContext.Provider>
    </div>
  );
}
