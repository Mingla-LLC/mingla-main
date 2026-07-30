import { useCallback, useEffect, useState } from "react";
import {
  actOnSourceRefund,
  appendCapturedQueuePage,
  getSourceRefundOperation,
  listSourceRefundOperations,
  recoverSourceRefundAttention,
} from "../services/refundOperationsService";

function money(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency })
      .format(Number(cents ?? 0) / 100);
  } catch {
    return `${(Number(cents ?? 0) / 100).toFixed(2)} ${currency}`;
  }
}

export function RefundOperationsPage() {
  const [view, setView] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [recoveryAction, setRecoveryAction] = useState("");
  const [recoveryChannel, setRecoveryChannel] = useState("");
  const [recoveryDeliveryId, setRecoveryDeliveryId] = useState("");
  const [recoveryContact, setRecoveryContact] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setView(await listSourceRefundOperations());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(
        message.includes("snapshot_expired")
          ? "This queue view expired. Refresh to load the latest refund operations."
          : "Couldn’t load refund operations. Try again.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const loadMore = async () => {
    if (!view?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listSourceRefundOperations({
        filters: {},
        cursor: view.nextCursor,
      });
      setView((current) => appendCapturedQueuePage(current, page));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (message.includes("snapshot_expired")) {
        setError(
          "This queue view expired. Refresh to load the latest refund operations.",
        );
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const select = async (item) => {
    if (item.itemKind !== "refund_operation") return;
    setSelected(await getSourceRefundOperation(item.itemId));
  };
  const act = async (action) => {
    const refundId = selected?.summary?.refund_id;
    if (!refundId) return;
    const reason = window.prompt("Reason (required)");
    if (!reason) return;
    setBusy(true);
    try {
      await actOnSourceRefund({ refundId, action, reason });
      setSelected(await getSourceRefundOperation(refundId));
      await load();
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
    } catch {
      setError(
        "Recovery action could not be applied. Refresh and verify the current delivery state.",
      );
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

  if (!view && !error) {
    return <div className="p-8">Loading refund operations…</div>;
  }
  return (
    <main className="p-8 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Refund operations</h1>
        <p className="text-sm text-gray-500">
          Queue captured at {view?.snapshot_created_at
            ? new Date(view.snapshot_created_at).toLocaleTimeString()
            : "—"}
        </p>
      </header>
      {error && (
        <div role="alert" className="rounded border border-red-300 p-4">
          {error} <button onClick={load}>Refresh queue</button>
        </div>
      )}
      {!error && view?.items?.length === 0 && (
        <p>No refund operations need review.</p>
      )}
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Source</th>
              <th>Amount</th>
              <th>Provider</th>
              <th>Buyer</th>
              <th>Fee</th>
              <th>Financial</th>
              <th>Ops</th>
            </tr>
          </thead>
          <tbody>
            {(view?.items ?? []).map((item) => {
              const row = item.safeSummary;
              return (
                <tr
                  key={`${item.itemKind}:${item.itemId}`}
                  onClick={() => void select(item)}
                  className="cursor-pointer border-t"
                >
                  <td>{row.operationId ?? row.exceptionId}</td>
                  <td>{row.sourceType ?? "Provider event exception"}</td>
                  <td>
                    {row.currency ? money(row.amountCents, row.currency) : "—"}
                  </td>
                  <td>{row.provider}</td>
                  <td>{row.buyerState ?? row.matchStatus}</td>
                  <td>{row.feeState ?? "—"}</td>
                  <td>{row.financialState ?? "—"}</td>
                  <td>{row.opsStatus ?? "Needs review"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {view?.nextCursor && (
        <button
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
      {selected && (
        <aside className="rounded border p-5 space-y-3">
          <h2 className="font-semibold">Live details</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {summaryFields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-gray-500">{label}</dt>
                <dd>{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <h3 className="font-medium">Attention deliveries</h3>
          {currentDeliveries.length === 0
            ? <p className="text-sm text-gray-500">No current delivery rows.</p>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
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
          {selected.summary?.buyer_state !== "processed" && (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={busy}
                  onClick={() => void act("reconcile_provider")}
                >
                  Reconcile provider
                </button>
                <button
                  disabled={busy}
                  onClick={() => void act("escalate")}
                >
                  Escalate
                </button>
                <button disabled={busy} onClick={() => void act("resolve_ops")}>
                  Resolve Ops
                </button>
              </div>
              {selected.summary?.buyer_state === "needs_attention" && (
                <section className="space-y-2 rounded border p-3">
                  <h3 className="font-medium">Attention recovery</h3>
                  <label>
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
                      <label>
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
                      <label>
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
                    <label>
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
                    <label>
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
                    <button
                      disabled={busy || !recoveryReason ||
                        (recoveryAction === "correct_attention_contact" &&
                          (!recoveryChannel || !recoveryContact)) ||
                        (recoveryAction === "reclaim_confirmed_unsent" &&
                          (!recoveryDeliveryId || !recoveryChannel))}
                      onClick={() => void recoverAttention()}
                    >
                      Apply recovery
                    </button>
                  )}
                  {recoveryNotice && <p role="status">{recoveryNotice}</p>}
                </section>
              )}
            </>
          )}
        </aside>
      )}
    </main>
  );
}
