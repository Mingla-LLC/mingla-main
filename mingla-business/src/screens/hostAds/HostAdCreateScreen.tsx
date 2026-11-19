/**
 * Issue #3697 v1.4 — Host Ads plan builder and resumable launch surface.
 * #4238 W6a — rebuilt to design v9 on Graphite Glass: six steps (what to
 * promote, who sees it, where it runs, budget, the ad, review and pay), each
 * opening on "Let Mingla choose" with an Advanced layer; every amount is what
 * the Host pays (credit is sent to the server); Launch waits for every app's
 * check, the media rights and enough credit, with the reason pinned above it.
 */

import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { DateField } from "../../components/ui/DateField";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import {
  HOST_AD_OWNED_ERROR_COPY,
  HOST_AD_PLATFORM_NAMES,
  hostAdErrorMessage,
  hostAdStatusLabel,
  hostAdWideningKind,
} from "../../components/marketing/ads/hostAdCopy";
import {
  goBackToAds,
  hostAdDayOf,
  hostAdScheduleError,
  hostAdScheduleIsos,
  hostAdScheduleLimit,
  hostAdScrollBottomPadding,
  hostAdErrorLineBottomOffset,
  shouldHideHostAdDock,
  hostAdAgeRangeValid,
  initialHostAdConnections,
} from "../../components/marketing/ads/hostAdBuilderRules";
import {
  hostAdPageDate,
  hostAdPageUnavailableReason,
} from "../../components/marketing/ads/hostAdPageLabels";
import { cachedHostAdSetup } from "../../components/marketing/ads/hostAdSetupCache";
import { HostAdCountryPicker } from "../../components/marketing/ads/HostAdCountryPicker";
import { HostAdAudiencePicker } from "../../components/marketing/ads/HostAdAudiencePicker";
import { HostAdPagePicker } from "../../components/marketing/ads/HostAdPagePicker";
import { HostAdPlacesEditor } from "../../components/marketing/ads/HostAdPlacesEditor";
import { HostAdInterestsEditor } from "../../components/marketing/ads/HostAdInterestsEditor";
import { HostAdPreview } from "../../components/marketing/ads/HostAdCreativeExtras";
import {
  type HostAdBudgetMode,
  hostAdAllocations,
  hostAdDaysInRun,
  hostAdProportionalCents,
} from "../../components/marketing/ads/hostAdBudget";
import {
  HOST_AD_BUILDER_APPS,
  HOST_AD_BUILDER_STEPS,
  type HostAdBuilderStep,
  hostAdBuilderStepId,
  hostAdCreativeProblem,
  hostAdCreditFromPay,
  hostAdPlanBudget,
  hostAdLaunchBlocker,
  hostAdMinimumCreditCents,
  hostAdMinimumPayCents,
  hostAdPayFromCredit,
  hostAdSliderRange,
  hostAdSnap,
  hostAdTopUpNeededCents,
  hostAdPlanHoldPlaced,
  hostAdWeekRange,
  type HostAdCheckRow,
} from "../../components/marketing/ads/hostAdBuilderModel";
import { hb, hostAdGoalName, hostAdGoalUnit, hostAdStepName } from "../../components/marketing/ads/hostAdBuilderCopy";
import {
  AdvancedRow,
  Badge,
  Blocker,
  BudgetSlider,
  BuilderCard,
  BuilderLabel,
  BuilderList,
  builderStyles as bs,
  CheckRow,
  CheckState,
  ChipRow,
  InfoLine,
  Note,
  Segmented,
  SwitchRow,
  ValueRow,
} from "../../components/marketing/ads/HostAdBuilderBits";
import { HostAdTopUpSheet } from "../../components/marketing/ads/HostAdTopUpSheet";
import { HostAdWordsSheet } from "../../components/marketing/ads/HostAdWordsSheet";
import { hm } from "../../components/marketing/ads/hostAdManageCopy";
import { Sheet } from "../../components/ui/Sheet";
import { Icon } from "../../components/ui/Icon";
import { Material } from "../../components/ui/Material";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { useBusinessMediaTranslation } from "../../i18n";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { unsavedWork } from "../../hooks/useUnsavedChangesGuard";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
import { applyAdCreditTopUp, getAdCreditWallet, type AdCreditTopUpLimits } from "../../services/adCreditService";
import { formatCurrency, formatCurrencyRound } from "../../utils/currency";
import {
  HOST_AD_CTA_OPTIONS,
  type HostAdCtaId,
  hostAdCopyError,
  hostAdDefaultCta,
  isHostAdCtaId,
} from "../../components/marketing/ads/hostAdCreativeRules";
import {
  applyInterestLookup,
  applyPlaceLookup,
  type HostAdApp,
  HOST_AD_DEFAULT_RADIUS_KM,
  HOST_AD_EXCLUDE_APPS,
  hostAdAppAvailability,
  hostAdInterestKey,
  hostAdLookupKind,
  hostAdLookupQuery,
  hostAdPlaceAppStatus,
  hostAdPlaceFromSaved,
  hostAdPlaceKey,
  hostAdPendingLookups,
  hostAdPendingLookupSignature,
  hostAdPlaceNeedsLookup,
  type HostAdPlace,
  type HostAdPlaceKind,
  HOST_AD_LANGUAGE_NAMES,
} from "../../components/marketing/ads/hostAdTargeting";
import {
  hostAdAudiencePlace,
  initialHostAdCountries,
} from "../../components/marketing/ads/hostAdCountries";
import {
  HOST_AD_UNAVAILABLE_BODY,
  HOST_AD_UNAVAILABLE_TITLE,
  hostAdSetupErrorCopy,
} from "../../components/marketing/ads/hostAdSetupCopy";
import { HostAdMediaSection, type HostAdMediaTile } from "../../components/marketing/ads/HostAdMediaSection";
import type { HostAdUploadReport } from "../../components/marketing/ads/HostAdVideoUploadSlot";
import {
  HOST_AD_MEDIA_MAX,
  hostAdAddToAd,
  hostAdCreativeNameFor,
  hostAdElapsedLabel,
  hostAdPickFingerprint,
  hostAdRemoveFromAd,
  hostAdUploadOwnerKey,
  planHostAdPick,
  type HostAdPickedVideo,
  type HostAdPickRefusal,
  type HostAdUploadItem,
} from "../../components/marketing/ads/hostAdMediaQueue";
import { color, edge, radius, space, type } from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { DONE_BAR_OCCUPIED, MIN_VISIBLE_CLEARANCE } from "../../wrappers/keyboardClearance";
import { hostAdGoalFallbackReason, hostAdPageGoal } from "../../components/marketing/ads/hostAdGoal";
import type {
  HostAdConnection,
  HostAdCopyWarning,
  HostAdCreative,
  HostAdGuidance,
  HostAdGuidanceBelowEvery,
  HostAdOptimization,
  HostAdPage,
  HostAdPlanAggregate,
  HostAdSeriesDate,
  HostAdSetup,
  HostAdTargetingCity,
  HostAdTargetingInterest,
  PreparedHostAdPlan,
} from "../../services/hostAdPlanService";
import { loadHostAdPlanService } from "./hostAdKitService";
import { randomUuid } from "../../utils/randomId";
import { adTileFitLine } from "../../components/marketing/ads/hostAdTileFit";
import { hostOptimizationByPlatform } from "../../services/hostAdPlanService";

// #4238: platforms are named the way Hosts know them.

// #4238 B7: the upload slot, multi-picker and video transport load on intent
// through the one shared authoring runtime (see its header), so Host web never
// downloads upload code at boot.
const loadVideoAuthoringRuntime = () => import("../../services/eventCoverVideoAuthoringRuntime");
const HostAdVideoUploadSlot = React.lazy(() =>
  loadVideoAuthoringRuntime().then((runtime) => ({ default: runtime.HostAdVideoUploadSlot })),
);

const PLATFORM_LABELS = HOST_AD_PLATFORM_NAMES;

/** #4238 B7: what a refused pick says on its tile. */
const PICK_REFUSAL_KEY: Record<HostAdPickRefusal, string> = {
  unsupported: "media.refused.unsupported",
  too_short: "media.refused.tooShort",
  too_long: "media.refused.tooLong",
  too_large: "media.refused.tooLarge",
  unreadable: "media.refused.unreadable",
};

const RESUMABLE_STATES = new Set([
  "ready_for_funding",
  "funded_held",
  "staff_review_required",
  "staff_approved",
  "creating_paused_objects",
  "creation_failed_retryable",
  "changes_requested",
]);

const HOST_AD_STEPS = HOST_AD_BUILDER_STEPS.map((id) => ({ id }));

type HostAdStepId = HostAdBuilderStep;

const hostAdStepId = hostAdBuilderStepId;

/** #4238 W6a design v9 desktop builder: step list 208, preview 360, form ≥ 534 at 1280. */
const DESK_STEP_LIST = 208;
const DESK_PREVIEW = 360;
const DESK_FORM_MAX = 680;

/**
 * #4238 D4: the builder keeps its place in the URL with setParams, never a
 * replace. A replace remounted the screen on web, which reloaded Ads setup
 * and, for ?plan_id=, resumed the plan again in a loop.
 */
function hostAdBuilderParams(input: {
  draftId: string;
  planId?: string | null;
  step: HostAdStepId;
}): Record<string, string | undefined> {
  return {
    draft_id: input.draftId,
    step: input.step,
    plan_id: input.planId ?? undefined,
  };
}

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function aggregateHasProviderObjectEvidence(
  aggregate: HostAdPlanAggregate,
): boolean {
  if ((aggregate.campaigns ?? []).length > 0) return true;
  return (aggregate.provider_attempts ?? []).some((attempt) => {
    if (attempt.command !== "create_paused_objects") return false;
    const externalIds = attempt.external_ids;
    return (
      attempt.state === "succeeded" ||
      (externalIds !== null &&
        typeof externalIds === "object" &&
        !Array.isArray(externalIds) &&
        Object.keys(externalIds).length > 0)
    );
  });
}

export default function HostAdCreateRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    plan_id?: string | string[];
    draft_id?: string | string[];
    step?: string | string[];
  }>();
  const requestedPlanId = firstParam(params.plan_id);
  const requestedDraftId = firstParam(params.draft_id);
  const requestedStepId = hostAdStepId(firstParam(params.step));
  const resumedRef = useRef<string | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const draftShouldHydrateRef = useRef(false);
  if (draftIdRef.current === null) {
    draftIdRef.current = requestedDraftId ?? randomUuid();
    draftShouldHydrateRef.current = requestedDraftId !== null;
  }
  const draftHydrationStartedRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const draftPlanIdRef = useRef<string | null>(null);
  const draftSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const permissions = useHostAdPermissions(brandId);
  // #4238 Extra A: the floating bottom nav and the floating "Create an ad"
  // button sit over this screen on phones. Reserve both so the step buttons
  // stay reachable at full scroll (business web and native).
  const bottomChromeInset = useStickyFooterOffset();
  // #4238 rework 6 (P1-1): on Android the window does not resize for the
  // keyboard, so the pinned dock under the scroll view stayed behind the
  // keyboard and the keyboard-aware scroll aligned the field to a viewport edge
  // the Host cannot see. While the keyboard is open the dock steps aside so the
  // scroll view runs to the keyboard, as it does in the sheets that already work.
  const keyboardOpen = useKeyboardIsVisible();
  const dockHiddenForKeyboard = shouldHideHostAdDock(Platform.OS, keyboardOpen);
  const scrollBottomStyle = useMemo(
    () => ({ paddingBottom: hostAdScrollBottomPadding(bottomChromeInset) }),
    [bottomChromeInset],
  );
  const [setup, setSetup] = useState<HostAdSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState<HostAdPage | null>(null);
  const [connections, setConnections] = useState<HostAdConnection[]>([]);
  const [creative, setCreative] = useState<HostAdCreative | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [rightsBasis, setRightsBasis] = useState<
    "owned" | "licensed" | "authorized_by_brand"
  >("owned");
  const [aiGenerated, setAiGenerated] = useState(false);
  const [name, setName] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  // #4238: chosen by name; never defaulted to a country we did not read.
  const [countries, setCountries] = useState<string[]>([]);
  const [optimization, setOptimization] =
    useState<HostAdOptimization>("visits");
  const [ageMin, setAgeMin] = useState("21");
  const [ageMax, setAgeMax] = useState("45");
  const [gender, setGender] = useState<"all" | "men" | "women">("all");
  const [cities, setCities] = useState<HostAdTargetingCity[]>([]);
  // #4238: places saved before per-place distances use this shared one.
  const [radiusKm, setRadiusKm] = useState(String(HOST_AD_DEFAULT_RADIUS_KM));
  const [excludedPlaces, setExcludedPlaces] = useState<HostAdTargetingCity[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [languageIds, setLanguageIds] = useState<Record<string, string>>({});
  // "<place or interest key>|<app>" while that app's lookup runs.
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const inFlightRef = useRef(new Set<string>());
  const [interests, setInterests] = useState<HostAdTargetingInterest[]>([]);
  // #4238 P1: leave out people who already bought (on by default).
  const [excludePastBuyers, setExcludePastBuyers] = useState(true);
  // #4238 wave 2: the brand's own audiences (keys only; the server resolves).
  const [audienceKeys, setAudienceKeys] = useState<string[]>([]);
  const [dailyAmount, setDailyAmount] = useState("30");
  const [capAmount, setCapAmount] = useState("210");
  // #4238 P1: a total for the run by default; per day as an option.
  const [budgetMode, setBudgetMode] = useState<HostAdBudgetMode>("total");
  const [totalAmount, setTotalAmount] = useState("");
  // #4238 P1: the button; defaults from the page once it is picked.
  const [cta, setCta] = useState<HostAdCtaId | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activeStepId, setActiveStepId] = useState<HostAdStepId>(
    requestedStepId ?? "pick",
  );
  const [maxVisitedStep, setMaxVisitedStep] = useState(
    Math.max(
      0,
      HOST_AD_STEPS.findIndex(
        (step) => step.id === (requestedStepId ?? "pick"),
      ),
    ),
  );
  const [existingPlanId, setExistingPlanId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedHostAdPlan | null>(null);
  const [activePlanState, setActivePlanState] = useState<string | null>(null);
  const [acceptBroader, setAcceptBroader] = useState(false);
  const [providerObjectEvidence, setProviderObjectEvidence] = useState(false);
  const [, setCancelDialogVisible] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<
    "loading" | "unsaved" | "saving" | "saved" | "conflict" | "error"
  >("loading");
  // #4238 B7/B8: several ad videos upload side by side, each in its own
  // background slot; there is no sheet on this path, so nothing is reused.
  const [uploads, setUploads] = useState<HostAdUploadItem[]>([]);
  const [uploadAttempts, setUploadAttempts] = useState<Record<string, number>>({});
  const [cancelledUploads, setCancelledUploads] = useState<string[]>([]);
  // Files refused at pick, shown as failed tiles until cleared.
  const [refusedPicks, setRefusedPicks] = useState<
    { key: string; file: HostAdPickedVideo; reason: HostAdPickRefusal }[]
  >([]);
  const uploadSeqRef = useRef(0);
  const uploadsRef = useRef<HostAdUploadItem[]>([]);
  uploadsRef.current = uploads;
  const [adVideoLinking, setAdVideoLinking] = useState(false);
  const linkedCreativeIdsRef = useRef<Set<string>>(new Set());
  // Picks that repeat a library clip, asked one at a time.
  const [duplicatePicks, setDuplicatePicks] = useState<
    { file: HostAdPickedVideo; clipId: string; clipName: string }[]
  >([]);
  const [mediaSelectMode, setMediaSelectMode] = useState(false);
  const [mediaSelected, setMediaSelected] = useState<string[]>([]);
  const [mediaUndo, setMediaUndo] = useState<
    null | { text: string; creativeIds?: string[]; restore?: string[] }
  >(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // B10: the server refused because the rights box was not ticked.
  const [rightsMissing, setRightsMissing] = useState(false);
  const rightsYRef = useRef(0);
  // AD-05 — a creative that exists server-side but did not link here yet:
  // "Try linking again" re-links the SAME id, never re-uploads.
  const [unlinkedCreativeId, setUnlinkedCreativeId] = useState<string | null>(null);
  // #4238 W6a: the v9 builder's own state.
  useBusinessMediaTranslation();
  const network = useNetInfoSafe();
  const offline = network?.isConnected === false;
  const { isWideDesktop } = useResponsiveLayout();
  const reduceMotion = useReducedMotionNative();
  const [audienceChoice, setAudienceChoice] = useState<"mingla" | "host">("mingla");
  const [appChoice, setAppChoice] = useState<"mingla" | "host">("mingla");
  const [dailyPayCents, setDailyPayCents] = useState(0);
  const [creativeIds, setCreativeIds] = useState<string[]>([]);
  const [occurrenceKey, setOccurrenceKey] = useState<string | null>(null);
  const [seriesDates, setSeriesDates] = useState<HostAdSeriesDate[] | null>(null);
  const [seriesError, setSeriesError] = useState(false);
  const [acknowledgedFallback, setAcknowledgedFallback] = useState<string[]>([]);
  const [goalQuestion, setGoalQuestion] = useState<string[]>([]);
  const [googleNeedsSetup, setGoogleNeedsSetup] = useState(false);
  const [checkState, setCheckState] = useState<"idle" | "checking" | "done" | "failed">("idle");
  const [copyWarnings, setCopyWarnings] = useState<HostAdCopyWarning[]>([]);
  const [guidance, setGuidance] = useState<HostAdGuidance | HostAdGuidanceBelowEvery | null>(null);
  const [guidanceState, setGuidanceState] = useState<"idle" | "loading" | "error">("idle");
  const [walletCreditCents, setWalletCreditCents] = useState<number | null>(null);
  const [topUpLimits, setTopUpLimits] = useState<AdCreditTopUpLimits | null>(null);
  const [advanced, setAdvanced] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState<
    null | "words" | "rights" | "topUp" | "leave" | "launch" | "cancel" | "archive"
  >(null);
  const [launched, setLaunched] = useState<null | "staff" | "apps">(null);
  const scrollRef = useRef<{ scrollTo?: (options: { y: number; animated?: boolean }) => void } | null>(null);
  const checksYRef = useRef(0);
  // #4238 W7 (native P3-4): each step opens at its top, never at the scroll
  // offset the previous step was left at.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [activeStepId]);

  useEffect(() => {
    if (requestedDraftId !== null || draftIdRef.current === null) return;
    router.setParams(
      hostAdBuilderParams({
        draftId: draftIdRef.current,
        planId: requestedPlanId,
        step: activeStepId,
      }),
    );
  }, [activeStepId, requestedDraftId, requestedPlanId, router]);

  // #4238 D5: after a refresh or a direct link there is no history, so a bare
  // router.back() did nothing. Go to the Ads list explicitly then.
  const navigation = useNavigation();
  const sanctionedExitRef = useRef(false);
  const backToAds = useCallback(() => {
    sanctionedExitRef.current = true;
    goBackToAds(router);
  }, [router]);
  // #4238 rework 6: Android hardware back and the iOS swipe both leave the
  // builder through the same "Leave the builder? Your draft is kept" sheet as
  // the close button. Once launched there is nothing to lose, so it just leaves.
  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    const unsubscribe = navigation.addListener("beforeRemove" as never, ((event: { preventDefault: () => void }) => {
      if (sanctionedExitRef.current || launched) return;
      event.preventDefault();
      setSheet("leave");
    }) as never);
    return unsubscribe;
  }, [navigation, launched]);

  const load = useCallback(async (force = false) => {
    if (!brandId || !permissions.canRead) return;
    setLoading(true);
    setError(null);
    try {
      const { loadHostAdSetup } = await loadHostAdPlanService();
      // #4238 D4: one setup read per brand for a short while (remounts,
      // step changes and a resumed plan reuse it); Retry forces a fresh one.
      setSetup(await cachedHostAdSetup(brandId, loadHostAdSetup, { force }));
    } catch (cause) {
      setError(
        hostAdSetupErrorCopy(
          cause !== null && typeof cause === "object" && "code" in cause
            ? String(cause.code)
            : null,
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [brandId, permissions.canRead]);

  // #3040 B-C14 [A-14, C-4..C-8] — the ad video is an `ad_creative` lane job;
  // the SERVER creates the creative row from the READY job and the upload
  // slot reports its id. Nothing records a creative from a URL here.
  // #4238 B7: each finished upload links once; a clip placed in the library
  // (the ad was full) is refreshed into the library but not added to the ad.
  const linkAdCreative = useCallback(
    async (creativeId: string, placement: "ad" | "library" = "ad"): Promise<void> => {
      if (!brandId) return;
      if (linkedCreativeIdsRef.current.has(creativeId)) return;
      setAdVideoLinking(true);
      setError(null);
      try {
        const { loadHostAdSetup } = await loadHostAdPlanService();
        const refreshed = await cachedHostAdSetup(brandId, loadHostAdSetup, {
          force: true,
        });
        const recorded = refreshed.creatives.find(
          (item) => item.id === creativeId,
        );
        if (!recorded) {
          throw new Error(HOST_AD_OWNED_ERROR_COPY.videoNotShown);
        }
        linkedCreativeIdsRef.current.add(creativeId);
        setUnlinkedCreativeId(null);
        setSetup(refreshed);
        if (placement === "ad") {
          setCreative((current) => current ?? recorded);
          setCreativeIds((current) => hostAdAddToAd(current, [recorded.id]));
          setRightsConfirmed(false);
          setPrepared(null);
        }
      } catch (cause) {
        setUnlinkedCreativeId(creativeId);
        setError(
          hostAdErrorMessage(cause, "Your ad video is saved, but it didn't link to this ad. Try linking it again."),
        );
      } finally {
        setAdVideoLinking(false);
      }
    },
    [brandId],
  );

  // #4238 B7: one upload slot reports a stage. A ready clip links once and
  // its tile becomes the library creative.
  const handleUploadReport = useCallback(
    (report: HostAdUploadReport): void => {
      const owner = uploadsRef.current.find((item) => item.key === report.key);
      if (report.phase === "ready" && report.creativeId !== null && owner) {
        // Link first; the tile leaves the upload list once the creative shows.
        void linkAdCreative(report.creativeId, owner.placement).then(() =>
          setUploads((current) => current.filter((item) => item.key !== report.key)),
        );
      }
      setUploads((current) =>
        current.flatMap((item) => {
          if (item.key !== report.key) return [item];
          return [{
            ...item,
            phase: report.phase,
            percent: report.percent,
            canRetry: report.canRetry,
            failure: report.failure,
            preparingSince:
              report.phase === "preparing" ? item.preparingSince ?? Date.now() : item.preparingSince,
          }];
        }),
      );
    },
    [linkAdCreative],
  );

  // The "Getting it ready · 0:42" clock ticks only while something prepares.
  const anyPreparing = uploads.some((item) => item.phase === "preparing");
  useEffect(() => {
    if (!anyPreparing) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyPreparing]);

  useEffect(() => {
    if (!permissions.isLoading) void load();
  }, [load, permissions.isLoading]);

  const hydrateAggregate = useCallback(
    async (aggregate: HostAdPlanAggregate) => {
      if (!setup) return;
      const canonical = aggregate.version.canonical_plan;
      const destination = canonical.destination as
        Record<string, unknown> | undefined;
      const audience = canonical.audience_intent as
        Record<string, unknown> | undefined;
      const copy = canonical.copy as Record<string, unknown> | undefined;
      const deliveryBudgets = canonical.delivery_budgets as
        Record<string, Record<string, unknown>> | undefined;
      const mediaRights = canonical.media_rights as
        Record<string, unknown> | undefined;
      const schedule = canonical.schedule as
        Record<string, unknown> | undefined;
      const matchedPage =
        setup.pages.find(
          (item) =>
            item.canonical_url === destination?.canonical_url ||
            (item.page_type === destination?.page_type &&
              item.brand_slug === destination?.brand_slug &&
              (item.entity_slug ?? null) ===
                (destination?.entity_slug ?? null)),
        ) ?? null;
      setPage(matchedPage);
      setConnections(
        setup.connections.filter((item) =>
          aggregate.provider_allocations.some(
            (allocation) => allocation.connection_id === item.id,
          ),
        ),
      );
      setCreative(
        setup.creatives.find(
          (item) => item.id === canonical.creative_library_id,
        ) ?? null,
      );
      setRightsConfirmed(mediaRights?.rights_confirmed === true);
      setRightsBasis(
        ["owned", "licensed", "authorized_by_brand"].includes(
          String(mediaRights?.rights_basis),
        )
          ? (mediaRights?.rights_basis as
              "owned" | "licensed" | "authorized_by_brand")
          : "owned",
      );
      setAiGenerated(mediaRights?.ai_generated === true);
      setName(String(canonical.name ?? ""));
      setPrimaryText(String(copy?.primary ?? ""));
      setHeadline(String(copy?.headline ?? ""));
      setCountries(
        initialHostAdCountries(
          setup.brand_country_code,
          Array.isArray(audience?.countries) ? audience.countries : null,
        ),
      );
      const frozenGoal = recordValue(canonical.optimization_by_platform);
      setOptimization(
        canonical.optimization_goal === "signups"
          ? "signups"
          : frozenGoal && Object.values(frozenGoal).includes("sales")
            ? "sales"
            : hostAdPageGoal(matchedPage),
      );
      if (Array.isArray(canonical.creative_library_ids)) {
        setCreativeIds(
          canonical.creative_library_ids
            .filter((id): id is string => typeof id === "string")
            .slice(0, 5),
        );
      } else if (typeof canonical.creative_library_id === "string") {
        setCreativeIds([canonical.creative_library_id]);
      }
      if (typeof canonical.occurrence_key === "string") setOccurrenceKey(canonical.occurrence_key);
      setAppChoice(canonical.app_choice === "host" ? "host" : "mingla");
      setAudienceChoice(canonical.audience_choice === "host" ? "host" : "mingla");
      if (Array.isArray(canonical.acknowledged_visits_fallback)) {
        setAcknowledgedFallback(
          canonical.acknowledged_visits_fallback.map((value) => String(value)),
        );
      }
      setAgeMin(String(audience?.ageMin ?? 21));
      setAgeMax(String(audience?.ageMax ?? 45));
      setGender(
        ["men", "women"].includes(String(audience?.gender))
          ? (audience?.gender as "men" | "women")
          : "all",
      );
      const { hostTargetingSelectionsFromAggregate } =
        await loadHostAdPlanService();
      const targeting = hostTargetingSelectionsFromAggregate(aggregate);
      setCities(targeting.cities);
      setExcludedPlaces(targeting.excluded);
      setExcludePastBuyers(
        Array.isArray(
          recordValue(canonical.audience_selection)?.exclude_keys,
        ),
      );
      setInterests(targeting.interests);
      setRadiusKm(String(targeting.radiusKm ?? HOST_AD_DEFAULT_RADIUS_KM));
      setLanguages(
        Array.isArray(audience?.languages)
          ? audience.languages.filter(
              (code): code is string => typeof code === "string",
            )
          : [],
      );
      // #4238 W6a: the plan keeps credit; the builder shows what was paid.
      setDailyPayCents(
        hostAdPayFromCredit(
          aggregate.provider_allocations.reduce(
            (sum, allocation) =>
              sum +
              Number(
                deliveryBudgets?.[String(allocation.platform)]
                  ?.host_amount_cents ?? 0,
              ),
            0,
          ),
        ),
      );
      setCapAmount(
        String(
          aggregate.provider_allocations.reduce(
            (sum, allocation) =>
              sum + Number(allocation.host_budget_cents ?? 0),
            0,
          ) / 100,
        ),
      );
      // #4238 r6: the date fields are read in the page's own zone.
      setStartDate(
        hostAdDayOf(String(schedule?.starts_at ?? ""), matchedPage?.timezone),
      );
      setEndDate(
        hostAdDayOf(String(schedule?.ends_at ?? ""), matchedPage?.timezone),
      );
      // Plans from before the total budget were set per day.
      setBudgetMode(canonical.budget_mode === "total" ? "total" : "daily");
      setTotalAmount(
        String(
          aggregate.provider_allocations.reduce(
            (sum, allocation) =>
              sum + Number(allocation.host_budget_cents ?? 0),
            0,
          ) / 100,
        ),
      );
      if (isHostAdCtaId(canonical.call_to_action)) setCta(canonical.call_to_action);
      setExistingPlanId(aggregate.plan.id);
      draftPlanIdRef.current = aggregate.plan.id;
      setProviderObjectEvidence(aggregateHasProviderObjectEvidence(aggregate));
    },
    [setup],
  );

  const resumePlan = useCallback(
    async (planId: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const { getHostAdPlan } = await loadHostAdPlanService();
        const aggregate = await getHostAdPlan(planId);
        await hydrateAggregate(aggregate);
        setActiveStepId("review");
        setMaxVisitedStep(HOST_AD_STEPS.length - 1);
        if (draftIdRef.current) {
          router.setParams(
      hostAdBuilderParams({
              draftId: draftIdRef.current,
              planId,
              step: "review",
            }),
          );
        }
        if (aggregate.plan.state === "staff_review_required") {
          setPrepared({
            planId,
            versionId: aggregate.version.id,
            planHash: aggregate.version.plan_hash,
            status: "ready",
            targeting: aggregate.targeting_snapshots,
            measurement:
              (aggregate.version.canonical_plan.measurement as
                Record<string, unknown> | undefined) ?? null,
            mediaRights:
              (aggregate.version.canonical_plan.media_rights as
                Record<string, unknown> | undefined) ?? null,
            optimizationByPlatform: recordValue(
              aggregate.version.canonical_plan.optimization_by_platform,
            ),
            providerValidations: [],
          });
          setActivePlanState(aggregate.plan.state);
          setNotice(
            "Mingla is checking your ad. Your money is set aside and nothing is being spent yet.",
          );
        } else if (aggregate.plan.state === "changes_requested") {
          setPrepared(null);
          setActivePlanState(aggregate.plan.state);
          const reason = aggregate.reviews[0]?.reason;
          setNotice(
            `Mingla asked for changes${reason ? `: ${reason}` : "."} The money you set aside is back in your Ads credit. Make the changes below, then check your ad again.`,
          );
        } else {
          setPrepared({
            planId,
            versionId: aggregate.version.id,
            planHash: aggregate.version.plan_hash,
            status: "ready",
            targeting: aggregate.targeting_snapshots,
            measurement:
              (aggregate.version.canonical_plan.measurement as
                Record<string, unknown> | undefined) ?? null,
            mediaRights:
              (aggregate.version.canonical_plan.media_rights as
                Record<string, unknown> | undefined) ?? null,
            optimizationByPlatform: recordValue(
              aggregate.version.canonical_plan.optimization_by_platform,
            ),
            providerValidations: [],
          });
          setActivePlanState(aggregate.plan.state);
          setNotice(
            hb("saved"),
          );
        }
      } catch (cause) {
        setError(
          hostAdErrorMessage(cause, "The plan could not be restored."),
        );
      } finally {
        setBusy(false);
      }
    },
    [hydrateAggregate, router],
  );

  useEffect(() => {
    if (setup && requestedPlanId && resumedRef.current !== requestedPlanId) {
      resumedRef.current = requestedPlanId;
      void resumePlan(requestedPlanId);
    }
  }, [requestedPlanId, resumePlan, setup]);

  useEffect(() => {
    if (
      !setup ||
      !permissions.canRead ||
      draftHydrationStartedRef.current ||
      draftIdRef.current === null
    ) {
      return;
    }
    draftHydrationStartedRef.current = true;
    if (!draftShouldHydrateRef.current) {
      // #4238: a fresh ad starts on every ready platform and the brand's own
      // country (or none). A resumed plan below overrides both.
      if (!requestedPlanId) {
        setConnections(initialHostAdConnections(setup.connections, null));
        setCountries(initialHostAdCountries(setup.brand_country_code));
      }
      setDraftReady(true);
      setDraftSaveStatus("unsaved");
      return;
    }
    let mounted = true;
    void loadHostAdPlanService()
      .then(({ getHostAdDraft }) => getHostAdDraft(draftIdRef.current as string))
      .then((draft) => {
        if (!mounted) return;
        if (draft.brand_id !== brandId) {
          setDraftSaveStatus("error");
          setError("This draft belongs to another brand.");
          return;
        }
        const state = recordValue(draft.draft_state);
        if (!state) {
          setDraftSaveStatus("error");
          setError("This draft could not be read.");
          return;
        }
        setPage(
          setup.pages.find((item) => item.id === state.page_id) ??
            // #4238 Duplicate: a copied draft names its page by key.
            setup.pages.find(
              (item) =>
                typeof state.page_key === "string" &&
                [
                  item.page_type,
                  item.brand_slug,
                  item.page_type === "brand" ? null : item.entity_slug,
                ]
                  .filter(Boolean)
                  .join(":") === state.page_key,
            ) ??
            null,
        );
        // #4238: a draft that saved no platforms starts on every ready one.
        setConnections(
          initialHostAdConnections(setup.connections, state.connection_ids),
        );
        setCreative(
          setup.creatives.find((item) => item.id === state.creative_id) ?? null,
        );
        if (typeof state.rights_confirmed === "boolean") {
          setRightsConfirmed(state.rights_confirmed);
        }
        if (
          ["owned", "licensed", "authorized_by_brand"].includes(
            String(state.rights_basis),
          )
        ) {
          setRightsBasis(
            state.rights_basis as
              | "owned"
              | "licensed"
              | "authorized_by_brand",
          );
        }
        if (typeof state.ai_generated === "boolean") {
          setAiGenerated(state.ai_generated);
        }
        if (typeof state.name === "string") setName(state.name);
        if (typeof state.primary_text === "string") {
          setPrimaryText(state.primary_text);
        }
        if (typeof state.headline === "string") setHeadline(state.headline);
        setCountries(
          initialHostAdCountries(
            setup.brand_country_code,
            Array.isArray(state.countries) ? state.countries : null,
            typeof state.countries_text === "string"
              ? state.countries_text
              : null,
          ),
        );
        if (
          state.optimization === "sales" ||
          state.optimization === "visits" ||
          state.optimization === "signups"
        ) {
          setOptimization(state.optimization);
        }
        if (typeof state.daily_pay_cents === "number" && state.daily_pay_cents > 0) {
          setDailyPayCents(Math.round(state.daily_pay_cents));
        } else if (typeof state.daily_amount === "string" && Number(state.daily_amount) > 0) {
          // Drafts from before W6a kept a typed amount in major units.
          setDailyPayCents(Math.round(Number(state.daily_amount) * 100));
        }
        if (Array.isArray(state.creative_ids)) {
          setCreativeIds(
            state.creative_ids
              .filter((id): id is string => typeof id === "string")
              .slice(0, 5),
          );
        } else if (typeof state.creative_id === "string") {
          setCreativeIds([state.creative_id]);
        }
        if (typeof state.occurrence_key === "string") setOccurrenceKey(state.occurrence_key);
        if (state.app_choice === "host" || state.app_choice === "mingla") setAppChoice(state.app_choice);
        if (state.audience_choice === "host" || state.audience_choice === "mingla") {
          setAudienceChoice(state.audience_choice);
        }
        if (Array.isArray(state.acknowledged_fallback)) {
          setAcknowledgedFallback(
            state.acknowledged_fallback.filter((value): value is string => typeof value === "string"),
          );
        }
        if (typeof state.age_min === "string") setAgeMin(state.age_min);
        if (typeof state.age_max === "string") setAgeMax(state.age_max);
        if (["all", "men", "women"].includes(String(state.gender))) {
          setGender(state.gender as "all" | "men" | "women");
        }
        if (Array.isArray(state.cities)) {
          setCities(
            state.cities
              .map(hostAdPlaceFromSaved)
              .filter((place): place is HostAdPlace => place !== null),
          );
        }
        if (Array.isArray(state.excluded_places)) {
          setExcludedPlaces(
            state.excluded_places
              .map(hostAdPlaceFromSaved)
              .filter((place): place is HostAdPlace => place !== null),
          );
        }
        if (Array.isArray(state.languages)) {
          setLanguages(
            state.languages.filter(
              (code): code is string =>
                typeof code === "string" && /^[a-z]{2}$/.test(code),
            ),
          );
        }
        if (typeof state.radius_km === "string") setRadiusKm(state.radius_km);
        if (typeof state.exclude_past_buyers === "boolean") {
          setExcludePastBuyers(state.exclude_past_buyers);
        }
        if (Array.isArray(state.interests)) {
          setInterests(
            (state.interests as HostAdTargetingInterest[]).filter(
              (interest) =>
                interest !== null &&
                typeof interest === "object" &&
                typeof interest.name === "string",
            ),
          );
        }
        if (Array.isArray(state.audience_keys)) {
          setAudienceKeys(
            state.audience_keys
              .filter((key): key is string => typeof key === "string")
              .slice(0, 3),
          );
        }
        if (typeof state.daily_amount === "string") {
          setDailyAmount(state.daily_amount);
        }
        if (typeof state.cap_amount === "string") setCapAmount(state.cap_amount);
        if (state.budget_mode === "total" || state.budget_mode === "daily") {
          setBudgetMode(state.budget_mode);
        } else if (typeof state.daily_amount === "string") {
          // Drafts from before the total budget were set per day.
          setBudgetMode("daily");
        }
        if (typeof state.total_amount === "string") {
          setTotalAmount(state.total_amount);
        }
        if (isHostAdCtaId(state.cta)) setCta(state.cta);
        if (typeof state.start_date === "string") setStartDate(state.start_date);
        if (typeof state.end_date === "string") setEndDate(state.end_date);
        if (typeof state.accept_broader === "boolean") {
          setAcceptBroader(state.accept_broader);
        }
        if (recordValue(state.prepared)) {
          setPrepared(state.prepared as unknown as PreparedHostAdPlan);
        }
        if (typeof state.active_plan_state === "string") {
          setActivePlanState(state.active_plan_state);
        }
        if (typeof state.provider_object_evidence === "boolean") {
          setProviderObjectEvidence(state.provider_object_evidence);
        }
        setExistingPlanId(draft.plan_id);
        draftPlanIdRef.current = draft.plan_id;
        draftRevisionRef.current = draft.revision;
        if (requestedStepId === null) {
          const restoredStep = hostAdStepId(draft.current_step) ?? "pick";
          const restoredIndex = HOST_AD_STEPS.findIndex(
            (step) => step.id === restoredStep,
          );
          setActiveStepId(restoredStep);
          setMaxVisitedStep(Math.max(0, restoredIndex));
          if (draftIdRef.current) {
            router.setParams(
      hostAdBuilderParams({
                draftId: draftIdRef.current,
                planId: draft.plan_id,
                step: restoredStep,
              }),
            );
          }
        }
        setDraftReady(true);
        setDraftSaveStatus("saved");
      })
      .catch((cause: unknown) => {
        if (!mounted) return;
        const code =
          cause !== null && typeof cause === "object" && "code" in cause
            ? String(cause.code)
            : "";
        if (code === "draft_not_found") {
          // A fresh ad whose draft was never saved: same start as a new ad.
          if (!requestedPlanId) {
            setConnections(initialHostAdConnections(setup.connections, null));
            setCountries(initialHostAdCountries(setup.brand_country_code));
          }
          setDraftReady(true);
          setDraftSaveStatus("unsaved");
          return;
        }
        setDraftSaveStatus("error");
        setError(
          hostAdErrorMessage(cause, "The saved ad draft could not be restored."),
        );
      });
    return () => {
      mounted = false;
    };
  }, [
    brandId,
    permissions.canRead,
    requestedPlanId,
    requestedStepId,
    router,
    setup,
  ]);

  // #4238 P0: an app that runs in none of the chosen countries is turned off
  // (it stays greyed out with its reason in the list).
  const availabilityKey = (setup?.availability ?? [])
    .map((row) => `${row.platform}:${row.country_code}`)
    .join(",");
  useEffect(() => {
    if (!setup) return;
    setConnections((current) => {
      const kept = current.filter(
        (connection) =>
          hostAdAppAvailability(
            connection.platform,
            countries,
            setup.availability ?? [],
          ).works,
      );
      return kept.length === current.length ? current : kept;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityKey, countries.join(","), setup]);

  // #4238 W6a: the goal follows the page (the Host never picks it). A free
  // ticket page is moved to sign-ups when the server says so.
  const radiusKmNumber = Number(radiusKm);
  // #4238 r6: "today" and both date fields are the page's own calendar.
  const today = useMemo(
    () => hostAdDayOf(new Date().toISOString(), page?.timezone),
    [page?.timezone],
  );
  // #4238: a page the server says can't be promoted (a restored draft or
  // plan whose page has since ended) names its reason instead.
  const promoteError = !page
    ? "Choose the Mingla page people should land on."
    : hostAdPageUnavailableReason(page);
  // #4238: an ad on a dated page ends by the last day people can book.
  const scheduleLimit = useMemo(
    () =>
      hostAdScheduleLimit(page, (iso) => hostAdPageDate(iso, page?.timezone)),
    [page],
  );
  // #4238 W6a: apps that can run here at all (country, goal), the ones the
  // Host turned on, and the ones the plan really uses (under "Let Mingla
  // choose", the apps the server funds at this budget).
  const goal: HostAdOptimization = optimization;
  const runnableConnections = useMemo(
    () =>
      (setup?.connections ?? []).filter(
        (connection) =>
          hostAdAppAvailability(connection.platform, countries, setup?.availability ?? []).works &&
          !(goal !== "visits" && connection.platform === "google"),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setup, countries.join(","), goal],
  );
  const guidanceOk = guidance !== null && guidance.ok === true ? guidance : null;
  const guidanceBelow = guidance !== null && guidance.ok === false ? guidance : null;
  const fundedPlatforms = useMemo(
    () =>
      appChoice === "mingla"
        ? (guidanceOk?.apps_plan?.funded ?? []).map((row) => row.platform)
        : null,
    [appChoice, guidanceOk],
  );
  const planConnections = useMemo(
    () =>
      appChoice === "mingla"
        ? runnableConnections.filter((connection) =>
            (fundedPlatforms ?? []).includes(connection.platform),
          )
        : connections.filter((connection) =>
            runnableConnections.some((row) => row.id === connection.id),
          ),
    [appChoice, connections, fundedPlatforms, runnableConnections],
  );
  const lookupConnections = appChoice === "mingla" ? runnableConnections : connections;
  const activeApps = useMemo(
    () => lookupConnections.map((connection) => connection.platform as HostAdApp),
    [lookupConnections],
  );
  const planApps = planConnections.map((connection) => connection.platform);
  const goalByPlatform = useMemo(
    () =>
      page
        ? hostOptimizationByPlatform(goal, page, runnableConnections)
        : ({} as Record<string, HostAdOptimization>),
    [goal, page, runnableConnections],
  );
  const minimumPay = (platform: string): number | null =>
    hostAdMinimumPayCents(setup?.minimums, platform, goalByPlatform[platform] ?? "visits");
  const minimumCredit = (platform: string): number | null =>
    hostAdMinimumCreditCents(setup?.minimums, platform, goalByPlatform[platform] ?? "visits");
  // #4238: each app's own distance limits (Meta needs 17 km around a city).
  const radiusProblem = cities
    .flatMap((place) =>
      activeApps.map((app) => ({
        app,
        status: hostAdPlaceAppStatus(place, app, {
          radiusKm: place.radiusKm ?? radiusKmNumber,
          availability: setup?.availability ?? [],
        }),
      })),
    )
    .find((row) => row.status.state === "radius");
  const audienceError =
    countries.length === 0
      ? hb("audience.noCountry")
      : radiusProblem
        ? hb("audience.radius", {
            app: PLATFORM_LABELS[radiusProblem.app] ?? radiusProblem.app,
            reason: radiusProblem.status.text,
          })
        : !hostAdAgeRangeValid(ageMin, ageMax)
          ? hb("audience.ageError")
          : null;
  const ageErrorLine = !hostAdAgeRangeValid(ageMin, ageMax) ? hb("audience.ageError") : null;
  // #4238 P3-1 (iOS and Android): room for the age error line above the keyboard Done bar.
  const errorLineOffset = hostAdErrorLineBottomOffset(
    Platform.OS,
    DONE_BAR_OCCUPIED,
    MIN_VISIBLE_CLEARANCE,
    ageErrorLine !== null,
  );
  const scrollOffsetProps = (errorLineOffset === null ? {} : { bottomOffset: errorLineOffset }) as object;
  const platformsError =
    appChoice === "host" && planConnections.length === 0 ? hb("platforms.turnOnOne") : null;
  // #4238 W6a: one money unit on screen (pay); credit goes to the server.
  const runDays =
    endDate !== "" ? hostAdDaysInRun(startDate || today, endDate) : null;
  const venueLike = !scheduleLimit;
  const { holdPayCents, dailyCreditCents, capCreditCents } = hostAdPlanBudget({
    dailyPayCents,
    runDays,
  });
  const appMinimums = useMemo(
    () =>
      Object.fromEntries(planApps.map((platform) => [platform, minimumCredit(platform) ?? undefined])) as Record<
        string,
        number | undefined
      >,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planApps.join(","), setup?.minimums, goalByPlatform],
  );
  const allocation = hostAdAllocations({
    mode: "daily",
    totalCents: capCreditCents,
    dailyCents: dailyCreditCents,
    days: runDays,
    apps: planApps,
    minimums: appMinimums,
  });
  const fundedShares =
    appChoice === "mingla" && guidanceOk?.apps_plan
      ? planApps.map(
          (platform) =>
            guidanceOk.apps_plan?.funded.find((row) => row.platform === platform)?.daily_credit_cents ?? 0,
        )
      : null;
  const dailyShares = fundedShares ?? allocation.split.rows.map((row) => row.dailyCents);
  const capShares = hostAdProportionalCents(
    capCreditCents,
    dailyShares.map((value) => Math.max(1, value)),
  );
  const customMinimumPay = planApps.reduce((sum, platform) => sum + (minimumPay(platform) ?? 0), 0);
  const smallestPay =
    guidanceOk?.smallest_overall?.pay_cents ??
    guidanceBelow?.apps_plan?.smallest_overall?.pay_cents ??
    (appChoice === "mingla"
      ? runnableConnections.reduce<number | null>((best, connection) => {
          const value = minimumPay(connection.platform);
          return value !== null && (best === null || value < best) ? value : best;
        }, null)
      : customMinimumPay || null);
  const minimumMarkPay = appChoice === "host" ? customMinimumPay || smallestPay : smallestPay;
  const recommendedPay = guidanceOk?.total.recommended_daily_cents ?? null;
  const sliderRange = hostAdSliderRange({
    minimumPayCents: minimumMarkPay,
    recommendedPayCents: recommendedPay,
  });
  const belowEvery =
    guidanceBelow !== null ||
    (minimumMarkPay !== null && dailyPayCents > 0 && dailyPayCents < minimumMarkPay && appChoice === "mingla");
  const appsShort = appChoice === "host" && planApps.length > 0 && !allocation.split.ok;
  const budgetError =
    endDate === ""
      ? hb("budget.pickEnd")
      : dailyPayCents <= 0 || belowEvery || appsShort
        ? hb("budget.raiseBlocker")
        : appChoice === "mingla" && planConnections.length === 0
          ? hb("budget.estimating")
          : startDate !== "" && startDate < today
            ? hb("budget.startPast")
            : endDate < (startDate || today)
              ? hb("budget.endBeforeStart")
              : hostAdScheduleError(startDate, endDate, scheduleLimit);
  const pickedCreatives = useMemo(
    () =>
      creativeIds
        .map((id) => setup?.creatives.find((item) => item.id === id))
        .filter((item): item is HostAdCreative => item !== undefined),
    [creativeIds, setup?.creatives],
  );
  const creativeProblem = hostAdCreativeProblem({ picked: pickedCreatives, apps: planApps });
  // #4238 B9: only the apps this ad runs on judge its words (the same list the
  // words sheet counts against); Google's 90-character limit no longer blocks
  // Next when Google is off.
  const copyError = hostAdCopyError(planApps.length > 0 ? planApps : activeApps, {
    primary: primaryText.trim(),
    headline: (headline.trim() || name.trim() || page?.title || ""),
  });
  // #4238 B7: clips still uploading or getting ready ride along; Next needs
  // one ready, and Launch waits until they are ready or removed.
  const preparingAdCount = uploads.filter(
    (item) => item.placement === "ad" && item.phase !== "failed" && !cancelledUploads.includes(item.key),
  ).length;
  const creativeError =
    creativeProblem?.kind === "none"
      ? preparingAdCount > 0
        ? hb("media.pending", { count: preparingAdCount })
        : hb("creative.pickOne")
      : creativeProblem?.kind === "too_many"
        ? hb("creative.pickFive")
        : creativeProblem?.kind === "photo_app"
          ? hb("creative.photoApp", { app: PLATFORM_LABELS[creativeProblem.platform] ?? creativeProblem.platform })
          : primaryText.trim().length < 3
            ? hb("creative.missingText")
            : (name.trim() || page?.title || "").length < 3
              ? hb("creative.missingName")
              : copyError;
  const stepErrors: Record<HostAdStepId, string | null> = {
    pick: promoteError,
    audience: audienceError,
    platforms: platformsError,
    budget: budgetError,
    creative: creativeError,
    review: null,
  };
  const formError =
    promoteError ?? audienceError ?? platformsError ?? budgetError ?? creativeError;

  const draftSnapshot = useMemo<Record<string, unknown>>(
    () => ({
      page_id: page?.id ?? null,
      connection_ids: connections.map((item) => item.id),
      creative_id: creative?.id ?? null,
      rights_confirmed: rightsConfirmed,
      rights_basis: rightsBasis,
      ai_generated: aiGenerated,
      name,
      primary_text: primaryText,
      headline,
      countries,
      optimization,
      age_min: ageMin,
      age_max: ageMax,
      gender,
      cities,
      excluded_places: excludedPlaces,
      exclude_past_buyers: excludePastBuyers,
      languages,
      radius_km: radiusKm,
      interests,
      audience_keys: audienceKeys,
      daily_amount: dailyAmount,
      cap_amount: capAmount,
      budget_mode: budgetMode,
      total_amount: totalAmount,
      cta,
      start_date: startDate,
      end_date: endDate,
      accept_broader: acceptBroader,
      prepared,
      active_plan_state: activePlanState,
      provider_object_evidence: providerObjectEvidence,
      daily_pay_cents: dailyPayCents,
      creative_ids: creativeIds,
      occurrence_key: occurrenceKey,
      app_choice: appChoice,
      audience_choice: audienceChoice,
      acknowledged_fallback: acknowledgedFallback,
    }),
    [
      dailyPayCents,
      creativeIds,
      occurrenceKey,
      appChoice,
      audienceChoice,
      acknowledgedFallback,
      acceptBroader,
      activePlanState,
      audienceKeys,
      budgetMode,
      cta,
      totalAmount,
      ageMax,
      ageMin,
      aiGenerated,
      capAmount,
      cities,
      connections,
      countries,
      creative?.id,
      dailyAmount,
      endDate,
      excludePastBuyers,
      excludedPlaces,
      gender,
      languages,
      headline,
      interests,
      name,
      optimization,
      page?.id,
      prepared,
      primaryText,
      providerObjectEvidence,
      radiusKm,
      rightsBasis,
      rightsConfirmed,
      startDate,
    ],
  );

  // #4453 — did the last draft save land? Read by the brand switcher's ask.
  const draftSaveLandedRef = useRef(true);
  const persistDraft = useCallback(
    (
      snapshot: Record<string, unknown> = draftSnapshot,
      step: HostAdStepId = activeStepId,
    ) => {
      if (
        !draftReady ||
        !brandId ||
        !permissions.canPlan ||
        draftIdRef.current === null
      ) {
        return Promise.resolve();
      }
      setDraftSaveStatus("saving");
      const save = async (): Promise<void> => {
        try {
          const { saveHostAdDraft } = await loadHostAdPlanService();
          const draft = await saveHostAdDraft({
            draftId: draftIdRef.current as string,
            brandId,
            expectedRevision: draftRevisionRef.current,
            currentStep: step,
            draftState: snapshot,
            planId: draftPlanIdRef.current ?? existingPlanId,
          });
          draftRevisionRef.current = draft.revision;
          draftSaveLandedRef.current = true;
          setDraftSaveStatus("saved");
        } catch (cause) {
          draftSaveLandedRef.current = false;
          const code =
            cause !== null && typeof cause === "object" && "code" in cause
              ? String(cause.code)
              : "";
          setDraftSaveStatus(code === "draft_conflict" ? "conflict" : "error");
        }
      };
      draftSaveChainRef.current = draftSaveChainRef.current
        .catch(() => undefined)
        .then(save);
      return draftSaveChainRef.current;
    },
    [
      brandId,
      activeStepId,
      draftReady,
      draftSnapshot,
      existingPlanId,
      permissions.canPlan,
    ],
  );

  useEffect(() => {
    if (!draftReady || !permissions.canPlan) return undefined;
    setDraftSaveStatus((current) =>
      current === "saving" ? current : "unsaved",
    );
    const timer = setTimeout(() => {
      void persistDraft();
    }, 1000);
    return () => clearTimeout(timer);
  }, [draftReady, draftSnapshot, permissions.canPlan, persistDraft]);

  // #4453 — the draft saves a second after the last change. The brand
  // switcher asks first: anything not saved yet is saved now (through the
  // same one-at-a-time chain), and the switch is held when that save did not
  // land (failed, or the draft changed somewhere else).
  const brandSwitchFlushRef = useRef<() => Promise<boolean>>(async () => true);
  brandSwitchFlushRef.current = async (): Promise<boolean> => {
    if (draftSaveStatus === "saved" || draftSaveStatus === "loading") return true;
    await persistDraft();
    return draftSaveLandedRef.current;
  };
  useEffect(() => {
    const flush = (): Promise<boolean> => brandSwitchFlushRef.current();
    const flushers = (unsavedWork.flushers ??= new Set());
    flushers.add(flush);
    return (): void => {
      flushers.delete(flush);
    };
  }, []);

  const activeStepIndex = HOST_AD_STEPS.findIndex(
    (step) => step.id === activeStepId,
  );

  const goToStep = async (nextIndex: number): Promise<void> => {
    const next = HOST_AD_STEPS[nextIndex];
    if (!next) return;
    if (nextIndex > activeStepIndex && stepErrors[activeStepId]) {
      setError(stepErrors[activeStepId]);
      return;
    }
    setError(null);
    setActiveStepId(next.id);
    setMaxVisitedStep((current) => Math.max(current, nextIndex));
    if (draftIdRef.current) {
      router.setParams(
      hostAdBuilderParams({
          draftId: draftIdRef.current,
          planId: draftPlanIdRef.current ?? existingPlanId,
          step: next.id,
        }),
      );
    }
    await persistDraft(draftSnapshot, next.id);
  };

  // #4238 media-buyer: every app is looked up on its own
  // (I-4238-PER-APP-MATCH). Errors are kept as "Couldn't check", never as
  // "not found" (I-4238-ERROR-IS-NOT-MISSING).
  const firstSearchApp = (
    kind: "city" | "region" | "interest",
  ): HostAdApp | null => {
    const order: HostAdApp[] =
      kind === "interest"
        ? ["meta", "tiktok", "google", "snapchat", "reddit"]
        : ["meta", "tiktok", "google", "snapchat"];
    const pool = [
      ...activeApps,
      ...(setup?.connections ?? []).map((item) => item.platform as HostAdApp),
    ];
    return order.find((app) => pool.includes(app)) ?? null;
  };

  const markChecking = (key: string, on: boolean): void => {
    if (on) inFlightRef.current.add(key);
    else inFlightRef.current.delete(key);
    setChecking(new Set(inFlightRef.current));
  };

  const lookupPlaceOnApp = useCallback(
    async (
      list: "include" | "exclude",
      place: HostAdPlace,
      app: HostAdApp,
    ): Promise<void> => {
      if (!brandId) return;
      const key = hostAdPlaceKey(place);
      const flight = `${list}:${key}|${app}`;
      if (inFlightRef.current.has(flight)) return;
      markChecking(flight, true);
      try {
        const { lookupHostAdTargeting } = await loadHostAdPlanService();
        const response = await lookupHostAdTargeting({
          brandId,
          platform: app,
          kind: hostAdLookupKind(place),
          query: hostAdLookupQuery(place),
          country: place.countryCode,
        });
        const update = (current: HostAdTargetingCity[]) =>
          current.map((item) =>
            hostAdPlaceKey(item) === key
              ? applyPlaceLookup(item, app, response)
              : item,
          );
        if (list === "include") setCities(update);
        else setExcludedPlaces(update);
      } finally {
        markChecking(flight, false);
      }
    },
     
    [brandId],
  );

  const lookupInterestOnApp = useCallback(
    async (interest: HostAdTargetingInterest, app: HostAdApp): Promise<void> => {
      if (!brandId || app === "reddit") return;
      const key = hostAdInterestKey(interest.name);
      const flight = `interest:${key}|${app}`;
      if (inFlightRef.current.has(flight)) return;
      markChecking(flight, true);
      try {
        const { lookupHostAdTargeting } = await loadHostAdPlanService();
        const response = await lookupHostAdTargeting({
          brandId,
          platform: app,
          kind: "interest",
          query: interest.name,
        });
        setInterests((current) =>
          current.map((item) =>
            hostAdInterestKey(item.name) === key
              ? applyInterestLookup(item, app, response)
              : item,
          ),
        );
      } finally {
        markChecking(flight, false);
      }
    },
     
    [brandId],
  );

  // Look up every place and interest an app has no answer for yet: new
  // places, and every place again when the Host turns an app on.
  const unresolvedSignature = hostAdPendingLookupSignature([
    ...cities.flatMap((place) =>
      activeApps
        .filter(
          (app) =>
            hostAdPlaceNeedsLookup(place, app) &&
            !place.refs[app] &&
            !place.offers?.[app] &&
            !place.errors?.[app] &&
            !place.missing?.[app],
        )
        .map((app) => ({ list: "include" as const, key: hostAdPlaceKey(place), app })),
    ),
    ...excludedPlaces.flatMap((place) =>
      activeApps
        .filter(
          (app) =>
            app === "meta" &&
            !place.refs[app] &&
            !place.errors?.[app] &&
            !place.missing?.[app],
        )
        .map((app) => ({ list: "exclude" as const, key: hostAdPlaceKey(place), app })),
    ),
    ...interests.flatMap((interest) =>
      activeApps
        .filter(
          (app) =>
            app !== "reddit" &&
            !interest.refs[app] &&
            !interest.errors?.[app] &&
            !interest.missing?.[app],
        )
        .map((app) => ({
          list: "interest" as const,
          key: hostAdInterestKey(interest.name),
          app,
        })),
    ),
  ]);
  const citiesRef = useRef(cities);
  citiesRef.current = cities;
  const excludedRef = useRef(excludedPlaces);
  excludedRef.current = excludedPlaces;
  const interestsRef = useRef(interests);
  interestsRef.current = interests;
  useEffect(() => {
    if (!brandId || unresolvedSignature === "") return;
    for (const { list, key, app } of hostAdPendingLookups(unresolvedSignature)) {
      if (list === "interest") {
        const interest = interestsRef.current.find(
          (row) => hostAdInterestKey(row.name) === key,
        );
        if (interest) void lookupInterestOnApp(interest, app);
        continue;
      }
      const source = list === "include" ? citiesRef.current : excludedRef.current;
      const place = source.find((row) => hostAdPlaceKey(row) === key);
      if (place) {
        void lookupPlaceOnApp(list, place, app);
      }
    }
  }, [brandId, lookupInterestOnApp, lookupPlaceOnApp, unresolvedSignature]);

  // Meta targets languages by its own locale keys.
  const languageSignature = activeApps.includes("meta")
    ? languages.filter((code) => !languageIds[code]).join(",")
    : "";
  useEffect(() => {
    if (!brandId || languageSignature === "") return;
    void (async () => {
      const { lookupHostAdTargeting } = await loadHostAdPlanService();
      for (const code of languageSignature.split(",")) {
        const response = await lookupHostAdTargeting({
          brandId,
          platform: "meta",
          kind: "language",
          query: HOST_AD_LANGUAGE_NAMES[code] ?? code,
        });
        const id = response?.match?.best?.id;
        if (id) setLanguageIds((current) => ({ ...current, [code]: String(id) }));
      }
    })();
  }, [brandId, languageSignature]);

  const prefixedChecking = (list: string): ReadonlySet<string> =>
    new Set(
      [...checking]
        .filter((item) => item.startsWith(`${list}:`))
        .map((item) => item.slice(list.length + 1)),
    );

  const searchPlaces = async (
    query: string,
    country: string,
    kind: HostAdPlaceKind,
  ) => {
    const app = firstSearchApp(kind === "region" ? "region" : "city");
    if (!brandId || !app) return [];
    const { searchHostAdTargeting } = await loadHostAdPlanService();
    const result = await searchHostAdTargeting({
      brandId,
      platform: app,
      kind: kind === "region" ? "region" : "city",
      query,
      country,
    });
    if (result.unavailable) throw new Error("search_unavailable");
    // A city the first app only knows as a state still shows, as typed.
    if (result.results.length === 0 && (result.wider ?? []).length > 0) {
      return [{ id: `typed:${query}`, name: query, meta: { country_code: country } }];
    }
    return result.results;
  };

  const searchInterests = async (query: string, app: HostAdApp | null) => {
    const platform = app ?? firstSearchApp("interest");
    if (!brandId || !platform) return [];
    const { searchHostAdTargeting } = await loadHostAdPlanService();
    const result = await searchHostAdTargeting({
      brandId,
      platform,
      kind: "interest",
      query,
    });
    if (result.unavailable) throw new Error("search_unavailable");
    return result.results.map((row) => ({ id: String(row.id), name: row.name }));
  };

  const handlePrepare = async (forceAcceptance = false): Promise<void> => {
    if (!permissions.canPlan) return;
    if (formError || !brandId || !page || planConnections.length === 0 || pickedCreatives.length === 0) {
      return;
    }
    const first = pickedCreatives[0];
    setBusy(true);
    setError(null);
    setCheckState("checking");
    setGoalQuestion([]);
    setGoogleNeedsSetup(false);
    try {
      await persistDraft(draftSnapshot, "review");
      const { prepareHostAdPlan } = await loadHostAdPlanService();
      const next = await prepareHostAdPlan({
        brandId,
        existingPlanId,
        page,
        connections: planConnections,
        creative: first,
        creativeIds: pickedCreatives.map((item) => item.id),
        name: (name.trim() || page.title).slice(0, 120),
        primaryText: primaryText.trim(),
        headline: headline.trim() || name.trim() || page.title,
        countries,
        cities: audienceChoice === "host" ? cities : [],
        radiusKm: audienceChoice === "host" && cities.length > 0 ? radiusKmNumber : null,
        interests: audienceChoice === "host" ? interests : [],
        excludedPlaces,
        languages,
        languageIds,
        excludePastBuyers,
        ageMin: Number(ageMin),
        ageMax: Number(ageMax),
        gender,
        // #4238 W1: the server keeps budgets in credit (what the apps spend).
        dailyBudgetCents: dailyShares.reduce((sum, value) => sum + value, 0),
        capCents: capCreditCents,
        budgetMode: budgetMode as HostAdBudgetMode,
        shares: { dailyCents: dailyShares, capCents: capShares },
        cta: cta ?? hostAdDefaultCta(page.page_type),
        ...hostAdScheduleIsos(startDate, endDate, scheduleLimit, page?.timezone),
        acceptBroader: forceAcceptance || acceptBroader,
        rightsConfirmed,
        rightsBasis,
        aiGenerated,
        optimization: goal,
        acknowledgedVisitsFallback: acknowledgedFallback,
        audienceKeys,
        occurrenceKey,
        appChoice,
        audienceChoice,
      });
      setExistingPlanId(next.planId);
      draftPlanIdRef.current = next.planId;
      setPrepared(next);
      setCopyWarnings(next.copyWarnings ?? []);
      setProviderObjectEvidence(false);
      setActivePlanState(next.status === "ready" ? "ready_for_funding" : "validating");
      setCheckState("done");
    } catch (cause) {
      const code =
        cause !== null && typeof cause === "object" && "detail" in cause
          ? String((cause as { detail: unknown }).detail)
          : "";
      const extra =
        cause !== null && typeof cause === "object" && "extra" in cause
          ? ((cause as { extra: Record<string, unknown> }).extra ?? {})
          : {};
      const platforms = Array.isArray(extra.platforms)
        ? extra.platforms.map((value) => String(value))
        : [];
      if (code === "host_ad_goal_fallback_unacknowledged") {
        setGoalQuestion(platforms);
        setCheckState("done");
      } else if (code === "host_ad_google_needs_setup") {
        setGoogleNeedsSetup(true);
        setCheckState("done");
      } else if (code === "optimization_sales_free_event") {
        setOptimization("signups");
        setNotice(hb("errors.freeEvent"));
        setCheckState("idle");
      } else if (code === "media_rights_attestation_required") {
        // #4238 B10: not an app failure. Point at the rights box instead of
        // "Couldn't check with Facebook & Instagram".
        setRightsMissing(true);
        setCheckState("idle");
        scrollRef.current?.scrollTo?.({ y: Math.max(0, rightsYRef.current - space[6]), animated: !reduceMotion });
      } else {
        setCheckState("failed");
        setError(hostAdErrorMessage(cause, hb("errors.generic")));
      }
    } finally {
      setBusy(false);
    }
  };

  // #4238 W6a: one confirm states the money, then hold and launch. The server
  // still checks the typed constant (D-7); the service sends it.
  const handleLaunchConfirmed = async (): Promise<void> => {
    if (!prepared || prepared.status !== "ready" || !permissions.canFund || !permissions.canLaunch) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { fundHostAdPlan, launchHostAdPlan } = await loadHostAdPlanService();
      // #4238: a plan Mingla approved (or already funded) holds its budget.
      // Holding again is refused (ad_plan_not_fundable), so launch the hold.
      const fundedState = hostAdPlanHoldPlaced(activePlanState)
        ? (activePlanState as string)
        : (
            await fundHostAdPlan({
              planId: prepared.planId,
              versionId: prepared.versionId,
              planHash: prepared.planHash,
            })
          ).state;
      setActivePlanState(fundedState);
      if (fundedState === "staff_review_required") {
        setLaunched("staff");
      } else {
        await launchHostAdPlan({
          planId: prepared.planId,
          versionId: prepared.versionId,
          planHash: prepared.planHash,
        });
        setLaunched("apps");
      }
      HapticFeedback.success();
      setSheet(null);
    } catch (cause) {
      try {
        const { getHostAdPlan } = await loadHostAdPlanService();
        const aggregate = await getHostAdPlan(prepared.planId);
        setActivePlanState(aggregate.plan.state);
        if (aggregate.plan.state === "staff_review_required") {
          setLaunched("staff");
          setSheet(null);
          return;
        }
      } catch {
        // Keep the launch failure as the message; a reload restores the
        // durable server state if this read fails too.
      }
      setSheet(null);
      setError(hostAdErrorMessage(cause, hb("errors.generic")));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelBeforeCreate = async () => {
    if (!permissions.canEnd) return;
    if (!prepared) return;
    setBusy(true);
    setCancelError(null);
    try {
      const { cancelHostAdPlanBeforeCreate } =
        await loadHostAdPlanService();
      await cancelHostAdPlanBeforeCreate({
        versionId: prepared.versionId,
        planHash: prepared.planHash,
        reason: "Host cancelled the ad before it was set up on any app.",
      });
      setSheet(null);
      setPrepared(null);
      setExistingPlanId(null);
      setActivePlanState("cancelled_before_create");
      setProviderObjectEvidence(false);
      setCancelDialogVisible(false);
      setNotice(hb("review.cancelled"));
      await load(true);
    } catch (cause) {
      setCancelError(
        hostAdErrorMessage(cause, "The plan could not be canceled."),
      );
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------
  // #4238 W6a effects: wallet, guidance, series dates, default budget,
  // the automatic "Check with each app", and the top-up return on web.
  // ---------------------------------------------------------------------
  const currency = setup?.currency ?? "";
  const money = useCallback(
    (cents: number): string =>
      cents % 100 === 0
        ? formatCurrencyRound(cents, currency, true)
        : formatCurrency(cents, currency, true),
    [currency],
  );
  const capabilities = setup?.capabilities ?? {};
  const askName = capabilities.launch?.ask_name ?? capabilities.top_up?.ask_name ?? null;
  const canTopUp = capabilities.top_up ? capabilities.top_up.allowed : permissions.canFund;

  const loadWallet = useCallback(async (): Promise<void> => {
    if (!brandId) return;
    try {
      const payload = await getAdCreditWallet(brandId);
      setWalletCreditCents(payload.wallet?.balance_cents ?? 0);
      setTopUpLimits(payload.top_up_limits ?? null);
    } catch {
      // Unknown credit: the review step says so and asks for no top-up.
      setWalletCreditCents(null);
    }
  }, [brandId]);
  useEffect(() => {
    if (activeStepId === "budget" || activeStepId === "review") void loadWallet();
  }, [activeStepId, loadWallet]);

  // A first budget: three times the smallest working amount, on the step.
  useEffect(() => {
    if (dailyPayCents > 0 || minimumMarkPay === null || minimumMarkPay <= 0) return;
    setDailyPayCents(hostAdSnap(minimumMarkPay * 3, sliderRange));
  }, [dailyPayCents, minimumMarkPay, sliderRange]);

  const guidanceKey = JSON.stringify([
    brandId,
    goal,
    appChoice,
    dailyPayCents,
    appChoice === "mingla" ? runnableConnections.map((row) => row.platform) : planApps,
    countries,
    page?.id ?? null,
    startDate,
    endDate,
    occurrenceKey,
    pickedCreatives.length,
  ]);
  useEffect(() => {
    if (!brandId || !page || dailyPayCents <= 0) return undefined;
    if (!["platforms", "budget", "creative", "review"].includes(activeStepId)) return undefined;
    const platforms = (appChoice === "mingla" ? runnableConnections : planConnections).map(
      (row) => row.platform,
    );
    if (platforms.length === 0) return undefined;
    let live = true;
    // Guidance is rate-limited per brand: read it once the slider settles.
    const timer = setTimeout(() => {
      setGuidanceState("loading");
      void loadHostAdPlanService()
        .then(({ getHostAdBudgetGuidance }) =>
          getHostAdBudgetGuidance({
            brandId,
            platforms,
            goal,
            dailyPayCents,
            appChoice,
            page,
            countries,
            ...hostAdScheduleIsos(startDate, endDate, scheduleLimit, page.timezone),
            occurrenceKey,
            creativeCount: pickedCreatives.length,
          }),
        )
        .then((result) => {
          if (!live) return;
          setGuidance(result);
          setGuidanceState("idle");
        })
        .catch(() => {
          if (live) setGuidanceState("error");
        });
    }, 900);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // guidanceKey captures every input by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidanceKey, activeStepId]);

  // #4238 5e: a series can promote all its dates or one.
  const seriesEventId =
    page && page.page_type === "event" && (page.dates_remaining ?? 0) > 1 ? page.id : null;
  useEffect(() => {
    if (!seriesEventId) {
      setSeriesDates(null);
      return undefined;
    }
    let live = true;
    setSeriesError(false);
    void loadHostAdPlanService()
      .then(({ listHostAdSeriesDates }) => listHostAdSeriesDates(seriesEventId))
      .then((rows) => {
        if (live) setSeriesDates(rows);
      })
      .catch(() => {
        if (live) setSeriesError(true);
      });
    return () => {
      live = false;
    };
  }, [seriesEventId]);

  // "Check with each app" runs on its own on Review; it spends nothing.
  const canAutoCheck =
    activeStepId === "review" &&
    !launched &&
    !offline &&
    permissions.canPlan &&
    formError === null &&
    prepared === null &&
    checkState !== "checking" &&
    checkState !== "failed" &&
    goalQuestion.length === 0 &&
    !googleNeedsSetup;
  useEffect(() => {
    if (!canAutoCheck) return undefined;
    const timer = setTimeout(() => {
      void handlePrepare(false);
    }, 600);
    return () => clearTimeout(timer);
    // handlePrepare reads the latest form; canAutoCheck gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutoCheck, draftSnapshot]);

  // Web top-up return (?ad_credit_top_up=1&session_id=… or ?reference=…).
  const topUpParams = useLocalSearchParams<{
    ad_credit_top_up?: string | string[];
    session_id?: string | string[];
    reference?: string | string[];
    trxref?: string | string[];
    payment?: string | string[];
  }>();
  const appliedReturnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!brandId) return;
    const flag = firstParam(topUpParams.ad_credit_top_up);
    const sessionId = firstParam(topUpParams.session_id);
    const reference = firstParam(topUpParams.reference) ?? firstParam(topUpParams.trxref);
    if (flag === "0" || firstParam(topUpParams.payment) === "cancelled") {
      setNotice(hb("topUp.cancelled"));
      router.setParams({ ad_credit_top_up: undefined, payment: undefined } as never);
      return;
    }
    const key = reference && reference.startsWith("mingla_adc_") ? reference : flag === "1" ? sessionId : null;
    if (!key || appliedReturnRef.current === key) return;
    appliedReturnRef.current = key;
    void (async () => {
      try {
        await applyAdCreditTopUp(
          reference && reference.startsWith("mingla_adc_")
            ? { brandId, paystackReference: reference, idempotencyKey: `top_up:${reference}` }
            : { brandId, checkoutSessionId: key },
        );
        setNotice(hb("topUp.paid"));
        await loadWallet();
      } catch {
        appliedReturnRef.current = null;
        setError(hb("topUp.returnFailed"));
      } finally {
        router.setParams({
          ad_credit_top_up: undefined,
          session_id: undefined,
          reference: undefined,
          trxref: undefined,
        } as never);
      }
    })();
  }, [brandId, loadWallet, router, topUpParams.ad_credit_top_up, topUpParams.payment, topUpParams.reference, topUpParams.session_id, topUpParams.trxref]);

  if (!brandId) {
    return (
      <View style={styles.center}>
        <EmptyState
          illustration="users"
          title="Pick a brand"
          description="Choose a brand before creating an ad."
        />
      </View>
    );
  }
  if (permissions.isLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.text2} />
      </View>
    );
  }
  if (!permissions.canRead) {
    return (
      <View style={styles.center}>
        <EmptyState
          illustration="users"
          title="Ads access required"
          description="Ask a brand owner to grant Ads view access for this brand."
        />
      </View>
    );
  }
  if (!setup) {
    return (
      <View style={styles.center}>
        <EmptyState
          illustration="users"
          title={hb("pick.loadFailed")}
          description={error ?? hb("errors.generic")}
          cta={{ label: hb("tryAgain"), onPress: () => void load(true) }}
        />
      </View>
    );
  }
  if (setup.available === false) {
    return (
      <View style={styles.center} testID="host-ad-unavailable">
        <EmptyState
          illustration="users"
          title={HOST_AD_UNAVAILABLE_TITLE}
          description={HOST_AD_UNAVAILABLE_BODY}
          cta={{ label: hb("back"), onPress: backToAds }}
        />
      </View>
    );
  }

  const resumable = setup.plans.filter((plan) => RESUMABLE_STATES.has(plan.state));
  const stepName = (index: number): string => hostAdStepName(HOST_AD_STEPS[index]?.id ?? "pick");
  const goToStepId = (id: HostAdStepId): void => {
    const index = HOST_AD_STEPS.findIndex((step) => step.id === id);
    if (index >= 0) {
      setError(null);
      setActiveStepId(id);
      setMaxVisitedStep((current) => Math.max(current, index));
      if (draftIdRef.current) {
        router.setParams(
          hostAdBuilderParams({
            draftId: draftIdRef.current,
            planId: draftPlanIdRef.current ?? existingPlanId,
            step: id,
          }),
        );
      }
    }
  };
  const touch = (): void => {
    setPrepared(null);
    setCheckState("idle");
  };
  const toggleAdvanced = (key: string): void =>
    setAdvanced((current) => ({ ...current, [key]: !current[key] }));
  const unit = hostAdGoalUnit(goal);
  const place = hostAdAudiencePlace(page?.city, countries);
  const firstPoster = pickedCreatives[0]?.poster_url ?? pickedCreatives[0]?.source_url ?? null;
  const ctaId = cta ?? hostAdDefaultCta(page?.page_type);
  const ctaLabel = HOST_AD_CTA_OPTIONS.find((option) => option.id === ctaId)?.label ?? "";
  const endLabel = endDate ? hostAdPageDate(`${endDate}T12:00:00Z`, page?.timezone) ?? endDate : "";
  const anyRetarget = (guidanceOk?.per_app ?? []).some((row) => row.retarget === true);
  const metaFloorPay = minimumPay("meta");
  const walletPay = walletCreditCents === null ? null : hostAdPayFromCredit(walletCreditCents);
  // #4238: an approved or funded plan already holds its budget; resuming it
  // launches that hold, so nothing more is needed from Ads credit.
  const holdPlaced = hostAdPlanHoldPlaced(activePlanState);
  const topUpNeeded =
    walletCreditCents === null || holdPlaced ? 0 : hostAdTopUpNeededCents(holdPayCents, walletCreditCents);
  const appLabel = (platform: string): string => PLATFORM_LABELS[platform] ?? platform;

  // ---- per-app check rows (Review) ----
  const checkRows: (HostAdCheckRow & { note?: string })[] = planConnections
    .map((connection): (HostAdCheckRow & { note?: string }) | null => {
      const platform = connection.platform;
      if (checkState === "checking") return { platform, state: "checking" };
      if (goalQuestion.includes(platform) && !acknowledgedFallback.includes(platform)) {
        return { platform, state: "question", note: "visits" };
      }
      if (platform === "google" && googleNeedsSetup) return { platform, state: "failed", note: "google" };
      if (!prepared) return checkState === "failed" ? { platform, state: "failed" } : null;
      const snapshot = prepared.targeting.find((row) => row.platform === platform);
      if (!snapshot) return { platform, state: "ready" };
      if (snapshot.verdict === "broader" && snapshot.broader_accepted !== true && !acceptBroader) {
        return { platform, state: "question", note: "wider" };
      }
      if (snapshot.verdict === "unavailable" || snapshot.verdict === "check_required") {
        return { platform, state: "failed" };
      }
      return { platform, state: "ready" };
    })
    .filter((row): row is HostAdCheckRow & { note?: string } => row !== null);
  const blocker = hostAdLaunchBlocker({
    offline,
    canLaunch: permissions.canLaunch,
    canFund: permissions.canFund,
    askName,
    checks: checkRows,
    // #4238 B7: clips still getting ready keep Launch closed (the dock says why).
    checked: prepared !== null && prepared.status === "ready" && preparingAdCount === 0,
    rightsConfirmed,
    topUpNeededCents: topUpNeeded,
    // #4238 roles: the server's own answers (admins launch and fund) win.
    capabilities,
  });
  // #4238 honest Review questions: say the real reason each app gave.
  const wideningLines = (platform: string): string[] =>
    (prepared?.targeting.find((row) => row.platform === platform)?.widening_summary ?? []).filter(
      (line) => typeof line === "string" && line.trim().length > 0,
    );
  const wideningAcceptLabel = (platform: string): string => {
    const lines = wideningLines(platform);
    if (lines.length === 0) return hb("review.useWider");
    const kind = hostAdWideningKind(lines);
    return kind === "past_buyers"
      ? hb("review.runWithoutBuyers")
      : kind === "area"
        ? hb("review.useWider")
        : hb("review.runThisWay");
  };
  const visitsQuestion = (platform: string): string => {
    const connection = planConnections.find((item) => item.platform === platform);
    const wanted: "sales" | "signups" = goal === "signups" ? "signups" : "sales";
    const reason = connection ? hostAdGoalFallbackReason(wanted, connection) : "cannot";
    return hb(reason === "not_yet" ? "review.visitsQuestionYet" : "review.visitsQuestionCannot", {
      app: appLabel(platform),
      unit,
    });
  };
  const blockerText = (): string | null => {
    if (!blocker) return null;
    switch (blocker.kind) {
      case "offline":
        return hb("review.blockOffline");
      case "no_launch_access":
        return hb("review.blockLaunch", { name: blocker.askName ?? hb("review.theOwner") });
      case "no_fund_access":
        return hb("review.blockFund", { name: blocker.askName ?? hb("review.theOwner") });
      case "checking":
        return hb("review.blockChecking");
      case "not_checked":
        return formError ?? hb("review.blockNotChecked");
      case "question":
        return hb("review.blockQuestion", { app: appLabel(blocker.platform) });
      case "failed":
        return hb("review.blockFailed", { app: appLabel(blocker.platform) });
      case "rights":
        return hb("review.blockRights");
      case "top_up":
        return canTopUp
          ? hb("review.blockTopUp", { amount: money(blocker.amountCents) })
          : hb("topUp.noAccess", { name: askName ?? hb("review.theOwner") });
      default: {
        const never: never = blocker;
        return String(never);
      }
    }
  };
  const showChecks = (): void => {
    scrollRef.current?.scrollTo?.({ y: Math.max(0, checksYRef.current - 24), animated: !reduceMotion });
  };

  // ---------------- step 1: what to promote ----------------
  const pickBody = (
    <View style={bs.stackLg}>
      <Text style={bs.h1} accessibilityRole="header">{hb("pick.h1")}</Text>
      {resumable.length > 0 ? (
        <View style={bs.stack} testID="host-ad-resumable">
          <BuilderLabel>{hb("pick.resume")}</BuilderLabel>
          <BuilderList>
            {resumable.map((plan, index) => (
              <ValueRow
                key={plan.id}
                divider={index > 0}
                label={hostAdStatusLabel(plan.state)}
                value={
                  setup.pages.find(
                    (item) =>
                      [item.page_type, item.brand_slug, item.page_type === "brand" ? null : item.entity_slug]
                        .filter(Boolean)
                        .join(":") === plan.destination_key,
                  )?.title ?? hb("pick.resume")
                }
                trailing={hb("pick.continue")}
                onPress={() => void resumePlan(plan.id)}
              />
            ))}
          </BuilderList>
        </View>
      ) : null}
      {setup.pages.length === 0 ? (
        <EmptyState illustration="users" title={hb("pick.empty")} description={hb("pick.emptyBody")} />
      ) : (
        <HostAdPagePicker
          pages={setup.pages}
          selected={page}
          onSelect={(item) => {
            setPage(item);
            setOptimization(hostAdPageGoal(item));
            setOccurrenceKey(null);
            setAcknowledgedFallback([]);
            setCta(null);
            const limit = hostAdScheduleLimit(item, (iso) => hostAdPageDate(iso, item.timezone));
            setEndDate(limit ? limit.lastDay : "");
            setBudgetMode(limit ? "total" : "daily");
            touch();
          }}
        />
      )}
      {page ? (
        <View style={styles.goalRow}>
          <Badge label={hostAdGoalName(goal)} />
        </View>
      ) : null}
      {seriesEventId ? (
        <BuilderCard accessibilityLabel={hb("pick.whichDates")} testID="host-ad-series">
          <BuilderLabel>{hb("pick.whichDates")}</BuilderLabel>
          {seriesError ? (
            <Text style={bs.small}>{hb("pick.datesFailed")}</Text>
          ) : seriesDates === null ? (
            <ActivityIndicator color={color.text2} />
          ) : (
            <>
              <Segmented
                value={occurrenceKey === null ? "all" : "one"}
                accessibilityLabel={hb("pick.whichDates")}
                options={[
                  { id: "all", label: hb("pick.allDates", { count: seriesDates.length }) },
                  { id: "one", label: hb("pick.oneDate") },
                ]}
                onChange={(next) => {
                  const firstDate = seriesDates[0];
                  if (next === "one" && firstDate) {
                    setOccurrenceKey(firstDate.occurrenceKey);
                    setEndDate(hostAdDayOf(firstDate.endAt, page?.timezone));
                  } else {
                    setOccurrenceKey(null);
                    if (scheduleLimit) setEndDate(scheduleLimit.lastDay);
                  }
                  touch();
                }}
                testID="host-ad-series-mode"
              />
              {occurrenceKey === null ? (
                <Text style={bs.small}>
                  {hb("pick.allDatesLine", { date: scheduleLimit?.label ?? "" })}
                </Text>
              ) : (
                <ChipRow
                  role="radio"
                  accessibilityLabel={hb("pick.oneDate")}
                  options={seriesDates.map((row) => ({
                    id: row.occurrenceKey,
                    label: hostAdPageDate(row.startAt, page?.timezone) ?? row.startAt.slice(0, 10),
                  }))}
                  selected={occurrenceKey ? [occurrenceKey] : []}
                  onToggle={(id) => {
                    const row = seriesDates.find((item) => item.occurrenceKey === id);
                    setOccurrenceKey(id);
                    if (row) setEndDate(hostAdDayOf(row.endAt, page?.timezone));
                    touch();
                  }}
                  testIDPrefix="host-ad-series-date"
                />
              )}
            </>
          )}
        </BuilderCard>
      ) : null}
    </View>
  );

  // ---------------- step 2: who sees it ----------------
  const leaveOutLabel = goal === "sales" ? hb("audience.leaveOutBuyers") : hb("audience.leaveOutSignups");
  const audienceBody = (
    <View style={bs.stackLg}>
      <Text style={bs.h1} accessibilityRole="header">{hb("audience.h1")}</Text>
      <Segmented
        value={audienceChoice}
        accessibilityLabel={hb("steps.audience")}
        options={[
          { id: "mingla", label: hb("minglaChoose") },
          { id: "host", label: hb("audience.chooseMyself") },
        ]}
        onChange={(next) => {
          setAudienceChoice(next);
          touch();
        }}
        testID="host-ad-audience-choice"
      />
      {audienceChoice === "mingla" ? (
        <>
          <BuilderCard testID="host-ad-audience-mingla">
            <InfoLine icon="location" title={hb("audience.near", { place })} subtitle={hb("audience.nearSub")} />
            {excludePastBuyers ? (
              <InfoLine
                icon="check"
                title={goal === "sales" ? hb("audience.skipsBuyers") : hb("audience.skipsSignups")}
              />
            ) : null}
            {planApps.includes("meta") || appChoice === "mingla" ? (
              <InfoLine
                icon="users"
                title={hb("audience.remindOn")}
                subtitle={
                  anyRetarget || metaFloorPay === null
                    ? hb("audience.remindOnSub")
                    : hb("audience.remindOffSub", { amount: money(metaFloorPay * 2) })
                }
              />
            ) : null}
          </BuilderCard>
          <BuilderCard>
            <View style={bs.rowBetween}>
              <View style={styles.grow}>
                <Text style={styles.rowTitle}>{hb("audience.pastGuests")}</Text>
                <Text style={bs.small}>{hb("audience.pastGuestsSub")}</Text>
              </View>
              <Badge label={hb("comingSoon")} />
            </View>
          </BuilderCard>
        </>
      ) : (
        <View style={bs.stackLg} testID="host-ad-audience-custom">
          <View style={bs.stack}>
            <BuilderLabel>{hb("audience.country")}</BuilderLabel>
            <HostAdCountryPicker
              countries={countries}
              onChange={(next) => {
                setCountries(next);
                touch();
              }}
            />
          </View>
          <View style={bs.stack}>
            <BuilderLabel>{hb("audience.places")}</BuilderLabel>
            <Text style={bs.small}>{hb("audience.placesHelp")}</Text>
            <HostAdPlacesEditor
              places={cities}
              apps={activeApps}
              countries={countries}
              availability={setup.availability ?? []}
              checking={prefixedChecking("include")}
              busy={busy}
              onSearch={searchPlaces}
              onAdd={(item) => {
                setCities((current) =>
                  current.some((row) => hostAdPlaceKey(row) === hostAdPlaceKey(item)) ? current : [...current, item],
                );
                touch();
              }}
              onChange={(key, item) => {
                setCities((current) => current.map((row) => (hostAdPlaceKey(row) === key ? item : row)));
                touch();
              }}
              onRemove={(key) => {
                setCities((current) => current.filter((row) => hostAdPlaceKey(row) !== key));
                touch();
              }}
              onRetry={(key, app) => {
                const found = cities.find((row) => hostAdPlaceKey(row) === key);
                if (found) void lookupPlaceOnApp("include", found, app);
              }}
            />
          </View>
          <View style={bs.stack}>
            <BuilderLabel>{hb("audience.interests")}</BuilderLabel>
            <Text style={bs.small}>{hb("audience.interestsHelp")}</Text>
            <HostAdInterestsEditor
              interests={interests}
              apps={activeApps}
              checking={prefixedChecking("interest")}
              busy={busy}
              onSearch={searchInterests}
              onAdd={(interestName) => {
                setInterests((current) =>
                  current.some((row) => hostAdInterestKey(row.name) === hostAdInterestKey(interestName))
                    ? current
                    : [...current, { name: interestName, refs: {} }],
                );
                touch();
              }}
              onChange={(key, interest) => {
                setInterests((current) => current.map((row) => (hostAdInterestKey(row.name) === key ? interest : row)));
                touch();
              }}
              onRemove={(key) => {
                setInterests((current) => current.filter((row) => hostAdInterestKey(row.name) !== key));
                touch();
              }}
              onRetry={(key, app) => {
                const found = interests.find((row) => hostAdInterestKey(row.name) === key);
                if (found) void lookupInterestOnApp(found, app);
              }}
            />
          </View>
        </View>
      )}
      <AdvancedRow
        open={advanced.audience === true}
        title={hb("advanced")}
        subtitle={hb("audience.advancedSub")}
        onToggle={() => toggleAdvanced("audience")}
        reduceMotion={reduceMotion}
        testID="host-ad-audience-advanced"
      />
      {advanced.audience ? (
        <View style={bs.stackLg} testID="host-ad-audience-advanced-panel">
          <View style={bs.stack}>
            <BuilderLabel>{hb("audience.leaveOut")}</BuilderLabel>
            <BuilderList>
              <SwitchRow
                title={leaveOutLabel}
                subtitle={hb("audience.onByDefault")}
                value={excludePastBuyers}
                onChange={(next) => {
                  setExcludePastBuyers(next);
                  touch();
                }}
                testID="host-ad-exclude-buyers"
              />
            </BuilderList>
            <Text style={bs.small}>{hb("audience.placesToLeaveOut")}</Text>
            <HostAdPlacesEditor
              mode="exclude"
              testIDPrefix="host-ad-excluded"
              places={excludedPlaces}
              apps={activeApps}
              countries={countries}
              availability={setup.availability ?? []}
              checking={prefixedChecking("exclude")}
              busy={busy}
              onSearch={searchPlaces}
              onAdd={(item) => {
                setExcludedPlaces((current) =>
                  current.some((row) => hostAdPlaceKey(row) === hostAdPlaceKey(item)) ? current : [...current, item],
                );
                touch();
              }}
              onChange={(key, item) => {
                setExcludedPlaces((current) => current.map((row) => (hostAdPlaceKey(row) === key ? item : row)));
                touch();
              }}
              onRemove={(key) => {
                setExcludedPlaces((current) => current.filter((row) => hostAdPlaceKey(row) !== key));
                touch();
              }}
              onRetry={(key, app) => {
                const found = excludedPlaces.find((row) => hostAdPlaceKey(row) === key);
                if (found && HOST_AD_EXCLUDE_APPS.includes(app)) void lookupPlaceOnApp("exclude", found, app);
              }}
            />
          </View>
          <View style={bs.stack}>
            <BuilderLabel>{hb("audience.reminders")}</BuilderLabel>
            <BuilderList>
              <ValueRow
                label={hb("audience.remindOn")}
                value={
                  anyRetarget || metaFloorPay === null
                    ? hb("audience.automatic")
                    : hb("audience.remindOffSub", { amount: money(metaFloorPay * 2) })
                }
              />
            </BuilderList>
          </View>
          <View style={bs.stack}>
            <BuilderLabel>{hb("audience.people")}</BuilderLabel>
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={bs.caption}>{hb("audience.ageMin")}</Text>
                <Input
                  value={ageMin}
                  onChangeText={(value) => {
                    setAgeMin(value);
                    touch();
                  }}
                  variant="integer"
                  accessibilityLabel={hb("audience.ageMin")}
                  testID="host-ad-age-min"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={bs.caption}>{hb("audience.ageMax")}</Text>
                <Input
                  value={ageMax}
                  onChangeText={(value) => {
                    setAgeMax(value);
                    touch();
                  }}
                  variant="integer"
                  accessibilityLabel={hb("audience.ageMax")}
                  testID="host-ad-age-max"
                />
              </View>
            </View>
            {ageErrorLine ? (
              <Text style={[bs.caption, styles.errorText]} accessibilityLiveRegion="polite" testID="host-ad-age-error">
                {ageErrorLine}
              </Text>
            ) : null}
            <Text style={bs.caption}>{hb("audience.ageFloor")}</Text>
            <Text style={bs.caption}>{hb("audience.gender")}</Text>
            <ChipRow
              role="radio"
              accessibilityLabel={hb("audience.gender")}
              options={[
                { id: "all", label: hb("audience.genderAll") },
                { id: "women", label: hb("audience.genderWomen") },
                { id: "men", label: hb("audience.genderMen") },
              ]}
              selected={[gender]}
              onToggle={(id) => {
                setGender(id as "all" | "women" | "men");
                touch();
              }}
              testIDPrefix="host-ad-gender"
            />
            <Text style={bs.caption}>
              {hb("audience.languages")} · {languages.length === 0 ? hb("audience.languagesEmpty") : languages.map((code) => HOST_AD_LANGUAGE_NAMES[code] ?? code).join(", ")}
            </Text>
            <ChipRow
              role="checkbox"
              accessibilityLabel={hb("audience.languages")}
              options={Object.entries(HOST_AD_LANGUAGE_NAMES).map(([code, label]) => ({ id: code, label }))}
              selected={languages}
              onToggle={(code) => {
                setLanguages((current) =>
                  current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
                );
                touch();
              }}
              testIDPrefix="host-ad-language"
            />
          </View>
          <View style={bs.stack}>
            <BuilderLabel>{hb("audience.yourAudiences")}</BuilderLabel>
            {(setup.audiences ?? []).length > 0 ? (
              <HostAdAudiencePicker
                audiences={setup.audiences ?? []}
                unavailable={setup.audiences_error === "unavailable"}
                selected={audienceKeys}
                countries={countries}
                connections={lookupConnections}
                onChange={(next) => {
                  setAudienceKeys(next);
                  touch();
                }}
              />
            ) : (
              <BuilderList>
                <SwitchRow title={hb("audience.pastGuests")} subtitle={hb("comingSoon")} value={false} onChange={() => undefined} disabled />
                <SwitchRow divider title={hb("audience.contacts")} subtitle={hb("comingSoon")} value={false} onChange={() => undefined} disabled />
                <SwitchRow divider title={hb("audience.lookalike")} subtitle={hb("comingSoon")} value={false} onChange={() => undefined} disabled />
              </BuilderList>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );

  // ---------------- step 3: where it runs ----------------
  const appState = (platform: string): { ok: boolean; sub: string; badge?: string } => {
    const connection = setup.connections.find((row) => row.platform === platform);
    const desc = hb(`platforms.desc.${platform}`);
    if (platform === "google" && goal !== "visits") {
      return { ok: false, sub: `${desc} ${hb("platforms.googleSetup", { goal: hostAdGoalName(goal) })}`, badge: hb("platforms.needsSetup") };
    }
    if (!connection) return { ok: false, sub: desc, badge: hb("platforms.notAvailable") };
    if (!runnableConnections.some((row) => row.id === connection.id)) {
      return { ok: false, sub: `${desc} ${hb("platforms.notInCountry")}` };
    }
    const pay = minimumPay(platform);
    const visitsOnly = goal !== "visits" && goalByPlatform[platform] === "visits";
    return {
      ok: true,
      sub: [
        desc,
        pay !== null ? hb("platforms.from", { amount: money(pay) }) : hb("platforms.noRate"),
        visitsOnly ? hb("platforms.visitsOnly", { unit }) : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  };
  const platformsBody = (
    <View style={bs.stackLg}>
      <Text style={bs.h1} accessibilityRole="header">{hb("platforms.h1")}</Text>
      <Segmented
        value={appChoice}
        accessibilityLabel={hb("steps.platforms")}
        options={[
          { id: "mingla", label: hb("minglaChoose") },
          { id: "host", label: hb("platforms.chooseApps") },
        ]}
        onChange={(next) => {
          setAppChoice(next);
          if (next === "host" && connections.length === 0) setConnections(runnableConnections);
          touch();
        }}
        testID="host-ad-app-choice"
      />
      {appChoice === "mingla" ? (
        <BuilderCard>
          <BuilderLabel>{hb("platforms.howMinglaPicks")}</BuilderLabel>
          <Text style={bs.body}>{hb("platforms.howMinglaPicksBody")}</Text>
        </BuilderCard>
      ) : null}
      <BuilderList testID="host-ad-apps">
        {HOST_AD_BUILDER_APPS.map((platform, index) => {
          const state = appState(platform);
          const connection = setup.connections.find((row) => row.platform === platform);
          if (appChoice === "host" && state.ok && connection) {
            const on = connections.some((row) => row.id === connection.id);
            return (
              <SwitchRow
                key={platform}
                divider={index > 0}
                title={appLabel(platform)}
                subtitle={state.sub}
                value={on}
                onChange={() => {
                  setConnections((current) =>
                    on ? current.filter((row) => row.id !== connection.id) : [...current, connection],
                  );
                  touch();
                }}
                testID={`host-ad-platform-${platform}`}
              />
            );
          }
          return (
            <ValueRow
              key={platform}
              divider={index > 0}
              label={appLabel(platform)}
              value={state.sub}
              badge={state.badge}
              testID={`host-ad-platform-${platform}`}
            />
          );
        })}
      </BuilderList>
      {appChoice === "host" ? <Text style={bs.small}>{hb("platforms.eachAmount")}</Text> : null}
    </View>
  );

  // ---------------- step 4: budget ----------------
  const dailyMode = budgetMode === "daily" || venueLike;
  const fundedNames = planApps.map(appLabel).join(", ");
  const nextTrimmed = guidanceOk?.apps_plan?.trimmed?.[0] ?? null;
  const learningPay = Math.max(
    0,
    ...(guidanceOk?.per_app ?? []).map((row) => row.learning_pay_cents ?? 0),
  );
  const week = hostAdWeekRange(guidanceOk?.total.expected_week);
  const shortNeedPay = planApps.reduce((sum, platform) => sum + (minimumPay(platform) ?? 0), 0);
  const budgetBody = (
    <View style={bs.stackLg}>
      <Text style={bs.h1} accessibilityRole="header">{hb("budget.h1")}</Text>
      {!venueLike ? (
        <Segmented
          value={budgetMode as HostAdBudgetMode}
          accessibilityLabel={hb("steps.budget")}
          options={[
            { id: "total", label: hb("budget.totalTo", { date: endLabel }) },
            { id: "daily", label: hb("budget.perDay") },
          ]}
          onChange={(next) => {
            setBudgetMode(next);
            touch();
          }}
          testID="host-ad-budget-mode"
        />
      ) : null}
      <BuilderCard testID="host-ad-budget-card">
        <BuilderLabel>{dailyMode ? hb("budget.payDay") : hb("budget.payTotal")}</BuilderLabel>
        <Text style={bs.statXl} testID="host-ad-budget-big" accessibilityLiveRegion="polite">
          {dailyMode ? `${money(dailyPayCents)} ${hb("budget.aDay")}` : money(holdPayCents)}
        </Text>
        <Text style={bs.small} testID="host-ad-budget-sub">
          {runDays === null
            ? hb("budget.noEnd")
            : venueLike
              ? hb("budget.subVenue", { ads: money(dailyCreditCents), date: endLabel })
              : dailyMode
                ? hb("budget.subDaily", { total: money(holdPayCents), date: endLabel, ads: money(dailyCreditCents) })
                : hb("budget.subTotal", { daily: money(dailyPayCents), date: endLabel, ads: money(hostAdCreditFromPay(holdPayCents)) })}
        </Text>
        {!belowEvery ? (
          <View style={bs.est} testID="host-ad-budget-estimate">
            <Text style={bs.body}>
              {guidanceState === "error"
                ? hb("budget.estimateFailed")
                : week
                  ? hb("budget.estimate", { daily: money(dailyPayCents), low: week.low, high: week.high, unit })
                  : hb("budget.estimating")}
            </Text>
            {recommendedPay !== null ? (
              <Text style={bs.small} testID="host-ad-budget-learn">
                {dailyPayCents >= recommendedPay
                  ? hb("budget.learnOk")
                  : hb("budget.learnLow", { amount: money(recommendedPay) })}
              </Text>
            ) : null}
          </View>
        ) : null}
        <BudgetSlider
          value={dailyPayCents}
          range={sliderRange}
          label={hb("budget.sliderLabel")}
          valueText={hb("budget.sliderValue", { amount: money(dailyPayCents) })}
          marks={[
            ...(minimumMarkPay !== null
              ? [{ value: minimumMarkPay, label: `${hb("budget.minimum")}\n${money(minimumMarkPay)}` }]
              : []),
            ...(recommendedPay !== null && recommendedPay !== minimumMarkPay
              ? [{ value: recommendedPay, label: `${hb("budget.recommended")}\n${money(recommendedPay)}`, accent: true }]
              : []),
          ]}
          onChange={(next) => {
            setDailyPayCents(next);
            touch();
          }}
          testID="host-ad-budget-slider"
        />
      </BuilderCard>
      {belowEvery && minimumMarkPay !== null ? (
        <Note
          tone="error"
          testID="host-ad-budget-below"
          text={hb("budget.belowMin", {
            daily: money(dailyPayCents),
            min: money(minimumMarkPay),
            app: appLabel(guidanceBelow?.apps_plan?.smallest_overall?.platform ?? guidanceOk?.smallest_overall?.platform ?? "meta"),
          })}
          actions={
            <Button
              label={hb("budget.raiseTo", { amount: money(minimumMarkPay) })}
              variant="secondary"
              size="sm"
              onPress={() => {
                setDailyPayCents(minimumMarkPay);
                touch();
              }}
              testID="host-ad-budget-raise-min"
            />
          }
        />
      ) : appsShort ? (
        <Note
          tone="warn"
          testID="host-ad-budget-short"
          text={hb("budget.appsShort", {
            apps: fundedNames,
            need: money(shortNeedPay),
            daily: money(dailyPayCents),
            fit: appLabel(planApps[0] ?? "meta"),
          })}
          actions={
            <>
              <Button
                label={hb("budget.raiseTo", { amount: money(shortNeedPay) })}
                variant="secondary"
                size="sm"
                onPress={() => {
                  setDailyPayCents(shortNeedPay);
                  touch();
                }}
              />
              <Button
                label={hb("minglaChoose")}
                variant="secondary"
                size="sm"
                onPress={() => {
                  setAppChoice("mingla");
                  touch();
                }}
              />
            </>
          }
        />
      ) : planApps.length > 0 ? (
        <BuilderCard accessibilityLabel={hb("budget.runsOn")} testID="host-ad-budget-runs-on">
          <BuilderLabel>{hb("budget.runsOn")}</BuilderLabel>
          <Text style={bs.body}>{fundedNames}</Text>
          {guidanceOk?.fit === "slow" && learningPay > 0 ? (
            <>
              <Text style={bs.small}>{hb("budget.slow", { amount: money(learningPay) })}</Text>
              <View style={bs.actions}>
                <Button
                  label={hb("budget.raiseTo", { amount: money(learningPay) })}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    setDailyPayCents(learningPay);
                    touch();
                  }}
                />
              </View>
            </>
          ) : nextTrimmed && appChoice === "mingla" ? (
            <Text style={bs.small}>
              {hb("budget.adds", {
                app: appLabel(nextTrimmed.platform),
                amount: money(dailyPayCents + nextTrimmed.needs_more_pay_cents),
              })}
            </Text>
          ) : null}
        </BuilderCard>
      ) : guidanceState === "loading" ? (
        <ActivityIndicator color={color.text2} />
      ) : null}
      {walletPay === null ? (
        <Text style={bs.small}>{hb("budget.creditUnknown")}</Text>
      ) : walletPay < holdPayCents ? (
        <Note tone="warn" text={hb("budget.creditLow", { hold: money(holdPayCents), credit: money(walletPay) })} />
      ) : (
        <Text style={bs.small}>{hb("budget.credit", { hold: money(holdPayCents), credit: money(walletPay) })}</Text>
      )}
      {!venueLike ? (
        <AdvancedRow
          open={advanced.budget === true}
          title={hb("advanced")}
          subtitle={hb("budget.advancedSub")}
          onToggle={() => toggleAdvanced("budget")}
          reduceMotion={reduceMotion}
          testID="host-ad-budget-advanced"
        />
      ) : null}
      {advanced.budget || venueLike ? (
        <View style={bs.stack} testID="host-ad-budget-dates">
          <DateField
            label={hb("budget.starts")}
            value={startDate}
            min={today}
            max={scheduleLimit?.lastDay}
            onChangeValue={(value) => {
              setStartDate(value);
              if (endDate && value && endDate < value) setEndDate(value);
              touch();
            }}
            accessibilityLabel={hb("budget.starts")}
            testID="host-ad-start-date"
          />
          <Text style={bs.caption}>{startDate === "" ? hb("budget.startsApproved") : ""}</Text>
          <DateField
            label={hb("budget.ends")}
            value={endDate}
            min={startDate || today}
            max={scheduleLimit?.lastDay}
            onChangeValue={(value) => {
              setEndDate(value);
              touch();
            }}
            accessibilityLabel={hb("budget.ends")}
            testID="host-ad-end-date"
          />
          <Text style={bs.caption}>
            {venueLike ? hb("budget.venueEnd") : scheduleLimit ? hb("budget.endsEvent", { date: scheduleLimit.label }) : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );

  // ---------------- step 5: media (#4238 B7/B8, approved design) ----------------
  const mediaApps = planApps.length > 0 ? planApps : activeApps;
  const visibleUploads = uploads.filter((item) => !cancelledUploads.includes(item.key));
  const adUploads = visibleUploads.filter((item) => item.placement === "ad");
  const adMediaCount = creativeIds.length + adUploads.length;
  const adMediaRoom = Math.max(0, HOST_AD_MEDIA_MAX - adMediaCount);
  const pendingAdUploads = adUploads.filter((item) => item.phase !== "failed").length;

  const clipLength = (seconds: number | null | undefined): string => {
    const total = Math.round(Number(seconds ?? 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  const pickAdVideos = async (): Promise<void> => {
    if (!brandId || !permissions.canPlan) return;
    const draftId = draftIdRef.current;
    if (draftId === null) {
      setNotice(hb("media.draftNotReady"));
      return;
    }
    let runtime: Awaited<ReturnType<typeof loadVideoAuthoringRuntime>>;
    let picked: Awaited<ReturnType<typeof runtime.launchAdVideosPicker>>;
    try {
      runtime = await loadVideoAuthoringRuntime();
      // Web can pick past the room (the rest go to the library); native caps it.
      picked = await runtime.launchAdVideosPicker({
        maxFiles: Platform.OS === "web" ? HOST_AD_MEDIA_MAX : Math.max(1, adMediaRoom),
      });
    } catch (cause) {
      setError(hostAdErrorMessage(cause, hb("media.pickFailed")));
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;
    const files: HostAdPickedVideo[] = picked.assets.map((asset) => {
      const durationMs = runtime.normalizePickerDurationMs(asset.duration);
      return {
        uri: asset.uri,
        fileName: asset.fileName ?? null,
        mimeType: asset.mimeType ?? null,
        fileSize: asset.fileSize ?? null,
        durationMs: durationMs > 0 ? durationMs : null,
      };
    });
    const plan = planHostAdPick({
      files,
      adCount: adMediaCount,
      library: (setup?.creatives ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        duration_seconds: item.duration_seconds,
      })),
      inFlight: visibleUploads.map((item) => hostAdPickFingerprint(item.file)),
      isWeb: Platform.OS === "web",
    });
    const make = (file: HostAdPickedVideo, placement: "ad" | "library"): HostAdUploadItem => {
      uploadSeqRef.current += 1;
      const token = randomUuid().replace(/-/g, "").slice(0, 10);
      return {
        key: `upload-${uploadSeqRef.current}-${token}`,
        ownerKey: hostAdUploadOwnerKey(draftId, token),
        file,
        name: hostAdCreativeNameFor(file.fileName) || hb("media.untitled"),
        placement,
        phase: "uploading",
        percent: 0,
        preparingSince: null,
        creativeId: null,
        failure: null,
        canRetry: false,
      };
    };
    const added = [
      ...plan.toAd.map((file) => make(file, "ad")),
      ...plan.toLibrary.map((file) => make(file, "library")),
    ];
    if (added.length > 0) setUploads((current) => [...current, ...added]);
    if (plan.refused.length > 0) {
      setRefusedPicks((current) => [
        ...current,
        ...plan.refused.map(({ file, reason }) => {
          uploadSeqRef.current += 1;
          return { key: `refused-${uploadSeqRef.current}`, file, reason };
        }),
      ]);
    }
    if (plan.duplicates.length > 0) {
      setDuplicatePicks((current) => [
        ...current,
        ...plan.duplicates.map(({ file, clip }) => ({ file, clipId: clip.id, clipName: clip.name })),
      ]);
    }
    if (plan.toLibrary.length > 0) {
      setNotice(hb("media.toLibrary", { count: plan.toLibrary.length }));
    } else if (plan.repeats.length > 0) {
      setNotice(hb("media.repeat", { name: hostAdCreativeNameFor(plan.repeats[0].fileName) }));
    }
    if (Platform.OS === "web" && plan.refused.length + plan.repeats.length === picked.assets.length) {
      runtime.revokeCoverPickedAssets(picked.assets);
    }
    setMediaUndo(null);
    setRightsConfirmed(false);
    touch();
  };

  const removeFromAd = (ids: string[]): void => {
    if (ids.length === 0) return;
    const before = creativeIds;
    setCreativeIds((current) => hostAdRemoveFromAd(current, ids));
    setRightsConfirmed(false);
    setPrepared(null);
    const removedName = setup?.creatives.find((item) => item.id === ids[0])?.name ?? "";
    setMediaUndo({
      text: ids.length === 1 ? hb("media.removed", { name: removedName }) : hb("media.removedMany", { count: ids.length }),
      creativeIds: before,
    });
    touch();
  };

  const addFromLibrary = (id: string): void => {
    if (adMediaRoom <= 0) return;
    const item = setup?.creatives.find((row) => row.id === id);
    setCreativeIds((current) => hostAdAddToAd(current, [id]));
    if (item && creative === null) setCreative(item);
    setRightsConfirmed(false);
    setPrepared(null);
    setMediaUndo(null);
    touch();
  };

  const dropUploads = (keys: string[]): void => {
    if (keys.length === 0) return;
    setCancelledUploads((current) => [...new Set([...current, ...keys])]);
    setRefusedPicks((current) => current.filter((item) => !keys.includes(item.key)));
  };

  const undoMedia = async (): Promise<void> => {
    const undo = mediaUndo;
    if (undo === null) return;
    setMediaUndo(null);
    if (undo.creativeIds) {
      setCreativeIds(undo.creativeIds);
      setPrepared(null);
      touch();
    }
    if (undo.restore && undo.restore.length > 0) {
      try {
        const { restoreHostAdCreatives } = await import("../../services/hostAdCreativeLibraryService");
        await restoreHostAdCreatives(undo.restore);
        await load(true);
      } catch (cause) {
        setError(hostAdErrorMessage(cause, hb("media.archiveFailed")));
      }
    }
  };

  const libraryCreatives = (setup?.creatives ?? []).filter((item) => !creativeIds.includes(item.id));
  const selectedAdIds = creativeIds.filter((id) => mediaSelected.includes(id));
  const selectedLibraryIds = libraryCreatives.map((item) => item.id).filter((id) => mediaSelected.includes(id));
  const selectedFailedKeys = [
    ...adUploads.filter((item) => item.phase === "failed").map((item) => item.key),
    ...refusedPicks.map((item) => item.key),
  ].filter((key) => mediaSelected.includes(key));

  const confirmArchive = async (): Promise<void> => {
    const ids = selectedLibraryIds;
    if (ids.length === 0) return;
    setArchiveBusy(true);
    try {
      const { archiveHostAdCreatives } = await import("../../services/hostAdCreativeLibraryService");
      const done = await archiveHostAdCreatives(ids);
      setSheet(null);
      setMediaSelected([]);
      setMediaSelectMode(false);
      await load(true);
      setMediaUndo({ text: hb("media.archived", { count: done.length }), restore: done });
    } catch (cause) {
      setError(hostAdErrorMessage(cause, hb("media.archiveFailed")));
      setSheet(null);
    } finally {
      setArchiveBusy(false);
    }
  };

  const toggleSelected = (key: string): void =>
    setMediaSelected((current) => (current.includes(key) ? current.filter((id) => id !== key) : [...current, key]));

  const creativeTile = (item: HostAdCreative, where: "ad" | "library"): HostAdMediaTile => {
    const fit = item.kind === "image" ? null : adTileFitLine(item.fit, mediaApps);
    const name = item.name;
    return {
      key: item.id,
      name,
      label: item.kind === "image" ? `${name} · ${hb("media.photo")}` : `${name} · ${clipLength(item.duration_seconds)}`,
      posterUri: item.poster_url ?? item.source_url ?? null,
      phase: "ready",
      status: null,
      percent: null,
      note: item.kind === "image" ? hb("media.photoFit") : fit?.text ?? "",
      noteTone: item.kind === "image" || fit?.warn ? "warn" : "plain",
      corner:
        where === "ad"
          ? { icon: "close", label: hb("media.remove", { name }), onPress: () => removeFromAd([item.id]) }
          : {
              icon: "plus",
              label: adMediaRoom > 0 ? hb("media.use", { name }) : hb("media.useFull"),
              disabled: adMediaRoom <= 0,
              onPress: () => addFromLibrary(item.id),
            },
      selected: mediaSelected.includes(item.id),
      onToggle: () => toggleSelected(item.id),
      testID: `host-ad-creative-${item.id}`,
    };
  };

  const uploadTile = (item: HostAdUploadItem): HostAdMediaTile => {
    const failed = item.phase === "failed";
    return {
      key: item.key,
      name: item.name,
      label: `${item.name} · ${clipLength((item.file.durationMs ?? 0) / 1000)}`,
      posterUri: null,
      phase: item.phase === "ready" ? "preparing" : item.phase,
      status: failed
        ? item.failure === "network" ? hb("media.failedNetwork") : hb("media.failedFile")
        : item.phase === "uploading"
          ? item.percent !== null ? hb("media.uploading", { percent: item.percent }) : hb("media.uploadingNoPct")
          : hb("media.preparing", { elapsed: hostAdElapsedLabel(item.preparingSince, nowMs) }),
      percent: item.phase === "uploading" ? item.percent : null,
      note: failed
        ? item.failure === "network" ? hb("media.failedNetworkNote") : hb("media.failedFileNote")
        : hb("media.fitPending"),
      noteTone: failed ? "warn" : "dim",
      onRetry:
        failed && item.canRetry
          ? () => {
              setUploads((current) =>
                current.map((row) => (row.key === item.key ? { ...row, phase: "uploading", percent: 0, failure: null } : row)),
              );
              setUploadAttempts((current) => ({ ...current, [item.key]: (current[item.key] ?? 0) + 1 }));
            }
          : undefined,
      corner: {
        icon: "close",
        label: failed ? hb("media.clear", { name: item.name }) : hb("media.cancelUpload", { name: item.name }),
        disabled: false,
        onPress: () => {
          dropUploads([item.key]);
          if (!failed) setNotice(hb("media.cancelled", { name: item.name }));
        },
      },
      selected: failed ? mediaSelected.includes(item.key) : null,
      onToggle: () => toggleSelected(item.key),
      testID: `host-ad-upload-${item.key}`,
    };
  };

  const refusedTile = (item: { key: string; file: HostAdPickedVideo; reason: HostAdPickRefusal }): HostAdMediaTile => {
    const name = hostAdCreativeNameFor(item.file.fileName) || hb("media.untitled");
    const lengthFix = item.reason === "too_short" || item.reason === "too_long";
    return {
      key: item.key,
      name,
      label: item.file.durationMs ? `${name} · ${clipLength(item.file.durationMs / 1000)}` : name,
      posterUri: null,
      phase: "failed",
      status: hb(PICK_REFUSAL_KEY[item.reason]),
      percent: null,
      note: lengthFix ? hb("media.fixLength") : hb("media.fixOther"),
      noteTone: "warn",
      corner: { icon: "close", label: hb("media.clear", { name }), onPress: () => dropUploads([item.key]) },
      selected: mediaSelected.includes(item.key),
      onToggle: () => toggleSelected(item.key),
      testID: `host-ad-refused-${item.key}`,
    };
  };

  const adMediaTiles: HostAdMediaTile[] = [
    ...pickedCreatives.map((item) => creativeTile(item, "ad")),
    ...visibleUploads.filter((item) => item.placement === "ad").map(uploadTile),
    ...refusedPicks.map(refusedTile),
  ];
  const libraryMediaTiles: HostAdMediaTile[] = [
    ...visibleUploads.filter((item) => item.placement === "library").map(uploadTile),
    ...libraryCreatives.map((item) => creativeTile(item, "library")),
  ];
  const duplicateAsk = duplicatePicks[0] ?? null;

  // ---------------- step 5: the ad ----------------
  const creativePreview = (
    <HostAdPreview
      apps={planApps.length > 0 ? planApps : activeApps}
      posterUrl={firstPoster}
      brandName={brand?.displayName ?? page?.brand_name ?? ""}
      primary={primaryText.trim()}
      headline={headline.trim() || name.trim() || page?.title || ""}
      cta={ctaId}
    />
  );
  const creativeBody = (
    <View style={bs.stackLg}>
      <Text style={bs.h1} accessibilityRole="header">{hb("creative.h1")}</Text>
      {!isWideDesktop ? creativePreview : null}
      {copyWarnings.length > 0 ? (
        <Note
          tone="warn"
          testID="host-ad-copy-warning"
          text={`“${copyWarnings[0].excerpt}”: ${copyWarnings[0].message} ${hb("creative.copyWarn")}`}
          actions={<Button label={hb("creative.seeFix")} variant="secondary" size="sm" onPress={() => setSheet("words")} />}
        />
      ) : null}
      <BuilderList>
        <ValueRow
          label={hb("creative.words")}
          value={
            copyWarnings.length > 0
              ? hb("creative.suggestions", { count: copyWarnings.length })
              : // #4238 rework 3 (P3-7): say what is missing, never a filled-in look.
                primaryText.trim().length < 3
                ? hb("creative.missingText")
                : `${headline.trim() || name.trim() || page?.title || ""} · ${ctaLabel}`
          }
          onPress={() => setSheet("words")}
          testID="host-ad-words-row"
        />
        {/* #4238 W6b: Ari writes the ad from the page only (no made-up people
            or places); its plan comes back as a proposal card to confirm. */}
        <ValueRow
          divider
          icon="sparkle"
          label={hm("ari.draft")}
          value={hm("ari.draftSub")}
          onPress={() => router.push(`/(tabs)/ari?brandId=${encodeURIComponent(brandId ?? "")}` as never)}
          testID="host-ad-draft-with-ari"
        />
      </BuilderList>
      <View style={bs.stack}>
        <HostAdMediaSection
          heading={hb("media.inThisAd")}
          countLabel={
            adMediaCount > 0 && adMediaCount < 3
              ? hb("media.countFew", { n: adMediaCount })
              : hb("media.count", { n: adMediaCount })
          }
          libraryHeading={hb("media.library")}
          libraryHint={hb("media.libraryHint")}
          emptyAdText={hb("media.emptyAd")}
          ad={adMediaTiles}
          library={libraryMediaTiles}
          selectMode={mediaSelectMode}
          selectLabel={mediaSelectMode ? hb("media.cancelSelect") : hb("media.select")}
          onToggleSelectMode={() => {
            setMediaSelectMode((value) => !value);
            setMediaSelected([]);
          }}
          addLabel={adMediaRoom > 0 ? hb("media.add") : hb("media.full")}
          addHint={adMediaRoom > 0 ? hb("media.addHint", { n: adMediaRoom }) : hb("media.fullHint")}
          addDisabled={adMediaRoom <= 0 || mediaSelectMode || !permissions.canPlan}
          onAdd={() => void pickAdVideos()}
          retryLabel={hb("media.retry")}
          notes={[]}
          empty={{ title: hb("media.emptyTitle"), body: hb("media.emptyBody"), spec: hb("media.emptySpec") }}
        />
        {mediaUndo !== null ? (
          <Note
            tone="info"
            text={mediaUndo.text}
            testID="host-ad-media-undo"
            actions={
              mediaUndo.creativeIds || mediaUndo.restore ? (
                <Button label={hb("media.undo")} variant="secondary" size="sm" onPress={() => void undoMedia()} testID="host-ad-media-undo-button" />
              ) : undefined
            }
          />
        ) : null}
        {unlinkedCreativeId !== null ? (
          <Button
            label={hb("creative.relink")}
            variant="secondary"
            onPress={() => {
              void linkAdCreative(unlinkedCreativeId);
            }}
            loading={adVideoLinking}
            testID="host-ad-relink-video"
          />
        ) : null}
      </View>
    </View>
  );

  // ---------------- step 6: review and pay ----------------
  const rightsLabel =
    rightsBasis === "licensed"
      ? hb("rights.licensed")
      : rightsBasis === "authorized_by_brand"
        ? hb("rights.authorized")
        : hb("rights.owned");
  const reviewRow = (label: string, value: string, step: HostAdStepId, divider: boolean): React.ReactElement => (
    <ValueRow
      key={label}
      divider={divider}
      label={label}
      value={value}
      trailing={hb("review.editShort")}
      accessibilityLabel={hb("review.edit", { row: label })}
      onPress={() => goToStepId(step)}
    />
  );
  const cancellable =
    permissions.canEnd &&
    !providerObjectEvidence &&
    prepared !== null &&
    ["funded_held", "staff_review_required", "staff_approved", "creating_paused_objects", "creation_failed_retryable"].includes(
      activePlanState ?? "",
    );
  const reviewBody = launched ? (
    <View style={styles.launched} testID="host-ad-launched">
      <View style={styles.launchedArt}>
        <Icon name="check" size={36} color={color.successText} />
      </View>
      <Text style={bs.h1} accessibilityRole="header">{hb("review.launchedTitle")}</Text>
      <Text style={[bs.small, styles.centerText]}>
        {launched === "staff" ? hb("review.launchedStaff") : hb("review.launchedApps")}
      </Text>
    </View>
  ) : (
    <View style={bs.stackLg}>
      <Text style={bs.h1} accessibilityRole="header">{hb("review.h1")}</Text>
      {offline ? <Note tone="info" text={hb("offline")} /> : null}
      {activePlanState === "staff_review_required" ? <Note tone="info" text={hb("review.inReview")} /> : null}
      <BuilderList testID="host-ad-review-rows">
        {reviewRow(hb("review.promoting"), `${page?.title ?? ""} · ${hostAdGoalName(goal)}`, "pick", false)}
        {reviewRow(
          hb("review.who"),
          audienceChoice === "mingla" ? hb("review.whoMingla", { place }) : hb("review.whoCustom", { place: cities.map((row) => row.name).join(", ") || place }),
          "audience",
          true,
        )}
        {reviewRow(hb("review.where"), fundedNames || hb("review.whereMingla"), "platforms", true)}
        {reviewRow(hb("review.budgetRow"), hb("review.budgetValue", { total: money(holdPayCents), daily: money(dailyPayCents) }), "budget", true)}
        {reviewRow(
          hb("review.dates"),
          occurrenceKey
            ? hb("review.datesOne", { date: endLabel })
            : startDate
              ? hb("review.datesFrom", { start: hostAdPageDate(`${startDate}T12:00:00Z`, page?.timezone) ?? startDate, date: endLabel })
              : hb("review.datesValue", { date: endLabel }),
          "budget",
          true,
        )}
        {reviewRow(hb("review.ad"), hb("review.adValue", { count: pickedCreatives.length, button: ctaLabel }), "creative", true)}
      </BuilderList>
      <View
        style={bs.stack}
        onLayout={(event) => {
          checksYRef.current = event.nativeEvent.layout.y;
        }}
        testID="host-ad-checks"
      >
        <BuilderLabel>{hb("review.checks")}</BuilderLabel>
        {checkRows.length === 0 ? (
          <BuilderCard>
            <Text style={bs.small}>{formError ?? hb("review.blockNotChecked")}</Text>
            {formError === null ? (
              <View style={bs.actions}>
                <Button label={hb("review.checkNow")} variant="secondary" onPress={() => void handlePrepare(false)} loading={busy} testID="host-ad-prepare" />
              </View>
            ) : null}
          </BuilderCard>
        ) : (
          <BuilderList>
            {checkRows.map((row, index) => (
              <View key={row.platform} style={[styles.checkRow, index > 0 && styles.divider]} testID={`host-ad-check-${row.platform}`}>
                <View style={bs.rowBetween}>
                  <Text style={styles.rowTitle}>{appLabel(row.platform)}</Text>
                  <CheckState
                    state={row.state}
                    label={
                      row.state === "checking"
                        ? hb("review.checking")
                        : row.state === "ready"
                          ? hb("review.ready")
                          : row.state === "question"
                            ? hb("review.question")
                            : hb("review.failed")
                    }
                  />
                </View>
                {row.state === "question" && row.note === "wider" ? (
                  <>
                    {/* #4238: the server's own reasons, never a guess about the area. */}
                    {wideningLines(row.platform).length > 0 ? (
                      wideningLines(row.platform).map((line) => (
                        <Text key={line} style={bs.small} testID={`host-ad-widening-${row.platform}`}>{line}</Text>
                      ))
                    ) : (
                      <Text style={bs.small}>{hb("review.wider")}</Text>
                    )}
                    <View style={bs.actions}>
                      <Button
                        label={hb("review.turnOff", { app: appLabel(row.platform) })}
                        variant="secondary"
                        size="sm"
                        onPress={() => {
                          setAppChoice("host");
                          setConnections(planConnections.filter((item) => item.platform !== row.platform));
                          touch();
                        }}
                      />
                      <Button
                        label={wideningAcceptLabel(row.platform)}
                        variant="secondary"
                        size="sm"
                        onPress={() => {
                          setAcceptBroader(true);
                          void handlePrepare(true);
                        }}
                        testID={`host-ad-accept-wider-${row.platform}`}
                      />
                    </View>
                  </>
                ) : null}
                {row.state === "question" && row.note === "visits" ? (
                  <>
                    <Text style={bs.small} testID={`host-ad-visits-question-${row.platform}`}>{visitsQuestion(row.platform)}</Text>
                    <View style={bs.actions}>
                      <Button
                        label={hb("review.turnOff", { app: appLabel(row.platform) })}
                        variant="secondary"
                        size="sm"
                        onPress={() => {
                          setAppChoice("host");
                          setConnections(planConnections.filter((item) => item.platform !== row.platform));
                          setGoalQuestion([]);
                          touch();
                        }}
                      />
                      <Button
                        label={hb("review.aimVisits")}
                        variant="secondary"
                        size="sm"
                        onPress={() => {
                          setAcknowledgedFallback((current) => [...new Set([...current, ...goalQuestion])]);
                          setGoalQuestion([]);
                          touch();
                        }}
                        testID={`host-ad-accept-visits-${row.platform}`}
                      />
                    </View>
                  </>
                ) : null}
                {row.state === "failed" ? (
                  <>
                    <Text style={[bs.small, styles.errorText]}>
                      {row.note === "google" ? hb("review.googleSetup") : hb("review.checkFailed", { app: appLabel(row.platform) })}
                    </Text>
                    <View style={bs.actions}>
                      <Button
                        label={hb("tryAgain")}
                        variant="secondary"
                        size="sm"
                        onPress={() => {
                          setGoogleNeedsSetup(false);
                          setCheckState("idle");
                          void handlePrepare(false);
                        }}
                      />
                      <Button
                        label={hb("getHelp")}
                        variant="ghost"
                        size="sm"
                        onPress={() => router.push("/account/support" as never)}
                      />
                    </View>
                  </>
                ) : null}
              </View>
            ))}
          </BuilderList>
        )}
      </View>
      <BuilderCard accessibilityLabel={hb("review.creditRow")} testID="host-ad-review-money">
        <View style={bs.kv}>
          <View style={bs.kvRow}>
            <Text style={bs.kvKey}>{hb("review.creditRow")}</Text>
            <Text style={bs.kvVal} testID="host-ad-review-credit">{walletPay === null ? "—" : money(walletPay)}</Text>
          </View>
          <View style={bs.kvRow}>
            <Text style={bs.kvKey}>{hb("review.held")}</Text>
            <Text style={bs.kvVal} testID="host-ad-review-hold">{money(holdPayCents)}</Text>
          </View>
          <View style={bs.kvRow}>
            <Text style={bs.kvKey}>{hb("review.chargedToday")}</Text>
            <Text style={bs.kvVal}>{money(0)}</Text>
          </View>
          {topUpNeeded > 0 ? (
            <View style={[bs.kvRow, bs.kvTotal]}>
              <Text style={[bs.kvKey, styles.warnText]}>{hb("review.topUpNeeded")}</Text>
              <Text style={[bs.kvVal, styles.warnText]} testID="host-ad-review-topup">{money(topUpNeeded)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={bs.caption} testID="host-ad-review-fee">
          {hb("review.feeLine", { ads: money(hostAdCreditFromPay(holdPayCents)) })}
        </Text>
      </BuilderCard>
      <View
        style={bs.stack}
        onLayout={(event) => {
          rightsYRef.current = event.nativeEvent.layout.y;
        }}
      >
        <BuilderLabel>{hb("review.media")}</BuilderLabel>
        <BuilderList>
          <ValueRow
            label={hb("review.rights")}
            value={hb("review.rightsValue", { basis: rightsLabel })}
            onPress={() => setSheet("rights")}
            testID="host-ad-rights-row"
          />
        </BuilderList>
        <CheckRow
          checked={rightsConfirmed}
          label={hb("review.rightsConfirm")}
          onToggle={() => {
            setRightsConfirmed((value) => !value);
            setRightsMissing(false);
            touch();
          }}
          testID="host-ad-rights"
        />
        {rightsMissing && !rightsConfirmed ? (
          <Text style={styles.rightsMissing} accessibilityLiveRegion="assertive" testID="host-ad-rights-missing">
            {hb("review.rightsMissing")}
          </Text>
        ) : null}
        <CheckRow
          checked={aiGenerated}
          label={hb("review.ai")}
          onToggle={() => {
            setAiGenerated((value) => !value);
            touch();
          }}
          testID="host-ad-ai"
        />
      </View>
      {copyWarnings.length > 0 ? (
        <View style={bs.stack} testID="host-ad-review-copy">
          <BuilderLabel>{hb("review.copyWarnings")}</BuilderLabel>
          {copyWarnings.map((warning) => (
            <Note key={`${warning.excerpt}-${warning.message}`} tone="warn" text={`“${warning.excerpt}”: ${warning.message} ${hb("creative.copyWarn")}`} />
          ))}
        </View>
      ) : null}
      {cancellable ? (
        <Button
          label={hb("review.cancelAd")}
          variant="destructiveOutline"
          onPress={() => setSheet("cancel")}
          testID="host-ad-cancel-before-create"
        />
      ) : null}
      {providerObjectEvidence ? <Text style={bs.small}>{hb("review.alreadyBuilt")}</Text> : null}
    </View>
  );

  const bodies: Record<HostAdStepId, React.ReactElement> = {
    pick: pickBody,
    audience: audienceBody,
    platforms: platformsBody,
    budget: budgetBody,
    creative: creativeBody,
    review: reviewBody,
  };
  const isReview = activeStepId === "review";
  const stepError = stepErrors[activeStepId];
  const waitingForClips = isReview && preparingAdCount > 0;
  const reviewBlocker = isReview
    ? waitingForClips
      ? hb("review.waitUploads", { count: preparingAdCount })
      : blockerText()
    : null;
  const mediaSelecting = activeStepId === "creative" && mediaSelectMode && !launched;
  const dockBlocker = launched || mediaSelecting ? null : isReview ? reviewBlocker : stepError;
  const selectedCount = selectedAdIds.length + selectedLibraryIds.length + selectedFailedKeys.length;
  const primary = launched ? (
    <Button label={hb("review.seeAds")} fullWidth onPress={backToAds} testID="host-ad-see-ads" />
  ) : mediaSelecting ? (
    // #4238: select mode swaps Next for one compact row of actions.
    <View style={styles.selectDock} testID="host-ad-media-select-dock">
      <Text style={[bs.caption, styles.selectSummary]} accessibilityLiveRegion="polite">
        {selectedCount === 0 ? hb("media.selectSummary") : hb("media.selected", { count: selectedCount })}
      </Text>
      <View style={styles.selectActions}>
        {selectedAdIds.length + selectedFailedKeys.length > 0 || selectedLibraryIds.length === 0 ? (
          <View style={styles.grow}>
            <Button
              label={
                selectedAdIds.length + selectedFailedKeys.length > 0
                  ? hb("media.removeSel", { count: selectedAdIds.length + selectedFailedKeys.length })
                  : hb("media.removeSelNone")
              }
              variant="secondary"
              fullWidth
              disabled={selectedAdIds.length + selectedFailedKeys.length === 0}
              onPress={() => {
                removeFromAd(selectedAdIds);
                dropUploads(selectedFailedKeys);
                setMediaSelected([]);
                setMediaSelectMode(false);
              }}
              testID="host-ad-media-remove-selected"
            />
          </View>
        ) : null}
        {selectedLibraryIds.length > 0 ? (
          <View style={styles.grow}>
            <Button
              label={hb("media.archiveSel", { count: selectedLibraryIds.length })}
              variant="destructiveOutline"
              fullWidth
              onPress={() => setSheet("archive")}
              testID="host-ad-media-archive-selected"
            />
          </View>
        ) : null}
        <Button
          label={hb("media.done")}
          variant="secondary"
          onPress={() => {
            setMediaSelectMode(false);
            setMediaSelected([]);
          }}
          testID="host-ad-media-select-done"
        />
      </View>
    </View>
  ) : isReview ? (
    blocker?.kind === "top_up" && canTopUp ? (
      <Button
        label={hb("review.topUp", { amount: money(topUpNeeded) })}
        fullWidth
        onPress={() => setSheet("topUp")}
        testID="host-ad-topup"
      />
    ) : (
      <Button
        label={hb("review.launch")}
        fullWidth
        disabled={blocker !== null}
        loading={busy && checkState !== "checking"}
        onPress={() => setSheet("launch")}
        testID="host-ad-launch"
      />
    )
  ) : (
    <Button
      label={hb("next")}
      fullWidth
      disabled={Boolean(stepError)}
      onPress={() => void goToStep(activeStepIndex + 1)}
      testID="host-ad-step-next"
    />
  );
  const dockBlockerNode = dockBlocker ? (
    <Blocker
      text={dockBlocker}
      testID="host-ad-blocker"
      onShow={isReview && (blocker?.kind === "question" || blocker?.kind === "failed") ? showChecks : undefined}
      showLabel={hb("show")}
    />
  ) : null;
  const banners = (
    <>
      {error ? <Note tone="error" text={error} testID="host-ad-error" /> : null}
      {notice ? <Note tone="info" text={notice} testID="host-ad-notice" /> : null}
      {draftSaveStatus === "error" || draftSaveStatus === "conflict" ? (
        <Text style={[bs.caption, styles.errorText]} accessibilityLiveRegion="polite">{hb("saveFailed")}</Text>
      ) : null}
    </>
  );

  const sheets = (
    <>
      <HostAdWordsSheet
        visible={sheet === "words"}
        apps={planApps.length > 0 ? planApps : activeApps}
        name={name || page?.title || ""}
        headline={headline}
        primary={primaryText}
        cta={ctaId}
        warnings={copyWarnings}
        onClose={() => setSheet(null)}
        onSave={(next) => {
          setName(next.name);
          setHeadline(next.headline);
          setPrimaryText(next.primary);
          setCta(next.cta);
          setSheet(null);
          touch();
        }}
      />
      <Sheet visible={sheet === "rights"} onClose={() => setSheet(null)} snapPoint="half" testID="host-ad-rights-sheet">
        <View style={styles.sheetBody}>
          <Text style={bs.h1} accessibilityRole="header">{hb("rights.title")}</Text>
          <BuilderList>
            {(
              [
                ["owned", hb("rights.owned"), hb("rights.ownedSub")],
                ["licensed", hb("rights.licensed"), hb("rights.licensedSub")],
                ["authorized_by_brand", hb("rights.authorized"), hb("rights.authorizedSub")],
              ] as const
            ).map(([value, label, sub], index) => (
              <ValueRow
                key={value}
                divider={index > 0}
                label={sub}
                value={label}
                trailing={rightsBasis === value ? "✓" : " "}
                accessibilityLabel={`${label}. ${sub}`}
                onPress={() => {
                  setRightsBasis(value);
                  setRightsConfirmed(false);
                  touch();
                }}
                testID={`host-ad-rights-${value}`}
              />
            ))}
          </BuilderList>
          <Button label={hb("rights.done")} fullWidth onPress={() => setSheet(null)} />
        </View>
      </Sheet>
      <Sheet visible={sheet === "leave"} onClose={() => setSheet(null)} snapPoint="half" testID="host-ad-leave-sheet">
        <View style={styles.sheetBody}>
          <Text style={bs.h1} accessibilityRole="header">{hb("leave.title")}</Text>
          <Text style={bs.small}>{hb("leave.body")}</Text>
          {pendingAdUploads + visibleUploads.filter((item) => item.placement === "library" && item.phase === "uploading").length > 0 ? (
            <Text style={bs.small} testID="host-ad-leave-uploading">
              {hb("leave.uploading", {
                count: pendingAdUploads + visibleUploads.filter((item) => item.placement === "library" && item.phase === "uploading").length,
              })}
            </Text>
          ) : null}
          <View style={styles.sheetActions}>
            <View style={styles.grow}>
              <Button label={hb("leave.leave")} variant="secondary" fullWidth onPress={() => { setSheet(null); backToAds(); }} testID="host-ad-leave" />
            </View>
            <View style={styles.grow}>
              <Button label={hb("leave.keep")} fullWidth onPress={() => setSheet(null)} />
            </View>
          </View>
        </View>
      </Sheet>
      {sheet === "topUp" ? (
        <HostAdTopUpSheet
          visible
          brandId={brandId}
          currency={currency}
          neededCents={topUpNeeded}
          limits={topUpLimits}
          money={money}
          returnPath={`/marketing/ads/create?draft_id=${encodeURIComponent(draftIdRef.current ?? "")}&step=review`}
          onClose={() => setSheet(null)}
          onApplied={() => {
            setSheet(null);
            setNotice(hb("topUp.paid"));
            HapticFeedback.success();
            void loadWallet();
          }}
        />
      ) : null}
      <ConfirmDialog
        visible={sheet === "launch"}
        onClose={() => {
          if (!busy) setSheet(null);
        }}
        onConfirm={handleLaunchConfirmed}
        title={hb("review.confirmTitle")}
        description={hb("review.confirmBody", { amount: money(holdPayCents) })}
        confirmLabel={hb("review.launchShort")}
        cancelLabel={hb("review.notYet")}
        confirmLoading={busy}
        closeDisabled={busy}
        testID="host-ad-launch-dialog"
      />
      <ConfirmDialog
        visible={sheet === "cancel"}
        onClose={() => {
          if (!busy) setSheet(null);
        }}
        onConfirm={handleCancelBeforeCreate}
        title={hb("review.cancelTitle")}
        description={hb("review.cancelBody")}
        confirmLabel={hb("review.cancelAd")}
        cancelLabel={hb("review.keepAd")}
        destructive
        confirmLoading={busy}
        closeDisabled={busy}
        errorMessage={cancelError}
        testID="host-ad-cancel-dialog"
      />
      {/* #4238 B7: one background upload per picked clip. Mounted at the
          screen root so changing steps never stops an upload; a removed tile
          stays mounted as `cancelled` so its job is cancelled. */}
      <React.Suspense fallback={null}>
      {brandId
        ? uploads.map((item) => (
            <HostAdVideoUploadSlot
              key={item.key}
              brandId={brandId}
              item={item}
              attempt={uploadAttempts[item.key] ?? 0}
              cancelled={cancelledUploads.includes(item.key)}
              onReport={handleUploadReport}
            />
          ))
        : null}
      </React.Suspense>
      <Sheet
        visible={duplicateAsk !== null}
        onClose={() => setDuplicatePicks((current) => current.slice(1))}
        snapPoint="half"
        testID="host-ad-duplicate-sheet"
      >
        {duplicateAsk ? (
          <View style={styles.sheetBody}>
            <Text style={bs.h1} accessibilityRole="header">
              {hb("media.dupTitle", { name: duplicateAsk.clipName })}
            </Text>
            <Text style={bs.small}>{hb("media.dupBody")}</Text>
            <Button
              label={hb("media.dupUse")}
              fullWidth
              onPress={() => {
                if (adMediaRoom > 0) {
                  addFromLibrary(duplicateAsk.clipId);
                } else {
                  setNotice(hb("media.dupFull", { name: duplicateAsk.clipName }));
                }
                setDuplicatePicks((current) => current.slice(1));
              }}
              testID="host-ad-duplicate-use"
            />
            <Button
              label={hb("media.dupUpload")}
              variant="secondary"
              fullWidth
              onPress={() => {
                const draftId = draftIdRef.current;
                if (draftId !== null) {
                  const token = randomUuid().replace(/-/g, "").slice(0, 10);
                  uploadSeqRef.current += 1;
                  const item: HostAdUploadItem = {
                    key: `upload-${uploadSeqRef.current}-${token}`,
                    ownerKey: hostAdUploadOwnerKey(draftId, token),
                    file: duplicateAsk.file,
                    name: hostAdCreativeNameFor(duplicateAsk.file.fileName) || hb("media.untitled"),
                    placement: adMediaRoom > 0 ? "ad" : "library",
                    phase: "uploading",
                    percent: 0,
                    preparingSince: null,
                    creativeId: null,
                    failure: null,
                    canRetry: false,
                  };
                  setUploads((current) => [...current, item]);
                }
                setDuplicatePicks((current) => current.slice(1));
              }}
              testID="host-ad-duplicate-upload"
            />
          </View>
        ) : null}
      </Sheet>
      <ConfirmDialog
        visible={sheet === "archive"}
        onClose={() => {
          if (!archiveBusy) setSheet(null);
        }}
        onConfirm={() => void confirmArchive()}
        title={hb("media.archiveTitle", { count: selectedLibraryIds.length })}
        description={hb("media.archiveBody")}
        confirmLabel={hb("media.archiveConfirm")}
        cancelLabel={hb("media.keep")}
        destructive
        confirmLoading={archiveBusy}
        closeDisabled={archiveBusy}
        testID="host-ad-archive-dialog"
      />
    </>
  );

  // ---------------- desktop (design v9): rail · steps 208 · form · preview 360 ----------------
  if (isWideDesktop) {
    return (
      <View style={styles.host} testID="host-ad-builder-desktop">
        <ScrollView
          ref={scrollRef as never}
          contentContainerStyle={styles.deskScroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.deskGrid}>
            <View style={[styles.deskSteps, { width: DESK_STEP_LIST }]} accessibilityRole="tablist" accessibilityLabel={hb("title")}>
              {HOST_AD_STEPS.map((step, index) => {
                const current = index === activeStepIndex;
                const done = index < activeStepIndex || index <= maxVisitedStep - (current ? 1 : 0);
                const reachable = index <= maxVisitedStep && !launched;
                return (
                  <Pressable
                    key={step.id}
                    style={[styles.deskStep, current && styles.deskStepOn, !reachable && styles.deskStepLocked]}
                    disabled={!reachable || current}
                    onPress={() => goToStepId(step.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: current, disabled: !reachable }}
                    accessibilityLabel={`${hb("stepOf", { n: index + 1 })}, ${stepName(index)}`}
                    testID={`host-ad-step-${step.id}`}
                  >
                    <View style={[styles.deskStepNum, done && !current && styles.deskStepNumDone, current && styles.deskStepNumOn]}>
                      {done && !current ? (
                        <Icon name="check" size={14} color={color.ink} />
                      ) : (
                        <Text style={[styles.deskStepNumText, current && styles.accentText]}>{index + 1}</Text>
                      )}
                    </View>
                    <Text style={[styles.deskStepText, current && styles.deskStepTextOn]} numberOfLines={2}>
                      {stepName(index)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.deskForm, { maxWidth: DESK_FORM_MAX }]}>
              <View style={bs.rowBetween}>
                <Text style={styles.deskTitle} accessibilityRole="header">{hb("deskTitle")}</Text>
                <Pressable
                  style={styles.iconBtn}
                  onPress={() => setSheet("leave")}
                  accessibilityRole="button"
                  accessibilityLabel={hb("close")}
                  testID="host-ad-close"
                >
                  <Icon name="close" size={20} color={color.text1} />
                </Pressable>
              </View>
              {banners}
              {bodies[activeStepId]}
              <View style={styles.deskFoot}>
                {activeStepIndex > 0 && !launched ? (
                  <Button label={hb("back")} variant="secondary" onPress={() => void goToStep(activeStepIndex - 1)} testID="host-ad-step-back" />
                ) : (
                  <View />
                )}
                <View style={styles.deskFootRight}>
                  {dockBlockerNode}
                  <View style={styles.deskPrimary}>{primary}</View>
                </View>
              </View>
            </View>
            <View style={[styles.deskAside, { width: DESK_PREVIEW }]}>
              <BuilderCard accessibilityLabel={hb("creative.h1")}>
                <BuilderLabel>{hb("creative.h1")}</BuilderLabel>
                {creativePreview}
              </BuilderCard>
              <BuilderCard>
                <View style={bs.kv}>
                  <View style={bs.kvRow}>
                    <Text style={bs.kvKey}>{hb("review.promoting")}</Text>
                    <Text style={bs.kvVal} numberOfLines={2}>{page?.title ?? "—"}</Text>
                  </View>
                  <View style={bs.kvRow}>
                    <Text style={bs.kvKey}>{hb("steps.pick")}</Text>
                    <Text style={bs.kvVal}>{page ? hostAdGoalName(goal) : "—"}</Text>
                  </View>
                  <View style={bs.kvRow}>
                    <Text style={bs.kvKey}>{hb("budget.ends")}</Text>
                    <Text style={bs.kvVal}>{endLabel || "—"}</Text>
                  </View>
                  <View style={bs.kvRow}>
                    <Text style={bs.kvKey}>{hb("budget.payDay")}</Text>
                    <Text style={bs.kvVal}>{dailyPayCents > 0 ? money(dailyPayCents) : "—"}</Text>
                  </View>
                </View>
              </BuilderCard>
            </View>
          </View>
        </ScrollView>
        {sheets}
      </View>
    );
  }

  // ---------------- phone (iOS / Android / narrow web) ----------------
  return (
    <View style={styles.host}>
      <View style={styles.topBar}>
        <Pressable
          style={styles.iconBtn}
          onPress={() => {
            if (launched || activeStepIndex === 0) backToAds();
            else void goToStep(activeStepIndex - 1);
          }}
          accessibilityRole="button"
          accessibilityLabel={hb("back")}
          testID="host-ad-step-back"
        >
          <Icon name="chevL" size={20} color={color.text1} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>{hb("title")}</Text>
        {launched ? (
          <View style={styles.iconSpacer} />
        ) : (
          <Pressable
            style={styles.iconBtn}
            onPress={() => setSheet("leave")}
            accessibilityRole="button"
            accessibilityLabel={hb("close")}
            testID="host-ad-close"
          >
            <Icon name="close" size={20} color={color.text1} />
          </Pressable>
        )}
      </View>
      <ScrollView
        ref={scrollRef as never}
        contentContainerStyle={[styles.scroll, scrollBottomStyle]}
        keyboardShouldPersistTaps="handled"
        {...scrollOffsetProps}
      >
        {!launched ? (
          <View style={styles.progressWrap}>
            <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel={hb("stepOf", { n: activeStepIndex + 1 })}>
              {HOST_AD_STEPS.map((step, index) =>
                index < activeStepIndex ? (
                  <Pressable
                    key={step.id}
                    style={styles.progressHit}
                    onPress={() => goToStepId(step.id)}
                    accessibilityRole="button"
                    accessibilityLabel={hb("stepBack", { n: index + 1, name: stepName(index) })}
                    testID={`host-ad-step-${step.id}`}
                  >
                    <View style={[styles.progressBar, styles.progressDone]} />
                  </Pressable>
                ) : (
                  <View key={step.id} style={styles.progressHit}>
                    <View style={[styles.progressBar, index === activeStepIndex && styles.progressCurrent]} />
                  </View>
                ),
              )}
            </View>
            <View style={bs.rowBetween}>
              <Text style={bs.caption}>{hb("stepOf", { n: activeStepIndex + 1 })}</Text>
              <Text style={bs.caption}>{stepName(activeStepIndex)}</Text>
            </View>
          </View>
        ) : null}
        {banners}
        {bodies[activeStepId]}
      </ScrollView>
      {dockHiddenForKeyboard ? null : (
        <Material kind="chrome" style={[styles.dock, { paddingBottom: Math.max(space[6], bottomChromeInset) }]}>
          {dockBlockerNode}
          {primary}
        </Material>
      )}
      {sheets}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: color.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space[6] },
  centerText: { textAlign: "center", maxWidth: 360 },
  grow: { flex: 1, minWidth: 0 },
  selectDock: { gap: space[2], width: "100%" },
  selectSummary: { textAlign: "center" },
  selectActions: { flexDirection: "row", gap: space[2], alignItems: "center" },
  rightsMissing: { ...type.caption, color: color.errorText },
  scroll:{ paddingHorizontal: space[5], paddingTop: space[4], gap: space[6] },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[2] + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
    backgroundColor: color.canvas,
  },
  topTitle: { ...type.h2, color: color.text1, flex: 1, textAlign: "center" },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.card2,
    ...edge.control,
  },
  iconSpacer: { width: 44 },
  progressWrap: { gap: space[2] + 2 },
  progress: { flexDirection: "row", gap: 6 },
  progressHit: { flex: 1, height: 20, justifyContent: "center" },
  progressBar: { height: 4, borderRadius: 2, backgroundColor: color.fill.step },
  progressDone: { backgroundColor: color.accent },
  progressCurrent: { backgroundColor: color.accentLine },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space[4],
    paddingHorizontal: space[6],
    gap: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  goalRow: { flexDirection: "row" },
  rowTitle: { ...type.row, color: color.text1 },
  fieldRow: { flexDirection: "row", gap: space[3] },
  fieldHalf: { flex: 1, gap: space[2] },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  poster: { width: "100%", height: "100%" },
  checkRow: { paddingVertical: space[4], paddingHorizontal: space[5], gap: space[3] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  errorText: { color: color.errorText },
  warnText: { color: color.warningText },
  accentText: { color: color.accentText },
  launched: { alignItems: "center", gap: space[3], paddingTop: space[10] },
  launchedArt: {
    width: 96,
    height: 96,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.successTint,
    marginBottom: space[3],
  },
  sheetBody: { paddingHorizontal: space[6], paddingTop: space[2], paddingBottom: space[8], gap: space[6] },
  sheetActions: { flexDirection: "row", gap: space[3], marginTop: space[2] },
  deskScroll: { padding: space[6], paddingBottom: space[10] },
  deskGrid: { flexDirection: "row", alignItems: "flex-start", gap: space[6], justifyContent: "center" },
  deskSteps: {
    padding: space[3],
    gap: space[1],
    borderRadius: radius.xl,
    backgroundColor: color.card,
    ...edge.edge,
    ...edge.rim,
  },
  deskStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2] + 2,
    minHeight: 52,
    paddingVertical: space[2] + 2,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  deskStepOn: { backgroundColor: color.fill.railOn },
  deskStepLocked: { opacity: 0.5 },
  deskStepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: color.lineStrong,
  },
  deskStepNumDone: { backgroundColor: color.paper, borderColor: color.paper },
  deskStepNumOn: { borderColor: color.accent },
  deskStepNumText: { ...type.caption, color: color.text2 },
  deskStepText: { ...type.chip, color: color.text2, flex: 1 },
  deskStepTextOn: { color: color.text1 },
  deskForm: { flex: 1, minWidth: 534, gap: space[6] },
  deskTitle: { ...type.h2, color: color.text1 },
  deskFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingTop: space[4],
    paddingBottom: space[6],
  },
  deskFootRight: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space[3] },
  deskPrimary: { minWidth: 160 },
  deskAside: { gap: space[6] },
});
