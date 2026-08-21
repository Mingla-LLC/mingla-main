/**
 * EditPublishedScreen — sectioned full edit-after-publish surface (ORCH-0704 v2).
 *
 * Replaces the narrow Cycle 9b-2 single-screen (description + coverHue
 * only) with a 6-section accordion that reuses the existing wizard step
 * body components via local edit state + the `StepBodyProps` contract.
 *
 * Sections (one expanded at a time):
 *   1. Basics    → CreatorStep1Basics
 *   2. When      → CreatorStep2When
 *   3. Where     → CreatorStep3Where
 *   4. Cover     → CreatorStep4Cover
 *   5. Tickets   → CreatorStep5Tickets (with editMode.soldCountByTier)
 *   6. Settings  → CreatorStep6Settings
 *   (Step 7 Preview is OMITTED — operator uses Cycle 9a Preview button.)
 *
 * Save flow:
 *   1. Validate every section (validateStep per CreatorStepN)
 *   2. Compute patch via editableDraftToPatch
 *   3. Empty patch → toast "No changes to save."
 *   4. Otherwise → ChangeSummaryModal opens with diffs + ticket diffs +
 *      severity + required reason input
 *   5. Modal Confirm → handleConfirmSave(reason) → 800ms processing →
 *      updateLiveEventFields(id, patch, soldCountCtx, reason)
 *   6. ok=true → toast "Saved. Live now." → router.back
 *   7. ok=false → reject dialog "Refund first" with "Open Orders" CTA
 *      (stub: routes Cycle-9c-toast until 9c builds Orders ledger)
 *
 * Keyboard handling: SmartScrollView (KeyboardAwareScrollView) auto-scrolls the
 * focused input; the description reveal (issue #1027) is deferred to the
 * keyboard-shown signal via the library's useKeyboardIsVisible() (no bespoke
 * Keyboard listeners — orch-0892 gate).
 *
 * Per ORCH-0704 v2 spec §3.4.5 + §3.4.6.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Keyboard listener
// + state + auto-insets DELETED. useKeyboardIsVisible() preserves dock-hide and
// (issue #1027) drives the deferred description-reveal scroll — no bespoke
// Keyboard.addListener (orch-0892 gate). Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  useLiveEventStore,
  type EditableLiveEventFields,
  type LiveEvent,
  type UpdateLiveEventResult,
} from "../../store/liveEventStore";
import { buildSoldCountContextFromOrders } from "../../services/eventOrdersService";
import { refundAllEventOrders } from "../../services/orderRefundService";
import {
  computeRichFieldDiffs,
  computeTicketDiffs,
  classifySeverity,
  editableDraftToPatch,
  liveEventToEditableDraft,
  type FieldDiff,
  type TicketDiff,
} from "../../utils/liveEventAdapter";
import { validateLiveEventFieldUpdate } from "../../utils/publishedEventEditGuards";
import {
  describeUnmappedEditGuard,
  resolvePaidPublishGuardCopy,
} from "../../utils/paidPublishGuards";
import type { EditSeverity } from "../../store/eventEditLogStore";
import {
  validateStep,
  type ValidationError,
} from "../../utils/draftEventValidation";
import type { DraftEvent } from "../../store/draftEventStore";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Toast } from "../ui/Toast";

import { ChangeSummaryModal } from "./ChangeSummaryModal";
import { CreatorStep1Basics } from "./CreatorStep1Basics";
import { CreatorStep2When } from "./CreatorStep2When";
import { CreatorStep3Where } from "./CreatorStep3Where";
import { CreatorStep4Cover } from "./CreatorStep4Cover";
import { ThemeControlRow } from "../theme/ThemeControlRow";
import { ThemeSheet } from "../theme/ThemeSheet";
import { CreatorStep5Tickets } from "./CreatorStep5Tickets";
import { CreatorStep6Settings } from "./CreatorStep6Settings";
// issue #2101 [named-buyer checkout] — the owner-only "Eligible buyers" card.
// LAZY (ORCH-1083 boot budget): the card is mounted by THREE separate lazy
// route chunks (Event, Trip and Experience management), so a static import
// makes Metro hoist it into the eager `__common` chunk that EVERY buyer
// downloads before anything renders — for a control only a brand owner ever
// sees. Same treatment, and same reason, as SeeWhosGoingGate.
const EventTicketCheckoutAccessCard = React.lazy(() =>
  import("./EventTicketCheckoutAccessCard").then((m) => ({
    default: m.EventTicketCheckoutAccessCard,
  })),
);
import { EditAfterPublishBanner } from "./EditAfterPublishBanner";

import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useBrand } from "../../hooks/useBrands";
import { useBrandStripeStatus } from "../../hooks/useBrandStripeStatus";
import { isChipInPayoutReady } from "../../utils/chipInPayoutReadiness";
import { canPerformAction } from "../../utils/permissionGates";
import {
  attestEventCoverSelection,
  EventCoverMediaError,
} from "../../services/eventCoverMediaService";
// ORCH-0824 hotfix (Option B): post-publish RPC for the 5 new taxonomy
// + city fields. Bridges the local-only EditPublishedScreen save flow to
// the events DB row so legacy events become Discover-eligible after edit.
import {
  type AtomicPublishedEventPatch,
  patchPublishedEventAtomically,
  patchPublishedEventTheme,
} from "../../services/businessEvents";
import { refreshBrandTaxRegistrationAttestation } from "../../services/pricingSwitchesService";
import { updateLiveRsvp } from "../../services/rsvpEvents";
import { buildRsvpUpdatePayloadDiff } from "../../utils/serverDraftEventMapper";
import { RsvpStep5Setup } from "../rsvp/RsvpStep5Setup";
import { rsvpEditNoticeCopy } from "../../utils/rsvpHubMetrics";
import { businessEventKeys } from "../../hooks/useBusinessEvents";
import { publicEventKeys } from "../../hooks/usePublicEvents";
import {
  useEventHasWebPurchases,
  useEventReconciliation,
} from "../../hooks/useEventOrders";
// ORCH-1172 — the section model lives in a pure sibling module so the
// ticketed-vs-RSVP section-list logic is unit-testable without importing this
// react-native component. Re-exported below for back-compat.
import {
  SECTIONS,
  sectionsForMode,
  type SectionConfig,
  type SectionKey,
} from "./editPublishedSections";

// ---- Section configuration -----------------------------------------

export {
  SECTIONS,
  RSVP_SECTIONS,
  sectionsForMode,
} from "./editPublishedSections";
export type { SectionConfig, SectionKey } from "./editPublishedSections";

const SAVE_PROCESSING_MS = 800;
const TOAST_NAV_DELAY_MS = 600;
// ORCH-1047 — iOS cannot present a second native Modal while the reason sheet
// (ChangeSummaryModal → Sheet → RN Modal) is still dismissing; the OS silently
// drops it. We therefore close the reason sheet, wait for its dismiss animation
// to finish, THEN present the "Refund first" reject dialog (ConfirmDialog → RN
// Modal) so it reliably appears instead of vanishing into a silent no-op.
const REJECT_DIALOG_HANDOFF_MS = 450;
const COVER_MEDIA_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "coverMediaUrl",
  "coverMediaPosterUrl",
  "coverMediaType",
  "coverMediaProvider",
  "coverMediaSourceUrl",
  "coverMediaCredit",
  "coverMediaCreditUrl",
  "coverMediaAlt",
]);

// ORCH-0824 hotfix (Option B): keys whose patches now have a server-side
// mutation path via `business_patch_event_taxonomy` RPC. When the patch
// touches ONLY these (or these + cover media), the
// disableLocalSaveReason gate is lifted because the server side IS
// reachable. Any other field still triggers the gate because no server
// mutation exists for it.
const ORCH_0824_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "partyTypes",
  "vibeTags",
  "musicGenres",
  "city",
  "locationGeo",
  // ORCH-0824 hotfix-5: address re-picks via Google Places autocomplete
  // set address + city + locationGeo together. The patch RPC accepts a
  // p_location_text parameter that updates events.location_text.
  "address",
]);

// ORCH-0877 Path B: keys whose patches now have a server-side mutation path.
// The canonical atomic event owner delegates the When slice to the protected
// leaf RPC in the same transaction. This closes the ORCH-0704 v2 Zustand-only
// save gap that silently kept post-publish When edits off buyers' phones.
const ORCH_0877_WHEN_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "whenMode",
  "date",
  "doorsOpen",
  "endsAt",
  "timezone",
  "recurrenceRule",
  "multiDates",
]);

const ORCH_0964_THEME_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "themeOverrides",
]);

// ORCH-1006: pricing switches have a server mutation path via
// patchPublishedEventPricingSwitches (direct events.pass_* write). Lifts the
// disableLocalSaveReason gate so a switch-only edit can save.
const ORCH_1006_PRICING_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "pricingSwitches",
]);

// issue #1972 — the typed core fields the ONE atomic live-event owner writes.
// `visibility` is deliberately NOT here: issue #2009 landed
// `business_set_event_visibility` as its sole authority, with its own audit
// row, share revocation and discovery-generation bump, and the database
// refuses every other writer. It is routed through ISSUE_2009_VISIBILITY_PATCH_KEYS
// below, so this set and that one stay disjoint and visibility has ONE owner.
const ISSUE_1972_CORE_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "name",
  "description",
  "format",
  "venueName",
  "onlineUrl",
  "hideAddressUntilTicket",
  "coverHue",
  "tickets",
  "requireApproval",
  "allowTransfers",
  "hideRemainingCount",
  "passwordProtected",
  "privateGuestList",
  "inPersonPaymentsEnabled",
]);


// issue #2009 [published-event visibility] — visibility finally HAS an
// authoritative server mutation (`business_set_event_visibility`), so it joins
// the server-routable set. Before this, a server-loaded ticketed event emitted
// a correct `patch.visibility` that nothing could write, and the safety gate
// disabled Save with no explanation the organiser could act on.
const ISSUE_2009_VISIBILITY_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  "visibility",
]);

/**
 * issue #2009 — the visibility write, its copy and its error mapping live in an
 * ON-INTENT async chunk, loaded only when an organiser actually saves.
 *
 * This screen sits in the eager `__common` boot chunk, so anything it imports
 * STATICALLY is downloaded by every visitor before any route renders. #2009's
 * first shape did exactly that and cost 3,379 B against issue #2099's 1,024 B
 * boot-payload ceiling. Loading it here instead costs one already-resolved
 * dynamic import on the save path and nothing at boot.
 *
 * Do NOT convert this into a static `import` — that silently undoes the split.
 */
const loadIssue2009Visibility = (): Promise<
  typeof import("../../services/publishedEventVisibility.issue2009")
> => import("../../services/publishedEventVisibility.issue2009");

const SERVER_EDITABLE_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([
  ...COVER_MEDIA_PATCH_KEYS,
  ...ORCH_0824_PATCH_KEYS,
  ...ORCH_0877_WHEN_PATCH_KEYS,
  ...ORCH_0964_THEME_PATCH_KEYS,
  ...ORCH_1006_PRICING_PATCH_KEYS,
  ...ISSUE_1972_CORE_PATCH_KEYS,
  ...ISSUE_2009_VISIBILITY_PATCH_KEYS,
]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isCoverMediaOnlyPatch = (
  patch: Partial<EditableLiveEventFields>,
): boolean => {
  const keys = Object.keys(patch) as (keyof EditableLiveEventFields)[];
  return (
    keys.length > 0 && keys.every((key) => COVER_MEDIA_PATCH_KEYS.has(key))
  );
};

// ORCH-0824 hotfix: patch contains only fields that have a server
// mutation path (cover media + ORCH-0824 taxonomy/city). Used to lift
// the disableLocalSaveReason gate for server-editable patches.
const isServerEditableOnlyPatch = (
  patch: Partial<EditableLiveEventFields>,
): boolean => {
  const keys = Object.keys(patch) as (keyof EditableLiveEventFields)[];
  return (
    keys.length > 0 && keys.every((key) => SERVER_EDITABLE_PATCH_KEYS.has(key))
  );
};

// ---- Component ------------------------------------------------------

export interface EditPublishedScreenProps {
  liveEvent: LiveEvent;
  disableLocalSaveReason?: string;
  /**
   * ORCH-1150 — when true, the event is an RSVP: drop the Tickets section + the
   * sold-ticket refund gate, and show the "N guests are going — they'll be
   * notified" notice (wired in SPEC §12). Default false = ticketed event,
   * byte-identical behavior. See SPEC §12.
   */
  rsvpMode?: boolean;
}

interface ToastState {
  visible: boolean;
  message: string;
}

interface ModalState {
  visible: boolean;
  fieldDiffs: FieldDiff[];
  ticketDiffs?: TicketDiff[];
  severity: EditSeverity;
}

interface RejectDialogContent {
  title: string;
  body: string;
  primaryLabel: string;
  primaryAction: () => void;
  /** ORCH-1047 — schedule-with-sales reject uses a hold-to-confirm destructive
   * variant so "Refund all & change" can't be fat-fingered. Other rejects stay
   * the simple "Open Orders" dialog. */
  variant?: "simple" | "holdToConfirm";
  destructive?: boolean;
}

export const EditPublishedScreen: React.FC<EditPublishedScreenProps> = ({
  liveEvent,
  disableLocalSaveReason,
  rsvpMode = false,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const updateLiveEventFields = useLiveEventStore(
    (s) => s.updateLiveEventFields,
  );

  // ---- Local edit state (transient — never persisted to draftEventStore) ----
  const initialEditState = useMemo<DraftEvent>(
    () => liveEventToEditableDraft(liveEvent),
    [liveEvent],
  );
  const [editState, setEditState] = useState<DraftEvent>(initialEditState);

  // ORCH-1172 R4 — guarded re-seed key. The editor seeds editState ONCE on mount
  // (useState above). When the route mounts this screen with a STALE prop (e.g.
  // a zustand mirror) and a FRESH `liveEvent` then arrives (stale-while-
  // revalidate, or any prop change after mount), editState would otherwise keep
  // the stale seed and diff-clobber the true saved values on save. We re-hydrate
  // editState from the fresh prop ONLY when this key changes AND the user has no
  // pending edits (fieldDiffs.length === 0) — never discarding in-progress input.
  // The key combines identity (`id`) + a freshness marker (`updatedAt`) so a
  // same-id-but-newer-data prop re-seeds, while an identical prop does not.
  const hydratedKeyRef = useRef<string>(
    `${liveEvent.id}::${liveEvent.updatedAt}`,
  );

  // Currently expanded section (accordion — only one at a time)
  const [openSection, setOpenSection] = useState<SectionKey | null>("basics");
  const [showErrors, setShowErrors] = useState<boolean>(false);

  // Modal state — driven by save flow
  const [modal, setModal] = useState<ModalState>({
    visible: false,
    fieldDiffs: [],
    ticketDiffs: undefined,
    severity: "additive",
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [coverVideoProcessing, setCoverVideoProcessing] =
    useState<boolean>(false);

  // Reject dialog — driven by guard-rail rejections
  const [rejectDialog, setRejectDialog] = useState<RejectDialogContent | null>(
    null,
  );

  // Toast
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: "",
  });
  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  // ORCH-0892-B v2: keyboard listener + state DELETED. KAS via
  // SmartScrollView handles focused-input scroll. dock-hide preserved
  // via useKeyboardIsVisible(). scrollToBottom retained as passthrough
  // for child-callback compatibility (KAS refines focus-scroll on top).
  const keyboardVisible = useKeyboardIsVisible();
  const scrollViewRef = useRef<ScrollView | null>(null);
  // issue #1027 (iOS description-reveal REGRESSION) — deferred scroll-to-bottom,
  // mirroring the create wizards. The edit screen shares the `scrollToBottom`
  // contract with the same step bodies (CreatorStep1Basics description,
  // CreatorStep3Where online-URL). WHY the defer is load-bearing on native:
  // SmartScrollView (KeyboardAwareScrollView) appends a
  // `paddingBottom: keyboardHeight + 1` spacer on keyboard show (KAS source
  // index.tsx:405-430); `scrollToEnd` only lands the focused field above the
  // keyboard once that spacer exists. A bare-rAF scrollToEnd fired before the
  // keyboard rose and fought KAS → nondeterministic over-scroll on iOS.
  //
  // We defer the reveal to the CANONICAL keyboard primitive
  // `useKeyboardIsVisible()` (react-native-keyboard-controller `useKeyboardState`,
  // whose isVisible flips true on `keyboardDidShow` — AFTER the spacer is
  // applied), NOT a bespoke `Keyboard.addListener` (forbidden by the orch-0892
  // gate). Its web wrapper is a library-free constant false, so the web bundle
  // stays clean and the deferred effect is inert on web.
  // I-PROPOSED-1027-WIZARD-REVEAL-DEFERRED-TO-KEYBOARD-SHOWN.
  const pendingScrollToBottomRef = useRef<boolean>(false);
  const keyboardVisibleRef = useRef<boolean>(keyboardVisible);

  const performScrollToEnd = useCallback((): void => {
    requestAnimationFrame((): void => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const scrollToBottom = useCallback((): void => {
    // Web scrolls immediately (plain ScrollView, no KAS spacer). On native, if
    // the keyboard is ALREADY up the spacer is applied so scroll now; otherwise
    // ARM the pending flag and let the keyboard-visible effect below fire once
    // the keyboard has finished rising (padded content height).
    if (Platform.OS === "web" || keyboardVisibleRef.current) {
      performScrollToEnd();
      return;
    }
    pendingScrollToBottomRef.current = true;
  }, [performScrollToEnd]);

  // Consume the pending reveal when `useKeyboardIsVisible()` flips true — the
  // library's keyboardDidShow-backed signal, delivered AFTER the KAS
  // paddingBottom spacer is applied. On web the hook is a constant false
  // (library-free wrapper), so this effect is inert there.
  useEffect(() => {
    keyboardVisibleRef.current = keyboardVisible;
    if (keyboardVisible) {
      if (pendingScrollToBottomRef.current) {
        pendingScrollToBottomRef.current = false;
        performScrollToEnd();
      }
    } else {
      // keyboard dismissed — drop any stale pending reveal.
      pendingScrollToBottomRef.current = false;
    }
  }, [keyboardVisible, performScrollToEnd]);

  // ---- Sold-count context (server-backed) ----------------------------------
  // Was an ORCH-0704 stub that read the empty client order store and returned
  // zeros for server-loaded events, leaving the buyer-protection edit guards
  // blind (they let date moves / tier changes on sold events reach the server,
  // which then rejected with a bare toast). Now sourced from the live event
  // orders so validateLiveEventFieldUpdate reliably fires the "Refund first"
  // dialog. serverEventId === null → query disabled → empty (the server RPC
  // still backstops every structural change).
  const serverOrdersRead = useEventReconciliation(liveEvent.serverEventId);
  const serverOrders = serverOrdersRead.data ?? [];
  const soldCountCtx = useMemo(
    () => buildSoldCountContextFromOrders(serverOrders),
    [serverOrders],
  );

  // Cycle 13a J-T6 G2: ticket price editability gated on EDIT_TICKET_PRICE
  // (finance_manager+). Hook ordering: runs every render before any early
  // return shell (ORCH-0710 lesson).
  const { rank: currentRank } = useCurrentBrandRole(liveEvent?.brandId ?? null);
  const canEditTicketPrice = canPerformAction(currentRank, "EDIT_TICKET_PRICE");

  // ORCH-1335 — chip-in payout readiness for the RSVP edit path (same banner as
  // create). Gated to rsvpMode so ticketed edits make no extra queries (both
  // hooks accept null → disabled). Fresh Stripe truth via the hook, Paystack via
  // the brand subaccount; loading → false → neutral nudge (no false-positive).
  // #1022 C-2 — useBrand was gated to rsvpMode, so a TICKETED event edit
  // loaded no brand record at all and the Theme row could not report
  // inheritance (it would show Mingla defaults for a brand-themed event).
  // Ungated: one extra CACHED read per mount, already warm in the wizards.
  const brandId = liveEvent?.brandId ?? null;
  const brandQuery = useBrand(brandId);
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const chipInBrandId = rsvpMode ? brandId : null;
  const chipInBrandQuery = brandQuery;
  // Deliberately still gated: a separate network call with no bearing on
  // theme. Ungating it would be scope creep.
  const chipInStripeStatus = useBrandStripeStatus(chipInBrandId);
  const chipInPayoutReady = useMemo(
    () =>
      isChipInPayoutReady(
        chipInBrandQuery.data ?? null,
        chipInStripeStatus.data?.status,
      ),
    [chipInBrandQuery.data, chipInStripeStatus.data?.status],
  );

  // ---- Update handler — local state only ----
  const handleUpdateDraft = useCallback(
    (
      patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>,
    ): void => {
      setEditState((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  // ORCH-1172 — RSVP edit uses the dedicated RSVP section list (Tickets +
  // generic Settings dropped; the RsvpStep5Setup card added after Cover, which
  // owns visibility/discoverable/privacy). Ticketed edit is byte-identical.
  // Supersedes the ORCH-1150 tickets-only filter, which left the mislabeled
  // ticketed Settings card in place and exposed only 3 of 9 RSVP controls.
  const sections = useMemo<readonly SectionConfig[]>(
    () => sectionsForMode(rsvpMode),
    [rsvpMode],
  );

  // ---- Per-section errors ----
  const sectionErrors = useMemo<Record<SectionKey, ValidationError[]>>(() => {
    const out: Record<SectionKey, ValidationError[]> = {
      basics: [],
      when: [],
      where: [],
      cover: [],
      visual: [],
      tickets: [],
      settings: [],
      // ORCH-1172 — RSVP host-control section. stepIndex null → never validated
      // by the ticketed validateStep (validateRsvpStep(4) returns []).
      "rsvp-setup": [],
    };
    for (const sec of sections) {
      out[sec.key] =
        sec.stepIndex === null ? [] : validateStep(sec.stepIndex, editState);
    }
    return out;
  }, [editState]);

  // ---- Toggle section ----
  const handleToggleSection = useCallback((key: SectionKey): void => {
    setOpenSection((prev) => (prev === key ? null : key));
  }, []);

  // ---- Diff computation ----
  const fieldDiffs = useMemo<FieldDiff[]>(
    () => computeRichFieldDiffs(liveEvent, editState),
    [liveEvent, editState],
  );

  // ORCH-1172 R4 — guarded re-seed. If the `liveEvent` prop changes to a fresher
  // value (id+updatedAt key differs) AND the user has made NO edits yet
  // (fieldDiffs.length === 0), re-hydrate editState from the fresh prop so the
  // editor reflects the REAL saved values (fixing the seed-from-stale clobber:
  // discoverable true→false on a save that touched only an unrelated setting).
  // Strictly gated on zero pending diffs so it NEVER discards in-progress input —
  // this guard applies identically to the ticketed and RSVP paths.
  useEffect(() => {
    const nextKey = `${liveEvent.id}::${liveEvent.updatedAt}`;
    if (nextKey === hydratedKeyRef.current) return;
    if (fieldDiffs.length > 0) return;
    hydratedKeyRef.current = nextKey;
    setEditState(liveEventToEditableDraft(liveEvent));
  }, [liveEvent, fieldDiffs.length]);
  const currentPatch = useMemo(
    () => editableDraftToPatch(liveEvent, editState),
    [liveEvent, editState],
  );
  // ORCH-0824 hotfix: allow Save through when the disable gate is set
  // AND the patch contains ONLY server-editable fields (cover media OR
  // ORCH-0824 taxonomy/city). Pre-ORCH-0824 this only allowed cover-only
  // patches; the new name reflects the broadened set.
  const canSaveServerCoverMediaOnly =
    disableLocalSaveReason !== undefined &&
    // ORCH-1172 — an RSVP edit has its OWN complete server write path
    // (biz_update_live_rsvp), so the ticketed Zustand-only disable gate must
    // not apply: every RSVP change is server-routable regardless of patch keys.
    (rsvpMode || isServerEditableOnlyPatch(currentPatch));

  // ---- Save flow ----
  const handleSavePress = useCallback((): void => {
    if (!rsvpMode && serverOrdersRead.status !== "ready") {
      showToast("Couldn't load ticket sales. Try again.");
      return;
    }
    if (coverVideoProcessing) {
      showToast("Wait for the cover video to finish processing first.");
      return;
    }
    // 1. Validate sections
    const hasErrors = sections.some((sec) => sectionErrors[sec.key].length > 0);
    if (hasErrors) {
      setShowErrors(true);
      // Open the first errored section so user sees inline errors
      const firstErrored = sections.find(
        (sec) => sectionErrors[sec.key].length > 0,
      );
      if (firstErrored !== undefined) {
        setOpenSection(firstErrored.key);
      }
      showToast("Fix the highlighted issues first.");
      return;
    }
    // 2. Compute patch
    const patch = currentPatch;
    if (Object.keys(patch).length === 0) {
      showToast("No changes to save.");
      return;
    }
    // issue #2009 SC-11/SC-12 — Private fails closed at BOTH layers. #1931
    // shipped containment only (every transition primitive raises
    // `private_access_release_frozen`), so there is no invited-guest path to
    // hand a Private event to. Refuse here with the approved copy, and refuse
    // again on the server if this client's capability state is stale.
    if (!rsvpMode && patch.visibility === "private") {
      void loadIssue2009Visibility().then((m) =>
        showToast(m.ISSUE_2009_PRIVATE_UNAVAILABLE_COPY),
      );
      return;
    }
    if (
      disableLocalSaveReason !== undefined &&
      // ORCH-1172 — RSVP edits route through biz_update_live_rsvp (a full server
      // write), so they bypass the ticketed Zustand-only disable gate entirely.
      !rsvpMode &&
      !isServerEditableOnlyPatch(patch)
    ) {
      // ORCH-0824 hotfix: only block when the patch contains a field
      // with no server mutation path. Cover media OR ORCH-0824
      // taxonomy/city are now both routable through their respective
      // server endpoints, so they pass the gate.
      showToast(disableLocalSaveReason);
      return;
    }
    // 3. Compute ticket diffs (only if patch.tickets changed)
    const ticketDiffs =
      patch.tickets !== undefined
        ? computeTicketDiffs(liveEvent.tickets, editState.tickets)
        : undefined;
    // 4. Severity
    const severity = classifySeverity(
      Object.keys(patch) as Parameters<typeof classifySeverity>[0],
    );
    // 5. Open modal
    setModal({
      visible: true,
      fieldDiffs,
      ticketDiffs,
      severity,
    });
  }, [
    currentPatch,
    coverVideoProcessing,
    disableLocalSaveReason,
    editState,
    fieldDiffs,
    liveEvent.tickets,
    rsvpMode,
    serverOrdersRead.status,
    sections,
    sectionErrors,
    showToast,
  ]);

  const invalidateServerEventCaches = useCallback((): void => {
    queryClient.invalidateQueries({
      queryKey: businessEventKeys.detail(liveEvent.id),
    });
    queryClient.invalidateQueries({
      queryKey: businessEventKeys.list(liveEvent.brandId),
    });
    queryClient.invalidateQueries({
      queryKey: publicEventKeys.detailById(liveEvent.id),
    });
    queryClient.invalidateQueries({
      queryKey: publicEventKeys.detailBySlug(
        liveEvent.brandSlug,
        liveEvent.eventSlug,
      ),
    });
    queryClient.invalidateQueries({
      queryKey: publicEventKeys.brandBySlug(liveEvent.brandSlug),
    });
  }, [
    liveEvent.brandId,
    liveEvent.brandSlug,
    liveEvent.eventSlug,
    liveEvent.id,
    queryClient,
  ]);

  // ORCH-1047 — captured reason for the "Refund all & proceed" path (the
  // reject dialog is presented after the reason sheet closes, so the reason
  // text must be stashed when the save is blocked).
  const reasonRef = useRef<string>("");

  // ORCH-1047 — "Refund all & proceed": refund every buyer for this event in
  // full, then re-apply the schedule change with the server's
  // acknowledge_sold_impact bypass. Operator-chosen partial-failure policy:
  // change anyway, and surface any buyer whose refund failed so they can be
  // refunded manually in Orders. This fires REAL refunds — it is only reachable
  // behind the hold-to-confirm destructive dialog.
  const runRefundAllAndProceed = useCallback(
    async (reason: string): Promise<void> => {
      setRejectDialog(null);
      if (liveEvent.serverEventId === null) {
        showToast("Can't change — this event is missing its server id.");
        return;
      }
      setSubmitting(true);
      const patch = currentPatch;
      try {
        const refund = await refundAllEventOrders(serverOrders, reason);
        // All-or-nothing (buyer protection): if ANY refund failed, do NOT change
        // the schedule — moving the event would strand the un-refunded buyers.
        // Abort, leave the schedule untouched, and report who still needs a
        // refund + the actual Stripe reason so the operator can act.
        if (refund.failed.length > 0) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          const names = refund.failed.map((f) => f.buyerName).join(", ");
          const why = refund.failed[0]?.error ?? "";
          showToast(
            `Refunds incomplete — ${refund.failed.length} failed (${names}). Schedule NOT changed. ${why}`.trim(),
          );
          return;
        }
        // Every buyer refunded → now it's safe to apply the schedule change.
        await patchPublishedEventAtomically(
          liveEvent.serverEventId,
          {
            core: {},
            when: {
              whenMode: patch.whenMode ?? liveEvent.whenMode,
              timezone: patch.timezone ?? liveEvent.timezone,
              when: {
                date: patch.date !== undefined ? patch.date : liveEvent.date,
                doorsOpen:
                  patch.doorsOpen !== undefined
                    ? patch.doorsOpen
                    : liveEvent.doorsOpen,
                endsAt:
                  patch.endsAt !== undefined ? patch.endsAt : liveEvent.endsAt,
              },
              multiDates:
                patch.multiDates !== undefined
                  ? patch.multiDates
                  : liveEvent.multiDates,
              recurrenceRule:
                patch.recurrenceRule !== undefined
                  ? patch.recurrenceRule
                  : liveEvent.recurrenceRule,
              acknowledgeSoldImpact: true,
            },
          },
          reason,
          (liveEvent.clientRevision ?? 0) + 1,
        );
        invalidateServerEventCaches();
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        const okCount = refund.refundedOrderIds.length;
        showToast(
          `Refunded all ${okCount} buyer${okCount === 1 ? "" : "s"}. Schedule updated.`,
        );
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            // orch-strict-grep-allow route-by-event-type — events-only screen
            router.replace(`/event/${liveEvent.id}` as never);
          }
        }, TOAST_NAV_DELAY_MS);
      } catch (error) {
        setSubmitting(false);
        const code = error instanceof Error ? error.message : "save_failed";
        showToast(
          `Refunds attempted but the schedule change failed (${code}). Check Orders.`,
        );
      }
    },
    [
      currentPatch,
      invalidateServerEventCaches,
      liveEvent,
      router,
      serverOrders,
      showToast,
    ],
  );

  // ---- Map rejection result to dialog content ----
  const buildRejectDialog = useCallback(
    (
      result: Extract<UpdateLiveEventResult, { ok: false }>,
    ): RejectDialogContent => {
      const closeAndOpenOrders = (): void => {
        setRejectDialog(null);
        // Cycle 9c — Orders ledger now exists; navigate to it.
        // orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)
        router.push(`/event/${liveEvent.id}/orders` as never);
      };

      const closeOnly = (): void => setRejectDialog(null);

      // ORCH-1047 — schedule-with-sales: offer "Refund all & change" as a
      // hold-to-confirm destructive action. Per-order manual refunds remain
      // reachable from the event's Orders screen.
      const refundAllAndChange = (
        n: number,
        whatChanges: string,
      ): RejectDialogContent => ({
        title: "Refund all & change?",
        body: `${n} ${n === 1 ? "buyer has" : "buyers have"} tickets for this event. To ${whatChanges}, all ${n} ${n === 1 ? "buyer" : "buyers"} are refunded in full first — this is permanent. If any refund fails, nothing changes and you'll see who still needs refunding. Hold to confirm.`,
        primaryLabel: "Refund all & change",
        variant: "holdToConfirm",
        destructive: true,
        primaryAction: () => {
          void runRefundAllAndProceed(reasonRef.current);
        },
      });

      switch (result.reason) {
        case "event_not_found":
          return {
            title: "Couldn't find this event",
            body: "It may have been deleted. Tap back to return.",
            primaryLabel: "Back",
            primaryAction: () => {
              setRejectDialog(null);
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace(`/(tabs)/events` as never);
              }
            },
          };
        case "missing_edit_reason":
        case "invalid_edit_reason":
          return {
            title: "Reason needed",
            body: "Please enter a reason between 10 and 200 characters.",
            primaryLabel: "Got it",
            primaryAction: closeOnly,
          };
        case "capacity_below_sold": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `${n} ticket${n === 1 ? "" : "s"} sold for this tier. To drop capacity below ${n}, refund existing buyers first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "tier_delete_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `${n} ticket${n === 1 ? "" : "s"} sold for this tier. Refund all ${n} buyers before deleting.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "tier_price_change_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `Existing buyers are protected at the price they paid. Refund all ${n} buyers, then change the price (or add a new tier at the new price).`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "tier_free_toggle_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `Toggling free/paid for a sold tier requires refunding all ${n} existing buyers first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "multi_date_remove_with_sales":
          return refundAllAndChange(
            result.affectedOrderCount ?? 0,
            "change the dates",
          );
        case "time_change_with_sales":
          return refundAllAndChange(
            result.affectedOrderCount ?? 0,
            "change the time",
          );
        case "when_mode_drops_active_date":
          return refundAllAndChange(
            result.affectedOrderCount ?? 0,
            "change the schedule",
          );
        case "recurrence_drops_occurrence":
          return refundAllAndChange(
            result.affectedOrderCount ?? 0,
            "change the recurrence",
          );
        default: {
          const _exhaust: never = result.reason;
          return _exhaust;
        }
      }
    },
    [liveEvent.id, router, runRefundAllAndProceed],
  );

  const handleConfirmSave = useCallback(
    async (reason: string): Promise<void> => {
      if (submitting) return;
      // ORCH-1047 — stash the reason so "Refund all & proceed" (fired from the
      // deferred reject dialog) can reuse it for the refunds + re-save.
      reasonRef.current = reason;
      setSubmitting(true);
      await sleep(SAVE_PROCESSING_MS);
      const patch = currentPatch;

      // ORCH-1150 — RSVP edit-published path. RSVP has NO sold tickets + no
      // money, so it bypasses the entire refund/sold-diff machinery below and
      // commits through biz_update_live_rsvp. A material change (date/time/
      // venue) makes that RPC enqueue an `rsvp_event_updated` notification to
      // every going guest (SPEC §5.2). Then the local Zustand mutation keeps
      // the cache in sync. No StripeBlockedCard, no EndSalesSheet, no ticket diff.
      if (rsvpMode) {
        if (liveEvent.serverEventId === null) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast("Save failed because this event is missing its server id.");
          return;
        }
        try {
          // ORCH-1172 R3 — send a DIFF-BASED publish-style payload: always the
          // RPC-required `title` + `when` + `requestedVisibility` + snake_case
          // location/cover, but each of the 9 host-control toggles ONLY when it
          // differs from the loaded `liveEvent`. The full-state send (R2) emitted
          // every key always, so the RPC's COALESCE-to-existing-on-absent safety
          // never fired and a hydration miss reverted untouched settings (the R3
          // clobber: editing hide-address also flipped rsvp_discoverable +
          // hideRemainingCount). With the diff, omitted toggles keep their stored
          // value server-side. (B1 also fixes the root hydration drop so the
          // loaded `liveEvent` now carries the TRUE saved rsvp_* values.)
          await updateLiveRsvp(
            liveEvent.serverEventId,
            buildRsvpUpdatePayloadDiff(liveEvent, editState),
            reason,
          );
        } catch (error) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          const code =
            error instanceof Error ? error.message : "rsvp_update_failed";
          const message = code.includes("event_not_an_rsvp")
            ? "This event isn't an RSVP — reopen it to edit."
            : code.includes("insufficient_event_permission")
              ? "You don't have permission to edit this event."
              : // ORCH-1296 [chip-in-edit-published-gap] — the provider-aware
                // bank-gate raised because chip-in was turned on for a brand that
                // can't collect yet. Surface an actionable message (connect a bank)
                // instead of the generic failure, mirroring the publish-time guard.
                code.includes("stripe_charges_disabled")
                ? "Connect a bank to collect chip-in contributions before turning it on."
                : "Couldn't save your changes. Tap to try again.";
          showToast(message);
          return;
        }
        // #1043 — the RSVP branch returns at the end of this block (below),
        // BEFORE the non-RSVP theme write (~:1178), so an organiser's theme
        // change on a published RSVP was silently dropped:
        // buildRsvpUpdatePayloadDiff carries no theme field and
        // biz_update_live_rsvp writes no override columns. RSVPs are
        // public.events rows, so the SAME offering-neutral columnar write the
        // event path uses (patchPublishedEventTheme -> patchOfferingTheme,
        // .eq("id")) targets them correctly — no RPC or migration needed. Gated
        // on an actual theme patch so an RSVP edit that didn't touch the theme
        // emits no needless write. Server-success-then-local, ordered like the
        // event path: written after the RSVP RPC commits and before the Zustand
        // mirror + navigate; the invalidateServerEventCaches() at the end of
        // this branch covers the columns just written.
        if (patch.themeOverrides !== undefined) {
          if (liveEvent.serverEventId === null) {
            setSubmitting(false);
            setModal((prev) => ({ ...prev, visible: false }));
            showToast(
              "Save failed because this event is missing its server id.",
            );
            return;
          }
          try {
            await patchPublishedEventTheme({
              eventId: liveEvent.serverEventId,
              themeOverrides: patch.themeOverrides ?? null,
            });
          } catch {
            setSubmitting(false);
            setModal((prev) => ({ ...prev, visible: false }));
            showToast("Couldn't save the public theme. Tap to try again.");
            return;
          }
        }
        // ORCH-1172 — the RPC is the source of truth for an RSVP edit; it has
        // already committed. Best-effort refresh the local Zustand mirror so a
        // cached list stays fresh — but a server-loaded RSVP (the common case,
        // where disableLocalSaveReason is set) has NO local row, so
        // updateLiveEventFields returns ok:false (event_not_found). That must
        // NOT surface as a save failure: the cache invalidation below refetches
        // the freshly-written row. Only the local-store-backed path treats a
        // mirror failure as a real failure.
        const rsvpResult = updateLiveEventFields(
          liveEvent.id,
          patch,
          soldCountCtx,
          reason,
        );
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        invalidateServerEventCaches();
        const localMirrorRequired = disableLocalSaveReason === undefined;
        if (rsvpResult.ok || !localMirrorRequired) {
          showToast("Saved. Going guests will be notified.");
          setTimeout(() => router.back(), TOAST_NAV_DELAY_MS);
        } else {
          showToast("Couldn't save your changes. Tap to try again.");
        }
        return;
      }

      const validation = validateLiveEventFieldUpdate(
        liveEvent,
        patch,
        soldCountCtx,
        reason,
      );
      if (!validation.ok) {
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        // Defer so the reject dialog isn't dropped while the reason sheet is
        // still dismissing on iOS (see REJECT_DIALOG_HANDOFF_MS).
        const pendingReject = buildRejectDialog(validation);
        setTimeout(
          () => setRejectDialog(pendingReject),
          REJECT_DIALOG_HANDOFF_MS,
        );
        return;
      }
      const corePatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) =>
          ISSUE_1972_CORE_PATCH_KEYS.has(key as keyof EditableLiveEventFields),
        ),
      ) as Partial<EditableLiveEventFields>;
      if (liveEvent.serverEventId === null) {
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        showToast("Save failed because this event is missing its server id.");
        return;
      }
      const atomicPatch: AtomicPublishedEventPatch = { core: corePatch };
      const explicitCoverSet =
        patch.coverMediaUrl !== undefined && patch.coverMediaUrl !== null;
      const explicitCoverClear = patch.coverMediaUrl === null;
      const metadataOnlyPatch =
        patch.coverMediaUrl === undefined &&
        (patch.coverMediaType !== undefined ||
          patch.coverMediaProvider !== undefined ||
          patch.coverMediaSourceUrl !== undefined ||
          patch.coverMediaCredit !== undefined ||
          patch.coverMediaCreditUrl !== undefined ||
          patch.coverMediaAlt !== undefined);
      if (metadataOnlyPatch) {
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        showToast("Choose the cover again so its attribution can be verified.");
        return;
      }

      const taxonomyPatchPresent =
        patch.city !== undefined ||
        patch.partyTypes !== undefined ||
        patch.vibeTags !== undefined ||
        patch.musicGenres !== undefined ||
        patch.locationGeo !== undefined ||
        // ORCH-0824 hotfix-5: address re-picks (via Google Places) flow
        // through the same patch RPC.
        patch.address !== undefined;
      // issue #1972 + #2009 CARRY-FORWARD ORDERING. The visibility leg runs
      // BEFORE `patchPublishedEventAtomically`, not after it. #2009 pins
      // `events.updated_at` AS LOADED as its optimistic-concurrency boundary,
      // and #1972's atomic owner sets `updated_at=now()`. Running the atomic
      // owner first therefore made every combined (core + visibility) save
      // fail with `stale_event_visibility` AFTER the core change had already
      // committed — a guaranteed partial commit reported as a failure.
      // Visibility first keeps the refusal free of any prior write, which is
      // also #2009's own model (its Ari tool refuses mixed calls outright).
      // issue #2009 [published-event visibility] — the visibility diff routes
      // through the narrow RPC BEFORE the unified server-editable early-return,
      // exactly like the cover / taxonomy / When / theme / pricing blocks above.
      // Server-success-then-local: an RPC failure aborts and NEVER claims a
      // partial success. There is deliberately no `.from("events").update(...)`
      // fallback — the database refuses one.
      // issue #2009 — SPEC §6 requires EXACTLY ONE success signal, and for a
      // visibility-only save it names the persisted label. Any wider patch
      // keeps the existing generic confirmation, so this stays null and both
      // success paths below fall back to it.
      let issue2009VisibilitySuccessToast: string | null = null;

      if (!rsvpMode && patch.visibility !== undefined) {
        const { issue2009ApplyEditorVisibility } =
          await loadIssue2009Visibility();
        const outcome = await issue2009ApplyEditorVisibility(
          liveEvent,
          patch,
          validation.trimmedReason,
        );
        if (!outcome.ok) {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast(outcome.toast);
          return;
        }
        issue2009VisibilitySuccessToast = outcome.successToast;
        invalidateServerEventCaches();
      }

      if (taxonomyPatchPresent) {
        atomicPatch.taxonomy = {
          city:
            patch.city !== undefined
              ? (patch.city ?? "")
              : (liveEvent.city ?? ""),
          partyTypes: patch.partyTypes ?? liveEvent.partyTypes ?? [],
          vibeTags: patch.vibeTags ?? liveEvent.vibeTags ?? [],
          musicGenres: patch.musicGenres ?? liveEvent.musicGenres ?? [],
          locationGeo:
            patch.locationGeo !== undefined
              ? patch.locationGeo
              : (liveEvent.locationGeo ?? null),
          locationText: patch.address !== undefined ? patch.address : null,
        };
      }

      const whenPatchPresent =
        patch.whenMode !== undefined ||
        patch.date !== undefined ||
        patch.doorsOpen !== undefined ||
        patch.endsAt !== undefined ||
        patch.timezone !== undefined ||
        patch.recurrenceRule !== undefined ||
        patch.multiDates !== undefined;
      if (whenPatchPresent) {
        atomicPatch.when = {
          whenMode: patch.whenMode ?? liveEvent.whenMode,
          timezone: patch.timezone ?? liveEvent.timezone,
          when: {
            date: patch.date !== undefined ? patch.date : liveEvent.date,
            doorsOpen:
              patch.doorsOpen !== undefined
                ? patch.doorsOpen
                : liveEvent.doorsOpen,
            endsAt:
              patch.endsAt !== undefined ? patch.endsAt : liveEvent.endsAt,
          },
          multiDates:
            patch.multiDates !== undefined
              ? patch.multiDates
              : liveEvent.multiDates,
          recurrenceRule:
            patch.recurrenceRule !== undefined
              ? patch.recurrenceRule
              : liveEvent.recurrenceRule,
        };
      }

      if (patch.themeOverrides !== undefined) {
        atomicPatch.theme = patch.themeOverrides ?? null;
      }
      if (patch.pricingSwitches !== undefined) {
        atomicPatch.pricing = patch.pricingSwitches;
      }

      try {
        if (patch.pricingSwitches?.passTax === true) {
          await refreshBrandTaxRegistrationAttestation(liveEvent.brandId);
        }
        if (explicitCoverClear) {
          atomicPatch.cover = { clear: true };
        } else if (explicitCoverSet) {
          const mediaUrl = patch.coverMediaUrl as string;
          const mediaType = patch.coverMediaType ?? liveEvent.coverMediaType;
          if (mediaType === null || mediaType === undefined) {
            throw new EventCoverMediaError(
              "upload_failed",
              "Cover save failed: media type is missing.",
            );
          }
          const attested = await attestEventCoverSelection(
            liveEvent.serverEventId,
            mediaUrl,
            mediaType,
            {
              provider:
                patch.coverMediaProvider !== undefined
                  ? patch.coverMediaProvider
                  : (liveEvent.coverMediaProvider ?? null),
              sourceUrl:
                patch.coverMediaSourceUrl !== undefined
                  ? patch.coverMediaSourceUrl
                  : (liveEvent.coverMediaSourceUrl ?? null),
              credit:
                patch.coverMediaCredit !== undefined
                  ? patch.coverMediaCredit
                  : (liveEvent.coverMediaCredit ?? null),
              creditUrl:
                patch.coverMediaCreditUrl !== undefined
                  ? patch.coverMediaCreditUrl
                  : (liveEvent.coverMediaCreditUrl ?? null),
              alt:
                patch.coverMediaAlt !== undefined
                  ? patch.coverMediaAlt
                  : (liveEvent.coverMediaAlt ?? null),
            },
            patch.coverMediaPosterUrl ??
              (mediaType === "image" ? mediaUrl : null),
          );
          atomicPatch.cover = { selectionRef: attested.selectionRef };
        }
        await patchPublishedEventAtomically(
          liveEvent.serverEventId,
          atomicPatch,
          validation.trimmedReason,
          (liveEvent.clientRevision ?? 0) + 1,
        );
        invalidateServerEventCaches();
      } catch (error) {
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        if (error instanceof EventCoverMediaError) {
          showToast("Cover upload failed. Try again.");
          return;
        }
        const code =
          error instanceof Error ? error.message : "live_event_update_failed";
        const guardCopy = resolvePaidPublishGuardCopy(code);
        if (guardCopy !== null) {
          showToast(guardCopy.body);
          return;
        }
        const message =
          code.includes("tax_registration_required")
            ? "Set up an active tax registration in Brand > Payments before passing tax to buyers."
            : code.includes("ticket_change_with_sales") ||
          code.includes("ticket_delete_with_sales")
            ? "Refund affected buyers before changing or removing that ticket."
            : code.includes("city_required")
              ? // issue #2333 — this arm was UNCONDITIONAL, so an online host was told
                // to "Pick the venue address from the suggestions", naming a field the
                // online Where step never renders (CreatorStep3Where.tsx:138-140 gates
                // the ONLY writer of city behind in_person|hybrid). A dead end dressed
                // as an instruction. After migration 20270427002334 an online event no
                // longer reaches this guard at all, but a LEGACY online row whose
                // theme.business_event.format is missing still can — and that host has
                // no address field either. Branch on the live event's format so the
                // copy is true for whoever actually sees it; the in_person/hybrid
                // string is unchanged.
                liveEvent.format === "online"
                ? "This online event can't be updated right now. Contact support and quote city_required."
                : "Pick the venue address from the suggestions so we have a city."
              : code.includes("party_types_required")
                ? "Pick at least one party type before saving."
                : code.includes("party_types_not_canonical") ||
                    code.includes("vibe_tags_not_canonical") ||
                    code.includes("music_genres_not_canonical")
                  ? "One of the selected tags is no longer supported. Pick again."
                  : code.includes("event_date_dst_invalid")
                    ? "That local time doesn't exist or occurs twice. Pick another time."
                    : code.includes("event_date_required")
                      ? "Set the event date before saving."
                      : code.includes("event_end_must_differ_from_start")
                        ? "End time must differ from start time."
                        : code.includes("when_mode_drops_active_date") ||
                            code.includes("recurrence_drops_occurrence") ||
                            code.includes("multi_date_remove_with_sales")
                          ? "This change would drop a date with active tickets. Cancel or refund those tickets first."
                          : code.includes("schedule_change_with_sales")
                            ? "This event has sold tickets. Refund those buyers before changing its time."
                            : code.includes("stale_client_revision") ||
                                code.includes("event_not_editable_race")
                              ? "Someone else updated this event. Tap to reload."
                              : code.includes("insufficient_event_permission")
                                ? "You don't have permission to edit this event."
                                : code.includes("event_not_editable_status") ||
                                    code.includes("event_deleted")
                                  ? "This event can't be edited — it may be ended or cancelled."
                                  : describeUnmappedEditGuard(code);
        showToast(message);
        return;
      }

      // ORCH-0824 hotfix: unified early-return for server-editable-only
      // patches when the local Zustand event isn't available
      // (disableLocalSaveReason is set when liveEvent === null at the
      // route layer, i.e., the user is editing a server-loaded event).
      // Cover-media, ORCH-0824 taxonomy/city, AND ORCH-0877 Path B When-
      // section RPC have all completed server-side at this point; the
      // local updateLiveEventFields would fail with `event_not_found`
      // because there's no Zustand row to mutate. Skip it cleanly with a
      // success toast + navigate.
      if (
        disableLocalSaveReason !== undefined &&
        isServerEditableOnlyPatch(patch)
      ) {
        invalidateServerEventCaches();
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        // ORCH-0980 pins the literal `showToast("Saved. Live now.");` in this
        // path, so both branches are spelled out rather than collapsed into a
        // `??`. issue #2009 SPEC §6: a visibility-ONLY save names the label.
        if (issue2009VisibilitySuccessToast !== null) {
          showToast(issue2009VisibilitySuccessToast);
        } else {
          showToast("Saved. Live now.");
        }
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            // orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)
            router.replace(`/event/${liveEvent.id}` as never);
          }
        }, TOAST_NAV_DELAY_MS);
        return;
      }

      const result = updateLiveEventFields(
        liveEvent.id,
        patch,
        soldCountCtx,
        validation.trimmedReason,
      );
      setSubmitting(false);
      setModal((prev) => ({ ...prev, visible: false }));
      if (result.ok) {
        // ORCH-0980 pins the literal `showToast("Saved. Live now.");` in this
        // path, so both branches are spelled out rather than collapsed into a
        // `??`. issue #2009 SPEC §6: a visibility-ONLY save names the label.
        if (issue2009VisibilitySuccessToast !== null) {
          showToast(issue2009VisibilitySuccessToast);
        } else {
          showToast("Saved. Live now.");
        }
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            // orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)
            router.replace(`/event/${liveEvent.id}` as never);
          }
        }, TOAST_NAV_DELAY_MS);
        return;
      }
      // Guard-rail rejection — open dialog (deferred so it isn't dropped while
      // the reason sheet dismisses on iOS; see REJECT_DIALOG_HANDOFF_MS).
      const pendingReject = buildRejectDialog(result);
      setTimeout(
        () => setRejectDialog(pendingReject),
        REJECT_DIALOG_HANDOFF_MS,
      );
    },
    [
      submitting,
      liveEvent,
      currentPatch,
      // ORCH-1172 — the RSVP save reads the full editState to build the
      // publish-style payload (buildRsvpUpdatePayload).
      editState,
      soldCountCtx,
      updateLiveEventFields,
      router,
      showToast,
      buildRejectDialog,
      disableLocalSaveReason,
      invalidateServerEventCaches,
      rsvpMode,
    ],
  );

  const handleModalClose = useCallback((): void => {
    if (submitting) return;
    setModal((prev) => ({ ...prev, visible: false }));
  }, [submitting]);

  // ---- Back/discard ----
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // orch-strict-grep-allow route-by-event-type — EditPublishedScreen.tsx edits events only; liveEvent.id is always an event id (ORCH-0859 [Tr2] REWORK 5b)
      router.replace(`/event/${liveEvent.id}` as never);
    }
  }, [router, liveEvent.id]);

  // ---- Section body renderer ----
  const renderSectionBody = useCallback(
    (key: SectionKey): React.ReactNode => {
      const stepBodyProps = {
        draft: editState,
        updateDraft: handleUpdateDraft,
        errors: sectionErrors[key],
        showErrors,
        onShowToast: showToast,
        scrollToBottom,
        editMode: { soldCountByTier: soldCountCtx.soldCountByTier },
        canEditTicketPrice,
        coverMediaEventId: liveEvent.serverEventId,
        brandDefaultCurrency: liveEvent.currency ?? null,
        coverMediaApplyMode: "published_manual" as const,
        onCoverVideoProcessingChange: setCoverVideoProcessing,
        // ORCH-1335 — RsvpStep5Setup ("rsvp-setup" section) reads this to swap
        // its chip-in bank callout. Undefined for non-RSVP sections (harmless).
        chipInPayoutReady,
        // ORCH-0892-A: legacy CoverPicker scroll-ref prop removed.
        // CoverPicker now uses the keyboard-controller library's KAV wrap.
        // scrollViewRef remains for the Cycle 3 wizard root pattern.
      };
      switch (key) {
        case "basics":
          return <CreatorStep1Basics {...stepBodyProps} />;
        case "when":
          return <CreatorStep2When {...stepBodyProps} />;
        case "where":
          return <CreatorStep3Where {...stepBodyProps} />;
        case "cover":
          return <CreatorStep4Cover {...stepBodyProps} showThemeRow={false} />;
        case "visual":
          // #1022 — the Visual section survives (its key is pinned by an
          // append-only parity test) but now hosts the NEW compact control.
          // #1035 — the ThemeSheet that used to sit here as a sibling has been
          // hoisted OUT of this memoized renderSectionBody to the component's
          // top-level return (a sibling of ChangeSummaryModal). It read
          // `themeSheetOpen` while that state was ABSENT from this useCallback's
          // dep array, so tapping the row flipped the state but React returned
          // the cached body with visible={false} and the sheet never presented.
          // The row keeps its stable setter onPress and stays put.
          return (
            <ThemeControlRow
              value={editState.themeOverrides}
              onChange={(themeOverrides) =>
                handleUpdateDraft({ themeOverrides })
              }
              scope="offering"
              brandTheme={brandQuery.data?.theme ?? null}
              brandThemeStatus={
                brandQuery.isLoading
                  ? "loading"
                  : brandQuery.isError
                    ? "error"
                    : "ready"
              }
              onPress={() => setThemeSheetOpen(true)}
              testID="edit-published-theme-row"
            />
          );
        case "tickets":
          return <CreatorStep5Tickets {...stepBodyProps} />;
        case "settings":
          return <CreatorStep6Settings {...stepBodyProps} />;
        case "rsvp-setup":
          // ORCH-1172 — mount the SAME Step-5 host-control body the create RSVP
          // wizard uses. Cross-field logic (capacity→waitlist, private→discover-
          // off, plus-ones-max) runs identically in edit: it only calls
          // updateDraft, which is the local editState setter here.
          return <RsvpStep5Setup {...stepBodyProps} />;
        default: {
          const _exhaust: never = key;
          return _exhaust;
        }
      }
    },
    [
      editState,
      handleUpdateDraft,
      sectionErrors,
      showErrors,
      showToast,
      scrollToBottom,
      soldCountCtx.soldCountByTier,
      canEditTicketPrice,
      liveEvent.serverEventId,
      liveEvent.currency,
      chipInPayoutReady,
    ],
  );

  // ---- Section "edited" indicator ----
  const editedSectionKeys = useMemo<Set<SectionKey>>(() => {
    const out = new Set<SectionKey>();
    if (fieldDiffs.length === 0) return out;
    const changedKeys = new Set(fieldDiffs.map((d) => d.fieldKey));
    for (const sec of sections) {
      if (
        (sec.key === "basics" &&
          (changedKeys.has("name") ||
            changedKeys.has("description") ||
            changedKeys.has("format") ||
            changedKeys.has("category"))) ||
        (sec.key === "when" &&
          (changedKeys.has("whenMode") ||
            changedKeys.has("date") ||
            changedKeys.has("doorsOpen") ||
            changedKeys.has("endsAt") ||
            changedKeys.has("timezone") ||
            changedKeys.has("recurrenceRule") ||
            changedKeys.has("multiDates"))) ||
        (sec.key === "where" &&
          (changedKeys.has("venueName") ||
            changedKeys.has("address") ||
            changedKeys.has("onlineUrl") ||
            changedKeys.has("hideAddressUntilTicket"))) ||
        (sec.key === "cover" &&
          (changedKeys.has("coverHue") ||
            changedKeys.has("coverMediaUrl") ||
            changedKeys.has("coverMediaType") ||
            changedKeys.has("coverMediaProvider") ||
            changedKeys.has("coverMediaSourceUrl") ||
            changedKeys.has("coverMediaCredit") ||
            changedKeys.has("coverMediaCreditUrl") ||
            changedKeys.has("coverMediaAlt"))) ||
        (sec.key === "visual" && changedKeys.has("themeOverrides")) ||
        (sec.key === "tickets" && changedKeys.has("tickets")) ||
        (sec.key === "settings" &&
          (changedKeys.has("visibility") ||
            changedKeys.has("requireApproval") ||
            changedKeys.has("allowTransfers") ||
            changedKeys.has("hideRemainingCount") ||
            changedKeys.has("passwordProtected") ||
            // Cycle 12 — in-person payments toggle is a Settings field.
            changedKeys.has("inPersonPaymentsEnabled"))) ||
        // ORCH-1172 — the RSVP card owns the 6 host-controls PLUS visibility,
        // privateGuestList + hideRemainingCount (the create wizard co-locates
        // them in Step-5; in RSVP edit there is no generic Settings card).
        (sec.key === "rsvp-setup" &&
          (changedKeys.has("rsvpCapacity") ||
            changedKeys.has("rsvpAllowPlusOnes") ||
            changedKeys.has("rsvpPlusOnesMax") ||
            changedKeys.has("rsvpWaitlistEnabled") ||
            changedKeys.has("rsvpApprovalMode") ||
            changedKeys.has("rsvpDiscoverable") ||
            changedKeys.has("visibility") ||
            changedKeys.has("privateGuestList") ||
            changedKeys.has("hideRemainingCount")))
      ) {
        out.add(sec.key);
      }
    }
    return out;
  }, [fieldDiffs]);

  // ---- webPurchasePresent ----
  const webPurchaseRead = useEventHasWebPurchases(rsvpMode ? null : liveEvent.id);
  const webPurchasePresent = webPurchaseRead.data ?? false;

  // ---- Render ----
  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Close edit"
        />
        <Text style={styles.chromeTitle}>Edit event</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <EditAfterPublishBanner />

        {/* ORCH-1150 — RSVP edit notice: every going guest is notified when a
            material detail (date/time/venue) changes. Replaces the ticketed
            refund warning (RSVP has no buyers to refund). */}
        {rsvpMode ? (
          <View style={styles.rsvpNotice}>
            <Text style={styles.rsvpNoticeText}>
              {rsvpEditNoticeCopy(liveEvent.rsvpGoingCount ?? 0)}
            </Text>
          </View>
        ) : null}

        {sections.map((sec) => {
          const isOpen = openSection === sec.key;
          const isEdited = editedSectionKeys.has(sec.key);
          const hasErrors = showErrors && sectionErrors[sec.key].length > 0;
          return (
            <View key={sec.key} style={styles.sectionCard}>
              <Pressable
                onPress={() => handleToggleSection(sec.key)}
                accessibilityRole="button"
                accessibilityLabel={`${sec.label} section${isOpen ? " (expanded)" : " (collapsed)"}`}
                style={({ pressed }) => [
                  styles.sectionHeader,
                  pressed && styles.sectionHeaderPressed,
                ]}
              >
                <View style={styles.sectionHeaderLeft}>
                  <Text style={styles.sectionLabel}>{sec.label}</Text>
                  {isEdited ? (
                    <View style={styles.editedBadge}>
                      <Text style={styles.editedBadgeText}>Edited</Text>
                    </View>
                  ) : null}
                  {hasErrors ? (
                    <View style={styles.errorBadge}>
                      <Text style={styles.errorBadgeText}>Fix</Text>
                    </View>
                  ) : null}
                </View>
                <Icon
                  name={isOpen ? "chevU" : "chevD"}
                  size={16}
                  color={textTokens.tertiary}
                />
              </Pressable>
              {isOpen ? (
                <View style={styles.sectionBody}>
                  {renderSectionBody(sec.key)}
                </View>
              ) : null}
            </View>
          );
        })}

        {/* issue #2101 [named-buyer checkout] — the owner-only "Eligible buyers"
            card. Ticketed events only: RSVP has no checkout, so the control is
            not offered in rsvpMode. Web-only by filename resolution — the
            .native.tsx sibling is a typed null renderer, so no native Business
            screen gains a configuration control. */}
        {!rsvpMode && Platform.OS === "web" ? (
          <View style={styles.sectionCard}>
            <React.Suspense fallback={null}>
              <EventTicketCheckoutAccessCard eventId={liveEvent.id} />
            </React.Suspense>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky bottom Save dock — hidden when keyboard up */}
      {!keyboardVisible ? (
        <View
          style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]}
        >
          {!rsvpMode && serverOrdersRead.status === "error" ? (
            <Text style={styles.ordersReadMessage}>
              Couldn&apos;t load ticket sales. Try again.
            </Text>
          ) : !rsvpMode && serverOrdersRead.status === "stale-error" ? (
            <Text style={styles.ordersReadMessage}>
              Unable to refresh ticket sales. Try again.
            </Text>
          ) : null}
          {!rsvpMode && serverOrdersRead.status !== "ready" ? (
            <Button
              label={
                serverOrdersRead.status === "loading" || serverOrdersRead.status === "disabled"
                  ? "Checking ticket sales…"
                  : "Try again"
              }
              onPress={() => { void serverOrdersRead.refetch(); }}
              variant="secondary"
              size="md"
              fullWidth
              disabled={serverOrdersRead.status === "loading" || serverOrdersRead.status === "disabled"}
              accessibilityLabel="Retry loading ticket sales"
            />
          ) : null}
          <Button
            label="Save changes"
            onPress={handleSavePress}
            variant="primary"
            size="lg"
            fullWidth
            disabled={
              submitting ||
              coverVideoProcessing ||
              (!rsvpMode && serverOrdersRead.status !== "ready") ||
              // issue #2009 SC-2 — a clean editor disables Save. Before this,
              // "no diff" was absent from the disabled predicate, so some loads
              // showed an ACTIVE button whose only outcome was the misleading
              // "No changes to save." toast.
              Object.keys(currentPatch).length === 0 ||
              (disableLocalSaveReason !== undefined &&
                !canSaveServerCoverMediaOnly)
            }
            accessibilityLabel="Save changes"
          />
        </View>
      ) : null}

      {/* Review modal */}
      <ChangeSummaryModal
        visible={modal.visible}
        diffs={modal.fieldDiffs}
        ticketDiffs={modal.ticketDiffs}
        severity={modal.severity}
        webPurchasePresent={webPurchasePresent}
        onClose={handleModalClose}
        onConfirm={handleConfirmSave}
        submitting={submitting}
      />

      {/* #1035 — Theme picker sheet, hoisted OUT of the memoized
          renderSectionBody so `visible` is evaluated in live render scope on
          every render. The Theme row (in the Visual section body) flips
          themeSheetOpen; rendering the sheet here — a sibling of
          ChangeSummaryModal, exactly like BrandEditView and every create
          mount — makes the tap present it. Serves BOTH published-event and
          published-RSVP edit (same screen, same Visual section). SheetMobile
          lazy-mounts, so an always-present sheet costs nothing while closed. */}
      <ThemeSheet
        visible={themeSheetOpen}
        onClose={() => setThemeSheetOpen(false)}
        value={editState.themeOverrides}
        onChange={(themeOverrides) => handleUpdateDraft({ themeOverrides })}
        scope="offering"
        brandTheme={brandQuery.data?.theme ?? null}
        testID="edit-published-theme-sheet"
      />

      {/* Refund-first reject dialog */}
      <ConfirmDialog
        visible={rejectDialog !== null}
        onClose={() => setRejectDialog(null)}
        onConfirm={() => {
          if (rejectDialog !== null) {
            rejectDialog.primaryAction();
          }
        }}
        title={rejectDialog?.title ?? ""}
        description={rejectDialog?.body ?? ""}
        confirmLabel={rejectDialog?.primaryLabel ?? "OK"}
        cancelLabel="Close"
        variant={rejectDialog?.variant ?? "simple"}
        destructive={rejectDialog?.destructive ?? false}
      />

      {/* Toast (self-positioning portal) */}
      <Toast
        visible={toast.visible}
        kind="info"
        message={toast.message}
        onDismiss={() => setToast({ visible: false, message: "" })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md + 8,
    paddingTop: spacing.md,
  },
  sectionCard: {
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  // ORCH-1150 — RSVP "they'll be notified" notice. Opaque fill (Android glass
  // policy: ANDROID_GLASS_USES_OPAQUE_FALLBACK) — solid card, no translucent tint.
  rsvpNotice: {
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: canvas.profile,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    overflow: "hidden",
  },
  rsvpNoticeText: {
    color: textTokens.secondary,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  sectionHeaderPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  editedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radiusTokens.full,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  editedBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: accent.warm,
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  errorBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 59, 48, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 59, 48, 0.45)",
  },
  errorBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ff3b30",
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  sectionBody: {
    paddingHorizontal: spacing.md,
    paddingTop: 0,
    paddingBottom: spacing.md,
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(12, 14, 18, 0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  ordersReadMessage: {
    color: textTokens.secondary,
    fontSize: 13,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
});

export default EditPublishedScreen;
