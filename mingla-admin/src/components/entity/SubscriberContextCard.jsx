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
import { HighRiskActionModal } from "./HighRiskActionModal";
import { Badge } from "../ui/Badge";
import { AlertCard } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { Button } from "../ui/Button";
import { RotateCcw } from "lucide-react";
import { getSubscriptionDetail } from "../../services/adminMoneyService";
import { grantOverrideAudited, revokeOverrideAudited } from "../../services/adminMoneyActService";
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
  const [action, setAction] = useState(null); // null | 'grant' | 'revoke'
  const [tier, setTier] = useState("mingla_plus");
  const [durationDays, setDurationDays] = useState(30);

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

  // Reset the grant form each time the grant modal opens.
  useEffect(() => {
    if (action === "grant") {
      setTier("mingla_plus");
      setDurationDays(30);
    }
  }, [action]);

  const sub = bundle?.subscription || null;
  const override = bundle?.override || null;
  const history = Array.isArray(bundle?.override_history) ? bundle.override_history : [];
  // The active override's id lives on the history rows (is_active), not on the
  // `override` summary object — use it to revoke.
  const activeOverride = history.find((h) => h.is_active) || null;

  const runGrant = useCallback(async ({ reason }) => {
    const days = Math.max(1, Math.floor(Number(durationDays) || 0));
    const { error: err } = await grantOverrideAudited({
      user_id: userId,
      tier,
      reason,
      duration_days: days,
    });
    if (err) {
      const msg = err.message || "";
      if (msg.includes("not_authorized")) throw new Error("Admin access required.");
      if (msg.toLowerCase().includes("invalid tier")) throw new Error("Tier must be Free or Mingla+.");
      if (msg.includes("reason_required")) throw new Error("A reason is required.");
      throw new Error(msg || "Couldn't grant the override.");
    }
    load();
  }, [userId, tier, durationDays, load]);

  const runRevoke = useCallback(async ({ reason }) => {
    if (!activeOverride) throw new Error("No active override to revoke.");
    const { error: err } = await revokeOverrideAudited({
      override_id: activeOverride.id,
      user_id: userId,
      reason,
    });
    if (err) {
      const msg = err.message || "";
      if (msg.includes("not_authorized")) throw new Error("Admin access required.");
      if (msg.includes("reason_required")) throw new Error("A reason is required.");
      throw new Error(msg || "Couldn't revoke the override.");
    }
    load();
  }, [activeOverride, userId, load]);

  return (
    <>
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

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--gray-200)] pt-4">
              <Button variant="secondary" size="sm" onClick={() => setAction("grant")}>
                {activeOverride ? "Extend Plus" : "Comp Plus"}
              </Button>
              {activeOverride && (
                <Button variant="danger" size="sm" onClick={() => setAction("revoke")}>
                  Revoke override
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">No subscriber selected.</p>
        )}
      </ModalBody>
    </Modal>

      {/* W2-D grant / revoke — DB entitlement override only (not billing). Rendered
          outside the card Modal so its position:fixed is viewport-relative. */}
      <HighRiskActionModal
        open={action === "grant"}
        onClose={() => setAction(null)}
        title={activeOverride ? "Extend Plus override" : "Comp Plus override"}
        description="Grants a DB subscription-tier override (not a real subscription). Billing is unchanged."
        confirmLabel="Grant override"
        onConfirm={runGrant}
        successMessage="Override granted."
      >
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="override-tier" className="text-xs font-medium text-[var(--color-text-secondary)]">Tier</label>
            <select
              id="override-tier"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="h-10 px-3 text-sm rounded-lg bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
            >
              <option value="mingla_plus">Mingla+</option>
              <option value="free">Free</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="override-duration" className="text-xs font-medium text-[var(--color-text-secondary)]">Duration (days)</label>
            <input
              id="override-duration"
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              className="w-28 h-10 px-3 text-sm rounded-lg bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border border-[var(--gray-300)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
            />
          </div>
        </div>
      </HighRiskActionModal>

      <HighRiskActionModal
        open={action === "revoke"}
        onClose={() => setAction(null)}
        title="Revoke override"
        description="Revokes the active DB subscription override. Billing is unchanged."
        confirmLabel="Revoke"
        destructive
        onConfirm={runRevoke}
        successMessage="Override revoked."
      />
    </>
  );
}
