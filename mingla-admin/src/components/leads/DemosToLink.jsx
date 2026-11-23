// #4571 W4 — Demos to link (Admin › Leads, #/inbound; design tab 4). Every
// booked demo ends up on the right host card: a booking made from a card's own
// scheduler link links itself; the rest are listed here with Mingla's best
// guess (the viewer's own call first, then email, phone and venue name) and a
// person decides: Confirm, Pick another host, Create host card or Not a host.
// Also listed: host cards at Demo booked with no linked demo (moved by hand
// before the rule) and cards whose demo was cancelled. No email or phone is
// ever shown (the server never sends one).
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, Flag } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { useToast } from "../../context/ToastContext";
import { RecordPicker } from "../ops/RecordPicker";
import { localWhen } from "../../lib/opsModel";
import { errorWords } from "../../lib/crmModel";
import { buildCrmHash } from "../../lib/crmUrl";
import { demoCreateRecord, demoInbox, demoLink, demoNotAHost } from "../../services/crmService";
import { inboxView, reasonWords } from "./demoLinkModel";

const HOST_KIND = [{ value: "host", label: "Host" }];
const BOX = "flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4";
const H2 = "flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--color-text-primary)]";

function cardHref(id) {
  return buildCrmHash("hosts", { card: id });
}

function BookingRow({ b, busy, onAct }) {
  const [picking, setPicking] = useState(false);
  const top = Array.isArray(b.suggestions) ? b.suggestions : [];
  const first = top[0] || null;
  const off = busy === b.booking_id;
  return (
    <li data-demo-booking={b.booking_id} className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-words text-[14px] font-semibold text-[var(--color-text-primary)]">
          {b.venue || b.name}{b.venue && b.name ? <span className="font-normal text-[var(--color-text-secondary)]"> · {b.name}</span> : null}
        </span>
        <span className="whitespace-nowrap text-[12.5px] text-[var(--color-text-secondary)]">{localWhen(b.call_at)}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px]">
        {b.status === "moved" && <Badge variant="warning">Moved</Badge>}
        {first ? (
          <span data-demo-suggestion={first.reason}><Badge variant="info">{reasonWords(first)}: {first.name}</Badge></span>
        ) : (
          <Badge variant="error">No host card matches</Badge>
        )}
        {top.length > 1 && <span className="text-[var(--color-text-tertiary)]">{top.length - 1} more possible</span>}
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {first && (
          <Button size="sm" className="min-h-11" disabled={off} loading={off} onClick={() => onAct("confirm", b, first.record_id)}>
            Confirm: {first.name}
          </Button>
        )}
        {top.slice(1, 3).map((s) => (
          <Button key={s.record_id} variant="secondary" size="sm" className="min-h-11" disabled={off} title={reasonWords(s)}
            onClick={() => onAct("confirm", b, s.record_id)}>{s.name}</Button>
        ))}
        {!first && <Button size="sm" className="min-h-11" disabled={off} onClick={() => onAct("create", b)}>Create host card</Button>}
        <Button variant="ghost" size="sm" className="min-h-11" disabled={off} aria-expanded={picking} onClick={() => setPicking((p) => !p)}>Pick another host</Button>
        {first && <Button variant="ghost" size="sm" className="min-h-11" disabled={off} onClick={() => onAct("create", b)}>Create host card</Button>}
        <Button variant="ghost" size="sm" className="min-h-11" disabled={off} onClick={() => onAct("not_a_host", b)}>Not a host</Button>
      </div>
      {picking && (
        <RecordPicker kinds={HOST_KIND} onClose={() => setPicking(false)}
          onPick={(pick) => { setPicking(false); onAct("pick", b, pick.id); }} />
      )}
    </li>
  );
}

export function DemosToLink() {
  const { addToast } = useToast();
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [busy, setBusy] = useState("");
  const gen = useRef(0);

  const load = useCallback(async () => {
    const mine = ++gen.current;
    setState((s) => ({ ...s, status: s.data ? "refreshing" : "loading", error: null }));
    try {
      const data = await demoInbox();
      if (mine === gen.current) setState({ status: "ready", data, error: null });
    } catch (error) {
      if (mine === gen.current) setState((s) => ({ ...s, status: "error", error }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (what, b, recordId) => {
    setBusy(b.booking_id);
    try {
      if (what === "confirm" || what === "pick") {
        const res = await demoLink(b.booking_id, recordId, what === "pick" ? "picked" : "confirmed_suggestion");
        addToast({ variant: "success", title: `Linked to ${res?.record?.name || "the card"}. It can move to Demo booked now.` });
      } else if (what === "create") {
        const res = await demoCreateRecord(b.booking_id);
        addToast({ variant: "success", title: res?.status === "linked_existing"
          ? `${res?.record?.name || "That host"} already had a card, so the demo is linked there.`
          : `Made a host card for ${res?.record?.name || "them"} and linked the demo.` });
      } else {
        await demoNotAHost(b.booking_id);
        addToast({ variant: "success", title: "Marked as not a host. It is off this list." });
      }
      await load();
    } catch (err) {
      addToast({ variant: "error", title: "That didn't save", description: errorWords(err) });
    } finally {
      setBusy("");
    }
  }, [addToast, load]);

  if (state.status === "loading") {
    return <section aria-label="Demos to link" className={BOX}><Skeleton className="h-6 w-48" /><Skeleton className="h-16 w-full" /></section>;
  }
  if (state.status === "error") {
    return <section aria-label="Demos to link" className={BOX}><LoadError title="Couldn't load the booked demos" message={errorWords(state.error)} onRetry={load} /></section>;
  }
  const v = inboxView(state.data);
  return (
    <section aria-label="Demos to link" data-demos-to-link="" id="demos-to-link" className={BOX} aria-busy={state.status === "refreshing" || undefined}>
      <h2 className={H2}><Flag aria-hidden="true" className="h-4 w-4" />Demos to link <Badge variant={v.count ? "warning" : "success"}>{v.count}</Badge></h2>
      <p className="text-[12.5px] text-[var(--color-text-secondary)]">
        A demo booked through a host card&apos;s own link links itself. These came in another way. Linking one lets its card move to Demo booked.
      </p>
      {v.needsLinking.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-tertiary)]">Every booked demo is linked. Nothing to review.</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">{v.needsLinking.map((b) => <BookingRow key={b.booking_id} b={b} busy={busy} onAct={act} />)}</ul>
      )}
      {v.withoutDemo.length > 0 && (
        <div data-demos-without="" className="flex min-w-0 flex-col gap-1.5 border-t border-[var(--gray-200)] pt-3">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Demo booked without a linked demo · {v.withoutDemo.length}</h3>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">Moved to Demo booked by hand before the rule. Link their booking with Pick another host above, or send the card&apos;s scheduler link.</p>
          <ul className="flex min-w-0 flex-wrap gap-2">
            {v.withoutDemo.map((r) => <li key={r.record_id}><a className="inline-flex min-h-11 items-center rounded-lg border border-[var(--gray-200)] px-3 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--gray-50)]" href={cardHref(r.record_id)}>{r.name}</a></li>)}
          </ul>
        </div>
      )}
      {v.cancelled.length > 0 && (
        <div data-demos-cancelled="" className="flex min-w-0 flex-col gap-1.5 border-t border-[var(--gray-200)] pt-3">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Demos cancelled · {v.cancelled.length}</h3>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">The card stays where it is. Book a new demo from the card, or move it back.</p>
          <ul className="flex min-w-0 flex-col gap-1">
            {v.cancelled.map((c) => (
              <li key={c.booking_id} className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
                <CalendarCheck aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-error-700)]" />
                <a className="font-semibold text-[var(--color-brand-700)] hover:underline" href={cardHref(c.record_id)}>{c.record_name}</a>
                <span className="text-[var(--color-text-secondary)]">{c.status === "declined" ? "declined" : "cancelled"} · was {localWhen(c.call_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
