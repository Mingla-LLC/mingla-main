/**
 * #2099 — Admin pending-venue identity correction panel.
 *
 * SPEC + Amendments 1–5. Extracted out of `ClaimsPage.jsx` per Amendment 4 §D3
 * so the correction owns its own state and can be rendered directly by the
 * behavioural/browser harness. `ClaimsPage` only supplies the selected venue
 * and the reload callbacks.
 *
 * The shared `HighRiskActionModal` is REUSED UNCHANGED (Amendment 5 §E1/§E3);
 * this panel must never modify, fork, copy, or replace it.
 *
 * State ownership
 * ---------------
 *   - `preview`  — SERVER truth. Replaced wholesale on every refresh.
 *   - `proposal` — OPERATOR truth (name/slug/category only). A refreshed preview
 *     seeds a field ONLY while that field is still untouched; once edited it is
 *     never overwritten by a load, Retry, or stale recovery.
 *   - reason + confirmation phrase — owned INTERNALLY by `HighRiskActionModal`.
 *     The panel never caches, copies, restores, infers, or replays them.
 *
 * Amendment 5 §E1 — on `STALE_VERSION` / `DEPENDENCY_SCHEMA_CHANGED` the panel
 * keeps the proposed name/slug/category, produces NO success toast and NO
 * detail/list reload, UNMOUNTS the modal (clearing BOTH reason and phrase),
 * refreshes authoritative preview truth, and forces a brand-new Review with a
 * newly typed reason and a newly typed exact slug. That re-entry is deliberate
 * security friction: both values authorise a new decision against changed
 * evidence.
 *
 * Ordinary (non-stale) service/offline failures keep the existing modal open
 * with its reason and phrase preserved, per the modal's own thrown-error
 * contract.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { HighRiskActionModal } from "../entity/HighRiskActionModal";
import { Button } from "../ui/Button";
import {
  correctPendingVenueIdentity,
  previewPendingVenueIdentityCorrection,
} from "../../services/adminClaimsService";

const SLUG_PATTERN = /^[a-z0-9]{1,32}$/;

export const CORRECTION_CATEGORY_LABELS = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
  stay: "Stay",
};

/** Safe operator copy for every server code family. Never surfaces SQL or values. */
const CODE_COPY = {
  NOT_AUTHENTICATED: "Sign in again to correct this venue.",
  NOT_AUTHORIZED: "Only this brand's owner or a Mingla admin can correct this venue.",
  NOT_FOUND: "This venue no longer exists.",
  NOT_PENDING: "Only a venue still awaiting review can be corrected.",
  FOLLOW_UP_ACTIVE: "This venue has an open review follow-up, so it cannot be corrected.",
  IDENTITY_MISMATCH: "This venue's details changed. Reload and try again.",
  STALE_VERSION: "The venue changed while this form was open.",
  POOL_INELIGIBLE: "This venue's place record cannot be corrected here.",
  DEPENDENCY_NOT_EMPTY: "This venue is already in use, so its identity cannot be corrected.",
  DEPENDENCY_SCHEMA_CHANGED: "Mingla's data checks changed while this form was open.",
  SENSITIVE_STATE_NOT_EMPTY: "This venue has generated content that must be cleared first.",
  STAY_AUTHORING_DISABLED: "Correcting a venue to Stay is switched off right now.",
  CORRECTION_BUSY: "Another change is in progress. Try again in a moment.",
  REQUEST_CONFLICT: "This correction was already submitted with different details.",
  SLUG_COLLISION: "That URL is already used by another venue in this brand.",
  INVALID_NAME: "Enter a venue name between 1 and 80 characters.",
  INVALID_SLUG: "Use 1–32 lowercase letters or numbers for the URL.",
  INVALID_CATEGORY: "Choose one of the listed categories.",
  AUDIT_FAILED: "Mingla couldn't record this correction, so nothing changed.",
};

function safeCodeCopy(code) {
  if (!code) return "This venue cannot be corrected right now.";
  return CODE_COPY[code] ?? "This venue cannot be corrected right now.";
}

const STALE_CODES = new Set(["STALE_VERSION", "DEPENDENCY_SCHEMA_CHANGED"]);

export function PendingVenueIdentityCorrectionPanel({ venue, onCorrected }) {
  const [preview, setPreview] = useState(null);
  const [proposal, setProposal] = useState({ name: "", slug: "", category: "play" });
  const [touched, setTouched] = useState(() => new Set());
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  // Bumped on every stale recovery so a reopened modal is guaranteed to be a
  // brand-new instance with empty reason and empty confirmation phrase.
  const [reviewKey, setReviewKey] = useState(0);

  const touchedRef = useRef(touched);
  const submitInFlight = useRef(false);

  const setTouchedField = useCallback((field) => {
    setTouched((current) => {
      if (current.has(field)) return current;
      const next = new Set(current);
      next.add(field);
      touchedRef.current = next;
      return next;
    });
  }, []);

  const editField = useCallback(
    (field, value) => {
      setTouchedField(field);
      setProposal((current) => ({ ...current, [field]: value }));
      // Any proposal change invalidates reviewed evidence.
      setReviewOpen(false);
    },
    [setTouchedField],
  );

  /** Apply server truth without ever clobbering an edited field. */
  const applyPreview = useCallback((next) => {
    setPreview(next);
    if (next?.eligible) {
      setProposal((current) => ({
        name: touchedRef.current.has("name") ? current.name : next.current.name,
        slug: touchedRef.current.has("slug") ? current.slug : next.current.slug,
        category: touchedRef.current.has("category")
          ? current.category
          : next.current.category,
      }));
    }
  }, []);

  const check = useCallback(async () => {
    if (!venue) return;
    setChecking(true);
    setStatus("Checking whether this venue can be corrected.");
    try {
      const next = await previewPendingVenueIdentityCorrection(venue.id);
      applyPreview(next);
      setStatus(
        next?.eligible
          ? "This unused pending venue can be corrected."
          : safeCodeCopy(next?.code),
      );
    } catch {
      setPreview(null);
      setStatus("Couldn't check this venue. Retry when the connection is available.");
    } finally {
      setChecking(false);
    }
  }, [applyPreview, venue]);

  /** Amendment 5 §E1 steps 2–5. */
  const recoverFromStale = useCallback(
    async (code) => {
      setReviewOpen(false); // unmounts the modal → reason AND phrase cleared
      setReviewKey((n) => n + 1);
      await check();
      setStatus(
        `${safeCodeCopy(code)} Review the refreshed details and confirm again with a new reason.`,
      );
    },
    [check],
  );

  const proposalValid =
    proposal.name.trim().length > 0 &&
    proposal.name.trim().length <= 80 &&
    SLUG_PATTERN.test(proposal.slug);

  const canReview = Boolean(preview?.eligible) && proposalValid;

  const handleConfirm = useCallback(
    async ({ reason }) => {
      if (!preview?.eligible) throw new Error("This venue can no longer be corrected.");
      if (submitInFlight.current) return;
      submitInFlight.current = true;
      try {
        const requestId =
          globalThis.crypto?.randomUUID?.() ??
          `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
        const result = await correctPendingVenueIdentity({
          preview,
          name: proposal.name,
          slug: proposal.slug,
          category: proposal.category,
          reason,
          requestId,
        });
        if (!result?.ok) {
          if (STALE_CODES.has(result?.code)) {
            // Do NOT throw: throwing would keep the modal open with the old
            // reason/phrase intact, which Amendment 5 forbids. Recover instead,
            // and swallow the success path by unmounting before it can toast.
            await recoverFromStale(result.code);
            return;
          }
          // Ordinary failure — modal stays open, reason + phrase preserved.
          throw new Error(safeCodeCopy(result?.code));
        }
        onCorrected?.();
      } finally {
        submitInFlight.current = false;
      }
    },
    [onCorrected, preview, proposal],
  );

  const dependencyCounts = useMemo(
    () => preview?.dependency_counts ?? [],
    [preview],
  );

  if (!venue) return null;

  return (
    <div
      className="space-y-3 rounded-lg border border-white/10 bg-black/10 p-3"
      data-testid="issue-2099-admin-panel"
    >
      <div className="text-xs font-semibold text-[var(--color-text-primary)]">
        Correct venue identity
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Keeps the same venue, owner and location. Only the unused pending name, URL and
        category change.
      </p>

      {!preview ? (
        <Button
          variant="secondary"
          onClick={() => void check()}
          disabled={checking}
          data-testid="issue-2099-admin-check"
        >
          {checking ? "Checking…" : "Check eligibility"}
        </Button>
      ) : (
        <>
          <p
            className="rounded-lg bg-white/5 p-2 text-xs text-[var(--color-text-secondary)]"
            data-testid="issue-2099-admin-current"
          >
            Current: {preview.current?.name} · {preview.current?.slug} ·{" "}
            {CORRECTION_CATEGORY_LABELS[preview.current?.category] ?? preview.current?.category}
          </p>

          <label className="block text-xs text-[var(--color-text-tertiary)]" htmlFor="issue-2099-admin-name">
            Proposed name
            <input
              id="issue-2099-admin-name"
              data-testid="issue-2099-admin-name"
              aria-describedby="issue-2099-admin-status"
              value={proposal.name}
              onChange={(e) => editField("name", e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--color-text-primary)]"
            />
          </label>

          <label className="block text-xs text-[var(--color-text-tertiary)]" htmlFor="issue-2099-admin-slug">
            Proposed URL slug
            <input
              id="issue-2099-admin-slug"
              data-testid="issue-2099-admin-slug"
              aria-describedby="issue-2099-admin-slug-error issue-2099-admin-status"
              value={proposal.slug}
              onChange={(e) => editField("slug", e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <p id="issue-2099-admin-slug-error" className="text-xs text-[var(--color-text-secondary)]">
            {proposal.slug.length > 0 && !SLUG_PATTERN.test(proposal.slug)
              ? "Use 1–32 lowercase letters or numbers."
              : ""}
          </p>

          <label className="block text-xs text-[var(--color-text-tertiary)]" htmlFor="issue-2099-admin-category">
            Proposed category
            <select
              id="issue-2099-admin-category"
              data-testid="issue-2099-admin-category"
              aria-describedby="issue-2099-admin-status"
              value={proposal.category}
              onChange={(e) => editField("category", e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-[var(--color-text-primary)]"
            >
              {Object.entries(CORRECTION_CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <DependencyCounts counts={dependencyCounts} testId="issue-2099-admin-dependency-counts" />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void check()}
              disabled={checking}
              data-testid="issue-2099-admin-recheck"
            >
              Retry check
            </Button>
            <Button
              onClick={() => setReviewOpen(true)}
              disabled={!canReview}
              data-testid="issue-2099-admin-review"
            >
              Review correction
            </Button>
          </div>
        </>
      )}

      <p
        id="issue-2099-admin-status"
        data-testid="issue-2099-admin-status"
        aria-live="polite"
        className="min-h-5 text-xs text-[var(--color-text-secondary)]"
      >
        {status}
      </p>

      {reviewOpen ? (
        <HighRiskActionModal
          key={reviewKey}
          open
          onClose={() => setReviewOpen(false)}
          title="Correct pending venue"
          description="This rewrites the pending venue's name, URL and category. The venue, its owner, its place record and its location do not change."
          confirmLabel="Correct pending venue"
          destructive
          requireReason
          reasonLabel="Audit reason (required)"
          confirmPhrase={proposal.slug}
          onConfirm={handleConfirm}
          successMessage="Pending venue identity corrected"
        >
          <div className="space-y-1 text-xs text-[var(--color-text-secondary)]" data-testid="issue-2099-admin-review-body">
            <div>
              Name: {preview?.current?.name} → {proposal.name.trim()}
            </div>
            <div>
              URL: {preview?.current?.slug} → {proposal.slug}
            </div>
            <div>
              Category:{" "}
              {CORRECTION_CATEGORY_LABELS[preview?.current?.category] ?? preview?.current?.category}{" "}
              → {CORRECTION_CATEGORY_LABELS[proposal.category] ?? proposal.category}
            </div>
            <div>The venue, brand, place record and location are unchanged.</div>
            <div>
              Reservations and availability reset to their unbooked defaults, and the listing
              stays awaiting review.
            </div>
            <DependencyCounts counts={dependencyCounts} testId="issue-2099-admin-review-counts" />
          </div>
        </HighRiskActionModal>
      ) : null}
    </div>
  );
}

function DependencyCounts({ counts, testId }) {
  if (!counts || counts.length === 0) return null;
  return (
    <div className="space-y-0.5 text-xs text-[var(--color-text-secondary)]" data-testid={testId}>
      <div className="text-[var(--color-text-tertiary)]">What this venue currently has</div>
      {counts.map((lane) => (
        <div key={lane.safe_label}>
          {lane.safe_label}: {lane.count} ({lane.classification})
        </div>
      ))}
    </div>
  );
}
