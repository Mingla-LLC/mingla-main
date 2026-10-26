// Issue #3980 (R7, R8) — Work: what needs doing, who's on it, and what's
// slipping. A card opens in the drawer over the page; Add card opens the add
// form in the same drawer.
//
// Issue #4130 (Wave 1) — four views: Board (default), Today (standup), This
// week and This month (reviews). The person chips filter every view on the
// server; the search box filters the board. Needs you is gone: its first
// column, Waiting on a person, holds the cards that wait on a person and the
// message drafts no card carries, and each opens its editor in the drawer
// (drafts, approvals, roadmap wording). Needs attention and Agent activity
// stay one click away.
import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Plus } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Drawer } from "../components/ui/Drawer";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { Segmented } from "../components/crm/fields";
import { SprintStrip } from "../components/ops/SprintStrip";
import { WorkColumns } from "../components/ops/WorkColumns";
import { WorkCardDrawer } from "../components/ops/WorkCardDrawer";
import { WorkAddForm } from "../components/ops/WorkAddForm";
import { AttentionChips, NeedsAttention } from "../components/ops/NeedsAttention";
import { AgentActivity } from "../components/ops/AgentActivity";
import { WorkMonth, WorkToday, WorkWeek } from "../components/ops/WorkViews";
import { loadToday } from "../components/ops/workToday";
import { DraftsPage } from "./DraftsPage";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { useOpsAttention, useOpsPoll, useOpsWork } from "../hooks/useOpsWork";
import { useOpsConfig } from "../hooks/useOpsConfig";
import { usePeopleDirectory } from "../hooks/usePeopleDirectory";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import * as ops from "../services/opsService";
import * as drafts from "../services/draftService";
import { draftErrorWords } from "../lib/draftModel";
import { addDays, attentionCounts, mondayOf, opsErrorWords, parseWorkSearch, parseWorkTab, todayIso } from "../lib/opsModel";
import { WORK_VIEWS, parseWorkView, splitDrafts, standupPeople, standupRows, standupText } from "../lib/workViews";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

function chipClass(pressed) {
  return `inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium ${pressed ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] font-semibold text-[var(--color-brand-700)]" : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]"} ${FOCUS}`;
}

/** Everyone, each teammate (with their open cards), and the cards I watch. */
function PersonChips({ people, owner, who, onPick }) {
  const team = people.filter((p) => !p.invited);
  return (
    <div role="group" aria-label="Filter by person" className="flex min-w-0 flex-wrap gap-1.5">
      <button type="button" aria-pressed={!owner && who === "all"} onClick={() => onPick({ owner: null, who: "all" })} className={chipClass(!owner && who === "all")}>Everyone</button>
      {team.map((p) => (
        <button key={p.email} type="button" title={p.email} aria-pressed={owner === p.email} onClick={() => onPick({ owner: p.email, who: "all" })} className={chipClass(owner === p.email)}>
          {p.name}{p.me ? " (you)" : ""}
          <span className="tabular-nums text-[var(--color-text-tertiary)]">{p.open}</span>
        </button>
      ))}
      <button type="button" aria-pressed={!owner && who === "watching"} onClick={() => onPick({ owner: null, who: "watching" })} className={chipClass(!owner && who === "watching")}>Cards I watch</button>
    </div>
  );
}

export function WorkBoardPage() {
  const [search, setSearch] = useHashQuery("work-board");
  const query = useMemo(() => parseWorkSearch(search), [search]);
  const tab = useMemo(() => parseWorkTab(search), [search]);
  const view = useMemo(() => parseWorkView(search), [search]);
  const online = useOnline();
  const { access } = useAuth();
  const { addToast } = useToast();
  const config = useOpsConfig();
  const people = usePeopleDirectory();
  const owner = view.owner;
  // The old "Mine" filter becomes my own chip.
  const who = query.who === "watching" ? "watching" : "all";
  const ownerFilter = owner || (query.who === "mine" ? people.me : null);
  const onBoard = view.view === "board" && tab.tab === "board";
  const list = useOpsWork({ who, week: query.week, owner: ownerFilter, q: view.q });
  const attention = useOpsAttention();
  const thisWeek = mondayOf(todayIso());
  // What is typed in the search box, until it is sent; a new address resets it.
  const [typing, setTyping] = useState({ q: view.q, text: view.q });
  const typed = typing.q === view.q ? typing.text : view.q;
  const setTyped = (text) => setTyping({ q: view.q, text });

  // My waiting message drafts: the ones no open card carries sit in Waiting
  // on a person on their own (they are mine, so only on my board).
  const showDrafts = onBoard && who === "all" && (!ownerFilter || ownerFilter === people.me);
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
      if (value === null || value === undefined || value === false || value === "" || (k === "view" && value === "board") || (k === "who" && value === "all") || (k === "tab" && value === "board")) p.delete(k);
      else p.set(k, value === true ? "1" : String(value));
    }
    if (patch.tab !== undefined && patch.tab !== "attention") p.delete("att");
    // A drawer at a time.
    if (patch.card || patch.add || patch.draft || patch.record || patch.drafts) {
      for (const k of ["card", "add", "draft", "record", "drafts"]) if (!Object.hasOwn(patch, k)) p.delete(k);
    }
    setSearch(p.toString(), opts);
  };
  const openCard = (id) => go({ card: id });
  const closeDrawer = () => {
    const id = query.card;
    go({ card: null, add: null, draft: null, record: null, drafts: null });
    if (id) requestAnimationFrame(() => document.querySelector(`[data-card-id="${id}"]`)?.focus?.());
  };

  const cards = list.data?.cards || [];
  const counts = list.data?.counts || {};
  const sprint = list.data?.sprint || config.data?.sprint?.current || { starts_on: query.week || thisWeek };
  const overdue = cards.filter((c) => c.overdue).length;
  const me = config.data?.me || {};
  const total = Object.values(attentionCounts(attention.data)).reduce((n, x) => n + x, 0);
  const draftRows = Array.isArray(myDrafts.data?.drafts) ? myDrafts.data.drafts : [];
  const split = splitDrafts(showDrafts ? draftRows : [], cards);
  const qWords = view.q.trim().toLowerCase();
  const looseDrafts = split.loose.filter((d) => !qWords || String(d.record?.name || "").toLowerCase().includes(qWords));

  const copyStandup = async () => {
    try {
      const data = await loadToday(owner);
      const rows = standupRows(standupPeople(people.people, owner), data.cards, data.standup?.by_person);
      await navigator.clipboard.writeText(standupText(rows));
      addToast({ variant: "success", title: "Standup copied.", description: "Paste it into the team chat." });
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t copy the standup", description: error?.token ? opsErrorWords(error) : "Your browser blocked copying. Open Today and copy it from there." });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Work"
        description="Every piece of team work is a card. Cards that wait on a person sit in the first column, with their drafts and approvals inside."
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="secondary" className="min-h-11" icon={ClipboardCopy} disabled={!online} onClick={copyStandup}>Copy standup</Button>
            <Button className="min-h-11" icon={Plus} disabled={!online} onClick={() => go({ add: true })}>Add card</Button>
          </div>
        }
      />
      {!online && <AlertCard variant="warning" title="You’re offline">You’re offline. You can read Work; adding and changes need a connection.</AlertCard>}

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Segmented label="Work view" wrap options={WORK_VIEWS} value={tab.tab === "board" ? view.view : null} onChange={(v) => go({ view: v, tab: "board" }, { replace: true })} />
          <button type="button" aria-pressed={tab.tab === "attention"} onClick={() => go({ tab: tab.tab === "attention" ? "board" : "attention" })} className={chipClass(tab.tab === "attention")}>
            Needs attention{attention.data ? <span className="tabular-nums">{total}</span> : null}
          </button>
          <button type="button" aria-pressed={tab.tab === "activity"} onClick={() => go({ tab: tab.tab === "activity" ? "board" : "activity" })} className={chipClass(tab.tab === "activity")}>Agent activity</button>
          {onBoard && (
            <form role="search" className="ml-auto flex min-w-0 flex-1 basis-[200px] sm:max-w-[260px]" onSubmit={(e) => { e.preventDefault(); go({ q: typed.trim().slice(0, 160) }, { replace: true }); }}>
              <label className="sr-only" htmlFor="work-search">Search cards</label>
              <input id="work-search" type="search" value={typed} maxLength={160} placeholder="Search cards" onChange={(e) => { setTyped(e.target.value); if (!e.target.value) go({ q: null }, { replace: true }); }}
                onBlur={() => { if (typed.trim() !== view.q) go({ q: typed.trim().slice(0, 160) }, { replace: true }); }}
                className={`min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] ${FOCUS}`} />
            </form>
          )}
        </div>
        {tab.tab === "board" && <PersonChips people={people.people} owner={ownerFilter} who={who} onPick={(patch) => go(patch, { replace: true })} />}
      </div>

      {tab.tab === "attention" ? (
        <NeedsAttention read={attention} group={tab.att} onGroup={(att) => go({ tab: "attention", att }, { replace: true })} me={people.me} online={online} onOpenCard={openCard} />
      ) : tab.tab === "activity" ? (
        <AgentActivity />
      ) : view.view === "today" ? (
        <WorkToday owner={ownerFilter} people={people.people} onOpenCard={openCard} />
      ) : view.view === "week" ? (
        <WorkWeek owner={ownerFilter} onOpenCard={openCard} />
      ) : view.view === "month" ? (
        <WorkMonth owner={ownerFilter} onOpenCard={openCard} />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {attention.data && total > 0 && <AttentionChips data={attention.data} onlyHot onPick={(att) => go({ tab: "attention", att })} />}
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
          ) : cards.length === 0 && looseDrafts.length === 0 && who === "all" && !ownerFilter && !query.week && !view.q ? (
            <SectionCard><p className="text-[13px] text-[var(--color-text-secondary)]">No cards yet. Add one, or set a host’s next event on their card: its steps appear here by themselves.</p></SectionCard>
          ) : (
            <WorkColumns
              cards={cards}
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
      )}

      {query.cardInvalid && (
        <Drawer open onClose={closeDrawer} title="That card isn’t here">
          <Button variant="secondary" className="min-h-11" onClick={closeDrawer}>Back to Work</Button>
        </Drawer>
      )}
      {query.add ? (
        <Drawer open onClose={() => go({ add: null })} title="Add card">
          <WorkAddForm
            key="add"
            config={config.data}
            online={online}
            onCancel={() => go({ add: null })}
            onAdded={(card) => { list.refetch({ quiet: true }); attention.refetch({ quiet: true }); go({ add: null, card: card.id }); }}
            onOpenCard={(id) => id && go({ add: null, card: id })}
          />
        </Drawer>
      ) : view.draft || view.record || view.allDrafts ? (
        <Drawer open onClose={closeDrawer} title={view.allDrafts ? "All my message drafts" : view.record ? "Message drafts for this host or creator" : "Message draft"}>
          <DraftsPage key={view.draft || view.record || "all"} embedded={{ search: view.draft ? `draft=${view.draft}` : view.record ? `record=${view.record}` : "" }} />
        </Drawer>
      ) : (
        <WorkCardDrawer cardId={query.card} config={config.data} online={online} onClose={closeDrawer} onChanged={() => { list.refetch({ quiet: true }); attention.refetch({ quiet: true }); refetchDrafts?.({ quiet: true }); }} />
      )}
    </div>
  );
}
