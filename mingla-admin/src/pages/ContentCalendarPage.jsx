import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Segmented, CONTROL_CLASS } from "../components/crm/fields";
import { ContentCard } from "../components/contentCalendar/ContentCard";
import { ContentDrawer } from "../components/contentCalendar/ContentDrawer";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { useContentCalendar } from "../hooks/useContentCalendar";
import { useToast } from "../context/ToastContext";
import { CONTENT_STAGES, CONTENT_VIEWS, contentErrorWords, monthKey, monthWindow, movePrompt, requestKey } from "../lib/contentCalendarModel";
import * as service from "../services/contentCalendarService";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

function CalendarView({ items, month, open, reschedule }) {
  const window = monthWindow(month);
  const dayKey = (date) => monthKey(date) === month;
  const byDate = (date) => items.filter((item) => item.publish_at && new Date(item.publish_at).toDateString() === date.toDateString());
  const drop = (event, date) => { event.preventDefault(); const id = event.dataTransfer.getData("text/x-mingla-content-id"); const item = items.find((row) => row.id === id); if (item) reschedule(item, date); };
  const undated = items.filter((item) => !item.publish_at);
  return <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
    <SectionCard title="Unscheduled" subtitle={`${undated.length}`}><div className="space-y-2">{undated.length ? undated.map((item) => <ContentCard key={item.id} item={item} compact onOpen={open} draggable />) : <p className="text-sm text-[var(--color-text-secondary)]">Every card has a date.</p>}</div></SectionCard>
    <div className="overflow-x-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]"><div className="grid min-w-[700px] grid-cols-7 border-b border-[var(--gray-200)]">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => <div key={name} className="p-2 text-center text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{name}</div>)}</div><div className="grid min-w-[700px] grid-cols-7">{window.days.map((date) => <section key={date.toISOString()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, date)} aria-label={date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })} className={`min-h-32 border-b border-r border-[var(--gray-200)] p-1.5 ${dayKey(date) ? "" : "bg-[var(--gray-50)] opacity-70"}`}><p className="mb-1 text-xs font-semibold text-[var(--color-text-secondary)]">{date.getDate()}</p><div className="space-y-1">{byDate(date).map((item) => <ContentCard key={item.id} item={item} compact onOpen={open} draggable />)}</div></section>)}</div></div>
  </div>;
}

function BoardView({ items, open, move }) {
  return <div className="overflow-x-auto pb-2"><div className="grid min-w-[1280px] grid-cols-6 gap-3">{CONTENT_STAGES.map((stage) => <section key={stage.value} aria-labelledby={`content-stage-${stage.value}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const item = items.find((row) => row.id === event.dataTransfer.getData("text/x-mingla-content-id")); if (item && item.stage !== stage.value) move(item, stage.value); }} className="min-h-[320px] rounded-xl bg-[var(--gray-50)] p-2"><h2 id={`content-stage-${stage.value}`} className="mb-2 px-1 text-sm font-semibold text-[var(--color-text-primary)]">{stage.label} <span className="text-[var(--color-text-tertiary)]">{items.filter((item) => item.stage === stage.value).length}</span></h2><div className="space-y-2">{items.filter((item) => item.stage === stage.value).map((item) => <ContentCard key={item.id} item={item} onOpen={open} onMove={() => { const index = CONTENT_STAGES.findIndex((row) => row.value === item.stage); move(item, CONTENT_STAGES[index + 1]?.value); }} onStage={move} stages={CONTENT_STAGES} draggable />)}</div></section>)}</div></div>;
}

function ListView({ items, open }) {
  return <SectionCard noPadding><div className="divide-y divide-[var(--gray-200)]">{items.map((item) => <button key={item.id} type="button" onClick={() => open(item.id)} className={`grid min-h-14 w-full grid-cols-1 gap-1 px-4 py-3 text-left hover:bg-[var(--gray-50)] sm:grid-cols-[minmax(0,2fr)_1fr_1fr] sm:items-center ${FOCUS}`}><span className="font-semibold text-[var(--color-text-primary)]">{item.title}</span><span className="text-sm capitalize text-[var(--color-text-secondary)]">{item.stage}</span><span className="text-sm text-[var(--color-text-secondary)]">{item.publish_at ? new Date(item.publish_at).toLocaleString() : "Unscheduled"}</span></button>)}</div></SectionCard>;
}

export function ContentCalendarPage() {
  const [search, setSearch] = useHashQuery("content-calendar");
  const route = useMemo(() => { const p = new URLSearchParams(search); return { view: ["calendar", "board", "list"].includes(p.get("view")) ? p.get("view") : "calendar", month: /^\d{4}-(0[1-9]|1[0-2])$/.test(p.get("month") || "") ? p.get("month") : monthKey(), card: /^[0-9a-f-]{36}$/i.test(p.get("card") || "") ? p.get("card") : null, q: (p.get("q") || "").slice(0, 160) }; }, [search]);
  const query = useMemo(() => ({ ...(route.q ? { q: route.q } : {}), limit: 500 }), [route.q]);
  const calendar = useContentCalendar(query);
  const online = useOnline();
  const { addToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [move, setMove] = useState(null);
  const [busy, setBusy] = useState(false);

  const setParam = (name, value, replace = false) => { const p = new URLSearchParams(search); if (!value || (name === "view" && value === "calendar")) p.delete(name); else p.set(name, value); setSearch(p.toString(), { replace }); };
  const open = (id) => setParam("card", id);
  const close = () => { setDetail(null); setParam("card", null); };
  const loadDetail = async () => {
    if (!route.card) return;
    setDetailLoading(true);
    try { setDetail(await service.getContent(route.card)); } catch (error) { addToast({ variant: "error", title: "Couldn’t open that card", description: contentErrorWords(error) }); close(); }
    finally { setDetailLoading(false); }
  };
  useEffect(() => { if (route.card) loadDetail(); else setDetail(null); }, [route.card]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try { const answer = await service.createContent(title, requestKey("web_create")); calendar.replaceItem(answer.item); setTitle(""); setAddOpen(false); open(answer.item.id); }
    catch (error) { addToast({ variant: "error", title: "Couldn’t add content", description: contentErrorWords(error) }); }
    finally { setBusy(false); }
  };
  const beginMove = (item, to) => {
    if (!to || to === item.stage) return;
    const prompt = movePrompt(item, to);
    if (prompt) setMove({ item, to, prompt }); else performMove(item, to, {});
  };
  const changed = (item) => { calendar.replaceItem(item); setDetail((current) => current ? { ...current, item } : current); };
  const offerUndo = (answer, titleText) => addToast({ variant: "success", title: titleText, duration: 8000, action: { label: "Undo", onClick: async () => { const undone = await service.undoContent(answer.audit_id, answer.item.revision); changed(undone.item); await calendar.refetch({ quiet: true }); } } });
  const performMove = async (item, to, approvals) => {
    setBusy(true);
    try { const answer = await service.moveContent(item.id, to, item.revision, approvals, requestKey("web_move")); changed(answer.item); setMove(null); offerUndo(answer, `Moved to ${CONTENT_STAGES.find((stage) => stage.value === to)?.label || to}`); }
    catch (error) { addToast({ variant: "error", title: "Couldn’t move that card", description: contentErrorWords(error) }); }
    finally { setBusy(false); }
  };
  const reschedule = async (item, date) => {
    const next = new Date(date); const old = item.publish_at ? new Date(item.publish_at) : null;
    next.setHours(old && !Number.isNaN(old.getTime()) ? old.getHours() : 12, old && !Number.isNaN(old.getTime()) ? old.getMinutes() : 0, 0, 0);
    setBusy(true);
    try { const answer = await service.updateContent(item.id, { publish_at: next.toISOString() }, item.revision, requestKey("web_date")); changed(answer.item); offerUndo(answer, "Publish date moved"); }
    catch (error) { addToast({ variant: "error", title: "Couldn’t reschedule", description: contentErrorWords(error) }); }
    finally { setBusy(false); }
  };
  const shiftMonth = (by) => { const [year, month] = route.month.split("-").map(Number); setParam("month", monthKey(new Date(year, month - 1 + by, 1))); };

  const empty = calendar.loaded && !calendar.error && calendar.items.length === 0;
  return (
    <div className="flex min-w-0 flex-col gap-6">
    <PageHeader title="Content calendar" description="Plan, approve, schedule and publish together." actions={<Button type="button" variant="brandContrast" icon={Plus} className="min-h-11" disabled={!online} onClick={() => setAddOpen(true)}>Add content</Button>} tabs={<Segmented label="Content view" options={CONTENT_VIEWS} value={route.view} onChange={(view) => setParam("view", view)} variant="highContrast" fullWidth className="sm:w-fit" />} />
    {!online && <AlertCard variant="warning" title="You’re offline">You can read what is already here. Adding, saving, moving, commenting, deleting and Undo need a connection.</AlertCard>}
    {calendar.stale && <AlertCard variant="warning" title="Content may be out of date" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => calendar.refetch()}>Try again</Button>} />}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label className="relative block min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Search content</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-tertiary)]" aria-hidden="true" /><input className={`${CONTROL_CLASS} min-h-11 pl-9`} value={route.q} onChange={(event) => setParam("q", event.target.value, true)} placeholder="Search title, copy or notes" /></label>
      {route.view === "calendar" && <div className="flex items-center gap-1"><Button type="button" variant="secondary" icon={ChevronLeft} aria-label="Previous month" className="min-h-11 min-w-11" onClick={() => shiftMonth(-1)} /><Button type="button" variant="secondary" className="min-h-11" onClick={() => setParam("month", monthKey())}>Today</Button><span className="min-w-32 text-center text-sm font-semibold text-[var(--color-text-primary)]">{monthWindow(route.month).first.toLocaleDateString([], { month: "long", year: "numeric" })}</span><Button type="button" variant="secondary" icon={ChevronRight} aria-label="Next month" className="min-h-11 min-w-11" onClick={() => shiftMonth(1)} /></div>}
    </div>
    {calendar.loading ? <SectionCard><p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading content…</p></SectionCard> : calendar.error ? <AlertCard variant="error" title="Couldn’t load the content calendar" action={<Button type="button" variant="secondary" className="min-h-11" onClick={() => calendar.refetch()}>Try again</Button>}>{contentErrorWords(calendar.error)}</AlertCard> : empty ? <SectionCard><h2 className="text-base font-semibold text-[var(--color-text-primary)]">No content cards yet.</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Add a title to start in Idea.</p><Button type="button" variant="brandContrast" className="mt-4 min-h-11" disabled={!online} onClick={() => setAddOpen(true)}>Add content</Button></SectionCard> : route.view === "calendar" ? <CalendarView items={calendar.items} month={route.month} open={open} reschedule={reschedule} /> : route.view === "board" ? <BoardView items={calendar.items} open={open} move={beginMove} /> : <ListView items={calendar.items} open={open} />}

    <ContentDrawer detail={detail} config={calendar.config} online={online} loading={detailLoading} onClose={close} onChanged={changed} onMove={beginMove} onDeleted={calendar.removeItem} onReload={loadDetail} />
    <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add content" size="sm"><ModalBody><label htmlFor="new-content-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Title</label><input id="new-content-title" autoFocus className={`${CONTROL_CLASS} min-h-11`} value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") create(); }} /><p className="mt-2 text-sm text-[var(--color-text-secondary)]">It starts in Idea and is assigned to you.</p></ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" onClick={() => setAddOpen(false)}>Cancel</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={busy} disabled={!title.trim() || !online} onClick={create}>Add content</Button></ModalFooter></Modal>
    <Modal open={!!move} onClose={() => setMove(null)} title={move?.prompt?.title || "Move content"} size="sm"><ModalBody><p className="text-sm text-[var(--color-text-secondary)]">{move?.prompt?.flag === "approve_copy" ? "Confirm that the copy is ready for design." : move?.prompt?.flag === "approve_design" ? "Confirm that the design is ready and the publish time and channels are set." : "A stable live link is not on this card yet. You can add it first, or explicitly continue without one."}</p></ModalBody><ModalFooter><Button type="button" variant="secondary" className="min-h-11" onClick={() => setMove(null)}>{move?.prompt?.flag === "publish_without_link" ? "Add link first" : "Cancel"}</Button><Button type="button" variant="brandContrast" className="min-h-11" loading={busy} onClick={() => performMove(move.item, move.to, { [move.prompt.flag]: true })}>{move?.prompt?.action}</Button></ModalFooter></Modal>
    </div>
  );
}
