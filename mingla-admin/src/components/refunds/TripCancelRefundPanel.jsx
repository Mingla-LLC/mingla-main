// Issue #4522 (H-2) — Refund operations: a second-provider trip cancel whose
// refund was sent and never answered. Staff record it (Paystack shows it
// refunded, with its reference) or escalate it (Paystack shows none).
// Nothing is re-sent, refunded or written off from here.
import { useState } from "react";
import { SectionCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input, Textarea } from "../ui/Input";
import {
  majorToMinor,
  TRIP_CANCEL_OUTCOMES,
  tripCancelChargeRows,
  tripCancelPanelTitle,
  validateTripCancelResolution,
  waitingHours,
} from "../../lib/refundOperationsView";

export function TripCancelRefundPanel({ detail, money, busy, error, onResolve }) {
  const charges = tripCancelChargeRows(detail);
  const actionable = charges.filter((charge) => charge.actionable);
  const [attemptId, setAttemptId] = useState(actionable[0]?.attemptId ?? "");
  const [outcome, setOutcome] = useState("refunded_at_provider");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [refundedElsewhere, setRefundedElsewhere] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const target = actionable.find((charge) => charge.attemptId === attemptId) ?? actionable[0];
  const hours = waitingHours(detail?.waiting_since);
  // Pass 8 (P8-2): a part Paystack refused offers "partly refunded already".
  const outcomes = TRIP_CANCEL_OUTCOMES.filter((option) => (target?.outcomes ?? []).includes(option.value));
  const chosenOutcome = outcomes.some((option) => option.value === outcome) ? outcome : outcomes[0]?.value;

  const submit = (chosen) => {
    const problems = validateTripCancelResolution({
      outcome: chosen,
      reference,
      reason,
      refundedElsewhere,
      chargeCents: target?.chargeCents,
    });
    if (problems || !target) {
      setFieldErrors(problems ?? {});
      return;
    }
    setFieldErrors({});
    void onResolve({
      attemptId: target.attemptId,
      outcome: chosen,
      reference: reference.trim(),
      reason: reason.trim(),
      amountCents: target.amountCents,
      currency: target.currency,
      ...(chosen === "refunded_elsewhere" ? { refundedElsewhereCents: majorToMinor(refundedElsewhere) } : {}),
    });
  };

  return (
    <SectionCard title={tripCancelPanelTitle(detail)}>
      <div className="space-y-4 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-[var(--color-text-tertiary)]">Trip</dt>
            <dd>{detail?.trip_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-tertiary)]">Order</dt>
            <dd className="break-all font-mono text-xs">{detail?.order_id ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-tertiary)]">Provider</dt>
            <dd>Paystack</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-tertiary)]">Waiting</dt>
            <dd>{hours === null ? "—" : `${hours} h`}</dd>
          </div>
        </dl>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
              <th className="py-1 pr-6">Charge</th>
              <th className="py-1 pr-8 text-right">Amount</th>
              <th className="py-1 pl-8">State</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((charge) => (
              <tr key={charge.key} className="border-t border-[var(--gray-200)]">
                <td className="py-1 pr-6">{charge.label}</td>
                <td className="py-1 pr-8 text-right tabular-nums whitespace-nowrap">
                  {charge.currency ? money(charge.amountCents, charge.currency.toUpperCase()) : "—"}
                </td>
                <td className="py-1 pl-8">
                  {charge.stateLabel}
                  {charge.escalated && (
                    <span className="ml-2"><Badge variant="warning">Escalated</Badge></span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && (
          <div role="alert" className="rounded-lg border border-[var(--color-error-200,#fecaca)] bg-[var(--color-error-50)] p-3 text-sm">
            {error}
          </div>
        )}
        {actionable.length === 0
          ? (
            <p className="text-[var(--color-text-secondary)]">
              Nothing to do here yet: the refund was sent in the last 15 minutes. Refresh the queue later.
            </p>
          )
          : (
            <>
              {actionable.length > 1 && (
                <fieldset className="space-y-1">
                  <legend className="text-[var(--color-text-tertiary)]">Which refund</legend>
                  {actionable.map((charge) => (
                    <label key={charge.key} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="trip-cancel-charge"
                        checked={target?.attemptId === charge.attemptId}
                        onChange={() => setAttemptId(charge.attemptId)}
                      />
                      {charge.label}: {money(charge.amountCents, String(charge.currency).toUpperCase())}
                    </label>
                  ))}
                </fieldset>
              )}
              <fieldset className="space-y-1">
                <legend className="text-[var(--color-text-tertiary)]">
                  What does Paystack show for {target?.label ?? "this refund"}?
                </legend>
                {outcomes.map((option) => (
                  <label key={option.value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="trip-cancel-outcome"
                      value={option.value}
                      checked={chosenOutcome === option.value}
                      onChange={() => {
                        setOutcome(option.value);
                        setFieldErrors({});
                      }}
                    />
                    {option.label}
                  </label>
                ))}
                {fieldErrors.outcome && <p role="alert" className="text-[var(--color-error-600,#dc2626)]">{fieldErrors.outcome}</p>}
              </fieldset>
              {chosenOutcome === "refunded_elsewhere" && (
                <Input
                  label={`Already refunded on this payment (${String(target?.currency ?? "").toUpperCase()})`}
                  inputMode="decimal"
                  value={refundedElsewhere}
                  onChange={(event) => {
                    setRefundedElsewhere(event.target.value);
                    setFieldErrors((current) => ({ ...current, refundedElsewhere: undefined }));
                  }}
                  error={fieldErrors.refundedElsewhere}
                  placeholder="The amount Paystack lists for that one refund"
                />
              )}
              {(chosenOutcome === "refunded_at_provider" || chosenOutcome === "refunded_elsewhere"
                || chosenOutcome === "paid_outside_provider") && (
                <Input
                  label={chosenOutcome === "refunded_elsewhere"
                    ? "Reference of that other Paystack refund"
                    : chosenOutcome === "paid_outside_provider"
                    ? "Reference of your payment to the traveler"
                    : "Paystack refund reference"}
                  value={reference}
                  onChange={(event) => {
                    setReference(event.target.value);
                    setFieldErrors((current) => ({ ...current, reference: undefined }));
                  }}
                  error={fieldErrors.reference}
                  placeholder={chosenOutcome === "paid_outside_provider"
                    ? "For example the bank transfer reference"
                    : "As shown on the refund in the Paystack dashboard"}
                />
              )}
              <Textarea
                label="Reason (saved on the refund)"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setFieldErrors((current) => ({ ...current, reason: undefined }));
                }}
                error={fieldErrors.reason}
                placeholder="What you checked in Paystack"
                rows={3}
              />
              {target?.state === "below_minimum" && (
                <p className="text-[var(--color-text-secondary)]">
                  This owed amount is below Paystack's minimum refund, so Mingla cannot send it through Paystack.
                  Pay the traveler exactly {money(target.amountCents, String(target.currency).toUpperCase())} another
                  way, then record it here. Recording moves no money.
                </p>
              )}
              <p className="text-[var(--color-text-secondary)]">
                Finishing sends the traveler their refund email and updates the host's payout.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || chosenOutcome !== "escalate"}
                  onClick={() => submit("escalate")}
                >
                  Escalate
                </Button>
                {chosenOutcome === "refunded_elsewhere"
                  ? (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => submit("refunded_elsewhere")}
                    >
                      Ask only for what is left
                    </Button>
                  )
                  : chosenOutcome === "paid_outside_provider"
                  ? (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => submit("paid_outside_provider")}
                    >
                      Record payment and finish cancel
                    </Button>
                  )
                  : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy || chosenOutcome !== "refunded_at_provider"}
                      onClick={() => submit("refunded_at_provider")}
                    >
                      Record refund and finish cancel
                    </Button>
                  )}
              </div>
            </>
          )}
      </div>
    </SectionCard>
  );
}
