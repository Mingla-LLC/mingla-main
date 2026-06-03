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
import { PhotoLightbox } from "../components/ui/PhotoLightbox";
import { useToast } from "../context/ToastContext";
import { logAdminAction } from "../lib/auditLog";
import { resolveClaimDisplayPhone, formatPhoneHref } from "../lib/claimsPhone";
import { ClaimRow } from "../components/claims/ClaimRow";
import {
  getClaimReviewBundle,
  groupClaimsByGooglePlaceId,
  listPendingClaims,
  listRejectedClaims,
  listVerifiedClaims,
  overrideClaimScore,
  reviewClaim,
  tweakClaimFields,
} from "../services/adminClaimsService";
import { collectClaimPhotos } from "../lib/claimPhotos";

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
  // META-ORCH-1062 — claim-review bundle (photos + scores + missing fields).
  const [bundle, setBundle] = useState(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  // Tweak form (address / category / price), pending-only.
  const [tweakAddress, setTweakAddress] = useState("");
  const [tweakCategory, setTweakCategory] = useState("");
  const [tweakPriceLevel, setTweakPriceLevel] = useState("");
  // Score override draft per signal: { [signalId]: { score, reason } }.
  const [scoreDraft, setScoreDraft] = useState({});

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
    setScoreDraft({});
    setTweakAddress(row.address ?? "");
    setTweakCategory(row.venue_category ?? "");
    setTweakPriceLevel("");
    setHoursLoading(true);
    // META-ORCH-1062 — fetch photos + scores + missing fields in parallel.
    void loadBundle(row.id);
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
    setBundle(null);
    setBundleError(null);
    setLightboxIndex(null);
    setScoreDraft({});
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

  // META-ORCH-1062 Q2 — apply a bidirectional score override for one signal.
  const submitScoreOverride = async (signalId) => {
    if (!detail) return;
    const draft = scoreDraft[signalId] ?? {};
    const score = Number(draft.score);
    if (!Number.isFinite(score) || score < 0 || score > 200) {
      addToast({
        variant: "warning",
        title: "Score must be 0–200",
      });
      return;
    }
    setActing(true);
    try {
      const res = await overrideClaimScore(detail.id, signalId, score, draft.reason);
      await logAdminAction("claim.score_override", "venue_claim", detail.id, {
        signal_id: signalId,
        score,
      });
      const dir = res?.result?.direction ?? "updated";
      addToast({ variant: "info", title: `Score ${dir}`, description: `${signalId} → ${score}` });
      await loadBundle(detail.id);
    } catch (e) {
      addToast({
        variant: "error",
        title: "Couldn't override score",
        description: e?.message ?? String(e),
      });
    } finally {
      setActing(false);
    }
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

  // META-ORCH-1062 — derived bundle views for the modal.
  const pp = bundle?.place_pool ?? null;
  const photos = useMemo(
    () => (detail ? collectClaimPhotos(bundle, detail.cover_media_url) : []),
    [bundle, detail],
  );
  const scores = Array.isArray(bundle?.scores) ? bundle.scores : [];
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

              {/* META-ORCH-1062 — missing fields (price / website / submitter pitch). */}
              {pp && (pp.price_level || pp.website || submitterPitch) ? (
                <div className="space-y-2">
                  {pp.price_level ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-[var(--color-text-tertiary)]">Price level</div>
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

                  {scores.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        Score override (0–200; raises or lowers deck rank)
                      </div>
                      {scores.map((s) => (
                        <div key={s.signal_id} className="flex flex-wrap items-end gap-2">
                          <div className="text-xs">
                            <div className="text-[var(--color-text-tertiary)]">
                              {s.signal_id} (now {Math.round(s.score)})
                            </div>
                            <input
                              type="number"
                              min={0}
                              max={200}
                              value={scoreDraft[s.signal_id]?.score ?? ""}
                              placeholder={String(Math.round(s.score))}
                              onChange={(e) =>
                                setScoreDraft((d) => ({
                                  ...d,
                                  [s.signal_id]: {
                                    ...(d[s.signal_id] ?? {}),
                                    score: e.target.value,
                                  },
                                }))
                              }
                              disabled={acting}
                              className="mt-1 w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-[var(--color-text-primary)]"
                            />
                          </div>
                          <input
                            type="text"
                            placeholder="reason"
                            value={scoreDraft[s.signal_id]?.reason ?? ""}
                            onChange={(e) =>
                              setScoreDraft((d) => ({
                                ...d,
                                [s.signal_id]: {
                                  ...(d[s.signal_id] ?? {}),
                                  reason: e.target.value,
                                },
                              }))
                            }
                            disabled={acting}
                            className="flex-1 min-w-[8rem] rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-[var(--color-text-primary)]"
                          />
                          <Button
                            variant="secondary"
                            onClick={() => void submitScoreOverride(s.signal_id)}
                            disabled={acting}
                          >
                            Apply
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      Score override available after the venue is scored (on approve).
                    </p>
                  )}
                </div>
              ) : null}
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
