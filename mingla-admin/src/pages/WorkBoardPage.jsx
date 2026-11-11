// Issue #3980 (R7, R8) — Work: what needs doing, who's on it, and what's
// slipping.
//
// Issue #4130 (Wave 1) — Board (default), Today, This week and This month.
//
// Issue #4255 (Wave 2) — ONE filter bar that filters every tab the same way
// (lib/workViews.js workFilter). Needs attention is a Show option and Agent
// activity sits at the foot of Today (D9). A card opens in panel one; a host,
// creator, post, event or other card linked from it opens in panel two beside
// it (components/ui/PanelStack), so nothing typed in the card is lost.
//
// Issue #4255 (Work board v2, W2) — kanban only, rebuilt around the board:
//   * the header is ONE line: Work, the four tabs, search, Owner, Show and
//     Linked to as chips, the Show subtasks switch and + New card
//     (components/ops/WorkHeader); it never wraps;
//   * the sprint bar under it (components/ops/SprintBar): goals as pills that
//     filter the board, cards done of planned, hours against capacity, late,
//     and Plan sprint, which opens the planner as panel one at full width;
//   * columns are statuses (ops_status_*); admins add, rename, recolour,
//     reorder and archive them; cards drag between columns (ops_work_move,
//     always with the card's revision): the move shows at once, a conflict
//     (PT409) snaps it back and says so, a drop in a Closed column asks for
//     proof first, and every move offers Undo for 8 seconds.
// (W3) The card opens at 720px with a focus mode; its thread opens beside it.
import { useEffect, useMemo, useState } from "react";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { PanelLinksContext, PanelStack } from "../components/ui/PanelStack";
import { SidePanel } from "../components/panels/SidePanel";
import { SprintBar } from "../components/ops/SprintBar";
import { SprintPlanner } from "../components/ops/SprintPlanner";
import { WorkBoard } from "../components/ops/WorkBoard";
import { WorkHeader } from "../components/ops/WorkHeader";
import { ArchiveColumnDialog, CloseCardDialog } from "../components/ops/BoardDialogs";
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
import { useSprintPlan, useWorkStatuses } from "../hooks/useWorkBoard";
import { usePeopleDirectory } from "../hooks/usePeopleDirectory";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import * as ops from "../services/opsService";
import * as drafts from "../services/draftService";
import { draftErrorWords } from "../lib/draftModel";
import { addDays, cardReasons, mondayOf, opsErrorWords, parseWorkSearch, todayIso } from "../lib/opsModel";
import { canChangeColumns, liveColumns, moveErrorWords, moveLocally, planMove } from "../lib/workBoardModel";
import { parseWorkView, periodWindow, splitDrafts, standupPeople, standupRows, standupText, workFilter } from "../lib/workViews";

// Panel one is one of these at a time; opening one closes the others and panel two.
const FIRST_PANEL_KEYS = ["card", "add", "draft", "record", "drafts", "plan"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BOARD_LIMIT = 300;

export function WorkBoardPage() {
  const [search, setSearch] = useHashQuery("work-board");
  const query = useMemo(() => parseWorkSearch(search), [search]);
  const view = useMemo(() => parseWorkView(search), [search]);
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const showSubtasks = params.get("subs") === "1";
  const goalId = UUID_RE.test(params.get("goal") || "") ? params.get("goal").toLowerCase() : null;
  const focus = params.get("focus") === "1";
  const planning = params.get("plan") === "1";
  const addColumn = UUID_RE.test(params.get("addcol") || "") ? params.get("addcol") : null;
  const stack = usePanelStack(search, setSearch);
  const online = useOnline();
  const { access } = useAuth();
  const { addToast } = useToast();
  const config = useOpsConfig();
  const people = usePeopleDirectory();
  const today = todayIso();
  const ownerFilter = view.owner || (params.get("who") === "mine" ? people.me : null);
  const who = view.show === "watch" ? "watching" : "all";
  const onBoard = view.view === "board";
  const statuses = useWorkStatuses({ enabled: onBoard });
  const columns = useMemo(() => liveColumns(statuses.data?.columns || config.data?.columns || []), [statuses.data, config.data]);
  const canChange = canChangeColumns(statuses.data, config.data);
  const list = useOpsWork({ who, week: query.week, owner: ownerFilter, q: view.q, limit: BOARD_LIMIT, perStatus: true, subtasks: showSubtasks, goalId, enabled: onBoard });
  const win = useMemo(() => (onBoard ? null : periodWindow(view.view)), [onBoard, view.view]);
  const period = useOpsPoll(() => loadPeriod(win, { owner: ownerFilter, who, q: view.q }), {
    key: `${access?.email || ""}|period|${view.view}|${win ? win.from.toISOString() : ""}|${ownerFilter || ""}|${who}|${view.q}`,
    intervalMs: view.view === "today" ? 60_000 : 120_000,
    enabled: !onBoard,
  });
  const thisWeek = mondayOf(today);
  const isThisWeek = !query.week || query.week === thisWeek;
  const sprint = list.data?.sprint || config.data?.sprint?.current || { starts_on: query.week || thisWeek };
  // The current sprint's plan (goals, capacity, cards in it) for the bar; another week reads its own.
  const plan = useSprintPlan(isThisWeek ? null : sprint?.id, { enabled: onBoard && (isThisWeek || !!sprint?.id) });
  const [typing, setTyping] = useState({ q: view.q, text: view.q });
  const typed = typing.q === view.q ? typing.text : view.q;
  const setTyped = (text) => setTyping({ q: view.q, text });
  const [closing, setClosing] = useState(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [archiving, setArchiving] = useState(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  // My waiting message drafts that no open card carries sit at the top of the first Not started column.
  const showDrafts = onBoard && who === "all" && !view.show && !view.linked && !goalId && (!ownerFilter || ownerFilter === people.me);
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
    if (Object.hasOwn(patch, "view") || Object.hasOwn(patch, "show")) { p.delete("tab"); p.delete("att"); }
    if (Object.hasOwn(patch, "owner") || Object.hasOwn(patch, "show")) p.delete("who");
    if (FIRST_PANEL_KEYS.some((k) => patch[k])) {
      for (const k of FIRST_PANEL_KEYS) if (!Object.hasOwn(patch, k)) p.delete(k);
      p.delete("side");
      if (!patch.card) p.delete("focus");
    }
    setSearch(p.toString(), opts);
  };
  const isAdmin = !!config.data?.me?.can_override;
  const filters = { owner: ownerFilter, show: view.show, linked: view.linked, q: view.q, me: people.me, today, reasonsOf: cardReasons, isAdmin };
  const setFilter = (patch) => go(patch, { replace: true });
  const filtersOn = !!(view.owner || view.show || view.linked || view.q || params.get("who"));
  const clearFilters = () => { setTyped(""); go({ owner: null, show: null, linked: null, q: null, who: null }, { replace: true }); };

  const openCard = (id) => go({ card: id });
  const closeDrawer = () => {
    const id = query.card;
    go({ card: null, add: null, draft: null, record: null, drafts: null, plan: null, side: null, focus: null, addcol: null });
    if (id) requestAnimationFrame(() => document.querySelector(`[data-card-id="${id}"]`)?.focus?.());
  };

  const allCards = list.data?.cards || [];
  const cards = useMemo(() => workFilter(allCards, filters), [allCards, filters.owner, filters.show, filters.linked, filters.q, filters.me, filters.today, filters.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodCards = useMemo(() => workFilter(period.data?.cards || [], filters), [period.data, filters.owner, filters.show, filters.linked, filters.q, filters.me, filters.today, filters.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  const late = cards.filter((c) => c.overdue).length;
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
  const refreshAll = () => { list.refetch({ quiet: true }); period.refetch({ quiet: true }); plan.refetch({ quiet: true }); refetchDrafts?.({ quiet: true }); };

  // ---- Moving cards ---------------------------------------------------------
  const offerUndo = (answer, title) => {
    const eventId = answer?.event_id;
    if (!eventId) { addToast({ variant: "success", title }); return; }
    addToast({ variant: "success", title, duration: 8000, action: { label: "Undo", onClick: async () => {
      try { await ops.undoWork(eventId); refreshAll(); addToast({ variant: "success", title: "Undone." }); }
      catch (error) { addToast({ variant: "error", title: "Undo didn’t work", description: opsErrorWords(error) }); }
    } } });
  };
  const runMove = async (card, to, extra) => {
    const before = list.data;
    list.setData((prev) => (prev ? { ...prev, cards: moveLocally(prev.cards, card.id, to) } : prev));
    try {
      const answer = await ops.moveWork(card.id, to.id, card.revision, extra);
      offerUndo(answer, `Moved to ${to.name}`);
      refreshAll();
      return true;
    } catch (error) {
      list.setData(before);
      if (error?.token === "stale_write") addToast({ variant: "warning", title: moveErrorWords(error, opsErrorWords) });
      else addToast({ variant: "error", title: `Couldn’t move card ${card.number}`, description: opsErrorWords(error) });
      list.refetch({ quiet: true });
      return false;
    }
  };
  const onMoveCard = (card, to) => {
    const what = planMove(card, to);
    if (what.kind === "close") setClosing({ card, column: to });
    else if (what.kind === "move") runMove(card, to);
  };

  // ---- Columns (admins) ------------------------------------------------------
  const columnCall = async (task, success) => {
    try {
      await task();
      await Promise.all([statuses.refetch({ quiet: true }), list.refetch({ quiet: true })]);
      if (success) addToast({ variant: "success", title: success });
      return true;
    } catch (error) {
      if (error?.token === "stale_write") { addToast({ variant: "warning", title: "The columns changed. Showing the latest." }); statuses.refetch({ quiet: true }); }
      else addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) });
      return false;
    }
  };
  const columnActions = {
    add: ({ name, grp, color }) => columnCall(() => ops.addStatus(name, color, grp), `Column “${name}” added. Drag its header to move it.`),
    rename: (col, name) => columnCall(() => ops.updateStatus(col.id, { name }, col.revision), "Column renamed"),
    recolour: (col, color) => columnCall(() => ops.updateStatus(col.id, { color }, col.revision), "Colour changed"),
    move: (col, position) => columnCall(() => ops.moveStatus(col.id, position, col.revision), `${col.name} moved`),
    archive: (col) => setArchiving(col),
  };

  const first = query.cardInvalid ? (
    <Drawer open onClose={closeDrawer} title="That card isn’t here">
      <Button variant="secondary" className="min-h-11" onClick={closeDrawer}>Back to Work</Button>
    </Drawer>
  ) : planning ? (
    <SprintPlanner sprintId={isThisWeek ? null : sprint?.id} team={people.people} online={online} onClose={() => go({ plan: null })} onChanged={refreshAll} />
  ) : query.add ? (
    <Drawer open onClose={() => go({ add: null, addcol: null })} title="Add card">
      <WorkAddForm
        key="add"
        config={config.data}
        online={online}
        onCancel={() => go({ add: null, addcol: null })}
        onAdded={(card) => {
          const to = columns.find((c) => c.id === addColumn);
          go({ add: null, addcol: null, card: card.id });
          if (to && card && card.status_id !== to.id) onMoveCard(card, to);
          else refreshAll();
        }}
        onOpenCard={(id) => id && go({ add: null, addcol: null, card: id })}
      />
    </Drawer>
  ) : view.draft || view.record || view.allDrafts ? (
    <Drawer open onClose={closeDrawer} title={view.allDrafts ? "All my message drafts" : view.record ? "Message drafts for this host or creator" : "Message draft"}>
      <DraftsPage key={view.draft || view.record || "all"} embedded={{ search: view.draft ? `draft=${view.draft}` : view.record ? `record=${view.record}` : "" }} />
    </Drawer>
  ) : query.card ? (
    <WorkCardDrawer cardId={query.card} config={config.data} online={online} onClose={closeDrawer} onChanged={refreshAll}
      focus={focus} onFocus={(on) => go({ focus: on ? true : null }, { replace: true })} onOpenCard={(id) => go({ card: id })} columns={columns} />
  ) : null;
  const firstSize = planning || (query.card && focus) ? "full" : query.card ? "card" : "default";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <WorkHeader
        view={view.view}
        onView={(v) => go({ view: v }, { replace: true })}
        typed={typed}
        onTyped={setTyped}
        onSearch={(q) => { if (q !== view.q) setFilter({ q: q || null }); }}
        ownerOptions={[{ value: "", label: "Everyone" }, ...(people.me ? [{ value: people.me, label: "Me" }] : []), ...team.filter((p) => p.email !== people.me).map((p) => ({ value: p.email, label: p.name }))]}
        owner={ownerFilter}
        onOwner={(v) => setFilter({ owner: v })}
        show={view.show}
        onShow={(v) => setFilter({ show: v })}
        linked={view.linked}
        onLinked={(v) => setFilter({ linked: v })}
        onClear={clearFilters}
        filtersOn={filtersOn}
        showSubtasks={showSubtasks}
        onToggleSubtasks={() => setFilter({ subs: showSubtasks ? null : true })}
        onNewCard={() => go({ add: true })}
        onCopyStandup={copyStandup}
        online={online}
      />
      {!online && <AlertCard variant="warning" title="You’re offline">You’re offline. You can read Work; adding and changes need a connection.</AlertCard>}

      <div role="tabpanel" id={`tabpanel-${view.view}`} aria-labelledby={`tab-${view.view}`} className="min-w-0">
        {onBoard ? (
          <div className="flex min-w-0 flex-col gap-2">
            <SprintBar
              sprint={sprint}
              plan={plan.data && (isThisWeek || plan.data?.sprint?.starts_on === sprint?.starts_on) ? plan.data : null}
              today={today}
              late={late}
              goalId={goalId}
              online={online}
              isThisWeek={isThisWeek}
              onGoal={(id) => setFilter({ goal: id })}
              onWeek={(d) => go({ week: addDays(query.week || thisWeek, d) === thisWeek ? null : addDays(query.week || thisWeek, d), goal: null }, { replace: true })}
              onThisWeek={() => go({ week: null, goal: null }, { replace: true })}
              onPlan={() => go({ plan: true })}
            />
            {list.stale && <AlertCard variant="warning" title="The board may be out of date" action={<Button variant="secondary" className="min-h-11" onClick={() => list.refetch()}>Try again</Button>} />}
            {showDrafts && myDrafts.error && !myDrafts.data && <LoadError title="Couldn’t load your message drafts" message={draftErrorWords(myDrafts.error)} onRetry={() => myDrafts.refetch()} />}
            {list.loading || (statuses.loading && !columns.length) ? (
              <div className="flex gap-2.5 overflow-hidden" aria-busy="true" aria-label="Loading the board"><div className="w-[280px] shrink-0"><Skeleton height={320} /></div><div className="w-[280px] shrink-0"><Skeleton height={320} /></div><div className="hidden w-[280px] shrink-0 md:block"><Skeleton height={320} /></div></div>
            ) : list.error ? (
              <LoadError title="Couldn’t load the board" message={opsErrorWords(list.error)} onRetry={() => list.refetch()} />
            ) : statuses.error && !columns.length ? (
              <LoadError title="Couldn’t load the board’s columns" message={opsErrorWords(statuses.error)} onRetry={() => statuses.refetch()} />
            ) : cards.length === 0 && looseDrafts.length === 0 && !filtersOn && !query.week && !goalId && columns.length === 0 ? (
              <SectionCard><p className="text-[13px] text-[var(--color-text-secondary)]">No cards yet. Add one, or set a host’s next event on their card: its steps appear here by themselves.</p></SectionCard>
            ) : (
              <WorkBoard
                columns={columns}
                cards={cards}
                info={view.show || view.linked ? null : list.data?.status_columns || null}
                today={today}
                selectedId={query.card}
                onSelect={(card) => openCard(card.id)}
                canChange={canChange}
                online={online}
                onMoveCard={onMoveCard}
                onAddCard={(col) => go({ add: true, addcol: col.id })}
                columnActions={columnActions}
                drafts={looseDrafts}
                selectedDraftId={view.draft}
                onOpenDraft={(d) => go({ draft: d.id })}
              />
            )}
          </div>
        ) : (
          <PeriodView win={win} read={period} cards={periodCards} people={people.people} onOpenCard={openCard} />
        )}
      </div>

      {closing && (
        <CloseCardDialog card={closing.card} column={closing.column} busy={closeBusy}
          onCancel={() => setClosing(null)}
          onClose={async (proof, result, children) => {
            setCloseBusy(true);
            const ok = await runMove(closing.card, closing.column, { proof, result, closeChildren: children });
            setCloseBusy(false);
            if (ok) setClosing(null);
          }} />
      )}
      {archiving && (
        <ArchiveColumnDialog column={archiving} columns={columns} busy={archiveBusy}
          onCancel={() => setArchiving(null)}
          onArchive={async (to) => {
            setArchiveBusy(true);
            const ok = await columnCall(() => ops.archiveStatus(archiving.id, to, archiving.revision), `Column “${archiving.name}” archived`);
            setArchiveBusy(false);
            if (ok) setArchiving(null);
          }} />
      )}

      <PanelLinksContext.Provider value={stack.links}>
        <PanelStack
          stack={stack}
          first={first}
          firstSize={firstSize}
          second={stack.side ? <SidePanel side={stack.side} onClose={stack.closeSide} onChanged={refreshAll} /> : null}
        />
      </PanelLinksContext.Provider>
    </div>
  );
}
