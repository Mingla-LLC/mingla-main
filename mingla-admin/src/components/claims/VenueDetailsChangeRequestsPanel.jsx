/**
 * Issue #3386 — Venue claims → "Detail changes" tab.
 *
 * Hosts can change a LIVE venue's name, category or address, but the change
 * waits here for Mingla. Until an admin approves, guests keep seeing the
 * venue's current details. Approve applies every proposed field at once;
 * Reject keeps the venue as it is and sends the host the reason.
 *
 * Its own component (not more state inside ClaimsPage) so the claim review
 * modal and its pinned contracts stay untouched. Every decision carries the
 * request id on screen, so a request the host withdrew or replaced meanwhile
 * is refused instead of applied, and the list refreshes.
 */

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { formatDateTime } from "../../lib/formatters";
import {
  listPendingVenueDetailsChanges,
  proposedPinMapUrl,
  reviewVenueDetailsChange,
  venueDetailsChangeFailureCopy,
  venueDetailsChangeRows,
} from "../../services/adminVenueDetailsChangeService";

export function VenueDetailsChangeRequestsPanel({ categoryLabels, onCountChange }) {
  const { addToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [busy, setBusy] = useState(null); // `${venueId}:approve|reject`
  const [rejecting, setRejecting] = useState(null); // the request row
  const [reason, setReason] = useState("");
  const [rejectError, setRejectError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const rows = await listPendingVenueDetailsChanges();
      setRequests(rows);
      onCountChange?.(rows.length);
    } catch {
      setListError("Change requests couldn’t load. Try again.");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (request, decision, rejectionReason) => {
    const key = `${request.id}:${decision}`;
    setBusy(key);
    setRejectError(null);
    try {
      const outcome = await reviewVenueDetailsChange({
        venueId: request.id,
        requestId: request.details_change_request_id,
        decision,
        reason: rejectionReason,
      });
      if (!outcome.ok) {
        const detail = venueDetailsChangeFailureCopy(outcome.code);
        if (decision === "reject" && outcome.code === "rejection_reason_required") {
          setRejectError(detail);
          return;
        }
        addToast({
          variant: "warning",
          title: decision === "approve" ? "Change not applied" : "Request not rejected",
          description: detail,
        });
        setRejecting(null);
        await load();
        return;
      }
      addToast({
        variant: decision === "approve" ? "success" : "info",
        title: decision === "approve" ? "Venue details updated" : "Request rejected",
        description:
          decision === "approve"
            ? `${request.details_change_name ?? request.name} now shows the new details. The host has been told.`
            : "The venue keeps its current details. The host has been told why.",
      });
      setRejecting(null);
      setReason("");
      await load();
    } catch (e) {
      const message = e?.message ?? String(e);
      if (decision === "reject") setRejectError(message);
      addToast({
        variant: "error",
        title: decision === "approve" ? "Couldn't approve the change" : "Couldn't reject the change",
        description: message,
      });
    } finally {
      setBusy(null);
    }
  };

  const openReject = (request) => {
    setRejecting(request);
    setReason("");
    setRejectError(null);
  };

  const confirmReject = () => {
    if (!rejecting) return;
    if (reason.trim().length === 0) {
      setRejectError(venueDetailsChangeFailureCopy("rejection_reason_required"));
      return;
    }
    void decide(rejecting, "reject", reason);
  };

  return (
    <SectionCard
      title={`Detail changes (${requests.length})`}
      subtitle="Live venues asking to change their name, category or address · oldest first. Guests see the current details until you approve."
      action={
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : listError ? (
        <div
          role="alert"
          className="rounded-lg border border-[var(--color-error-600)] bg-[var(--color-error-50)] p-4 text-sm text-[var(--color-error-700)]"
        >
          <p>{listError}</p>
          <Button variant="secondary" className="mt-3 min-h-11" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : requests.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
          No venue detail changes waiting for review.
        </p>
      ) : (
        <ul className="space-y-4" data-testid="venue-details-change-list">
          {requests.map((request) => {
            const rows = venueDetailsChangeRows(request, categoryLabels);
            const mapUrl = proposedPinMapUrl(request);
            return (
              <li
                key={request.details_change_request_id}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                    {request.name}
                  </h3>
                  {request.brand?.name ? (
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {request.brand.name}
                    </span>
                  ) : null}
                  {request.claim_status !== "verified" ? (
                    <Badge variant="warning">Not live</Badge>
                  ) : null}
                  <span className="ml-auto text-xs text-[var(--color-text-tertiary)]">
                    Sent {formatDateTime(request.details_change_requested_at)}
                  </span>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-left text-[var(--color-text-tertiary)]">
                        <th className="py-2 pr-4 font-medium">Field</th>
                        <th className="py-2 pr-4 font-medium">Now (what guests see)</th>
                        <th className="py-2 pr-4 font-medium">Requested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.field} className="border-b border-white/5 align-top">
                          <td className="py-2 pr-4 text-[var(--color-text-secondary)]">{row.field}</td>
                          <td className="py-2 pr-4 text-[var(--color-text-secondary)]">{row.current}</td>
                          <td className="py-2 pr-4 font-medium text-[var(--color-text-primary)]">
                            {row.proposed}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {mapUrl ? (
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--color-brand-500)] hover:underline"
                  >
                    Check the new pin on a map
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                ) : null}

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => openReject(request)}
                    disabled={busy !== null}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    className="min-h-11"
                    onClick={() => void decide(request, "approve")}
                    disabled={busy !== null}
                    loading={busy === `${request.id}:approve`}
                    aria-busy={busy === `${request.id}:approve`}
                  >
                    {busy === `${request.id}:approve` ? "Approving…" : "Approve change"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={rejecting !== null}
        onClose={() => {
          if (busy === null) setRejecting(null);
        }}
        title="Why aren't you approving this change?"
      >
        <ModalBody>
          {rejectError ? (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-[var(--color-error-500)] bg-[var(--color-error-50)] p-3 text-sm text-[var(--color-error-700)]"
            >
              {rejectError}
            </div>
          ) : null}
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
            The host sees this reason in the app. {rejecting?.name ?? "The venue"} keeps its
            current details, and the host can send a new request.
          </p>
          <textarea
            className="min-h-[100px] w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-[var(--color-text-primary)]"
            placeholder="For example: the address doesn't match the venue's sign or website."
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy !== null}
            aria-label="Reason for rejecting the change"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRejecting(null)} disabled={busy !== null}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="min-h-11 h-auto whitespace-normal"
            onClick={confirmReject}
            disabled={busy !== null}
            loading={rejecting !== null && busy === `${rejecting.id}:reject`}
          >
            Reject change
          </Button>
        </ModalFooter>
      </Modal>
    </SectionCard>
  );
}

export default VenueDetailsChangeRequestsPanel;
