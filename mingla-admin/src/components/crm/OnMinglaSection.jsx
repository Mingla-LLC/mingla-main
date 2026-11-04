// Issue #3980 — "On Mingla" on a host card: what just happened by itself,
// then every upcoming dated thing with its plain state, and past events.
//
// Issue #4270 (Wave 2) — the block lists what the brand has on Mingla, read
// by itself: events, experiences and trips, each with its kind, and a trip
// or experience that is on right now ("Live now"). There is no form to add a
// promised event any more (D9): hosts create events in the Host app. A
// promised date already saved keeps Repeats and Cancel until it goes live or
// is cancelled. Needs attention and the owner moved to Status; "Work on this
// host" moved to To do (HostToDoSection); the brand shows once, under Brand
// and team. useHostOnMingla reads the host card's one server read for all
// three blocks.
import { useState } from "react";
import { Button } from "../ui/Button";
import { SideLink } from "../ui/PanelStack";
import { StatePill } from "../ops/StateDot";
import { JustHappened } from "../ops/JustHappened";
import { CONTROL_CLASS, Select } from "./fields";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import {
  EVENT_KIND_WORDS,
  REPEAT_OPTIONS,
  dayLong,
  expectedCancelledWords,
  expectedSavedWords,
  hostPastRows,
  hostUpcomingRows,
  opsErrorWords,
  requestKey,
  todayIso,
} from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const LABEL = "mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function calendarHref(kind, id, onDate) {
  const p = new URLSearchParams();
  p.set("event", `${kind}:${id}`);
  if (typeof onDate === "string" && onDate.length >= 7) p.set("month", onDate.slice(0, 7));
  return `#/content-calendar?${p.toString()}`;
}

export function OnMinglaSection({ record, read, online }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const id = record?.id;
  const state = read || { loading: true, data: null, error: null };
  const load = read?.retry || (() => {});

  const data = state.data;
  const today = todayIso();
  // #4270 W2 (C-3): what is on right now stays listed, however long ago it began.
  const events = (Array.isArray(data?.events) ? data.events : []).filter((e) => e.start_on && (e.start_on >= today || e.live));
  const expected = Array.isArray(data?.expected) ? data.expected : [];
  const open = expected.filter((x) => x.status === "open");
  const recent = expected.filter((x) => x.status === "fulfilled");
  const past = hostPastRows(data?.past, data?.events);
  const series = open.find((x) => x.repeats && x.repeats !== "none");
  const upcoming = hostUpcomingRows(events, open, today);
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

  // #3980 proof fix P2-2: a promised event changes how often it repeats in
  // place (the same row, the same history), never by cancelling it and adding
  // it again.
  const changeRepeats = async (x, repeats) => {
    if (!x || repeats === (x.repeats || "none")) return;
    setBusy(true);
    try {
      const result = await ops.setExpectedEvent({ record_id: id, id: x.id, repeats }, requestKey("web_expected_repeats"));
      addToast({ variant: "success", title: expectedSavedWords(result, repeats === "none" ? "Saved. It happens once now." : `Saved. It repeats every ${repeats}.`) });
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t change how often it repeats", description: opsErrorWords(error) });
    } finally { setBusy(false); }
  };

  const fid = (key) => `on-mingla-${id}-${key}`;

  return (
    <section aria-labelledby={`on-mingla-${id}`} data-host-section="on-mingla" className="flex min-w-0 flex-col gap-3">
      <JustHappened target={`host:${id}`} items={data?.changes} />

      <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3">
        <h3 id={`on-mingla-${id}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
          <span>On Mingla</span>
          {!state.loading && <span className="text-[12.5px] font-medium text-[var(--color-text-tertiary)]">{data?.brand ? "From the brand, automatic" : "Not on Mingla yet"}</span>}
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
              <p className="text-[13px] text-[var(--color-text-tertiary)]">No events, experiences or trips coming up. Hosts create them in the Host app.</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {upcoming.map((u) => (
                  <li key={u.key} className="min-w-0">
                    <SideLink side={{ kind: u.kind, id: u.id }} href={calendarHref(u.kind, u.id, u.on)} className={`flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border border-[var(--gray-200)] px-3 py-2 hover:bg-[var(--gray-50)] ${FOCUS}`}>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{u.title}</span>
                        <span className={`block text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>
                          <span data-event-kind={u.eventKind || "event"} className="font-semibold text-[var(--color-text-secondary)]">{EVENT_KIND_WORDS[u.eventKind] || "Event"}</span>
                          {" · "}{dayLong(u.on)}{u.repeats ? " · repeats" : ""}{u.moment ? " · promo moment" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {u.live && <span data-live-now="" className="rounded-full bg-[var(--color-success-50)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-success-700)]">Live now</span>}
                        {u.state && <StatePill state={u.state} />}
                      </span>
                    </SideLink>
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
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                        <label htmlFor={`${fid("row-repeats")}-${u.id}`} className="text-[12.5px] font-semibold text-[var(--color-text-secondary)]">Repeats</label>
                        <div className="w-44 max-w-full">
                          <Select
                            id={`${fid("row-repeats")}-${u.id}`}
                            className="min-h-11"
                            options={REPEAT_OPTIONS}
                            value={u.row.repeats || "none"}
                            disabled={busy || !online}
                            onChange={(e) => changeRepeats(u.row, e.target.value)}
                          />
                        </div>
                        <button type="button" disabled={!online || busy} onClick={() => { setCancelling(u.id); setCancelReason(""); }} className={`min-h-11 rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:opacity-50 ${FOCUS}`}>Cancel this promised event</button>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {(past.length > 0 || recent.length > 0) && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Past events</span>
                <ul className="flex min-w-0 flex-col gap-1">
                  {past.map((item) => (
                    <li key={`past-${item.id || item.title}`} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2">
                      <span className={`min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)] ${WORDS}`}>{item.title}</span>
                      <StatePill state={{ k: "done", name: "Happened" }} />
                    </li>
                  ))}
                  {recent.map((item) => (
                    <li key={`fulfilled-${item.id || item.title}`} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2">
                      <span className={`min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)] ${WORDS}`}>{item.title}</span>
                      <StatePill state={{ k: "done", name: "Happened" }} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {series && (
              <p className={`text-[12.5px] text-[var(--color-text-tertiary)] ${WORDS}`}>
                Repeats every {series.repeats === "week" ? "week" : "month"}{series.repeats === "week" ? ` on ${WEEKDAY[new Date(`${series.expected_on}T12:00:00Z`).getUTCDay()]}` : ""}. Mingla keeps the next 4 dates on the Calendar.
              </p>
            )}
          </>
        )}
      </div>

    </section>
  );
}
