import { actorWord, gigEventWord, money, shortDateTime } from "../../lib/creatorPrograms";

// Issue #3872 — the shared contract timeline, in plain words: when, what, who.
// Amounts in an event's data are shown in the contract's currency, never as
// minor units.
function eventDetail(event, currency) {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  const amount = data.amount_minor ?? data.creator_fee_minor ?? data.refund_minor;
  const parts = [];
  if (amount != null && currency) parts.push(money(amount, currency));
  if (data.terms_version) parts.push(`Terms v${data.terms_version}`);
  if (data.round) parts.push(`Round ${data.round} of 2`);
  return parts.join(" · ");
}

export function GigTimeline({ events = [], currency = null }) {
  if (!events.length) return <p className="text-sm text-[var(--color-text-secondary)]">Nothing has happened on this deal yet.</p>;
  return (
    <ol className="divide-y divide-[var(--gray-200)] rounded-lg border border-[var(--gray-200)]" aria-label="Shared contract timeline">
      {events.map((event) => {
        const detail = eventDetail(event, currency);
        return (
          <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
            <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">{shortDateTime(event.at)}</span>
            <span className="text-right text-sm text-[var(--color-text-primary)]">
              {gigEventWord(event.kind)}
              {detail ? <span className="text-[var(--color-text-secondary)]"> · {detail}</span> : null}
              <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{actorWord(event.actor)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
