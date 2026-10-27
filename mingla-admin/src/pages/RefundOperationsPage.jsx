import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  actOnSourceRefund,
  appendCapturedQueuePage,
  getSourceRefundOperation,
  isSessionExpiredError,
  listSourceRefundOperations,
  recoverSourceRefundAttention,
  SESSION_EXPIRED_MESSAGE,
} from "../services/refundOperationsService";
import {
  exceptionDetail,
  queueRowModel,
  refundQueueErrorMessage,
  validateActionReason,
} from "../lib/refundOperationsView";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Textarea } from "../components/ui/Input";
import { formatDateTime } from "../lib/formatters";

function money(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency })
      .format(Number(cents ?? 0) / 100);
  } catch {
    return `${(Number(cents ?? 0) / 100).toFixed(2)} ${currency}`;
  }
}

export function RefundOperationsPage() {
  const { signOut } = useAuth();
  const [view, setView] = useState(null);
  const [selected, setSelected] = useState(null);
  // #4130: an exception row opens its captured details (no server detail call).
  const [selectedException, setSelectedException] = useState(null);
  const [opening, setOpening] = useState(null);
  const [openError, setOpenError] = useState("");
  const [error, setError] = useState("");
  // Issue #3512 — an expired session is not a queue failure. invokeWithRefresh
  // has already refreshed and retried once by the time we see this, so the only
  // remedy left is re-authenticating; say that instead of blaming the queue.
  const [sessionExpired, setSessionExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [checkedAt, setCheckedAt] = useState(null);
  // #4130: the reason for an action is typed here, not in a browser pop-up.
  const [actionReason, setActionReason] = useState("");
  const [actionReasonError, setActionReasonError] = useState("");
  const [actionError, setActionError] = useState("");
  const [recoveryAction, setRecoveryAction] = useState("");
  const [recoveryChannel, setRecoveryChannel] = useState("");
  const [recoveryDeliveryId, setRecoveryDeliveryId] = useState("");
  const [recoveryContact, setRecoveryContact] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    setMoreError("");
    setSessionExpired(false);
    try {
      setView(await listSourceRefundOperations());
      setCheckedAt(new Date());
    } catch (caught) {
      if (isSessionExpiredError(caught)) {
        setSessionExpired(true);
        setError(SESSION_EXPIRED_MESSAGE);
        return;
      }
      setError(refundQueueErrorMessage(caught, "load"));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const loadMore = async () => {
    if (!view?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await listSourceRefundOperations({
        filters: {},
        cursor: view.nextCursor,
      });
      // #4130: join the pages here, inside the try, so a page that does not
      // fit the captured queue is an error on screen — never a throw inside
      // a state update that takes the page down.
      const current = view;
      const next = appendCapturedQueuePage(current, page);
      setView(next);
    } catch (caught) {
      if (isSessionExpiredError(caught)) {
        setSessionExpired(true);
        setError(SESSION_EXPIRED_MESSAGE);
        return;
      }
      setMoreError(refundQueueErrorMessage(caught, "more"));
    } finally {
      setLoadingMore(false);
    }
  };

  const resetPanel = () => {
    setActionReason("");
    setActionReasonError("");
    setActionError("");
    setRecoveryNotice("");
    setRecoveryAction("");
    setRecoveryChannel("");
    setRecoveryDeliveryId("");
    setRecoveryContact("");
    setRecoveryReason("");
  };

  const select = async (item) => {
    setOpenError("");
    resetPanel();
    if (item.itemKind !== "refund_operation") {
      setSelected(null);
      setSelectedException(exceptionDetail(item));
      return;
    }
    setSelectedException(null);
    setOpening(item.itemId);
    try {
      const detail = await getSourceRefundOperation(item.itemId);
      if (!detail) {
        setSelected(null);
        setOpenError("This refund is no longer in the queue. Refresh to see the latest.");
        return;
      }
      setSelected(detail);
    } catch (caught) {
      // #4130: opening a row used to have no catch; a failure showed nothing.
      if (isSessionExpiredError(caught)) {
        setSessionExpired(true);
        setError(SESSION_EXPIRED_MESSAGE);
        return;
      }
      setSelected(null);
      setOpenError(refundQueueErrorMessage(caught, "open"));
    } finally {
      setOpening(null);
    }
  };
  const act = async (action) => {
    const refundId = selected?.summary?.refund_id;
    if (!refundId) return;
    const problem = validateActionReason(actionReason);
    if (problem) {
      setActionReasonError(problem);
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await actOnSourceRefund({ refundId, action, reason: actionReason.trim() });
      setActionReason("");
      setSelected(await getSourceRefundOperation(refundId));
      await load();
    } catch (caught) {
      // Issue #3512 — this path had no catch at all, so a 401 on an action
      // button aborted the handler with an unhandled rejection and the admin
      // saw nothing happen.
      if (isSessionExpiredError(caught)) {
        setSessionExpired(true);
        setError(SESSION_EXPIRED_MESSAGE);
      } else {
        setActionError(refundQueueErrorMessage(caught, "action"));
      }
    } finally {
      setBusy(false);
    }
  };
  const recoverAttention = async () => {
    const summary = selected?.summary;
    if (
      !summary?.refund_id || !summary?.attention_generation ||
      !recoveryAction || !recoveryReason
    ) return;
    setBusy(true);
    setRecoveryNotice("");
    try {
      await recoverSourceRefundAttention({
        refundId: summary.refund_id,
        action: recoveryAction,
        expectedGeneration: summary.attention_generation,
        deliveryId: recoveryDeliveryId || undefined,
        channel: recoveryChannel || undefined,
        newContact: recoveryContact || undefined,
        reasonCode: recoveryReason,
      });
      setRecoveryNotice(
        recoveryAction === "correct_attention_contact"
          ? "contact updated — invalidate and resend required"
          : "Recovery action accepted.",
      );
      setRecoveryContact("");
      setRecoveryDeliveryId("");
      setRecoveryChannel("");
      setRecoveryReason("");
      setRecoveryAction("");
      setSelected(await getSourceRefundOperation(summary.refund_id));
      await load();
    } catch (caught) {
      if (isSessionExpiredError(caught)) {
        setSessionExpired(true);
        setError(SESSION_EXPIRED_MESSAGE);
      } else {
        setActionError(
          "Recovery action could not be applied. Refresh and verify the current delivery state.",
        );
      }
    } finally {
      setBusy(false);
    }
  };
  const summaryFields = selected?.summary
    ? [
      ["Operation", selected.summary.refund_id],
      ["Source", selected.summary.source_type],
      ["Buyer state", selected.summary.buyer_state],
      ["Fee state", selected.summary.fee_state],
      ["Financial state", selected.summary.financial_state],
      ["Ops state", selected.summary.ops_status],
      ["Generation", selected.summary.attention_generation],
      ["Updated", selected.summary.updated_at],
    ]
    : [];
  const currentDeliveries = (selected?.attentionDeliveries ?? []).filter(
    (delivery) =>
      delivery.generation === selected?.summary?.attention_generation,
  );
  const correctionChannels = Array.from(
    new Set(
      currentDeliveries
        .filter((delivery) =>
          delivery.channel === "email" || delivery.channel === "sms"
        )
        .map((delivery) => delivery.channel),
    ),
  );
  const reclaimableDeliveries = currentDeliveries.filter(
    (delivery) =>
      delivery.status === "ambiguous" &&
      (delivery.channel === "email" || delivery.channel === "sms"),
  );
  const canInvalidate = currentDeliveries.some((delivery) =>
    [
      "ambiguous",
      "undelivered",
      "failed_terminal",
      "suppressed",
      "superseded",
    ].includes(delivery.status)
  );
  const reasons = recoveryAction === "correct_attention_contact"
    ? ["invalid_recipient", "recipient_updated_contact"]
    : recoveryAction === "reclaim_confirmed_unsent"
    ? ["provider_confirmed_unsent"]
    : recoveryAction === "invalidate_and_resend_attention"
    ? [
      "delivery_acceptance_unknown",
      "delivery_undelivered",
      "recipient_contact_corrected",
      "recipient_requested_resend",
    ]
    : [];

  const items = view?.items ?? [];

  if (!view && !error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Refund operations" />
        <p className="text-sm text-[var(--color-text-secondary)]">Loading refund operations…</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Refund operations"
        description={`Refunds that need a person: stuck, failed or waiting on the provider. Queue captured at ${view?.snapshot_created_at
          ? new Date(view.snapshot_created_at).toLocaleTimeString()
          : "—"}`}
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      {error && (
        <div role="alert" className="rounded-lg border border-[var(--color-error-200,#fecaca)] bg-[var(--color-error-50)] p-4 text-sm text-[var(--color-text-primary)]">
          {error}{" "}
          {sessionExpired
            ? (
              <Button variant="secondary" size="sm" onClick={() => void signOut()}>
                Sign in again
              </Button>
            )
            : (
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Refresh queue
              </Button>
            )}
        </div>
      )}
      {!error && view && items.length === 0 && (
        <SectionCard>
          <div className="flex flex-wrap items-center gap-3" role="status">
            <Badge variant="success">All clear</Badge>
            <span className="text-sm text-[var(--color-text-primary)]">
              No refunds need attention. Refunds that get stuck, fail or wait on the provider will appear here.
            </span>
            {checkedAt && (
              <span className="ml-auto text-xs text-[var(--color-text-tertiary)]">
                Checked {formatDateTime(checkedAt.toISOString())}
              </span>
            )}
          </div>
        </SectionCard>
      )}
      {items.length > 0 && (
        <SectionCard noPadding>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
                  <th className="px-4 py-2">Operation</th>
                  <th className="px-4 py-2">Source</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2">Provider</th>
                  <th className="px-4 py-2">Buyer</th>
                  <th className="px-4 py-2">Fee</th>
                  <th className="px-4 py-2">Financial</th>
                  <th className="px-4 py-2">Ops</th>
                  <th className="px-4 py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const row = queueRowModel(item);
                  return (
                    <tr
                      key={row.key}
                      onClick={() => void select(item)}
                      className="cursor-pointer border-t border-[var(--gray-200)] hover:bg-[var(--gray-50)]"
                    >
                      <td className="px-4 py-2 font-mono text-xs">{row.id}</td>
                      <td className="px-4 py-2">{row.source}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {row.currency ? money(row.amountCents, row.currency) : "—"}
                      </td>
                      <td className="px-4 py-2">{row.provider ?? "—"}</td>
                      <td className="px-4 py-2">{row.buyer ?? "—"}</td>
                      <td className="px-4 py-2">{row.fee ?? "—"}</td>
                      <td className="px-4 py-2">{row.financial ?? "—"}</td>
                      <td className="px-4 py-2">{row.ops}</td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={opening === item.itemId}
                          onClick={(event) => {
                            event.stopPropagation();
                            void select(item);
                          }}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
      {moreError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-error-200,#fecaca)] bg-[var(--color-error-50)] p-3 text-sm">
          {moreError}
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Refresh queue
          </Button>
        </div>
      )}
      {view?.nextCursor && (
        <Button
          variant="secondary"
          size="sm"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
      {openError && (
        <div role="alert" className="rounded-lg border border-[var(--color-error-200,#fecaca)] bg-[var(--color-error-50)] p-3 text-sm">
          {openError}
        </div>
      )}
      {selectedException && (
        <SectionCard title={selectedException.title}>
          <div className="space-y-3 text-sm">
            <p className="text-[var(--color-text-primary)]">{selectedException.explanation}</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              {selectedException.fields.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
                  <dd className="break-all">{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[var(--color-text-secondary)]">{selectedException.nextStep}</p>
          </div>
        </SectionCard>
      )}
      {selected && (
        <SectionCard title="Live details">
          <div className="space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {summaryFields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
                <dd className="break-all">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <h3 className="font-medium">Attention deliveries</h3>
          {currentDeliveries.length === 0
            ? <p className="text-sm text-[var(--color-text-tertiary)]">No current delivery rows.</p>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
                    <th>Channel</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Safe code</th>
                    <th>Next attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {currentDeliveries.map((delivery) => (
                    <tr key={delivery.deliveryId}>
                      <td>{delivery.channel}</td>
                      <td>{delivery.status}</td>
                      <td>{delivery.attempts}</td>
                      <td>{delivery.lastSafeCode ?? "—"}</td>
                      <td>{delivery.nextAttemptAt ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          {actionError && (
            <div role="alert" className="rounded-lg border border-[var(--color-error-200,#fecaca)] bg-[var(--color-error-50)] p-3 text-sm">
              {actionError}
            </div>
          )}
          {selected.summary?.buyer_state !== "processed" && (
            <>
              <Textarea
                label="Reason (saved on the refund)"
                value={actionReason}
                onChange={(event) => {
                  setActionReason(event.target.value);
                  setActionReasonError("");
                }}
                error={actionReasonError}
                placeholder="Why you are reconciling, escalating or resolving"
                rows={3}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void act("reconcile_provider")}
                >
                  Reconcile provider
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void act("escalate")}
                >
                  Escalate
                </Button>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void act("resolve_ops")}>
                  Resolve Ops
                </Button>
              </div>
              {selected.summary?.buyer_state === "needs_attention" && (
                <section className="space-y-2 rounded-lg border border-[var(--gray-200)] p-3 text-sm">
                  <h3 className="font-medium">Attention recovery</h3>
                  <label className="flex flex-col gap-1">
                    Action
                    <select
                      value={recoveryAction}
                      onChange={(event) => {
                        setRecoveryAction(event.target.value);
                        setRecoveryChannel("");
                        setRecoveryDeliveryId("");
                        setRecoveryReason("");
                      }}
                    >
                      <option value="">Choose an action</option>
                      {correctionChannels.length > 0 && (
                        <option value="correct_attention_contact">
                          Correct guest contact
                        </option>
                      )}
                      {reclaimableDeliveries.length > 0 && (
                        <option value="reclaim_confirmed_unsent">
                          Reclaim confirmed-unsent delivery
                        </option>
                      )}
                      {canInvalidate && (
                        <option value="invalidate_and_resend_attention">
                          Invalidate and resend attention link
                        </option>
                      )}
                    </select>
                  </label>
                  {recoveryAction === "correct_attention_contact" && (
                    <>
                      <label className="flex flex-col gap-1">
                        Channel
                        <select
                          value={recoveryChannel}
                          onChange={(event) =>
                            setRecoveryChannel(event.target.value)}
                        >
                          <option value="">Choose a channel</option>
                          {correctionChannels.map((channel) => (
                            <option key={channel} value={channel}>
                              {channel}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        Corrected contact
                        <input
                          value={recoveryContact}
                          onChange={(event) =>
                            setRecoveryContact(event.target.value)}
                        />
                      </label>
                    </>
                  )}
                  {recoveryAction === "reclaim_confirmed_unsent" && (
                    <label className="flex flex-col gap-1">
                      Ambiguous delivery
                      <select
                        value={recoveryDeliveryId}
                        onChange={(event) => {
                          const delivery = reclaimableDeliveries.find((item) =>
                            item.deliveryId === event.target.value
                          );
                          setRecoveryDeliveryId(event.target.value);
                          setRecoveryChannel(delivery?.channel ?? "");
                        }}
                      >
                        <option value="">Choose a delivery</option>
                        {reclaimableDeliveries.map((delivery) => (
                          <option
                            key={delivery.deliveryId}
                            value={delivery.deliveryId}
                          >
                            {delivery.channel} · {delivery.attempts} attempts ·
                            {" "}
                            {delivery.lastSafeCode ?? "no code"}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {recoveryAction && (
                    <label className="flex flex-col gap-1">
                      Approved reason
                      <select
                        value={recoveryReason}
                        onChange={(event) =>
                          setRecoveryReason(event.target.value)}
                      >
                        <option value="">Choose a reason</option>
                        {reasons.map((reason) => (
                          <option key={reason} value={reason}>{reason}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {recoveryAction && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy || !recoveryReason ||
                        (recoveryAction === "correct_attention_contact" &&
                          (!recoveryChannel || !recoveryContact)) ||
                        (recoveryAction === "reclaim_confirmed_unsent" &&
                          (!recoveryDeliveryId || !recoveryChannel))}
                      onClick={() => void recoverAttention()}
                    >
                      Apply recovery
                    </Button>
                  )}
                  {recoveryNotice && <p role="status">{recoveryNotice}</p>}
                </section>
              )}
            </>
          )}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
