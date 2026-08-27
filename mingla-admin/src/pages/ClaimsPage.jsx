/**
 * Ve3 — Venue claims queue (physical brands pending_review).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, MessageSquarePlus, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { PhotoLightbox } from "../components/ui/PhotoLightbox";
import { useToast } from "../context/ToastContext";
import { logAdminAction } from "../lib/auditLog";
import { resolveClaimDisplayPhone, formatPhoneHref } from "../lib/claimsPhone";
import { ClaimRow } from "../components/claims/ClaimRow";
import { PendingVenueIdentityCorrectionPanel } from "../components/claims/PendingVenueIdentityCorrectionPanel";
import {
  addClaimFeedback,
  getClaimReviewBundle,
  groupClaimsByGooglePlaceId,
  listPendingClaims,
  listRejectedClaims,
  listVerifiedClaims,
  reviewClaim,
  tweakClaimFields,
} from "../services/adminClaimsService";
// ORCH-1066 — the place-keyed tuner supersedes the brand-keyed overrideClaimScore
// for set/pin (richer + works from zero). overrideClaimScore stays in the service
// for the approval score_vetoes channel but the modal no longer calls it.
import { ScoreTunerPanel } from "../components/ScoreTunerPanel";
import { getActiveSignals } from "../services/deckTunerService";
import { collectClaimPhotos } from "../lib/claimPhotos";
import { formatDateTime } from "../lib/formatters";

const CAT_LABELS = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
  stay: "Stay",
};

// ORCH-1064 — feedback category enum → human label (matches the migration
// CHECK + the business sheet's group order).
const FEEDBACK_CAT_LABELS = {
  photos: "Photos",
  address: "Address",
  hours: "Hours",
  category: "Category",
  description: "Description",
  quality: "Listing quality",
  other: "Other",
};
const FEEDBACK_CAT_ORDER = [
  "photos",
  "address",
  "hours",
  "category",
  "description",
  "quality",
  "other",
];

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

const ACTION_FAILURE_COPY = {
  approve: "Could not approve venue",
  mark_called: "Could not mark venue as called",
  need_more_info: "Could not request more info",
  reject: "Could not reject venue",
};

function safeReviewErrorDetail(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  if (
    message.length === 0 ||
    /bearer|\bjwt\b|\btoken\b|payload|stack|\bat\s+\S+|@/i.test(message)
  ) {
    return "Try again. If this keeps happening, check the Admin activity log.";
  }
  return message.replace(/\s+/g, " ").slice(0, 240);
}

export function ClaimsPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [activeTab, setActiveTab] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [approvalRefreshVenue, setApprovalRefreshVenue] = useState(null);
  const [detail, setDetail] = useState(null);
  const [hours, setHours] = useState([]);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [reviewingAction, setReviewingAction] = useState(null);
  const [reviewError, setReviewError] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // META-ORCH-1062 — claim-review bundle (photos + scores + missing fields).
  const [bundle, setBundle] = useState(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  // Tweak form (address / category / price), pending-only.
  const [tweakAddress, setTweakAddress] = useState("");
  const [tweakCategory, setTweakCategory] = useState("");
  const [tweakPriceLevel, setTweakPriceLevel] = useState("");
  // ORCH-1066 — active-signal catalog (the 16 dials), fetched once + cached, so
  // the tuner can show a row for every signal even when the place has 0 scores.
  const [activeSignals, setActiveSignals] = useState([]);
  // ORCH-1064 — feedback authoring draft: staged items + the per-row composer +
  // the optional overall message. Cleared on open/close/submit.
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [feedbackCat, setFeedbackCat] = useState("photos");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const actionRefs = useRef({});
  const reviewErrorRef = useRef(null);
  const resultsRef = useRef(null);
  const rejectReasonRef = useRef(null);
  const skipNextTabLoadRef = useRef(false);

  const duplicateGroups = useMemo(
    () => groupClaimsByGooglePlaceId(rows),
    [rows],
  );

  const load = useCallback(async (tab = activeTab) => {
    setLoading(true);
    setListError(null);
    try {
      const data =
        tab === "verified"
          ? await listVerifiedClaims()
          : tab === "rejected"
            ? await listRejectedClaims()
            : await listPendingClaims();
      setRows(data);
      return data;
    } catch {
      setListError("Claims couldn’t refresh. Try again.");
      addToast({
        variant: "error",
        title: "Couldn't load claims",
        description: "Check your connection and try again.",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeTab, addToast]);

  useEffect(() => {
    if (skipNextTabLoadRef.current) {
      skipNextTabLoadRef.current = false;
      return;
    }
    void load();
  }, [load]);

  // ORCH-1066 — fetch the active-signal catalog once for the tuner dials.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sigs = await getActiveSignals();
        if (!cancelled) setActiveSignals(sigs);
      } catch {
        if (!cancelled) setActiveSignals([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBundle = useCallback(async (brandId) => {
    setBundleLoading(true);
    setBundleError(null);
    try {
      const data = await getClaimReviewBundle(brandId);
      setBundle(data);
    } catch (e) {
      setBundle(null);
      setBundleError(e?.message ?? String(e));
    } finally {
      setBundleLoading(false);
    }
  }, []);

  const openDetail = async (row) => {
    setDetail(row);
    setHours([]);
    setBundle(null);
    setBundleError(null);
    setLightboxIndex(null);
    setFeedbackItems([]);
    setFeedbackCat("photos");
    setFeedbackNote("");
    setFeedbackMessage("");
    setTweakAddress(row.address ?? "");
    setTweakCategory(row.venue_category ?? "");
    setTweakPriceLevel("");
    setHoursLoading(true);
    // META-ORCH-1062 — fetch photos + scores + missing fields in parallel.
    void loadBundle(row.id);
    try {
      // META-ORCH-1255(C): hours rows are venue-scoped (M3); the queue row
      // id IS the venue_listings id.
      const { data, error } = await supabase
        .from("brand_hours")
        .select("weekday,open_time,close_time,is_closed")
        .eq("venue_id", row.id)
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

  // #2099 — the panel's single success reload: exactly one detail reload and one
  // list reload (Amendment 5 §E2). Nothing here runs on a stale/failed attempt.
  const reloadAfterIdentityCorrection = useCallback(async () => {
    const venueId = detail?.id;
    await load();
    const refreshed = (await listPendingClaims()).find((row) => row.id === venueId);
    if (refreshed) await openDetail(refreshed);
    else closeDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, load]);

  const closeDetail = () => {
    setDetail(null);
    setReviewError(null);
    setHours([]);
    setBundle(null);
    setBundleError(null);
    setLightboxIndex(null);
    setFeedbackItems([]);
    setFeedbackCat("photos");
    setFeedbackNote("");
    setFeedbackMessage("");
  };

  // ORCH-1064 — stage one feedback item into the local draft array.
  const addFeedbackItem = () => {
    const note = feedbackNote.trim();
    if (note.length === 0) {
      addToast({ variant: "warning", title: "Add a note for this item" });
      return;
    }
    setFeedbackItems((items) => [...items, { category: feedbackCat, note }]);
    setFeedbackNote("");
  };

  const removeFeedbackItem = (index) => {
    setFeedbackItems((items) => items.filter((_, i) => i !== index));
  };

  // ORCH-1064 — send the staged round through the edge wrapper (push + audit
  // server-side), then close + reload so the "Follow-up requested" badge shows.
  const submitFeedback = async () => {
    if (!detail) return;
    if (feedbackItems.length === 0) {
      addToast({ variant: "warning", title: "Add at least one feedback item" });
      return;
    }
    setActing(true);
    try {
      const data = await addClaimFeedback(
        detail.id,
        feedbackItems,
        feedbackMessage.trim() || null,
      );
      await logAdminAction("claim.add_feedback", "venue_claim", detail.id, {
        round: data?.round ?? null,
        item_count: data?.item_count ?? feedbackItems.length,
      });
      addToast({
        variant: "info",
        title: "Feedback sent",
        description: `${data?.item_count ?? feedbackItems.length} item(s) sent to the business`,
      });
      closeDetail();
      await load();
    } catch (e) {
      addToast({
        variant: "error",
        title: "Couldn't send feedback",
        description: e?.message ?? String(e),
      });
    } finally {
      setActing(false);
    }
  };

  const focusVerifiedResults = () => {
    requestAnimationFrame(() => resultsRef.current?.focus());
  };

  const retryVerified = async (venueId = approvalRefreshVenue?.id) => {
    setLoading(true);
    setListError(null);
    try {
      const verifiedRows = await listVerifiedClaims();
      if (venueId && !verifiedRows.some((row) => row.id === venueId)) {
        setListError("Verified could not refresh.");
        return false;
      }
      setRows(verifiedRows);
      setApprovalRefreshVenue(null);
      focusVerifiedResults();
      return true;
    } catch {
      setListError("Verified could not refresh.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const refreshAfterApproval = async (venueId, venueName) => {
    if (activeTab !== "verified") skipNextTabLoadRef.current = true;
    setActiveTab("verified");
    setLoading(true);
    setListError(null);
    setApprovalRefreshVenue({ id: venueId, name: venueName });

    const [pendingResult, verifiedResult] = await Promise.allSettled([
      listPendingClaims(),
      listVerifiedClaims(),
    ]);

    if (pendingResult.status === "rejected") {
      addToast({
        variant: "warning",
        title: "Pending claims could not refresh",
        description: "Refresh Pending before reviewing another venue.",
      });
    }

    if (
      verifiedResult.status === "fulfilled" &&
      verifiedResult.value.some((row) => row.id === venueId)
    ) {
      setRows(verifiedResult.value);
      setApprovalRefreshVenue(null);
      setLoading(false);
      focusVerifiedResults();
      return;
    }

    setLoading(false);
    await retryVerified(venueId);
  };

  const focusReviewError = () => {
    requestAnimationFrame(() => reviewErrorRef.current?.focus());
  };

  const runReview = async (action, opts = {}) => {
    if (!detail || acting) return;

    const venueId = detail.id;
    const venueName = detail.name;
    setReviewError(null);
    setReviewingAction(action);
    setActing(true);
    try {
      const data = await reviewClaim(venueId, action, opts);
      try {
        await logAdminAction(`claim.${action}`, "venue_claim", venueId, {
          result: data?.result ?? null,
        });
      } catch {
        addToast({
          variant: "warning",
          title: "Review saved, but the Admin activity view could not refresh",
        });
      }

      if (action === "mark_called") {
        addToast({ variant: "info", title: "Marked as called" });
        setDetail((current) =>
          current
            ? { ...current, marked_called_at: new Date().toISOString() }
            : current,
        );
        requestAnimationFrame(() => actionRefs.current.approve?.focus());
      } else if (action === "need_more_info") {
        addToast({ variant: "info", title: "Follow-up flagged" });
        closeDetail();
        await load();
      } else if (action === "approve") {
        addToast({
          variant: "info",
          title: "Venue approved",
          description: `${venueName} is now under Verified.`,
        });
        closeDetail();
        await refreshAfterApproval(venueId, venueName);
      } else if (action === "reject") {
        addToast({ variant: "info", title: "Venue rejected" });
        setRejectOpen(false);
        closeDetail();
        await load();
      }
    } catch (e) {
      setReviewError({
        action,
        title: ACTION_FAILURE_COPY[action],
        detail: safeReviewErrorDetail(e),
      });
      focusReviewError();
    } finally {
      setReviewingAction(null);
      setActing(false);
    }
  };

  const openReject = () => {
    setReviewError(null);
    setRejectReason("");
    setRejectOpen(true);
    requestAnimationFrame(() => rejectReasonRef.current?.focus());
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

  // META-ORCH-1062 — tweak whitelisted fields on a pending claim, then reload.
  const submitTweak = async () => {
    if (!detail) return;
    const patch = {};
    if ((tweakAddress ?? "") !== (detail.address ?? "")) patch.address = tweakAddress;
    if ((tweakCategory ?? "") !== (detail.venue_category ?? "")) {
      patch.venue_category = tweakCategory;
    }
    if ((tweakPriceLevel ?? "").trim().length > 0) {
      patch.price_level = tweakPriceLevel.trim();
    }
    if (Object.keys(patch).length === 0) {
      addToast({ variant: "info", title: "No changes to save" });
      return;
    }
    setActing(true);
    try {
      await tweakClaimFields(detail.id, patch);
      await logAdminAction("claim.tweak_fields", "venue_claim", detail.id, { patch });
      addToast({ variant: "info", title: "Fields updated" });
      // Reload bundle + refresh the underlying row's address/category locally.
      setDetail((d) =>
        d
          ? {
              ...d,
              address: "address" in patch ? patch.address : d.address,
              venue_category:
                "venue_category" in patch ? patch.venue_category : d.venue_category,
            }
          : d,
      );
      await loadBundle(detail.id);
    } catch (e) {
      addToast({
        variant: "error",
        title: "Couldn't update fields",
        description: e?.message ?? String(e),
      });
    } finally {
      setActing(false);
    }
  };


  // ORCH-1066 — score editing moved to <ScoreTunerPanel> (place-keyed set/pin,
  // works from zero, with live preview + projected rank). The brand-keyed
  // overrideClaimScore + its submitScoreOverride handler were removed here; the
  // RPC remains in the codebase for the approval score_vetoes channel (SC-8).

  const phoneInfo = detail ? resolveClaimDisplayPhone(detail) : null;
  const tel = phoneInfo ? formatPhoneHref(phoneInfo.phone) : null;
  const mapsUri = detail
    ? (detail.place_pool?.google_maps_uri ??
      (detail.google_place_id
        ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(detail.google_place_id)}`
        : null))
    : null;
  // META-ORCH-1255(C): the duplicate pointer is venue-keyed (M4 sets
  // duplicate_of_venue_id on the venue row).
  const isDuplicateOfApproved = Boolean(detail?.duplicate_of_venue_id);
  const canApprove = !isDuplicateOfApproved;

  // META-ORCH-1062 — derived bundle views for the modal.
  const pp = bundle?.place_pool ?? null;
  const photos = useMemo(
    () => (detail ? collectClaimPhotos(bundle, detail.cover_media_url) : []),
    [bundle, detail],
  );
  const scores = Array.isArray(bundle?.scores) ? bundle.scores : [];
  // ORCH-1064 — the active feedback round's items (grouped by category for the
  // read-only status view). bundle.feedback is the active round only.
  const feedbackRows = useMemo(
    () => (Array.isArray(bundle?.feedback) ? bundle.feedback : []),
    [bundle],
  );
  const feedbackByCategory = useMemo(() => {
    const groups = new Map();
    for (const row of feedbackRows) {
      const list = groups.get(row.category) ?? [];
      list.push(row);
      groups.set(row.category, list);
    }
    return FEEDBACK_CAT_ORDER.filter((c) => groups.has(c)).map((c) => ({
      category: c,
      items: groups.get(c),
    }));
  }, [feedbackRows]);
  const isPending = detail?.claim_status
    ? detail.claim_status === "pending_review"
    : activeTab === "pending";
  const aestheticScore =
    pp?.photo_aesthetic_data && typeof pp.photo_aesthetic_data === "object"
      ? pp.photo_aesthetic_data.score ?? null
      : null;
  const submitterPitch =
    pp?.business_authoring_inputs?.tier1?.description ??
    pp?.business_authoring_inputs?.tier1?.pitch ??
    null;
  const bouncerReasonChips =
    typeof pp?.bouncer_reason === "string" && pp.bouncer_reason.length > 0
      ? pp.bouncer_reason.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
      : [];

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

      <div ref={resultsRef} tabIndex={-1} aria-live="polite">
        <SectionCard
          title={`${CLAIM_TABS.find((tab) => tab.id === activeTab)?.label ?? "Pending review"} (${rows.length})`}
          subtitle={
            activeTab === "pending"
              ? "Oldest first · review pending venue claims"
              : "Reviewed venue claims"
          }
        >
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : listError ? (
          <div
            className="rounded-lg border border-[var(--color-error-600)] bg-[var(--color-error-50)] p-4 text-sm text-[var(--color-error-700)]"
            role="alert"
          >
            <p>{listError}</p>
            <Button
              variant="secondary"
              className="mt-3 min-h-11"
              onClick={() => {
                if (activeTab === "verified" && approvalRefreshVenue) {
                  void retryVerified(approvalRefreshVenue.id);
                } else {
                  void load(activeTab);
                }
              }}
            >
              {activeTab === "verified" && approvalRefreshVenue
                ? "Retry Verified"
                : "Retry"}
            </Button>
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
                      isDuplicateOfApproved={Boolean(r.duplicate_of_venue_id)}
                      onSelect={() => openDetail(r)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </SectionCard>
      </div>

      <Modal
        open={!!detail}
        onClose={closeDetail}
        title={
          detail
            ? detail.brand?.name
              ? `${detail.name} — ${detail.brand.name}`
              : detail.name
            : "Venue"
        }
      >
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">Called</Badge>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      Called {formatDateTime(detail.marked_called_at)}
                    </span>
                  </div>
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
              {/* META-ORCH-1062 — inline photo gallery (cover + stored + gallery). */}
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-2">
                  Photos {photos.length > 0 ? `(${photos.length})` : ""}
                </div>
                {bundleLoading && photos.length === 0 ? (
                  <div className="flex items-center gap-2 text-[var(--color-text-tertiary)]">
                    <Spinner /> <span>Loading photos…</span>
                  </div>
                ) : bundleError ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
                    Couldn't load photos: {bundleError}
                  </div>
                ) : photos.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    No photos submitted yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {photos.map((url, i) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setLightboxIndex(i)}
                        className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
                        aria-label={`Open photo ${i + 1}`}
                      >
                        <img
                          src={url}
                          alt={`Venue photo ${i + 1}`}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* META-ORCH-1062 — quality signals: bouncer verdict + place_scores + aesthetic. */}
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-2">Quality signals</div>
                {bundleLoading && !pp ? (
                  <div className="flex items-center gap-2 text-[var(--color-text-tertiary)]">
                    <Spinner /> <span>Loading scores…</span>
                  </div>
                ) : bundleError ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
                    Couldn't load scores: {bundleError}
                  </div>
                ) : !pp ? (
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    No linked place to score.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={pp.is_servable ? "success" : "warning"}>
                        {pp.is_servable ? "Passes bouncer" : "Bounced"}
                      </Badge>
                      {bouncerReasonChips.map((r) => (
                        <span
                          key={r}
                          className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[var(--color-text-secondary)]"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-tertiary)] mb-1">
                        Aesthetic:{" "}
                        {aestheticScore != null ? aestheticScore : "Not scored"}
                      </div>
                      {scores.length === 0 ? (
                        <p className="text-xs text-[var(--color-text-tertiary)]">
                          Not yet scored — scoring runs on approve.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {scores.map((s) => (
                            <li
                              key={s.signal_id}
                              className="flex justify-between gap-4 text-xs"
                            >
                              <span className="text-[var(--color-text-secondary)]">
                                {s.signal_id}
                              </span>
                              <span className="font-mono">{Math.round(s.score)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Canonical discovery money + provider metadata / submitter pitch. */}
              {pp && (detail.discovery_price || pp.price_level || pp.website || submitterPitch) ? (
                <div className="space-y-2">
                  {detail.discovery_price ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-[var(--color-text-tertiary)]">Discovery price</div>
                      <div>
                        {detail.discovery_price.status === "active"
                          ? `${detail.discovery_price.source_min_minor}–${detail.discovery_price.source_max_minor ?? "open"} minor · ${detail.discovery_price.source_currency_code}`
                          : detail.discovery_price.status === "legacy_unresolved"
                            ? "Needs price range review"
                            : "Currency reconciliation required"}
                      </div>
                    </div>
                  ) : null}
                  {pp.price_level ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-[var(--color-text-tertiary)]">Provider price ordinal</div>
                      <div>{pp.price_level}</div>
                    </div>
                  ) : null}
                  {pp.website ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-[var(--color-text-tertiary)]">Website</div>
                      <a
                        href={pp.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--color-brand-400)] underline break-all"
                      >
                        {pp.website}
                      </a>
                    </div>
                  ) : null}
                  {submitterPitch ? (
                    <div>
                      <div className="text-[var(--color-text-tertiary)] mb-1">
                        Submitter pitch
                      </div>
                      <div className="whitespace-pre-wrap">{submitterPitch}</div>
                    </div>
                  ) : null}
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

              {/* META-ORCH-1062 — admin tweak + score override (pending claims only). */}
              {isPending ? (
                <div className="space-y-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide">
                    Admin adjustments
                  </div>

                  {/* #2099 — extracted panel (Amendment 4 §D3). ClaimsPage only
                      supplies the selected venue and the reload callbacks; the panel
                      owns preview/proposal state and the HighRiskActionModal review. */}
                  <PendingVenueIdentityCorrectionPanel
                    key={detail.id}
                    venue={detail}
                    onCorrected={reloadAfterIdentityCorrection}
                  />

                  <div className="space-y-2">
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      Tweak fields
                    </div>
                    <label className="block text-xs text-[var(--color-text-tertiary)]">
                      Address
                      <input
                        type="text"
                        value={tweakAddress}
                        onChange={(e) => setTweakAddress(e.target.value)}
                        disabled={acting}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                      />
                    </label>
                    <label className="block text-xs text-[var(--color-text-tertiary)]">
                      Category
                      <select
                        value={tweakCategory}
                        onChange={(e) => setTweakCategory(e.target.value)}
                        disabled={acting}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                      >
                        <option value="">—</option>
                        {Object.entries(CAT_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs text-[var(--color-text-tertiary)]">
                      Price level
                      <input
                        type="text"
                        value={tweakPriceLevel}
                        onChange={(e) => setTweakPriceLevel(e.target.value)}
                        placeholder={pp?.price_level ?? "PRICE_LEVEL_MODERATE"}
                        disabled={acting}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                      />
                    </label>
                    <Button
                      variant="secondary"
                      onClick={() => void submitTweak()}
                      disabled={acting}
                    >
                      Save field tweaks
                    </Button>
                  </div>

                  {/* ORCH-1066 — deck score tuner: seed (from zero) + per-signal
                      set/pin + live card preview + projected rank. Replaces the
                      dead-end "available after approve" copy + the brand-keyed
                      override grid. projected=true: the venue is pending/non-servable
                      so rank is a projection ("goes live when you approve"). */}
                  {detail.place_pool_id ? (
                    <ScoreTunerPanel
                      placePoolId={detail.place_pool_id}
                      placeData={{
                        id: detail.place_pool_id,
                        name: detail.name,
                        stored_photo_urls: pp?.stored_photo_urls ?? null,
                        rating: pp?.rating ?? null,
                        price_level: pp?.price_level ?? null,
                        price_tiers: pp?.price_tiers ?? null,
                        source_min_minor:
                          detail.discovery_price?.status === "active"
                            ? detail.discovery_price.source_min_minor
                            : null,
                        source_max_minor:
                          detail.discovery_price?.status === "active"
                            ? detail.discovery_price.source_max_minor
                            : null,
                        source_currency_code:
                          detail.discovery_price?.status === "active"
                            ? detail.discovery_price.source_currency_code
                            : null,
                        source_minor_unit_exponent: 2,
                        generative_summary: pp?.generative_summary ?? null,
                        primary_type: null,
                        types: null,
                        lat: detail.lat ?? null,
                        lng: detail.lng ?? null,
                        is_servable: pp?.is_servable ?? false,
                        is_active: pp?.is_active ?? true,
                      }}
                      scores={scores}
                      signals={activeSignals}
                      projected
                      density="modal"
                      loading={bundleLoading && scores.length === 0}
                      error={bundleError}
                      onAfterWrite={() => loadBundle(detail.id)}
                      onRetry={() => loadBundle(detail.id)}
                      addToast={addToast}
                    />
                  ) : (
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      No linked place — scoring is unavailable for this claim.
                    </p>
                  )}
                </div>
              ) : null}

              {/* ORCH-1064 — feedback to the business (pending claims only). Each
                  Send opens a fresh round, moves the claim to need_more_info, and
                  pushes the owner; the current round's items + their fixed status
                  render read-only below. */}
              {isPending ? (
                <div className="space-y-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 text-[var(--color-text-tertiary)] text-xs uppercase tracking-wide">
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    Feedback to business
                  </div>

                  {/* Staged items */}
                  {feedbackItems.length > 0 ? (
                    <div className="space-y-1.5">
                      {feedbackItems.map((item, i) => (
                        <div
                          key={`${item.category}-${i}`}
                          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs"
                        >
                          <span className="font-medium text-[var(--color-text-primary)]">
                            {FEEDBACK_CAT_LABELS[item.category]}
                          </span>
                          <span className="flex-1 truncate text-[var(--color-text-secondary)]">
                            {item.note}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFeedbackItem(i)}
                            disabled={acting}
                            aria-label="Remove feedback item"
                            className="rounded p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* Add-item composer */}
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-[var(--color-text-tertiary)]">
                      Category
                      <select
                        value={feedbackCat}
                        onChange={(e) => setFeedbackCat(e.target.value)}
                        disabled={acting}
                        className="mt-1 block w-36 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                      >
                        {FEEDBACK_CAT_ORDER.map((c) => (
                          <option key={c} value={c}>
                            {FEEDBACK_CAT_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex-1 min-w-[10rem] text-xs text-[var(--color-text-tertiary)]">
                      Note
                      <input
                        type="text"
                        value={feedbackNote}
                        onChange={(e) => setFeedbackNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addFeedbackItem();
                          }
                        }}
                        placeholder="What needs fixing?"
                        disabled={acting}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                      />
                    </label>
                    <Button
                      variant="secondary"
                      onClick={addFeedbackItem}
                      disabled={acting}
                    >
                      Add item
                    </Button>
                  </div>

                  {/* Optional overall message */}
                  <label className="block text-xs text-[var(--color-text-tertiary)]">
                    Overall message (optional)
                    <textarea
                      value={feedbackMessage}
                      onChange={(e) => setFeedbackMessage(e.target.value)}
                      placeholder="Optional message to the business (one per round)."
                      disabled={acting}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                    />
                  </label>

                  <Button
                    variant="primary"
                    onClick={() => void submitFeedback()}
                    disabled={acting || feedbackItems.length === 0}
                  >
                    Send feedback
                  </Button>

                  {/* Current round status (read-only) */}
                  {feedbackByCategory.length > 0 ? (
                    <div className="space-y-2 border-t border-white/10 pt-3">
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        Current round — what the business has addressed
                      </div>
                      {feedbackByCategory.map((group) => (
                        <div key={group.category} className="space-y-1">
                          <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                            {FEEDBACK_CAT_LABELS[group.category]}
                          </div>
                          {group.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 text-xs"
                            >
                              <span className="flex-1 text-[var(--color-text-secondary)]">
                                {item.note}
                              </span>
                              <Badge
                                variant={item.status === "fixed" ? "success" : "warning"}
                              >
                                {item.status === "fixed" ? "Fixed" : "Open"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ))}
                      {feedbackRows[0]?.overall_message ? (
                        <p className="text-[11px] italic text-[var(--color-text-tertiary)]">
                          “{feedbackRows[0].overall_message}”
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/*
                META-ORCH-1009 Sub-F WS7 recommendation profile (PRESERVED in the
                #299 merge): AI pitch + operator answers (facets) + AI consistency
                check from business_authoring_inputs. The simple WS7 photo gallery
                and the WS7 reduce-only signal-score veto editor were REMOVED here
                — the canonical gallery is the PhotoLightbox grid above, and score
                editing is the META-ORCH-1062 bidirectional override above. Approve
                no longer depends on score_vetoes (the go-live path is now the
                Phase 4 servable-flip → scorer, not WS7 vetoes); admin-review-
                venue-claim still ACCEPTS score_vetoes for backward-compat.
              */}
              {(() => {
                const recoPp = detail.place_pool ?? bundle?.place_pool ?? {};
                const inputs = recoPp.business_authoring_inputs ?? {};
                const consistency = inputs.consistency ?? null;
                const facets =
                  inputs.confirmed_ai_outputs?.facets ?? inputs.tier2?.facets ?? {};
                return (
                  <div className="mt-2 border-t border-[var(--color-border)] pt-4 space-y-4">
                    <div className="text-[var(--color-text-primary)] font-semibold">
                      Recommendation profile
                    </div>
                    <div className="text-xs text-[var(--color-text-tertiary)]">
                      {recoPp.business_recommend_edit_count ?? 0} recommend run(s) ·{" "}
                      {recoPp.website ? (
                        <a href={recoPp.website} target="_blank" rel="noreferrer" className="text-[var(--color-brand-400)] underline">
                          website
                        </a>
                      ) : "no website"}
                    </div>

                    {recoPp.generative_summary ? (
                      <div>
                        <div className="text-[var(--color-text-tertiary)] mb-1">AI pitch</div>
                        <div className="whitespace-pre-wrap text-sm">{recoPp.generative_summary}</div>
                      </div>
                    ) : null}

                    {Object.keys(facets).length > 0 ? (
                      <div>
                        <div className="text-[var(--color-text-tertiary)] mb-1">Operator answers</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {Object.entries(facets).map(([k, v]) => (
                            <span key={k}>
                              {k.replace(/_/g, " ")}: <b>{v === true ? "Yes" : v === false ? "No" : "—"}</b>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {consistency ? (
                      <div>
                        <div className="text-[var(--color-text-tertiary)] mb-1">
                          AI consistency check
                        </div>
                        <div className="text-sm">
                          <b>{consistency.verdict ?? "—"}</b>
                          {consistency.confidence_0_to_100 != null
                            ? ` (${consistency.confidence_0_to_100}%)`
                            : ""}
                          {consistency.summary ? ` — ${consistency.summary}` : ""}
                        </div>
                        {Array.isArray(consistency.flags) && consistency.flags.length > 0 ? (
                          <ul className="list-disc ml-5 text-xs text-amber-200/90 mt-1">
                            {consistency.flags.map((f, i) => (
                              <li key={i}>{String(f)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          )}
        </ModalBody>
        <ModalFooter className="!grid grid-cols-2 gap-2 max-md:!px-4 md:!flex md:flex-wrap md:justify-end">
          {reviewError && reviewError.action !== "reject" ? (
            <div
              ref={reviewErrorRef}
              role="alert"
              tabIndex={-1}
              className="col-span-2 w-full rounded-lg border border-[var(--color-error-500)] bg-[var(--color-error-50)] p-3 text-sm text-[var(--color-error-700)] md:basis-full"
            >
              <p className="font-semibold">{reviewError.title}</p>
              <p className="mt-1">{reviewError.detail}</p>
            </div>
          ) : null}
          {isDuplicateOfApproved ? (
            <p
              id="claim-duplicate-approve-help"
              className="col-span-2 w-full text-xs text-[var(--color-warning-700)] md:basis-full"
            >
              Resolve duplicate — reject this claim first.
            </p>
          ) : null}
          <Button
            variant="secondary"
            className="min-h-11 h-auto w-full whitespace-normal md:mr-auto md:w-auto"
            onClick={closeDetail}
            disabled={acting}
          >
            Close
          </Button>
          <Button
            ref={(node) => { actionRefs.current.need_more_info = node; }}
            variant="secondary"
            className="min-h-11 h-auto w-full whitespace-normal md:w-auto"
            onClick={() => void runReview("need_more_info")}
            disabled={acting}
            loading={reviewingAction === "need_more_info"}
            aria-busy={reviewingAction === "need_more_info"}
          >
            {reviewingAction === "need_more_info"
              ? "Requesting info…"
              : "Need more info"}
          </Button>
          <Button
            ref={(node) => { actionRefs.current.reject = node; }}
            variant="danger"
            className="min-h-11 h-auto w-full whitespace-normal md:w-auto"
            onClick={openReject}
            disabled={acting}
          >
            Reject
          </Button>
          {detail?.marked_called_at ? (
            <span className="flex min-h-11 w-full items-center justify-center text-sm text-[var(--color-text-secondary)] md:w-auto">
              Called {formatDateTime(detail.marked_called_at)}
            </span>
          ) : (
            <Button
              ref={(node) => { actionRefs.current.mark_called = node; }}
              variant="secondary"
              className="min-h-11 h-auto w-full whitespace-normal md:w-auto"
              onClick={() => void runReview("mark_called")}
              disabled={acting}
              loading={reviewingAction === "mark_called"}
              aria-busy={reviewingAction === "mark_called"}
            >
              {reviewingAction === "mark_called"
                ? "Marking called…"
                : "Mark as called"}
            </Button>
          )}
          <Button
            ref={(node) => { actionRefs.current.approve = node; }}
            variant="primary"
            className={`col-span-2 min-h-11 h-auto w-full whitespace-normal md:w-auto ${
              !canApprove && !acting ? "opacity-50 cursor-not-allowed" : ""
            }`}
            onClick={() => {
              if (canApprove) void runReview("approve");
            }}
            disabled={acting}
            loading={reviewingAction === "approve"}
            aria-busy={reviewingAction === "approve"}
            aria-disabled={!canApprove || undefined}
            aria-describedby={
              isDuplicateOfApproved ? "claim-duplicate-approve-help" : undefined
            }
          >
            {reviewingAction === "approve" ? "Approving…" : "Approve"}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Why is this claim being declined?"
      >
        <ModalBody>
          {reviewError?.action === "reject" ? (
            <div
              ref={reviewErrorRef}
              role="alert"
              tabIndex={-1}
              className="mb-3 rounded-lg border border-[var(--color-error-500)] bg-[var(--color-error-50)] p-3 text-sm text-[var(--color-error-700)]"
            >
              <p className="font-semibold">{reviewError.title}</p>
              <p className="mt-1">{reviewError.detail}</p>
            </div>
          ) : null}
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            This is emailed to the operator. They can submit again after rejection.
          </p>
          <textarea
            ref={rejectReasonRef}
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
          <Button
            ref={(node) => { actionRefs.current.reject = node; }}
            variant="danger"
            className="min-h-11 h-auto whitespace-normal"
            onClick={() => void confirmReject()}
            disabled={acting}
            loading={reviewingAction === "reject"}
            aria-busy={reviewingAction === "reject"}
          >
            {reviewingAction === "reject" ? "Rejecting…" : "Confirm reject"}
          </Button>
        </ModalFooter>
      </Modal>

      {/* META-ORCH-1062 — full-screen photo viewer (Esc/arrows/click-outside). */}
      {lightboxIndex != null && photos.length > 0 ? (
        <PhotoLightbox
          photos={photos}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  );
}

export default ClaimsPage;
