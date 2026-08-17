/**
 * #2099 — Business web pending-venue identity correction dialog.
 *
 * SPEC + Amendments 1–5, §D2/§D3. This module is WEB-ONLY and is reached only
 * through `PendingVenueIdentityCorrectionLauncher.web.tsx`'s on-intent dynamic
 * import, so neither the native import graph nor the eager web boot chunk ever
 * contains it. Nothing here may be imported from a shared (extensionless)
 * module.
 *
 * State ownership (D3 "shared proposal-preservation rule"):
 *   - `preview` is SERVER truth. It is replaced wholesale by every refresh.
 *   - `proposal` is OPERATOR truth. A refreshed preview seeds a proposal field
 *     ONLY while that field is still untouched (`touched` set). Once the
 *     operator edits a field, no load / Retry / stale recovery may overwrite
 *     it. Closing the dialog discards both, so reopening starts fresh.
 *
 * Review is the fresh explicit confirmation: any proposal edit or preview
 * refresh drops back to Edit and invalidates the review.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";

// Amendment 7 §G5 / Amendment 8 §H7 — KEY FACTORIES ONLY, read-only. React
// Query dispatches on the key, so invalidating here reaches every mounted
// observer wherever it lives — including the availability and reservation
// modules inside `VenueSuiteShell`, which #2099 may not edit. None of these
// modules' hooks is called from this file.
import { brandKeys } from "../../hooks/brandKeys";
import { brandPlacePipelineKeys } from "../../hooks/useBrandPlacePipelineState";
import { venueAvailabilityKeys } from "../../hooks/useVenueAvailability";
import { venueListingKeys } from "../../hooks/useVenueListings";
import { venueReservationSettingsKeys } from "../../hooks/useVenueReservationSettings";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import {
  accent,
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  correctPendingVenueIdentity,
  previewPendingVenueIdentityCorrection,
  type PendingVenueIdentityCorrectionCategory,
  type PendingVenueIdentityPreview,
} from "../../services/pendingVenueIdentityCorrectionService.web";

export const CORRECTION_CATEGORIES: readonly PendingVenueIdentityCorrectionCategory[] = [
  "restaurant",
  "play",
  "creative_and_arts",
  "stay",
] as const;

const SLUG_PATTERN = /^[a-z0-9]{1,32}$/;

/** Safe, operator-facing copy for every server code family we can receive. */
const INELIGIBLE_COPY: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in again to correct this venue.",
  NOT_AUTHORIZED: "Only this brand's owner or a Mingla admin can correct this venue.",
  NOT_FOUND: "This venue no longer exists.",
  NOT_PENDING: "Only a venue still awaiting review can be corrected.",
  FOLLOW_UP_ACTIVE: "This venue has an open review follow-up, so it cannot be corrected.",
  IDENTITY_MISMATCH: "This venue's details changed. Reload the page and try again.",
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

function safeCodeCopy(code: string | null | undefined): string {
  if (code === null || code === undefined || code.length === 0) {
    return "This venue cannot be corrected right now.";
  }
  return INELIGIBLE_COPY[code] ?? "This venue cannot be corrected right now.";
}

function categoryLabel(value: PendingVenueIdentityCorrectionCategory): string {
  return value.replaceAll("_", " ");
}

type Step = "edit" | "review";
type ProposalField = "name" | "slug" | "category" | "reason";

interface Proposal {
  name: string;
  slug: string;
  category: PendingVenueIdentityCorrectionCategory;
  reason: string;
}

export interface PendingVenueIdentityCorrectionDialogProps {
  visible: boolean;
  venueId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PendingVenueIdentityCorrectionDialog({
  visible,
  venueId,
  onClose,
  onSuccess,
}: PendingVenueIdentityCorrectionDialogProps): React.ReactElement {
  const [preview, setPreview] = useState<PendingVenueIdentityPreview | null>(null);
  const [proposal, setProposal] = useState<Proposal>({
    name: "",
    slug: "",
    category: "play",
    reason: "",
  });
  const [touched, setTouched] = useState<ReadonlySet<ProposalField>>(new Set());
  const [step, setStep] = useState<Step>("edit");
  const [status, setStatus] = useState("Checking whether this venue can be corrected.");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const queryClient = useQueryClient();
  // P1-A — the shared `Modal` centres an UNBOUNDED card: it grows with content
  // and the page behind it does not scroll (`body { overflow: hidden }`), so a
  // tall form pushes its own primary action past the fold with nothing able to
  // reach it. The Modal primitive is out of scope, so the bound and the scroller
  // live HERE, on the dialog's own content.
  const { height: viewportHeight } = useWindowDimensions();

  // Guards a second submit from an in-flight one even before React commits
  // `submitting` — Constitution #1/#3: the action can never double-fire.
  const submitInFlight = useRef(false);

  /**
   * Apply server truth without ever clobbering an edited field. Returns to Edit
   * and invalidates any prior Review, because the evidence just changed.
   */
  const applyPreview = useCallback((next: PendingVenueIdentityPreview): void => {
    setPreview(next);
    setStep("edit");
    if (next.eligible) {
      setProposal((current) => ({
        name: touchedHas(touchedRef.current, "name") ? current.name : next.current.name,
        slug: touchedHas(touchedRef.current, "slug") ? current.slug : next.current.slug,
        category: touchedHas(touchedRef.current, "category")
          ? current.category
          : next.current.category,
        reason: current.reason,
      }));
    }
  }, []);

  // `applyPreview` must read the LATEST touched set without re-creating itself
  // on every keystroke (which would restart the load effect).
  const touchedRef = useRef<ReadonlySet<ProposalField>>(touched);
  useEffect(() => {
    touchedRef.current = touched;
  }, [touched]);

  const loadPreview = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadFailed(false);
    setStatus("Checking whether this venue can be corrected.");
    try {
      const next = await previewPendingVenueIdentityCorrection(venueId);
      applyPreview(next);
      setStatus(
        next.eligible
          ? "This unused pending venue can be corrected."
          : safeCodeCopy(next.code),
      );
    } catch {
      setPreview(null);
      setLoadFailed(true);
      setStatus("Couldn't check this venue. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, [applyPreview, venueId]);

  // Close/reopen starts a fresh form (D3).
  useEffect(() => {
    if (!visible) {
      setPreview(null);
      setProposal({ name: "", slug: "", category: "play", reason: "" });
      setTouched(new Set());
      touchedRef.current = new Set();
      setStep("edit");
      setLoadFailed(false);
      setSubmitting(false);
      submitInFlight.current = false;
      setStatus("Checking whether this venue can be corrected.");
      return;
    }
    void loadPreview();
  }, [loadPreview, visible]);

  const editField = useCallback(
    <K extends ProposalField>(field: K, value: Proposal[K]): void => {
      setTouched((current) => {
        if (current.has(field)) return current;
        const next = new Set(current);
        next.add(field);
        touchedRef.current = next;
        return next;
      });
      setProposal((current) => ({ ...current, [field]: value }));
      // Any proposal change invalidates the reviewed evidence (D3).
      setStep("edit");
    },
    [],
  );

  // ---- Web focus trap + restore, Escape before (never during) submission ----
  useEffect(() => {
    if (!visible || Platform.OS !== "web" || globalThis.document === undefined) return;
    const doc = globalThis.document;
    const previouslyFocused = doc.activeElement as HTMLElement | null;
    const panel = doc.querySelector('[data-testid="issue-2099-correction-dialog"]');
    const focusable = (): HTMLElement[] =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        // Escape is allowed BEFORE submission and never during it.
        if (submitInFlight.current) event.preventDefault();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    doc.addEventListener("keydown", onKeyDown);
    return (): void => {
      doc.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
    // `step` is a dependency so the trap re-scans focusables after Edit↔Review.
  }, [step, visible]);

  const slugInvalid = proposal.slug.length > 0 && !SLUG_PATTERN.test(proposal.slug);
  const nameInvalid = proposal.name.length > 0 && proposal.name.trim().length === 0;

  const proposalComplete =
    proposal.name.trim().length > 0 &&
    proposal.name.trim().length <= 80 &&
    SLUG_PATTERN.test(proposal.slug) &&
    proposal.reason.trim().length > 0;

  const canReview = preview?.eligible === true && proposalComplete && !submitting;
  const canSubmit = canReview && step === "review";

  const submit = useCallback(async (): Promise<void> => {
    if (preview === null || preview.eligible !== true) return;
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setStatus("Correcting the pending venue identity.");
    try {
      const cryptoLike = globalThis.crypto as unknown as
        | { randomUUID?: () => string }
        | undefined;
      const requestId =
        cryptoLike?.randomUUID?.() ??
        `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
      const result = await correctPendingVenueIdentity({
        preview,
        name: proposal.name,
        slug: proposal.slug,
        category: proposal.category,
        reason: proposal.reason,
        requestId,
      });
      if (!result.ok) {
        if (
          result.code === "STALE_VERSION" ||
          result.code === "DEPENDENCY_SCHEMA_CHANGED"
        ) {
          // Refresh authoritative truth, keep every typed field, force a new Review.
          await loadPreview();
          setStatus(
            "The venue changed while this form was open. Review the refreshed details and confirm again.",
          );
          return;
        }
        setStep("edit");
        setStatus(safeCodeCopy(result.code));
        return;
      }
      // Amendment 7 §G5 / Amendment 8 §H7 — invalidate BEFORE closing and
      // BEFORE the success announcement, by key, so the corrected pending
      // identity is what the venue page's `VenueIdentityBand` re-reads.
      // `place_pool_id` is in the preservation set and the correction never
      // writes `place_discovery_price_ranges`, so the venue row and the
      // pipeline row (keyed venue + brand + pool) discharge SPEC §7's "pool"
      // and "config" clauses in full.
      const { venue_id: vId, brand_id: bId } = preview;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: venueListingKeys.detail(vId) }),
        queryClient.invalidateQueries({ queryKey: venueListingKeys.byBrand(bId) }),
        queryClient.invalidateQueries({
          queryKey: brandPlacePipelineKeys.byVenue(vId),
        }),
        queryClient.invalidateQueries({
          queryKey: brandPlacePipelineKeys.byBrand(bId),
        }),
        queryClient.invalidateQueries({
          queryKey: venueReservationSettingsKeys.detail(bId, vId),
        }),
        queryClient.invalidateQueries({
          queryKey: venueAvailabilityKeys.config(bId, vId),
        }),
        queryClient.invalidateQueries({ queryKey: brandKeys.detail(bId) }),
      ]);
      onSuccess();
    } catch {
      setStep("edit");
      setStatus(
        "Couldn't correct this venue. Your entries are preserved; retry when you're online.",
      );
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }, [loadPreview, onSuccess, preview, proposal, queryClient]);

  const dependencyCounts = useMemo(
    () => preview?.dependency_counts ?? [],
    [preview],
  );

  const requestClose = useCallback((): void => {
    if (submitInFlight.current) return;
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      onClose={requestClose}
      dismissOnScrimTap={!submitting}
      testID="issue-2099-correction-dialog"
    >
      <ScrollView
        accessibilityViewIsModal
        testID="issue-2099-correction-scroll"
        style={[
          styles.scroll,
          // Bounded by the VIEWPORT, not by the content: this is what makes the
          // container actually scroll instead of simply growing. `Modal` adds
          // its own `spacing.lg` padding on each side, so leave room for it.
          { maxHeight: Math.max(240, viewportHeight - spacing.lg * 6) },
        ]}
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title} accessibilityRole="header">
          Correct venue identity
        </Text>
        <Text style={styles.body}>
          This keeps the same venue, owner and location. Only its pending name, URL and
          category change.
        </Text>

        {preview !== null ? (
          <Text style={styles.comparison} testID="issue-2099-current-identity">
            Current: {preview.current.name} · {preview.current.slug} ·{" "}
            {categoryLabel(preview.current.category)}
          </Text>
        ) : null}

        {step === "edit" ? (
          <>
            <Text nativeID="issue-2099-name-label" style={styles.fieldLabel}>
              Proposed name
            </Text>
            <Input
              variant="text"
              value={proposal.name}
              onChangeText={(next) => editField("name", next)}
              accessibilityLabel="Proposed venue name"
              disabled={submitting}
              testID="issue-2099-name"
              error={nameInvalid ? "Enter a venue name." : null}
              errorId="issue-2099-name-error"
            />

            <Text nativeID="issue-2099-slug-label" style={styles.fieldLabel}>
              Proposed URL slug
            </Text>
            <Input
              variant="text"
              value={proposal.slug}
              onChangeText={(next) => editField("slug", next)}
              accessibilityLabel="Proposed venue URL slug"
              disabled={submitting}
              testID="issue-2099-slug"
              error={slugInvalid ? "Use 1–32 lowercase letters or numbers." : null}
              errorId="issue-2099-slug-error"
            />

            <Text style={styles.fieldLabel}>Proposed category</Text>
            <View style={styles.categoryRow} accessibilityRole="radiogroup">
              {CORRECTION_CATEGORIES.map((value) => {
                const selected = proposal.category === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => editField("category", value)}
                    disabled={submitting}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: submitting }}
                    accessibilityLabel={`Proposed category ${categoryLabel(value)}`}
                    testID={`issue-2099-category-${value}`}
                    style={[styles.categoryChoice, selected ? styles.categoryChoiceOn : null]}
                  >
                    {/* Checkmark keeps selection legible without relying on colour alone. */}
                    <Text style={styles.body}>
                      {selected ? "✓ " : ""}
                      {categoryLabel(value)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text nativeID="issue-2099-reason-label" style={styles.fieldLabel}>
              Reason
            </Text>
            <Input
              variant="text"
              value={proposal.reason}
              onChangeText={(next) => editField("reason", next)}
              accessibilityLabel="Reason for correcting this venue"
              disabled={submitting}
              testID="issue-2099-reason"
            />

            <DependencyCounts counts={dependencyCounts} />
          </>
        ) : (
          <View testID="issue-2099-review">
            <Text style={styles.fieldLabel} accessibilityRole="header">
              Review this correction
            </Text>
            <Text style={styles.body} testID="issue-2099-review-comparison">
              Name: {preview?.current.name} → {proposal.name.trim()}
            </Text>
            <Text style={styles.body}>
              URL: {preview?.current.slug} → {proposal.slug}
            </Text>
            <Text style={styles.body}>
              Category: {categoryLabel(preview?.current.category ?? "play")} →{" "}
              {categoryLabel(proposal.category)}
            </Text>
            <Text style={styles.body}>
              The venue, its owner, its place record and its location do not change.
            </Text>
            <Text style={styles.body}>
              Reservations and availability reset to their unbooked defaults, and the
              listing stays awaiting review.
            </Text>
            <DependencyCounts counts={dependencyCounts} />
          </View>
        )}

        <Text
          accessibilityLiveRegion="polite"
          nativeID="issue-2099-status"
          testID="issue-2099-status"
          style={styles.status}
        >
          {status}
        </Text>

        <View style={styles.actions}>
          {step === "review" ? (
            <Button
              label="Back"
              variant="secondary"
              onPress={() => setStep("edit")}
              disabled={submitting}
              accessibilityLabel="Back to editing the proposed venue identity"
            />
          ) : (
            <Button
              label={loading ? "Checking…" : loadFailed ? "Retry" : "Retry check"}
              variant="secondary"
              onPress={() => void loadPreview()}
              disabled={loading || submitting}
              accessibilityLabel="Re-check whether this venue can be corrected"
            />
          )}
          {step === "edit" ? (
            <Button
              label="Review correction"
              variant="primary"
              onPress={() => setStep("review")}
              disabled={!canReview}
              accessibilityLabel="Review the proposed venue correction"
            />
          ) : (
            <Button
              label={submitting ? "Correcting…" : "Correct pending venue"}
              variant="primary"
              onPress={() => void submit()}
              disabled={!canSubmit}
              accessibilityLabel="Correct pending venue"
            />
          )}
        </View>
      </ScrollView>
    </Modal>
  );
}

function DependencyCounts({
  counts,
}: {
  counts: readonly { safe_label: string; count: number; classification: string }[];
}): React.ReactElement | null {
  if (counts.length === 0) return null;
  // P2-1 — the server returns EVERY discovered lane, and on a genuinely unused
  // venue all but four of them are zero. Rendering 58 identical
  // `dependency: 0 (disallowed)` rows buries the three that carry information
  // and, at 390x844, fills the whole dialog. Show the non-zero lanes; summarise
  // the rest in one line. Nothing is hidden: the empty count is stated.
  const present = counts.filter((lane) => lane.count > 0);
  const empty = counts.length - present.length;
  return (
    <View testID="issue-2099-dependency-counts" style={styles.dependencyBlock}>
      <Text style={styles.fieldLabel}>What this venue currently has</Text>
      {present.map((lane) => (
        <Text key={lane.safe_label} style={styles.body}>
          {lane.safe_label}: {lane.count} ({lane.classification})
        </Text>
      ))}
      {empty > 0 ? (
        <Text style={styles.body} testID="issue-2099-dependency-empty">
          {empty} other checked {empty === 1 ? "area is" : "areas are"} empty.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // P1-A / P2-2 — the scroll host owns the bound AND the opaque surface. The
  // shared `GlassCard` the Modal wraps children in is translucent, so page
  // content read straight through the form.
  scroll: {
    alignSelf: "stretch",
    backgroundColor: canvas.depth,
    borderRadius: 12,
  },
  form: { gap: spacing.sm, minWidth: 320, padding: spacing.sm },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  body: { fontSize: typography.bodySm.fontSize, color: textTokens.secondary },
  comparison: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    padding: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.tertiary,
  },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  categoryChoice: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  categoryChoiceOn: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235,120,37,0.14)",
  },
  dependencyBlock: { gap: 2, marginTop: spacing.xs },
  status: {
    minHeight: 20,
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

function touchedHas(
  set: ReadonlySet<ProposalField>,
  field: ProposalField,
): boolean {
  return set.has(field);
}
