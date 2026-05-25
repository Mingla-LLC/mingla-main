/**
 * Ve3 — Venue claims queue (physical brands pending_review).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { logAdminAction } from "../lib/auditLog";
import { resolveClaimDisplayPhone, formatPhoneHref } from "../lib/claimsPhone";
import { ClaimRow } from "../components/claims/ClaimRow";
import {
  groupClaimsByGooglePlaceId,
  listPendingClaims,
  listRejectedClaims,
  listVerifiedClaims,
  reviewClaim,
} from "../services/adminClaimsService";

const CAT_LABELS = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CLAIM_TABS = [
  { id: "pending", label: "Pending review" },
  { id: "verified", label: "Verified" },
  { id: "rejected", label: "Rejected" },
];

const EMPTY_COPY = {
  pending: "No claims waiting for review. Nice work.",
  verified: "No verified venues yet.",
  rejected: "No rejected claims.",
};

export function ClaimsPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [activeTab, setActiveTab] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [hours, setHours] = useState([]);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const duplicateGroups = useMemo(
    () => groupClaimsByGooglePlaceId(rows),
    [rows],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data =
        activeTab === "verified"
          ? await listVerifiedClaims()
          : activeTab === "rejected"
            ? await listRejectedClaims()
            : await listPendingClaims();
      setRows(data);
    } catch (e) {
      addToast({
        variant: "error",
        title: "Couldn't load claims",
        description: e?.message ?? String(e),
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (row) => {
    setDetail(row);
    setHours([]);
    setHoursLoading(true);
    try {
      const { data, error } = await supabase
        .from("brand_hours")
        .select("weekday,open_time,close_time,is_closed")
        .eq("brand_id", row.id)
        .order("weekday", { ascending: true });
      if (error) throw error;
      setHours(data ?? []);
    } catch (e) {
      addToast({
        variant: "warning",
        title: "Hours unavailable",
        description: e?.message ?? String(e),
      });
    } finally {
      setHoursLoading(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setHours([]);
  };

  const runReview = async (action, opts = {}) => {
    if (!detail) return;
    setActing(true);
    try {
      const data = await reviewClaim(detail.id, action, opts);
      await logAdminAction(`claim.${action}`, "venue_claim", detail.id, {
        result: data?.result ?? null,
      });
      if (action === "mark_called") {
        addToast({ variant: "info", title: "Marked as called" });
        setDetail((d) =>
          d ? { ...d, marked_called_at: new Date().toISOString() } : d,
        );
      } else if (action === "need_more_info") {
        addToast({ variant: "info", title: "Follow-up flagged" });
        closeDetail();
        await load();
      } else if (action === "approve") {
        const dup = data?.result?.duplicate_flagged_count ?? 0;
        addToast({
          variant: "info",
          title: "Venue approved",
          description:
            dup > 0
              ? `${dup} duplicate claim(s) flagged for review`
              : undefined,
        });
        closeDetail();
        await load();
      } else if (action === "reject") {
        addToast({ variant: "info", title: "Venue rejected" });
        setRejectOpen(false);
        closeDetail();
        await load();
      }
    } catch (e) {
      addToast({
        variant: "error",
        title: "Action failed",
        description: e?.message ?? String(e),
      });
    } finally {
      setActing(false);
    }
  };

  const openReject = () => {
    setRejectReason("");
    setRejectOpen(true);
  };

  const confirmReject = async () => {
    const reason = rejectReason.trim();
    if (reason.length === 0) {
      addToast({
        variant: "warning",
        title: "Rejection reason required",
        description: "Add a short note for the operator email.",
      });
      return;
    }
    await runReview("reject", { rejectionReason: reason });
  };

  const phoneInfo = detail ? resolveClaimDisplayPhone(detail) : null;
  const tel = phoneInfo ? formatPhoneHref(phoneInfo.phone) : null;
  const mapsUri = detail
    ? (detail.place_pool?.google_maps_uri ??
      (detail.google_place_id
        ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(detail.google_place_id)}`
        : null))
    : null;
  const isDuplicateOfApproved = Boolean(detail?.duplicate_of_brand_id);
  const canApprove =
    Boolean(detail?.marked_called_at) && !isDuplicateOfApproved;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-8 w-8 text-[var(--color-brand-500)]" />
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Venue Claims
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Review venue claims by status.
          </p>
        </div>
        <Button variant="secondary" className="ml-auto" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {CLAIM_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.id
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white"
                : "border-white/10 bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <SectionCard
        title={`${CLAIM_TABS.find((tab) => tab.id === activeTab)?.label ?? "Pending review"} (${rows.length})`}
        subtitle={
          activeTab === "pending"
            ? "Oldest first · call venue then approve"
            : "Reviewed venue claims"
        }
      >
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)] py-8 text-center">
            {EMPTY_COPY[activeTab]}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[var(--color-text-tertiary)]">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Address</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Flags</th>
                  <th className="py-2 pr-4">Submitted</th>
                  <th className="py-2 pr-4">SLA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const gid = r.google_place_id?.trim?.();
                  const siblings = gid ? duplicateGroups.get(gid) ?? [] : [];
                  return (
                    <ClaimRow
                      key={r.id}
                      row={r}
                      hasDuplicateSiblings={siblings.length > 1}
                      isDuplicateOfApproved={Boolean(r.duplicate_of_brand_id)}
                      onSelect={() => openDetail(r)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal open={!!detail} onClose={closeDetail} title={detail?.name ?? "Venue"}>
        <ModalBody>
          {!detail ? null : (
            <div className="space-y-4 text-sm">
              {isDuplicateOfApproved ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100">
                  Duplicate of an approved claim for this Google place. Reject unless
                  the venue confirms this signup is theirs.
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {detail.place_pool_id ? (
                  <Badge variant="brand">Pool match</Badge>
                ) : null}
                {detail.marked_called_at ? (
                  <Badge variant="success">Called</Badge>
                ) : null}
                {detail.claim_follow_up_at ? (
                  <Badge variant="warning">Follow-up requested</Badge>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-[var(--color-text-tertiary)]">Slug</div>
                <div>{detail.slug}</div>
                <div className="text-[var(--color-text-tertiary)]">Category</div>
                <div>{CAT_LABELS[detail.venue_category] ?? detail.venue_category}</div>
                <div className="text-[var(--color-text-tertiary)]">Google Place</div>
                <div className="break-all">{detail.google_place_id ?? "—"}</div>
                <div className="text-[var(--color-text-tertiary)]">Location</div>
                <div>
                  {detail.lat != null && detail.lng != null
                    ? `${detail.lat}, ${detail.lng}`
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-1">Address</div>
                <div>{detail.address || "—"}</div>
              </div>
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-1">Phone to dial</div>
                <div>
                  {phoneInfo?.phone ? (
                    tel ? (
                      <a href={tel} className="text-[var(--color-brand-400)] underline">
                        {phoneInfo.phone}
                      </a>
                    ) : (
                      phoneInfo.phone
                    )
                  ) : (
                    "—"
                  )}
                  {phoneInfo?.source === "pool" ? (
                    <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">
                      (Google-listed)
                    </span>
                  ) : null}
                </div>
                {phoneInfo?.note ? (
                  <p className="text-xs text-amber-200/90 mt-1">{phoneInfo.note}</p>
                ) : null}
              </div>
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-1">Contact email</div>
                <div>{detail.contact_email || "—"}</div>
              </div>
              {mapsUri ? (
                <div>
                  <a
                    href={mapsUri}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-brand-400)] underline"
                  >
                    Open in Google Maps
                  </a>
                </div>
              ) : null}
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-1">Description</div>
                <div className="whitespace-pre-wrap">{detail.description || "—"}</div>
              </div>
              {detail.cover_media_url ? (
                <div>
                  <div className="text-[var(--color-text-tertiary)] mb-1">Cover</div>
                  <a
                    href={detail.cover_media_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-brand-400)] underline"
                  >
                    Open image
                  </a>
                </div>
              ) : null}
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-2">Hours</div>
                {hoursLoading ? (
                  <Spinner />
                ) : (
                  <ul className="space-y-1">
                    {hours.map((h) => (
                      <li key={h.weekday} className="flex justify-between gap-4">
                        <span>{WEEKDAYS[h.weekday] ?? h.weekday}</span>
                        <span className="text-[var(--color-text-secondary)]">
                          {h.is_closed
                            ? "Closed"
                            : `${h.open_time ?? "—"} – ${h.close_time ?? "—"}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={closeDetail} disabled={acting}>
            Close
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runReview("need_more_info")}
            disabled={acting}
          >
            Need more info
          </Button>
          <Button variant="danger" onClick={openReject} disabled={acting}>
            Reject
          </Button>
          {!detail?.marked_called_at ? (
            <Button
              variant="secondary"
              onClick={() => void runReview("mark_called")}
              disabled={acting}
            >
              Mark as called
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void runReview("approve")}
              disabled={acting || !canApprove}
              title={
                isDuplicateOfApproved
                  ? "Resolve duplicate — reject this claim first"
                  : undefined
              }
            >
              Approve
            </Button>
          )}
        </ModalFooter>
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Why is this claim being declined?"
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            This is emailed to the operator. They can submit again after rejection.
          </p>
          <textarea
            className="w-full min-h-[100px] rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-[var(--color-text-primary)]"
            placeholder="Why is this claim being declined?"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            disabled={acting}
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setRejectOpen(false)}
            disabled={acting}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirmReject()} disabled={acting}>
            Confirm reject
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

export default ClaimsPage;
