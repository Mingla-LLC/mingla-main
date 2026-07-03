// ORCH-1274 [Admin Money console — READ-ONLY] — subscriber support-context card.
//
// A small, READ-ONLY modal shown from the order detail (§5.3) when an order has a
// buyer_user_id. Fetches the support-context subscription bundle via the guard-
// first admin_get_subscription_detail RPC (adminMoneyService.getSubscriptionDetail)
// and renders the buyer's tier / effective tier / active override / trial+period
// end / override history. No mutation — comp/cancel are Wave-2 (§9), and comp
// already lives on SubscriptionManagementPage (not re-exposed here).

import { useEffect, useState, useCallback } from "react";
import { Modal, ModalBody } from "../ui/Modal";
import { Badge } from "../ui/Badge";
import { AlertCard } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { Button } from "../ui/Button";
import { RotateCcw } from "lucide-react";
import { getSubscriptionDetail } from "../../services/adminMoneyService";
import { formatDateTime, formatDate } from "../../lib/formatters";

function tierLabel(tier) {
  if (!tier) return "Free";
  return tier === "mingla_plus" ? "Mingla+" : tier;
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</span>
      <span className="text-sm text-[var(--color-text-primary)] break-words">{children}</span>
    </div>
  );
}

export function SubscriberContextCard({ open, onClose, userId }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    setBundle(null);
    try {
      const { data, error: err } = await getSubscriptionDetail(userId);
      if (err) {
        const msg = err.message || "";
        if (msg.includes("not_authorized")) setError("You are not authorized to view this subscriber.");
        else setError(msg || "Failed to load subscriber context.");
      } else {
        setBundle(data);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open && userId) load();
  }, [open, userId, load]);

  const sub = bundle?.subscription || null;
  const override = bundle?.override || null;
  const history = Array.isArray(bundle?.override_history) ? bundle.override_history : [];

  return (
    <Modal open={open} onClose={onClose} title="Subscriber context" size="md">
      <ModalBody>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" />
          </div>
        ) : error ? (
          <AlertCard
            variant="error"
            title="Couldn't load this subscriber"
            action={
              <Button variant="secondary" size="sm" icon={RotateCcw} onClick={load}>
                Retry
              </Button>
            }
          >
            {error}
          </AlertCard>
        ) : bundle ? (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              <Row label="Effective tier">
                <Badge variant={bundle.effective_tier === "mingla_plus" ? "brand" : "default"}>
                  {tierLabel(bundle.effective_tier)}
                </Badge>
              </Row>
              <Row label="Raw tier">{tierLabel(bundle.raw_tier)}</Row>
              <Row label="Active subscription">
                {sub ? (
                  <Badge variant={sub.is_active ? "success" : "default"} dot>
                    {sub.is_active ? "Active" : "Inactive"}
                  </Badge>
                ) : (
                  <span className="text-[var(--color-text-muted)]">No subscription row</span>
                )}
              </Row>
              <Row label="Period ends">{sub?.current_period_end ? formatDateTime(sub.current_period_end) : "—"}</Row>
              <Row label="Trial ends">{sub?.trial_ends_at ? formatDateTime(sub.trial_ends_at) : "—"}</Row>
              <Row label="Cancelled at">{sub?.cancelled_at ? formatDateTime(sub.cancelled_at) : "—"}</Row>
              <Row label="Stripe customer">
                {sub?.stripe_customer_id ? (
                  <span className="font-mono text-xs break-all">{sub.stripe_customer_id}</span>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Referral bonus (mo)">{sub?.referral_bonus_months ?? "—"}</Row>
            </div>

            {override && (
              <div className="rounded-lg border border-[var(--color-warning-200,var(--gray-200))] bg-[var(--color-warning-50)] p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge variant="warning">Admin override</Badge>
                  <Badge variant="warning" dot>{tierLabel(override.tier)}</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
                  <Row label="Reason">{override.reason || "—"}</Row>
                  <Row label="Expires">{override.expires_at ? formatDateTime(override.expires_at) : "—"}</Row>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-2">
                Override history ({history.length})
              </h4>
              {history.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No overrides on record.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-1.5 text-[13px]">
                      <Badge variant={h.is_active ? "success" : "default"}>{tierLabel(h.tier)}</Badge>
                      {h.revoked_at && <Badge variant="error">revoked</Badge>}
                      {h.reason && <span className="text-[var(--color-text-secondary)]">{h.reason}</span>}
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {h.starts_at ? formatDate(h.starts_at) : "—"}
                        {h.expires_at ? ` → ${formatDate(h.expires_at)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">No subscriber selected.</p>
        )}
      </ModalBody>
    </Modal>
  );
}
