// Issue #3980 — the top of a host card, in the artifact's order: what just
// happened by itself, what needs attention (no owner, missing details) or
// who owns it, then "On Mingla": the brand link, every upcoming dated thing
// with its plain state (events, promised dates, repeating dates, promo
// moments), past events, the form to add their first, next or another
// event, and the work on this host. Steps and the Calendar fill in by
// themselves from what is saved here.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { FixesList } from "../ops/FixesList";
import { StatePill } from "../ops/StateDot";
import { JustHappened } from "../ops/JustHappened";
import { CONTROL_CLASS, Select } from "./fields";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import {
  EVENT_TYPE_LABELS,
  REPEAT_OPTIONS,
  dayLong,
  expectedCancelledWords,
  expectedSavedWords,
  hostMissing,
  hostUpcomingRows,
  opsErrorWords,
  requestKey,
  todayIso,
} from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const LABEL = "mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const EMPTY_FORM = { title: "", event_type: "event", expected_on: "", repeats: "none", city: "", note: "" };
const VENUE_ICPS = ["restaurant_bar", "venue_gallery"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function calendarHref(kind, id, onDate) {
  const p = new URLSearchParams();
  p.set("event", `${kind}:${id}`);
  if (typeof onDate === "string" && onDate.length >= 7) p.set("month", onDate.slice(0, 7));
  return `#/content-calendar?${p.toString()}`;
}

function workWords(card) {
  if (card.status === "person") return "Needs you";
  if (card.status === "doing") return "In progress";
  if (card.status === "done") return "Done";
  return "To do";
}

export function OnMinglaSection({ record, online, me, ownerNames = [], onAssignMe, onFillIn }) {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [fixes, setFixes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const seq = useRef(0);
  const id = record?.id;
  const brandId = record?.brand_id || "";
  const venue = VENUE_ICPS.includes(record?.icp);

  const load = useCallback(async () => {
    if (!id) return;
    const mine = ++seq.current;
    try {
      const data = await ops.fetchHostOnMingla(id, todayIso());
      if (mine === seq.current) setState({ loading: false, data, error: null });
    } catch (error) {
      if (mine === seq.current) setState((prev) => ({ loading: false, data: prev.data, error }));
    }
  }, [id]);
  useEffect(() => { setState({ loading: true, data: null, error: null }); load(); }, [load, brandId]);
  useEffect(() => { setForm((f) => ({ ...f, event_type: venue ? "promo_moment" : "event" })); }, [venue, id]);

  const data = state.data;
  const today = todayIso();
  const events = (Array.isArray(data?.events) ? data.events : []).filter((e) => e.start_on && e.start_on >= today);
  const expected = Array.isArray(data?.expected) ? data.expected : [];
  const open = expected.filter((x) => x.status === "open");
  const recent = expected.filter((x) => x.status === "fulfilled");
  const past = Array.isArray(data?.past) ? data.past : [];
  const work = Array.isArray(data?.work) ? data.work : [];
  const series = open.find((x) => x.repeats && x.repeats !== "none");
  const upcoming = hostUpcomingRows(events, open, today);
  const missing = hostMissing(record);
  const noOwner = !(record?.owners || []).length;
  const which = upcoming.length ? "another" : past.length || recent.length ? "their next" : "their first";

  const save = async () => {
    setBusy(true); setFixes([]);
    const item = { record_id: id, title: form.title.trim(), event_type: form.event_type, expected_on: form.expected_on, repeats: form.repeats };
    if (form.city.trim()) item.city = form.city.trim();
    if (form.note.trim()) item.note = form.note.trim();
    try {
      const result = await ops.setExpectedEvent(item, requestKey("web_expected"));
      addToast({ variant: "success", title: expectedSavedWords(result, "Saved. It’s on the Calendar and its steps are in Work.") });
      setForm({ ...EMPTY_FORM, event_type: venue ? "promo_moment" : "event" });
      await load();
    } catch (error) {
      if (Array.isArray(error?.fixes) && error.fixes.length) setFixes(error.fixes);
      else addToast({ variant: "error", title: "Couldn’t save it", description: opsErrorWords(error) });
    } finally { setBusy(false); }
  };
  const cancel = async (x) => {
    setBusy(true);
    try {
      const result = await ops.setExpectedEvent({ record_id: id, id: x.id, status: "cancelled", cancel_reason: cancelReason.trim() }, requestKey("web_expected_cancel"));
      addToast({ variant: "success", title: expectedCancelledWords(result) });
      setCancelling(null); setCancelReason("");
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t cancel it", description: opsErrorWords(error) });
    } finally { setBusy(false); }
  };

  const field = (key) => ({ value: form[key], onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })), disabled: busy || !online });
  const fid = (key) => `on-mingla-${id}-${key}`;
  const canSave = online && !busy && form.title.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(form.expected_on);
  const typeOptions = Object.entries(EVENT_TYPE_LABELS)
    .filter(([value]) => value !== "promo_moment" || venue)
    .map(([value, label]) => ({ value, label }));

  return (
    <section aria-labelledby={`on-mingla-${id}`} className="flex min-w-0 flex-col gap-3">
      <JustHappened target={`host:${id}`} items={data?.changes} />

      {noOwner || missing.length ? (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-[var(--color-error-50)] px-3 py-2.5 text-[13px]">
          <b className="text-[var(--color-error-700)]">Needs attention</b>
          {noOwner && (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="text-[var(--color-text-primary)]">No owner</span>
              {me && <Button variant="secondary" size="sm" className="min-h-11" disabled={!online} onClick={onAssignMe}>Assign to me</Button>}
            </div>
          )}
          {missing.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className={`text-[var(--color-text-primary)] ${WORDS}`}>Missing {missing.join(", ")}</span>
              <Button variant="secondary" size="sm" className="min-h-11" disabled={!online} onClick={() => onFillIn?.(missing[0])}>Fill in</Button>
            </div>
          )}
        </div>
      ) : (
        <p className={`text-[13px] text-[var(--color-text-tertiary)] ${WORDS}`}>Owner: {ownerNames.join(", ")}</p>
      )}

      <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3">
        <h3 id={`on-mingla-${id}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
          <span>On Mingla</span>
          {!state.loading && <span className="text-[12.5px] font-medium text-[var(--color-text-tertiary)]">{data?.brand ? "Brand linked" : "Not on Mingla yet"}</span>}
        </h3>
        {state.loading ? (
          <div role="status" className="flex flex-col gap-2"><span className="sr-only">Loading this host’s events…</span><div className="h-3 w-2/3 animate-pulse rounded bg-[var(--gray-100)]" /><div className="h-3 w-1/2 animate-pulse rounded bg-[var(--gray-100)]" /></div>
        ) : state.error && !data ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
            <span className={`min-w-0 ${WORDS}`}>Couldn’t load this host’s events. {opsErrorWords(state.error)}</span>
            <Button variant="secondary" size="sm" className="min-h-11" onClick={load}>Try again</Button>
          </div>
        ) : (
          <>
            {!data?.brand && <p className={`rounded-xl bg-[var(--gray-100)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] ${WORDS}`}>When they sign up with this email, phone or handle, Mingla links the brand by itself.</p>}
            {upcoming.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">No upcoming event.</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {upcoming.map((u) => (
                  <li key={u.key} className="min-w-0">
                    <a href={calendarHref(u.kind, u.id, u.on)} className={`flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-[var(--gray-200)] px-3 py-2 hover:bg-[var(--gray-50)] ${FOCUS}`}>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{u.title}</span>
                        <span className={`block text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>{dayLong(u.on)}{u.repeats ? " · repeats" : ""}{u.moment ? " · promo moment" : ""}</span>
                      </span>
                      <StatePill state={u.state} />
                    </a>
                    {u.row && (cancelling === u.id ? (
                      <div className="mt-1 flex min-w-0 flex-wrap items-end gap-2">
                        <label className="flex min-w-[12rem] flex-1 flex-col">
                          <span className={LABEL}>Why was it cancelled?</span>
                          <input value={cancelReason} maxLength={300} disabled={busy || !online} onChange={(e) => setCancelReason(e.target.value)} className={`${CONTROL_CLASS} min-h-11`} />
                        </label>
                        <Button variant="danger" className="min-h-11" disabled={busy || !online || cancelReason.trim().length < 3} onClick={() => cancel(u.row)}>Cancel it</Button>
                        <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => { setCancelling(null); setCancelReason(""); }}>Keep it</Button>
                      </div>
                    ) : (
                      <button type="button" disabled={!online || busy} onClick={() => { setCancelling(u.id); setCancelReason(""); }} className={`min-h-11 rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:opacity-50 ${FOCUS}`}>Cancel this promised event</button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {(past.length > 0 || recent.length > 0) && (
              <p className={`text-[12.5px] text-[var(--color-text-tertiary)] ${WORDS}`}>Past: {[...past.map((p) => p.title), ...recent.map((x) => `${x.title} (now on Mingla)`)].join(", ")}</p>
            )}
            {series && (
              <p className={`text-[12.5px] text-[var(--color-text-tertiary)] ${WORDS}`}>
                Repeats every {series.repeats === "week" ? "week" : "month"}{series.repeats === "week" ? ` on ${WEEKDAY[new Date(`${series.expected_on}T12:00:00Z`).getUTCDay()]}` : ""}. Mingla keeps the next 4 dates on the Calendar.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3">
        <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Add {which} {venue ? "event or promo moment" : "event"}</h4>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={fid("title")} className={LABEL}>What</label>
            <input id={fid("title")} maxLength={160} className={`${CONTROL_CLASS} min-h-11`} placeholder={venue ? "Detty December menu" : "Name of the event"} {...field("title")} />
          </div>
          <div>
            <label htmlFor={fid("date")} className={LABEL}>Date</label>
            <input id={fid("date")} type="date" min={today} className={`${CONTROL_CLASS} min-h-11`} {...field("expected_on")} />
          </div>
          <div>
            <label htmlFor={fid("repeats")} className={LABEL}>Repeats</label>
            <Select id={fid("repeats")} className="min-h-11" options={REPEAT_OPTIONS} {...field("repeats")} />
          </div>
          <div>
            <label htmlFor={fid("type")} className={LABEL}>Type</label>
            <Select id={fid("type")} className="min-h-11" options={typeOptions} {...field("event_type")} />
          </div>
          <div>
            <label htmlFor={fid("city")} className={LABEL}>City (optional)</label>
            <input id={fid("city")} maxLength={120} className={`${CONTROL_CLASS} min-h-11`} {...field("city")} />
          </div>
          <div>
            <label htmlFor={fid("note")} className={LABEL}>Note (optional)</label>
            <input id={fid("note")} maxLength={500} className={`${CONTROL_CLASS} min-h-11`} {...field("note")} />
          </div>
          {fixes.length > 0 && <div className="sm:col-span-2"><FixesList title={`Not saved: ${fixes.length} ${fixes.length === 1 ? "thing" : "things"} to fix`} fixes={fixes} /></div>}
          <div className="sm:col-span-2">
            <Button size="sm" className="min-h-11 max-w-full whitespace-normal text-left" loading={busy} disabled={!canSave} onClick={save}>Save. Steps and Calendar fill in by themselves</Button>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1 border-t border-[var(--gray-200)] pt-3">
        <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Work on this host</h4>
        {state.loading ? null : work.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">Nothing open.</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1">
            {work.map((c) => (
              <li key={c.id}>
                <a href={`#/work-board?card=${c.id}`} className={`flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--gray-50)] ${FOCUS}`} aria-label={`${c.title}: ${workWords(c)}. Open the card`}>
                  <span className={`min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)] ${WORDS}`}>{c.title}</span>
                  <span className="whitespace-nowrap text-[12.5px] text-[var(--color-text-tertiary)]">{workWords(c)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
