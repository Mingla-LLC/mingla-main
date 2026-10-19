// Issue #3980 — on a host card: the linked brand's events on Mingla with
// their runway, the next event the host has promised (it shows dashed on the
// Calendar until it is public), and the open work cards for this host.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { OpsChip } from "../ops/OpsChip";
import { FixesList } from "../ops/FixesList";
import { CONTROL_CLASS, Select } from "./fields";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import {
  EVENT_TYPE_LABELS,
  WORK_STATUSES,
  bandShort,
  bandTone,
  dayLabel,
  opsErrorWords,
  requestKey,
  todayIso,
} from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const LABEL = "mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const LINK = `inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`;
const EMPTY_FORM = { title: "", event_type: "event", expected_on: "", city: "", note: "" };

function calendarHref(kind, id, onDate) {
  const p = new URLSearchParams();
  p.set("event", `${kind}:${id}`);
  if (typeof onDate === "string" && onDate.length >= 7) p.set("month", onDate.slice(0, 7));
  return `#/content-calendar?${p.toString()}`;
}

export function OnMinglaSection({ record, online }) {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [fixes, setFixes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const seq = useRef(0);
  const id = record?.id;
  const brandId = record?.brand_id || "";

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

  const data = state.data;
  const events = Array.isArray(data?.events) ? data.events : [];
  const expected = Array.isArray(data?.expected) ? data.expected : [];
  const open = expected.filter((x) => x.status === "open");
  const recent = expected.filter((x) => x.status === "fulfilled");
  const cards = Array.isArray(data?.cards) ? data.cards : [];
  const showForm = adding || (!state.loading && open.length === 0);

  const save = async () => {
    setBusy(true); setFixes([]);
    const item = { record_id: id, title: form.title.trim(), event_type: form.event_type, expected_on: form.expected_on };
    if (form.city.trim()) item.city = form.city.trim();
    if (form.note.trim()) item.note = form.note.trim();
    try {
      await ops.setExpectedEvent(item, requestKey("web_expected"));
      addToast({ variant: "success", title: "Expected event saved", description: "It shows dashed on the Calendar until it is public." });
      setForm(EMPTY_FORM); setAdding(false);
      await load();
    } catch (error) {
      if (Array.isArray(error?.fixes) && error.fixes.length) setFixes(error.fixes);
      else addToast({ variant: "error", title: "Couldn’t save the expected event", description: opsErrorWords(error) });
    } finally { setBusy(false); }
  };
  const cancel = async (x) => {
    setBusy(true);
    try {
      await ops.setExpectedEvent({ record_id: id, id: x.id, status: "cancelled", cancel_reason: cancelReason.trim() }, requestKey("web_expected_cancel"));
      addToast({ variant: "success", title: "Expected event cancelled" });
      setCancelling(null); setCancelReason("");
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t cancel it", description: opsErrorWords(error) });
    } finally { setBusy(false); }
  };

  const field = (key) => ({ value: form[key], onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })), disabled: busy || !online });
  const fid = (key) => `on-mingla-${id}-${key}`;
  const canSave = online && !busy && form.title.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(form.expected_on);

  return (
    <section aria-labelledby={`on-mingla-${id}`} className="flex min-w-0 flex-col gap-3 border-t border-[var(--gray-200)] pt-4">
      <h3 id={`on-mingla-${id}`} className="flex items-center gap-2 text-[14px] font-semibold text-[var(--color-text-primary)]">
        On Mingla <OpsChip tone="brand">New</OpsChip>
      </h3>

      {state.loading ? (
        <div role="status" className="flex flex-col gap-2"><span className="sr-only">Loading this host’s events…</span><div className="h-3 w-2/3 animate-pulse rounded bg-[var(--gray-100)]" /><div className="h-3 w-1/2 animate-pulse rounded bg-[var(--gray-100)]" /></div>
      ) : state.error && !data ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
          <span className="min-w-0 break-words">Couldn’t load this host’s events. {opsErrorWords(state.error)}</span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={load}>Try again</Button>
        </div>
      ) : (
        <>
          {!data?.brand ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">Link the brand above to see its events.</p>
          ) : events.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No events on Mingla yet.</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-1">
              {events.map((e) => (
                <li key={e.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-[13px] text-[var(--color-text-primary)]">{e.title} · {dayLabel(e.start_on)}{e.is_public ? "" : " · not public yet"}</span>
                  <a href={calendarHref("event", e.id, e.start_on)} aria-label={`${e.title}: ${bandShort(e.runway)}. Open on the Calendar`} className={`inline-flex min-h-11 items-center rounded-lg ${FOCUS}`}>
                    <OpsChip tone={bandTone(e.runway?.band)} dashed={e.runway?.band === "missed"}>{bandShort(e.runway)}</OpsChip>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <div className="flex min-w-0 flex-col gap-2">
            <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Expected next event</h4>
            {open.map((x) => (
              <div key={x.id} className="flex min-w-0 flex-col gap-2 rounded-lg border-[1.5px] border-dashed border-[var(--gray-400)] p-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-[13px] font-semibold text-[var(--color-text-primary)]">{x.title} · {EVENT_TYPE_LABELS[x.event_type] || "Event"} · {dayLabel(x.expected_on)}{x.city ? ` · ${x.city}` : ""}</span>
                  <a href={calendarHref("expected", x.id, x.expected_on)} className={LINK}>See it on the Calendar</a>
                </div>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  {x.runway?.band === "missed"
                    ? "It can no longer go public 21 days ahead: organic only, no giveaway or ads."
                    : `Must be public by ${dayLabel(x.runway?.go_live_by)} for the giveaway and ads. Until then it shows dashed on the Calendar.`}
                </p>
                {x.note && <p className="break-words text-[12.5px] text-[var(--color-text-tertiary)]">{x.note}</p>}
                {cancelling === x.id ? (
                  <div className="flex min-w-0 flex-wrap items-end gap-2">
                    <label className="flex min-w-[200px] flex-1 flex-col">
                      <span className={LABEL}>Why was it cancelled?</span>
                      <input value={cancelReason} maxLength={300} disabled={busy || !online} onChange={(e) => setCancelReason(e.target.value)} className={`${CONTROL_CLASS} min-h-11`} />
                    </label>
                    <Button variant="danger" className="min-h-11" disabled={busy || !online || cancelReason.trim().length < 3} onClick={() => cancel(x)}>Cancel it</Button>
                    <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => { setCancelling(null); setCancelReason(""); }}>Keep it</Button>
                  </div>
                ) : (
                  <Button variant="secondary" size="sm" className="min-h-11 self-start" disabled={!online || busy} onClick={() => { setCancelling(x.id); setCancelReason(""); }}>Cancel expected event</Button>
                )}
              </div>
            ))}
            {recent.map((x) => (
              <p key={x.id} className="break-words text-[12.5px] text-[var(--color-text-tertiary)]">Now on Mingla: {x.title} ({dayLabel(x.expected_on)}).</p>
            ))}
            {showForm ? (
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor={fid("title")} className={LABEL}>Title</label>
                  <input id={fid("title")} maxLength={160} className={`${CONTROL_CLASS} min-h-11`} placeholder="What the host promised" {...field("title")} />
                </div>
                <div>
                  <label htmlFor={fid("type")} className={LABEL}>Type</label>
                  <Select id={fid("type")} className="min-h-11" options={Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} {...field("event_type")} />
                </div>
                <div>
                  <label htmlFor={fid("date")} className={LABEL}>Date</label>
                  <input id={fid("date")} type="date" min={todayIso()} className={`${CONTROL_CLASS} min-h-11`} {...field("expected_on")} />
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
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <Button className="min-h-11" loading={busy} disabled={!canSave} onClick={save}>Save</Button>
                  {open.length > 0 && <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => { setAdding(false); setForm(EMPTY_FORM); setFixes([]); }}>Close</Button>}
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="min-h-11 self-start" disabled={!online} onClick={() => setAdding(true)}>Add another expected event</Button>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Work on this host</h4>
            {cards.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-secondary)]">No open work. Ask your agent to plan the next launch.</p>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {cards.map((c) => (
                  <li key={c.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-[13px] text-[var(--color-text-primary)]">{c.title}</span>
                    <a href={`#/work-board?card=${c.id}`} className={`inline-flex min-h-11 items-center rounded-lg ${FOCUS}`} aria-label={`${c.title}: open on the Work board`}>
                      <OpsChip tone={c.blocked ? "error" : c.status === "person" ? "warning" : "brand"}>{c.blocked ? "Blocked" : WORK_STATUSES.find((s) => s.value === c.status)?.label || c.status}</OpsChip>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
