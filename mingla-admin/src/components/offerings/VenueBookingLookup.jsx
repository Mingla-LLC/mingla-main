// #4490 P4-3 — request disputes in the Offerings console's "Venue offers" view:
// paste a guest's booking link (or the booking id) and see one venue booking —
// its state, the venue and offer, money (total, paid, refunded), the terms
// saved on it, the space claims and the full timeline. A request or an
// approved hold not yet paid can be ended ("Force expire hold"), with a reason
// that goes to the admin audit log. Read-only otherwise.
import { useState } from "react";
import { Search } from "lucide-react";
import { HighRiskActionModal } from "../entity/HighRiskActionModal";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { forceExpireVenueHold, getAdminVenueBooking } from "../../services/venueOffersAdminService";
import {
  bookingIdFromInput,
  bookingStateLabel,
  canForceExpire,
  ladderWords,
  timelineLabel,
  venueOfferKindLabel,
} from "../../lib/venueOffersAdmin";
import { formatDateTime } from "../../lib/formatters";

function moneyWords(minor, currency) {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "–";
  const code = typeof currency === "string" && currency.length === 3 ? currency : "NGN";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
}

export function VenueBookingLookup() {
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(null);
  const [expireOpen, setExpireOpen] = useState(false);

  const lookUp = async (idOverride) => {
    const id = idOverride ?? bookingIdFromInput(text);
    if (!id) {
      setError("Paste the guest's booking link (it contains /visit/…) or the booking id.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBooking(await getAdminVenueBooking(id));
    } catch (e) {
      setBooking(null);
      setError(e instanceof Error ? e.message : "That didn't load. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const st = booking ? bookingStateLabel(booking.state) : null;
  const snapshot = booking?.policySnapshot ?? null;
  const hire = booking?.hire ?? null;

  return (
    <SectionCard title="Look up a venue booking" subtitle="For request and deposit disputes. Paste the guest's booking link or the booking id.">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void lookUp();
        }}
      >
        <div className="flex-1">
          <Input
            label="Booking link or id"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="https://…/visit/…"
            error={error ?? undefined}
            aria-label="Booking link or id"
          />
        </div>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? <Spinner size="sm" /> : <Search size={16} aria-hidden />}
          <span className="ml-1">Look up</span>
        </Button>
      </form>

      {booking ? (
        <div className="mt-5 flex flex-col gap-5" data-testid="venue-booking-dispute">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold text-[var(--color-text-primary)]">{booking.reference}</span>
            <Badge variant={st.variant} dot>{st.label}</Badge>
            <span className="text-sm text-[var(--color-text-secondary)]">
              {venueOfferKindLabel(booking.offerKind, booking.offer?.entryStyle)} · {booking.offer?.name ?? "–"} · {booking.venue?.name ?? "–"}
            </span>
            <span className="flex-1" />
            {canForceExpire(booking) ? (
              <Button variant="danger" size="sm" onClick={() => setExpireOpen(true)}>
                Force expire hold
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void lookUp(booking.groupId)} disabled={loading}>
              Reload
            </Button>
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-[var(--color-text-tertiary)]">Guest</dt><dd>{booking.guest?.name ?? "–"}</dd></div>
            <div><dt className="text-[var(--color-text-tertiary)]">Date</dt><dd>{booking.window?.localDate ?? "–"}{hire?.sessionLabel ? ` · ${hire.sessionLabel}` : ""}</dd></div>
            {hire ? <div><dt className="text-[var(--color-text-tertiary)]">Space</dt><dd>{hire.placeName ?? "–"} · {hire.guests} guests</dd></div> : null}
            <div><dt className="text-[var(--color-text-tertiary)]">Total</dt><dd className="tabular-nums">{moneyWords(booking.totalDueMinor ?? booking.totalMinor, booking.currencyCode)}</dd></div>
            <div><dt className="text-[var(--color-text-tertiary)]">Paid</dt><dd className="tabular-nums">{moneyWords(booking.paidMinor, booking.currencyCode)}</dd></div>
            <div><dt className="text-[var(--color-text-tertiary)]">Refunded</dt><dd className="tabular-nums">{moneyWords(booking.refundedMinor, booking.currencyCode)}</dd></div>
            {booking.depositMinor ? <div><dt className="text-[var(--color-text-tertiary)]">Deposit</dt><dd className="tabular-nums">{moneyWords(booking.depositMinor, booking.currencyCode)}</dd></div> : null}
            {hire?.damageDepositMinor ? <div><dt className="text-[var(--color-text-tertiary)]">Damage deposit</dt><dd className="tabular-nums">{moneyWords(hire.damageDepositMinor, booking.currencyCode)} (refundable)</dd></div> : null}
            {booking.requestDeadline ? <div><dt className="text-[var(--color-text-tertiary)]">Reply by</dt><dd>{formatDateTime(booking.requestDeadline)}</dd></div> : null}
            {booking.holdUntil ? <div><dt className="text-[var(--color-text-tertiary)]">On hold until</dt><dd>{formatDateTime(booking.holdUntil)}</dd></div> : null}
          </dl>

          <div className="text-sm">
            <div className="mb-1 font-semibold text-[var(--color-text-primary)]">Terms saved on the booking</div>
            <div className="text-[var(--color-text-secondary)]">
              {Array.isArray(snapshot?.refundLadder ?? booking.policy?.refundLadder)
                ? ladderWords(snapshot?.refundLadder ?? booking.policy?.refundLadder)
                : snapshot?.policyText ?? booking.policy?.text ?? "No terms saved"}
            </div>
          </div>

          {Array.isArray(booking.claims) && booking.claims.length > 0 ? (
            <div className="text-sm">
              <div className="mb-1 font-semibold text-[var(--color-text-primary)]">Space claims</div>
              <ul className="flex flex-col gap-1 text-[var(--color-text-secondary)]">
                {booking.claims.map((c) => (
                  <li key={c.claimId}>
                    {c.spaceName} · {c.state}
                    {c.from ? ` · ${formatDateTime(c.from)} to ${formatDateTime(c.to)}` : ""}
                    {c.releaseReason ? ` · released: ${String(c.releaseReason).replace(/_/g, " ")}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {Array.isArray(booking.payments) && booking.payments.length > 0 ? (
            <div className="text-sm">
              <div className="mb-1 font-semibold text-[var(--color-text-primary)]">Payments</div>
              <ul className="flex flex-col gap-1 text-[var(--color-text-secondary)]">
                {booking.payments.map((p) => (
                  <li key={p.attemptId} className="tabular-nums">
                    {p.stage} · {p.state} · {moneyWords(p.amountMinor, booking.currencyCode)} · {p.at ? formatDateTime(p.at) : "–"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="text-sm">
            <div className="mb-1 font-semibold text-[var(--color-text-primary)]">Timeline</div>
            <ol className="flex flex-col gap-1 text-[var(--color-text-secondary)]">
              {(Array.isArray(booking.timeline) ? booking.timeline : []).map((e, i) => (
                <li key={`${e.type}-${i}`}>
                  <span className="tabular-nums">{e.at ? formatDateTime(e.at) : "–"}</span> · {timelineLabel(e.type, e.actorType)}
                  {e.details?.reason ? ` · “${e.details.reason}”` : ""}
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      <HighRiskActionModal
        open={expireOpen}
        onClose={() => setExpireOpen(false)}
        title={`End the hold on ${booking?.reference ?? "this booking"}`}
        description="Closes the request or the approved hold (only when nothing was paid) and frees the space. Check the timeline afterwards and contact the guest and the venue if they need to hear from us. Your reason is saved in the audit log."
        confirmLabel="Force expire hold"
        destructive
        successMessage="Hold ended."
        onConfirm={async ({ reason }) => {
          const next = await forceExpireVenueHold({ groupId: booking.groupId, reason: reason.trim() });
          setBooking(next);
          setExpireOpen(false);
        }}
      />
    </SectionCard>
  );
}
