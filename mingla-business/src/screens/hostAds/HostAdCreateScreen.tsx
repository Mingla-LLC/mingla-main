/** Issue #3697 v1.4 — Host Ads plan builder and resumable launch surface. */

import { useLocalSearchParams, useRouter } from "expo-router";
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
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { DateField } from "../../components/ui/DateField";
import { EmptyState } from "../../components/ui/EmptyState";
import { GlassCard } from "../../components/ui/GlassCard";
import { Input } from "../../components/ui/Input";
import {
  HOST_AD_OWNED_ERROR_COPY,
  HOST_AD_PLATFORM_NAMES,
  hostAdCountingLines,
  hostAdErrorMessage,
  hostAdPlaceName,
  hostAdReachLine,
  hostAdStatusLabel,
  hostAdTargetingNote,
  platformNames,
  hostAdAudienceName,
} from "../../components/marketing/ads/hostAdCopy";
import {
  goBackToAds,
  hostAdDayOf,
  hostAdScheduleError,
  hostAdScheduleIsos,
  hostAdScheduleLimit,
  hostAdScrollBottomPadding,
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
import {
  applyInterestLookup,
  applyPlaceLookup,
  type HostAdApp,
  HOST_AD_DEFAULT_RADIUS_KM,
  HOST_AD_EXCLUDE_APPS,
  hostAdAppAvailability,
  hostAdAppReviewStatus,
  hostAdInterestKey,
  hostAdLookupKind,
  hostAdLookupQuery,
  hostAdPlaceAppStatus,
  hostAdPlaceFromSaved,
  hostAdPlaceKey,
  hostAdPlaceNeedsLookup,
  type HostAdPlace,
  type HostAdPlaceKind,
  HOST_AD_LANGUAGE_NAMES,
} from "../../components/marketing/ads/hostAdTargeting";
import {
  countryName,
  initialHostAdCountries,
} from "../../components/marketing/ads/hostAdCountries";
import {
  HOST_AD_UNAVAILABLE_BODY,
  HOST_AD_UNAVAILABLE_TITLE,
  hostAdSetupErrorCopy,
} from "../../components/marketing/ads/hostAdSetupCopy";
import { CoverPickerSheet } from "../../components/ui/CoverPickerSheet";
import type { CoverPatch } from "../../components/ui/CoverPicker";
import { adCreativeCoverTarget } from "../../components/ui/coverTarget";
import {
  accent,
  canvas,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  HOST_AD_SALES_PLATFORMS,
  hostAdPageSellsTickets,
  hostOptimizationSummary,
} from "../../components/marketing/ads/hostAdGoal";
import type {
  HostAdConnection,
  HostAdCreative,
  HostAdOptimization,
  HostAdPage,
  HostAdPlanAggregate,
  HostAdSetup,
  HostAdTargetingCity,
  HostAdTargetingInterest,
  PreparedHostAdPlan,
} from "../../services/hostAdPlanService";
import { loadHostAdPlanService } from "./hostAdKitService";
import { hostAdOwnerKey } from "../../services/eventCoverVideoEdgeContract";
import { randomUuid } from "../../utils/randomId";
import { adVideoFitSummaryFor } from "../../utils/adVideoFit";

// #4238: platforms are named the way Hosts know them.
const PLATFORM_LABELS = HOST_AD_PLATFORM_NAMES;
const platformList = platformNames;


const EMPTY_AD_VIDEO_PATCH: CoverPatch = {
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
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

const HOST_AD_STEPS = [
  { id: "promote", label: "What are you promoting?" },
  { id: "audience", label: "Who should see it?" },
  { id: "budget", label: "Budget and dates" },
  { id: "creative", label: "Video and words" },
  { id: "review", label: "Review and launch" },
] as const;

type HostAdStepId = (typeof HOST_AD_STEPS)[number]["id"];

function hostAdStepId(value: string | null | undefined): HostAdStepId | null {
  return HOST_AD_STEPS.some((step) => step.id === value)
    ? (value as HostAdStepId)
    : null;
}

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

function parseMoney(value: string): number {
  const major = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(major) && major > 0 ? Math.round(major * 100) : 0;
}

function formatMoney(currency: string, cents: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
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

/** "Ticket sales: Meta, Snapchat · Page visits: Google". */
function goalSummaryLine(summary: {
  sales: readonly string[];
  visits: readonly string[];
}): string {
  const names = (platforms: readonly string[]) =>
    platforms.map((platform) => PLATFORM_LABELS[platform] ?? platform).join(", ");
  return [
    summary.sales.length > 0 ? `Ticket sales: ${names(summary.sales)}` : null,
    summary.visits.length > 0 ? `Page visits: ${names(summary.visits)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function ChoiceCard(props: {
  selected: boolean;
  title: string;
  subtitle?: string;
  onPress: () => void;
  testID: string;
  multiple?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <Pressable
      style={[
        styles.choice,
        props.selected && styles.choiceSelected,
        props.disabled && styles.choiceDisabled,
      ]}
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole={props.multiple ? "checkbox" : "radio"}
      accessibilityState={
        props.multiple
          ? { checked: props.selected, disabled: props.disabled }
          : { selected: props.selected, disabled: props.disabled }
      }
      // #4238: web screen readers read the tick state from aria-checked.
      aria-checked={props.multiple ? props.selected : undefined}
      accessibilityLabel={props.title}
      testID={props.testID}
    >
      {props.children}
      <View style={styles.choiceText}>
        <Text style={styles.choiceTitle}>{props.title}</Text>
        {props.subtitle ? (
          <Text style={styles.choiceSubtitle}>{props.subtitle}</Text>
        ) : null}
      </View>
      <View
        style={[
          styles.radio,
          props.multiple && styles.checkboxShape,
          props.selected && styles.radioSelected,
        ]}
      />
    </Pressable>
  );
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
  // #4238 wave 2: the brand's own audiences (keys only; the server resolves).
  const [audienceKeys, setAudienceKeys] = useState<string[]>([]);
  const [targetingSearchBusy] = useState(false);
  const [dailyAmount, setDailyAmount] = useState("30");
  const [capAmount, setCapAmount] = useState("210");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activeStepId, setActiveStepId] = useState<HostAdStepId>(
    requestedStepId ?? "promote",
  );
  const [maxVisitedStep, setMaxVisitedStep] = useState(
    Math.max(
      0,
      HOST_AD_STEPS.findIndex(
        (step) => step.id === (requestedStepId ?? "promote"),
      ),
    ),
  );
  const [existingPlanId, setExistingPlanId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedHostAdPlan | null>(null);
  const [activePlanState, setActivePlanState] = useState<string | null>(null);
  const [acceptBroader, setAcceptBroader] = useState(false);
  const [launchPhrase, setLaunchPhrase] = useState("");
  const [providerObjectEvidence, setProviderObjectEvidence] = useState(false);
  const [cancelDialogVisible, setCancelDialogVisible] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<
    "loading" | "unsaved" | "saving" | "saved" | "conflict" | "error"
  >("loading");
  const [adVideoPickerVisible, setAdVideoPickerVisible] = useState(false);
  const [adVideoPatch, setAdVideoPatch] = useState<CoverPatch>(
    EMPTY_AD_VIDEO_PATCH,
  );
  // #3040 B-C14 — ONE owner: true only while a creative id the server
  // created is being linked into this draft. Processing never disables the
  // sheet or the button (A-14: Replace used to be refused while it ran).
  const [adVideoLinking, setAdVideoLinking] = useState(false);
  // The job running in the sheet, for the button's own spinner only.
  const [adVideoProcessing, setAdVideoProcessing] = useState(false);
  const linkedCreativeIdRef = useRef<string | null>(null);
  // #3040 AD-04 — the fit sentence for the video this sheet holds, from the
  // server's per-platform fit (the same matrix every ads gate uses).
  const adVideoFitSummary = useMemo(
    (): string | null =>
      adVideoFitSummaryFor({
        creatives: setup?.creatives,
        heldId: adVideoPatch.adCreativeId ?? linkedCreativeIdRef.current,
        linked: creative,
      }),
    [adVideoPatch.adCreativeId, creative, setup],
  );
  // AD-05 — a creative that exists server-side but did not link here yet:
  // "Try linking again" re-links the SAME id, never re-uploads.
  const [unlinkedCreativeId, setUnlinkedCreativeId] = useState<string | null>(null);

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
  const backToAds = useCallback(() => goBackToAds(router), [router]);

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
  // the SERVER creates the creative row from the READY job and the sheet hands
  // back its id (`patch.adCreativeId`). Nothing records a creative from a URL
  // here any more (`recordHostAdVideo` is gone).
  const linkAdCreative = useCallback(
    async (creativeId: string): Promise<void> => {
      if (!brandId) return;
      if (linkedCreativeIdRef.current === creativeId) return;
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
        linkedCreativeIdRef.current = creativeId;
        setUnlinkedCreativeId(null);
        setSetup(refreshed);
        setCreative(recorded);
        setRightsConfirmed(false);
        setPrepared(null);
        setNotice(
          "Ad video saved to this ad. Nothing goes to ad platforms until you fund and confirm the plan.",
        );
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

  const handleAdVideoChange = useCallback(
    async (patch: CoverPatch): Promise<void> => {
      setAdVideoPatch(patch);
      if (!patch.coverMediaUrl) {
        // "Remove video" — the ad has no video until one is added again.
        linkedCreativeIdRef.current = null;
        setUnlinkedCreativeId(null);
        setCreative(null);
        setRightsConfirmed(false);
        setPrepared(null);
        return;
      }
      if (patch.coverMediaType !== "video" || !patch.adCreativeId) return;
      await linkAdCreative(patch.adCreativeId);
    }, [linkAdCreative],
  );

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
        frozenGoal && Object.values(frozenGoal).includes("sales")
          ? "sales"
          : "visits",
      );
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
      setInterests(targeting.interests);
      setRadiusKm(String(targeting.radiusKm ?? HOST_AD_DEFAULT_RADIUS_KM));
      setLanguages(
        Array.isArray(audience?.languages)
          ? audience.languages.filter(
              (code): code is string => typeof code === "string",
            )
          : [],
      );
      setDailyAmount(
        String(
          aggregate.provider_allocations.reduce(
            (sum, allocation) =>
              sum +
              Number(
                deliveryBudgets?.[String(allocation.platform)]
                  ?.host_amount_cents ?? 0,
              ),
            0,
          ) / 100,
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
            "Your saved ad is back. Check it, then type LAUNCH to carry on.",
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
          setup.pages.find((item) => item.id === state.page_id) ?? null,
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
        if (state.optimization === "sales" || state.optimization === "visits") {
          setOptimization(state.optimization);
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
          const restoredStep = hostAdStepId(draft.current_step) ?? "promote";
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

  // #4238: "Ticket sales" applies only on a page that sells tickets, on the
  // selected platforms whose sales signal is ready.
  const pageSellsTickets = hostAdPageSellsTickets(page);
  const salesReadyPlatforms = useMemo(
    () =>
      connections
        .filter(
          (connection) =>
            connection.sales?.ready === true &&
            HOST_AD_SALES_PLATFORMS.includes(connection.platform),
        )
        .map((connection) => connection.platform),
    [connections],
  );
  useEffect(() => {
    if (
      optimization === "sales" &&
      (!pageSellsTickets || salesReadyPlatforms.length === 0)
    ) {
      setOptimization("visits");
    }
  }, [optimization, pageSellsTickets, salesReadyPlatforms.length]);
  const dailyBudgetCents = parseMoney(dailyAmount);
  const capCents = parseMoney(capAmount);
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
  const activeApps = useMemo(
    () => connections.map((connection) => connection.platform as HostAdApp),
    [connections],
  );
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
    connections.length === 0
      ? "Choose at least one app to show your ad on."
      : countries.length === 0
        ? "Choose at least one country."
        : radiusProblem
          ? `${PLATFORM_LABELS[radiusProblem.app] ?? radiusProblem.app}: ${radiusProblem.status.text}`
          : !Number.isInteger(Number(ageMin)) ||
              !Number.isInteger(Number(ageMax)) ||
              Number(ageMin) < 13 ||
              Number(ageMax) > 100 ||
              Number(ageMin) > Number(ageMax)
            ? "Use an age range between 13 and 100."
            : null;
  const budgetError =
    dailyBudgetCents <= 0
      ? "Enter a daily budget."
      : capCents < dailyBudgetCents
        ? "Your total budget must be at least one day of spend."
        : startDate !== "" && startDate < today
          ? "The start date cannot be in the past."
          : endDate !== "" && endDate < (startDate || today)
            ? "The end date must be on or after the start date."
            : hostAdScheduleError(startDate, endDate, scheduleLimit);
  const creativeError = !creative
    ? "Choose a ready video."
    : !rightsConfirmed
      ? "Confirm your brand is allowed to use this video in paid ads."
      : name.trim().length < 3
        ? "Add a campaign name."
        : primaryText.trim().length < 3
          ? "Add the primary ad text."
          : null;
  const stepErrors: Record<HostAdStepId, string | null> = {
    promote: promoteError,
    audience: audienceError,
    budget: budgetError,
    creative: creativeError,
    review: null,
  };
  const formError =
    promoteError ?? audienceError ?? budgetError ?? creativeError;

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
      languages,
      radius_km: radiusKm,
      interests,
      audience_keys: audienceKeys,
      daily_amount: dailyAmount,
      cap_amount: capAmount,
      start_date: startDate,
      end_date: endDate,
      accept_broader: acceptBroader,
      prepared,
      active_plan_state: activePlanState,
      provider_object_evidence: providerObjectEvidence,
      // Typed LAUNCH is fresh authorization and is intentionally never saved.
    }),
    [
      acceptBroader,
      activePlanState,
      audienceKeys,
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
          setDraftSaveStatus("saved");
        } catch (cause) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brandId],
  );

  // Look up every place and interest an app has no answer for yet: new
  // places, and every place again when the Host turns an app on.
  const unresolvedSignature = [
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
        .map((app) => `include|${hostAdPlaceKey(place)}|${app}`),
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
        .map((app) => `exclude|${hostAdPlaceKey(place)}|${app}`),
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
        .map((app) => `interest|${hostAdInterestKey(interest.name)}|${app}`),
    ),
  ].join(",");
  const citiesRef = useRef(cities);
  citiesRef.current = cities;
  const excludedRef = useRef(excludedPlaces);
  excludedRef.current = excludedPlaces;
  const interestsRef = useRef(interests);
  interestsRef.current = interests;
  useEffect(() => {
    if (!brandId || unresolvedSignature === "") return;
    for (const item of unresolvedSignature.split(",")) {
      const [list, key, app] = item.split("|") as [string, string, HostAdApp];
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
        void lookupPlaceOnApp(list as "include" | "exclude", place, app);
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

  const handlePrepare = async (forceAcceptance = false) => {
    if (!permissions.canPlan) {
      setError("Your role can review this plan but cannot change it.");
      return;
    }
    if (
      formError ||
      !brandId ||
      !page ||
      connections.length === 0 ||
      !creative
    ) {
      setError(formError ?? "The plan is incomplete.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await persistDraft(draftSnapshot, "review");
      const { prepareHostAdPlan } = await loadHostAdPlanService();
      const next = await prepareHostAdPlan({
        brandId,
        existingPlanId,
        page,
        connections,
        creative,
        name: name.trim(),
        primaryText: primaryText.trim(),
        headline: headline.trim() || name.trim(),
        countries,
        cities,
        radiusKm: cities.length > 0 ? radiusKmNumber : null,
        interests,
        excludedPlaces,
        languages,
        languageIds,
        ageMin: Number(ageMin),
        ageMax: Number(ageMax),
        gender,
        dailyBudgetCents,
        capCents,
        // #4238 r6: both in the page's own zone, like the fields.
        ...hostAdScheduleIsos(startDate, endDate, scheduleLimit, page?.timezone),
        acceptBroader: forceAcceptance || acceptBroader,
        rightsConfirmed,
        rightsBasis,
        aiGenerated,
        optimization,
        audienceKeys,
      });
      setExistingPlanId(next.planId);
      draftPlanIdRef.current = next.planId;
      setPrepared(next);
      setProviderObjectEvidence(false);
      setActivePlanState(
        next.status === "ready" ? "ready_for_funding" : "validating",
      );
      if (next.status === "blocked") {
        setNotice(
          "One of the apps can't run this audience yet. Change your places or interests, or turn that app off. No money was taken.",
        );
      } else if (next.status === "broader") {
        setNotice(
          "One of the apps can't target exactly who you picked, so it would show your ad to a wider group. Read the note below, then accept it or turn that app off.",
        );
      } else {
        setNotice(
          "Your ad is ready. Check the details below, then add the money.",
        );
      }
    } catch (cause) {
      setError(
        hostAdErrorMessage(cause, "The plan could not be prepared."),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleFund = async () => {
    if (!permissions.canFund) {
      setError(
        "Only a finance manager, the owner or an approved ads spender can add money to an ad.",
      );
      return;
    }
    if (!prepared || prepared.status !== "ready") return;
    setBusy(true);
    setError(null);
    try {
      const { fundHostAdPlan } = await loadHostAdPlanService();
      const result = await fundHostAdPlan({
        planId: prepared.planId,
        versionId: prepared.versionId,
        planHash: prepared.planHash,
      });
      setActivePlanState(result.state);
      if (result.state === "staff_review_required") {
        setNotice(
          "Sent to Mingla to check. Your money is set aside and nothing is being spent yet.",
        );
      } else {
        setNotice(
          "Your money is set aside. Someone who can launch ads can now type LAUNCH to start your ad.",
        );
      }
    } catch (cause) {
      setError(
        hostAdErrorMessage(cause, "The campaign budget could not be held."),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLaunch = async () => {
    if (!permissions.canLaunch) {
      setError("Your role can't start ads. Ask the brand owner.");
      return;
    }
    if (!prepared || prepared.status !== "ready") return;
    if (launchPhrase !== "LAUNCH") {
      setError(
        "Type LAUNCH in capital letters to start your ad.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { launchHostAdPlan } = await loadHostAdPlanService();
      await launchHostAdPlan({
        planId: prepared.planId,
        versionId: prepared.versionId,
        planHash: prepared.planHash,
      });
      setNotice(
        "Your ad has started. Each app checks new ads first, so it may take a little while before people see it.",
      );
      setTimeout(() => router.replace("/(tabs)/marketing/ads" as never), 900);
    } catch (cause) {
      try {
        const { getHostAdPlan } = await loadHostAdPlanService();
        const aggregate = await getHostAdPlan(prepared.planId);
        await hydrateAggregate(aggregate);
        setActivePlanState(aggregate.plan.state);
      } catch {
        // Preserve the provider failure as the primary error. A later reload
        // restores the durable server state if this recovery read also fails.
      }
      setError(
        hostAdErrorMessage(cause, "The campaign could not launch."),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCancelBeforeCreate = async () => {
    if (!permissions.canEnd) {
      setError(
        "Only the brand owner can cancel this ad and get the money back.",
      );
      return;
    }
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
      setPrepared(null);
      setExistingPlanId(null);
      setActivePlanState("cancelled_before_create");
      setLaunchPhrase("");
      setProviderObjectEvidence(false);
      setCancelDialogVisible(false);
      setNotice(
        "Ad cancelled. Any money you set aside is back in your Ads credit.",
      );
      await load(true);
    } catch (cause) {
      setCancelError(
        hostAdErrorMessage(cause, "The plan could not be canceled."),
      );
    } finally {
      setBusy(false);
    }
  };

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
        <ActivityIndicator color={textTokens.secondary} />
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
          title="Ads setup unavailable"
          description={error ?? "Try again."}
          cta={{ label: "Retry", onPress: () => void load(true) }}
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
          cta={{ label: "Back to Ads", onPress: backToAds }}
        />
      </View>
    );
  }

  const resumable = setup.plans.filter((plan) =>
    RESUMABLE_STATES.has(plan.state),
  );
  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={[styles.scroll, scrollBottomStyle]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <Pressable
            onPress={backToAds}
            accessibilityRole="button"
            accessibilityLabel="Back to Ads"
          >
            <Text style={styles.back}>‹ Ads</Text>
          </Pressable>
          <Text style={styles.currency}>
            Amounts in {setup.currency}
          </Text>
        </View>
        <Text style={styles.title}>Create an ad</Text>
        <Text style={styles.intro}>
          Pick a public Mingla page, where it runs and one ready video. We lock
          the plan before any money moves.
        </Text>

        <Text
          style={[
            styles.draftStatus,
            (draftSaveStatus === "error" ||
              draftSaveStatus === "conflict") &&
              styles.error,
          ]}
          accessibilityLiveRegion="polite"
        >
          {draftSaveStatus === "loading"
            ? "Restoring saved draft…"
            : draftSaveStatus === "saving"
              ? "Saving…"
              : draftSaveStatus === "saved"
                ? "Saved to Mingla"
                : draftSaveStatus === "conflict"
                  ? "A newer draft exists. Reopen this ad before editing."
                  : draftSaveStatus === "error"
                    ? "Draft save failed. Your on-screen changes remain here."
                    : "Changes not saved yet"}
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <View style={styles.stepRail} accessibilityLabel="Ad builder steps">
          {HOST_AD_STEPS.map((step, index) => {
            const selected = step.id === activeStepId;
            const disabled = index > maxVisitedStep;
            return (
              <Pressable
                key={step.id}
                style={[
                  styles.stepPill,
                  selected && styles.stepPillSelected,
                  disabled && styles.stepPillDisabled,
                ]}
                disabled={disabled}
                onPress={() => void goToStep(index)}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                accessibilityLabel={`Step ${index + 1}: ${step.label}`}
                testID={`host-ad-step-${step.id}`}
              >
                <Text
                  style={[
                    styles.stepNumber,
                    selected && styles.stepNumberSelected,
                  ]}
                >
                  {index + 1}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.stepPillLabel,
                    selected && styles.stepPillLabelSelected,
                  ]}
                >
                  {step.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeStepId === "promote" && resumable.length > 0 ? (
          <GlassCard
            variant="base"
            contentStyle={styles.cardContent}
            testID="host-ad-resumable"
          >
            <Text style={styles.sectionTitle}>Carry on with a saved ad</Text>
            {resumable.map((plan) => (
              <Pressable
                key={plan.id}
                style={styles.savedPlan}
                onPress={() => void resumePlan(plan.id)}
                accessibilityRole="button"
                accessibilityLabel={`Continue saved ad, ${hostAdStatusLabel(plan.state)}`}
              >
                <View style={styles.choiceText}>
                  <Text style={styles.choiceTitle}>
                    {hostAdStatusLabel(plan.state)}
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    {setup.pages.find(
                      (item) =>
                        [item.page_type, item.brand_slug, item.page_type === "brand" ? null : item.entity_slug]
                          .filter(Boolean)
                          .join(":") === plan.destination_key,
                    )?.title ?? "Saved ad"}
                  </Text>
                </View>
                <Text style={styles.resume}>Continue</Text>
              </Pressable>
            ))}
          </GlassCard>
        ) : null}

        {activeStepId === "promote" ? (
          <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.step}>1 · What are you promoting?</Text>
          <Text style={styles.sectionTitle}>Choose the landing page</Text>
          <HostAdPagePicker
            pages={setup.pages}
            selected={page}
            onSelect={(item) => {
              setPage(item);
              if (!hostAdPageSellsTickets(item)) setOptimization("visits");
              // #4238: default the end to the last day people can book.
              const limit = hostAdScheduleLimit(item, (iso) =>
                hostAdPageDate(iso, item.timezone),
              );
              if (limit && endDate === "") setEndDate(limit.lastDay);
              setPrepared(null);
            }}
          />
          </GlassCard>
        ) : null}

        {activeStepId === "audience" ? (
          <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.step}>2 · Who should see it?</Text>
          <Text style={styles.sectionTitle}>Who should see it?</Text>
          {setup.connections.map((item) => {
              // #4238 P0: "works here" — greyed out with the reason.
              const where = hostAdAppAvailability(
                item.platform,
                countries,
                setup.availability ?? [],
              );
              return (
                <ChoiceCard
                  key={item.id}
                  selected={
                    where.works &&
                    connections.some((connection) => connection.id === item.id)
                  }
                  title={PLATFORM_LABELS[item.platform] ?? item.platform}
                  subtitle={where.works ? "Ready" : where.reason ?? undefined}
                  disabled={!where.works}
                  onPress={() => {
                    setConnections((current) =>
                      current.some((connection) => connection.id === item.id)
                        ? current.filter(
                            (connection) => connection.id !== item.id,
                          )
                        : [...current, item],
                    );
                    setPrepared(null);
                  }}
                  testID={`host-ad-platform-${item.platform}`}
                  multiple
                />
              );
            })}
          <HostAdAudiencePicker
            audiences={setup.audiences ?? []}
            unavailable={setup.audiences_error === "unavailable"}
            selected={audienceKeys}
            countries={countries}
            connections={connections}
            onChange={(next) => {
              setAudienceKeys(next);
              setPrepared(null);
            }}
          />
          <HostAdCountryPicker
            countries={countries}
            onChange={(next) => {
              setCountries(next);
              setPrepared(null);
            }}
          />
          <Text style={styles.label}>Places (optional)</Text>
          <Text style={styles.helper}>
            Add towns or cities to focus your ad. Each app finds the place in
            its own way, and you&apos;ll see its answer before you pay.
          </Text>
          <HostAdPlacesEditor
            places={cities}
            apps={activeApps}
            countries={countries}
            availability={setup.availability ?? []}
            checking={prefixedChecking("include")}
            busy={busy}
            onSearch={searchPlaces}
            onAdd={(place) => {
              setCities((current) =>
                current.some((item) => hostAdPlaceKey(item) === hostAdPlaceKey(place))
                  ? current
                  : [...current, place],
              );
              setPrepared(null);
            }}
            onChange={(key, place) => {
              setCities((current) =>
                current.map((item) => (hostAdPlaceKey(item) === key ? place : item)),
              );
              setPrepared(null);
            }}
            onRemove={(key) => {
              setCities((current) =>
                current.filter((item) => hostAdPlaceKey(item) !== key),
              );
              setPrepared(null);
            }}
            onRetry={(key, app) => {
              const place = cities.find((item) => hostAdPlaceKey(item) === key);
              if (place) void lookupPlaceOnApp("include", place, app);
            }}
          />
          <Text style={styles.label}>Leave out places (optional)</Text>
          <Text style={styles.helper}>
            Skip areas that never buy. Only Facebook &amp; Instagram and
            Snapchat can leave places out; the other apps say so below.
          </Text>
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
            onAdd={(place) => {
              setExcludedPlaces((current) =>
                current.some((item) => hostAdPlaceKey(item) === hostAdPlaceKey(place))
                  ? current
                  : [...current, place],
              );
              setPrepared(null);
            }}
            onChange={(key, place) => {
              setExcludedPlaces((current) =>
                current.map((item) => (hostAdPlaceKey(item) === key ? place : item)),
              );
              setPrepared(null);
            }}
            onRemove={(key) => {
              setExcludedPlaces((current) =>
                current.filter((item) => hostAdPlaceKey(item) !== key),
              );
              setPrepared(null);
            }}
            onRetry={(key, app) => {
              const place = excludedPlaces.find(
                (item) => hostAdPlaceKey(item) === key,
              );
              if (place && HOST_AD_EXCLUDE_APPS.includes(app)) {
                void lookupPlaceOnApp("exclude", place, app);
              }
            }}
          />
          <Text style={styles.label}>Interests (optional)</Text>
          <Text style={styles.helper}>
            Add interests that fit your crowd. Each app has its own list, so
            you&apos;ll see each app&apos;s own name for it.
          </Text>
          <HostAdInterestsEditor
            interests={interests}
            apps={activeApps}
            checking={prefixedChecking("interest")}
            busy={busy}
            onSearch={searchInterests}
            onAdd={(name) => {
              setInterests((current) =>
                current.some(
                  (item) => hostAdInterestKey(item.name) === hostAdInterestKey(name),
                )
                  ? current
                  : [...current, { name, refs: {} }],
              );
              setPrepared(null);
            }}
            onChange={(key, interest) => {
              setInterests((current) =>
                current.map((item) =>
                  hostAdInterestKey(item.name) === key ? interest : item,
                ),
              );
              setPrepared(null);
            }}
            onRemove={(key) => {
              setInterests((current) =>
                current.filter((item) => hostAdInterestKey(item.name) !== key),
              );
              setPrepared(null);
            }}
            onRetry={(key, app) => {
              const interest = interests.find(
                (item) => hostAdInterestKey(item.name) === key,
              );
              if (interest) void lookupInterestOnApp(interest, app);
            }}
          />
          <Text style={styles.label}>Languages (optional)</Text>
          <Text style={styles.helper}>
            Leave this empty to reach people in every language.
          </Text>
          <View style={styles.chipRow}>
            {Object.entries(HOST_AD_LANGUAGE_NAMES).map(([code, label]) => {
              const on = languages.includes(code);
              return (
                <Pressable
                  key={code}
                  style={[styles.chip, on && styles.chipSelected]}
                  onPress={() => {
                    setLanguages((current) =>
                      on
                        ? current.filter((item) => item !== code)
                        : [...current, code],
                    );
                    setPrepared(null);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Language: ${label}`}
                  testID={`host-ad-language-${code}`}
                >
                  <Text style={styles.chipLabel}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Minimum age</Text>
              <Input
                value={ageMin}
                onChangeText={(value) => {
                  setAgeMin(value);
                  setPrepared(null);
                }}
                variant="number"
                accessibilityLabel="Minimum age"
              />
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Maximum age</Text>
              <Input
                value={ageMax}
                onChangeText={(value) => {
                  setAgeMax(value);
                  setPrepared(null);
                }}
                variant="number"
                accessibilityLabel="Maximum age"
              />
            </View>
          </View>
          <Text style={styles.label}>Gender</Text>
          <View style={styles.chipRow}>
            {(["all", "women", "men"] as const).map((value) => (
              <Pressable
                key={value}
                style={[styles.chip, gender === value && styles.chipSelected]}
                onPress={() => {
                  setGender(value);
                  setPrepared(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: gender === value }}
                accessibilityLabel={`${value[0].toUpperCase()}${value.slice(1)}`}
              >
                <Text style={styles.chipLabel}>
                  {value[0].toUpperCase() + value.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          </GlassCard>
        ) : null}

        {activeStepId === "budget" ? (
          <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.step}>3 · Budget and dates</Text>
          {pageSellsTickets ? (
            <View style={styles.goalBlock} testID="host-ad-goal">
              <Text style={styles.sectionTitle}>What should this ad get?</Text>
              <ChoiceCard
                selected={optimization === "sales"}
                title="Ticket sales"
                subtitle={
                  salesReadyPlatforms.length > 0
                    ? `${platformList(salesReadyPlatforms)} ${
                        salesReadyPlatforms.length === 1 ? "learns" : "learn"
                      } from real ticket sales`
                    : "Not enough ticket sales on these platforms yet."
                }
                disabled={salesReadyPlatforms.length === 0}
                onPress={() => {
                  setOptimization("sales");
                  setPrepared(null);
                }}
                testID="host-ad-goal-sales"
              />
              <ChoiceCard
                selected={optimization === "visits"}
                title="Visits to your page"
                onPress={() => {
                  setOptimization("visits");
                  setPrepared(null);
                }}
                testID="host-ad-goal-visits"
              />
            </View>
          ) : null}
          <Text style={styles.sectionTitle}>Set the spend and schedule boundaries</Text>
          <Text style={styles.helper}>
            You pay and see every amount in {setup.currency}. We split your
            budget evenly across the apps you picked, and the exchange rate is
            fixed when you confirm your ad.
          </Text>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Daily budget ({setup.currency})</Text>
              <Input
                value={dailyAmount}
                onChangeText={(value) => {
                  setDailyAmount(value);
                  setPrepared(null);
                }}
                variant="number"
                accessibilityLabel="Daily budget"
              />
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>Total budget ({setup.currency})</Text>
              <Input
                value={capAmount}
                onChangeText={(value) => {
                  setCapAmount(value);
                  setPrepared(null);
                }}
                variant="number"
                accessibilityLabel="Total budget for this ad"
              />
            </View>
          </View>
          <Text style={styles.helper}>
            {dailyBudgetCents > 0 && capCents > 0
              ? `${formatMoney(setup.currency, dailyBudgetCents)} per day · never more than ${formatMoney(setup.currency, capCents)} in total`
              : "Enter valid positive amounts."}
          </Text>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <DateField
                label="Start date (optional)"
                value={startDate}
                min={today}
                max={scheduleLimit?.lastDay}
                onChangeValue={(value) => {
                  setStartDate(value);
                  if (endDate && value && endDate < value) setEndDate(value);
                  setPrepared(null);
                }}
                accessibilityLabel="Ad campaign start date"
                testID="host-ad-start-date"
              />
            </View>
            <View style={styles.fieldHalf}>
              <DateField
                label="End date (optional)"
                value={endDate}
                min={startDate || today}
                max={scheduleLimit?.lastDay}
                onChangeValue={(value) => {
                  setEndDate(value);
                  setPrepared(null);
                }}
                accessibilityLabel="Ad campaign end date"
                testID="host-ad-end-date"
              />
            </View>
          </View>
          <Text style={styles.helper}>
            {scheduleLimit
              ? `Leave the start empty to begin after approval. Your ad runs until ${scheduleLimit.label} at the latest, the last day people can book.`
              : "Leave the start empty to begin after approval. Leave the end empty to stop at the hard cap instead of a calendar date."}
          </Text>
          </GlassCard>
        ) : null}

        {activeStepId === "creative" ? (
          <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.step}>4 · Video and words</Text>
          <Text style={styles.sectionTitle}>Choose the ad</Text>
          {setup.creatives.length === 0 ? (
            <Text style={styles.helper}>
              No ad video yet. Add one below — vertical 9:16 works on the most
              platforms.
            </Text>
          ) : (
            setup.creatives.map((item) => (
              <ChoiceCard
                key={item.id}
                selected={creative?.id === item.id}
                title={item.name}
                subtitle={`${Math.round(Number(item.duration_seconds ?? 0))} sec · Ready`}
                onPress={() => {
                  setCreative(item);
                  setRightsConfirmed(false);
                  setPrepared(null);
                }}
                testID={`host-ad-creative-${item.id}`}
              >
                {item.poster_url ? (
                  <Image
                    source={{ uri: item.poster_url }}
                    style={styles.poster}
                  />
                ) : null}
              </ChoiceCard>
            ))
          )}
          {/* #3040 design §7 — the button reopens the sheet at any time: a
              running job shows its own spinner here but never disables it. */}
          <Button
            label={setup.creatives.length === 0 ? "Add ad video" : "Add another video"}
            variant="secondary"
            onPress={() => setAdVideoPickerVisible(true)}
            loading={adVideoLinking}
            leadingIcon={adVideoProcessing ? undefined : "play"}
            fullWidth
            testID="host-ad-add-video"
          />
          {adVideoProcessing ? (
            <View style={styles.adVideoWorkingRow} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={accent.warm} />
              <Text style={styles.helper}>
                Your ad video is being prepared. You can keep editing.
              </Text>
            </View>
          ) : null}
          {unlinkedCreativeId !== null ? (
            <Button
              label="Try linking again"
              variant="primary"
              onPress={() => { void linkAdCreative(unlinkedCreativeId); }}
              loading={adVideoLinking}
              fullWidth
              testID="host-ad-relink-video"
            />
          ) : null}
          <Text style={styles.label}>Paid-ad rights basis</Text>
          <View style={styles.chipRow}>
            {(
              [
                ["owned", "Owned"],
                ["licensed", "Licensed"],
                ["authorized_by_brand", "Brand authorized"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                style={[
                  styles.chip,
                  rightsBasis === value && styles.chipSelected,
                ]}
                onPress={() => {
                  setRightsBasis(value);
                  setRightsConfirmed(false);
                  setPrepared(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: rightsBasis === value }}
                accessibilityLabel={`Video rights: ${label}`}
              >
                <Text style={styles.chipLabel}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={[styles.acceptRow, rightsConfirmed && styles.choiceSelected]}
            onPress={() => {
              setRightsConfirmed((value) => !value);
              setPrepared(null);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rightsConfirmed }}
            accessibilityLabel="Confirm paid advertising rights"
          >
            <View
              style={[
                styles.checkbox,
                rightsConfirmed && styles.checkboxChecked,
              ]}
            />
            <Text style={styles.choiceTitle}>
              I confirm this video may be used in paid ads. A paid Creator
              gig also licenses the approved video to Mingla for its own
              marketing after the full Creator fee is released.
            </Text>
          </Pressable>
          <Pressable
            style={[styles.acceptRow, aiGenerated && styles.choiceSelected]}
            onPress={() => {
              setAiGenerated((value) => !value);
              setPrepared(null);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: aiGenerated }}
            accessibilityLabel="Video is made with AI"
          >
            <View
              style={[styles.checkbox, aiGenerated && styles.checkboxChecked]}
            />
            <Text style={styles.choiceTitle}>
              This video was made or heavily edited with AI
            </Text>
          </Pressable>
          <Text style={styles.label}>Campaign name</Text>
          <Input
            value={name}
            onChangeText={(value) => {
              setName(value);
              setPrepared(null);
            }}
            placeholder="Deserted Island — October"
            accessibilityLabel="Campaign name"
          />
          <Text style={styles.label}>Primary text</Text>
          <Input
            value={primaryText}
            onChangeText={(value) => {
              setPrimaryText(value);
              setPrepared(null);
            }}
            placeholder="The weekend you will talk about all year."
            accessibilityLabel="Primary ad text"
          />
          <Text style={styles.label}>Headline</Text>
          <Input
            value={headline}
            onChangeText={(value) => {
              setHeadline(value);
              setPrepared(null);
            }}
            placeholder="Tickets are moving"
            accessibilityLabel="Ad headline"
          />
          </GlassCard>
        ) : null}

        {activeStepId === "review" ? (
          <GlassCard variant="elevated" contentStyle={styles.cardContent}>
          <Text style={styles.step}>5 · Review and launch</Text>
          <Text style={styles.sectionTitle}>Check your ad</Text>
          <Text style={styles.helper}>
            We check your ad with each app first. This doesn&apos;t take any
            money or start your ad.
          </Text>
          <Button
            label={prepared ? "Check my ad again" : "Check my ad"}
            onPress={() => void handlePrepare(false)}
            disabled={Boolean(formError) || !permissions.canPlan}
            loading={busy}
            fullWidth
            testID="host-ad-prepare"
          />
          {!permissions.canPlan ? (
            <Text style={styles.helper}>
              Your role can look at this ad but not change it. You may still be
              able to add money or start it below.
            </Text>
          ) : null}
          {formError ? <Text style={styles.helper}>{formError}</Text> : null}

          {prepared ? (
            <View style={styles.planBox}>
              {audienceKeys.length > 0 ? (
                <View style={styles.targetingRow} testID="host-ad-review-audiences">
                  <Text style={styles.choiceTitle}>People you chose</Text>
                  <Text style={styles.choiceSubtitle}>
                    {audienceKeys
                      .map((key) => {
                        const audience = (setup.audiences ?? []).find(
                          (item) => item.audienceKey === key,
                        );
                        return audience ? hostAdAudienceName(audience) : null;
                      })
                      .filter((value): value is string => value !== null)
                      .join(", ")}
                  </Text>
                </View>
              ) : null}
              {prepared.optimizationByPlatform ? (
                <Text style={styles.choiceTitle} testID="host-ad-goal-summary">
                  {goalSummaryLine(
                    hostOptimizationSummary(
                      prepared.optimizationByPlatform,
                      prepared.targeting.length > 0
                        ? prepared.targeting.map((row) => row.platform)
                        : connections.map((connection) => connection.platform),
                    ),
                  )}
                </Text>
              ) : null}
              {prepared.measurement ? (
                <View style={styles.targetingRow}>
                  <Text style={styles.choiceTitle}>How we count results</Text>
                  <Text style={styles.choiceSubtitle}>
                    {
                      hostAdCountingLines(
                        Array.isArray(prepared.measurement.result_hierarchy)
                          ? prepared.measurement.result_hierarchy
                          : [],
                      ).counts
                    }
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    {
                      hostAdCountingLines(
                        Array.isArray(prepared.measurement.result_hierarchy)
                          ? prepared.measurement.result_hierarchy
                          : [],
                      ).sharing
                    }
                  </Text>
                </View>
              ) : null}
              {prepared.mediaRights ? (
                <View style={styles.targetingRow}>
                  <Text style={styles.choiceTitle}>You confirmed the video rights</Text>
                  <Text style={styles.choiceSubtitle}>
                    {prepared.mediaRights.rights_basis === "licensed"
                      ? "Licensed"
                      : prepared.mediaRights.rights_basis === "authorized_by_brand"
                        ? "Brand allowed"
                        : "Owned"}{" "}
                    ·{" "}
                    {prepared.mediaRights.ai_generated === true
                      ? "Made with AI"
                      : "Not made with AI"}
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    This video is used only for this paid ad.
                  </Text>
                </View>
              ) : null}
              {prepared.providerValidations.map(({ platform }) => (
                <Text
                  key={`validation-${platform}`}
                  style={styles.validationOk}
                >
                  {PLATFORM_LABELS[platform] ?? platform} checked your ad · nothing
                  is running yet
                </Text>
              ))}
              {prepared.targeting.length > 0 ? (
                <View style={styles.targetingRow}>
                  <Text style={styles.choiceTitle}>
                    Reach numbers overlap
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    Read each app on its own. Don&apos;t add the numbers up,
                    because the same person can use more than one app.
                  </Text>
                </View>
              ) : null}
              {prepared.targeting.map((row) => (
                <View key={row.platform} style={styles.targetingRow}>
                  <Text
                    style={styles.choiceTitle}
                    testID={`host-ad-review-status-${row.platform}`}
                  >
                    {PLATFORM_LABELS[row.platform] ?? row.platform} ·{" "}
                    {/* #4238 P0: Ready, Needs a choice, Couldn't check, Can't run yet. */}
                    {hostAdAppReviewStatus({
                      app: row.platform as HostAdApp,
                      verdict: row.verdict,
                      places: cities,
                      interests,
                    })}
                  </Text>
                  {[
                    ...new Set(
                      [
                        ...(row.widening_summary ?? []),
                        ...(row.checks_required ?? []),
                      ].map((line) =>
                        hostAdTargetingNote(row.platform, row.verdict, line, countries),
                      ),
                    ),
                  ].map((line) => (
                    <Text key={line} style={styles.choiceSubtitle}>
                      {line}
                    </Text>
                  ))}
                  {row.provider_estimate ? (
                    <>
                      <Text style={styles.choiceTitle}>
                        {hostAdReachLine(row.platform, row.provider_estimate)}
                      </Text>
                      {row.estimate_observed_at ? (
                        <Text style={styles.choiceSubtitle}>
                          Checked{" "}
                          {new Date(row.estimate_observed_at).toLocaleString()}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              ))}
              {prepared.status === "broader" ? (
                <>
                  <Pressable
                    style={[
                      styles.acceptRow,
                      acceptBroader && styles.choiceSelected,
                    ]}
                    onPress={() => setAcceptBroader((value) => !value)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: acceptBroader }}
                    accessibilityLabel="I accept the wider audience shown above"
                  >
                    <View
                      style={[
                        styles.checkbox,
                        acceptBroader && styles.checkboxChecked,
                      ]}
                    />
                    <Text style={styles.choiceTitle}>
                      I accept the wider audience shown above
                    </Text>
                  </Pressable>
                  <Button
                    label="Accept and check my ad again"
                    onPress={() => void handlePrepare(true)}
                    disabled={!acceptBroader}
                    loading={busy}
                    fullWidth
                  />
                </>
              ) : null}
              {prepared.status === "ready" ? (
                <>
                  {activePlanState === "ready_for_funding" ? (
                    permissions.canFund ? (
                      <>
                        <Text style={styles.helper}>
                          We&apos;ll set aside{" "}
                          {formatMoney(setup.currency, capCents)} from your Ads
                          credit. Your first few ads, and any ad that needs a
                          closer look, are checked by Mingla before they start.
                          Nothing is spent until your ad runs.
                        </Text>
                        <Button
                          label="Set aside the money"
                          onPress={() => void handleFund()}
                          loading={busy}
                          fullWidth
                          testID="host-ad-fund"
                        />
                      </>
                    ) : (
                      <Text style={styles.helper}>
                        Your ad is ready. A finance manager, the owner or an
                        approved ads spender needs to add the money next.
                      </Text>
                    )
                  ) : null}
                  {activePlanState === "staff_review_required" ? (
                    <Text style={styles.helper}>
                      Your money is set aside while Mingla checks your ad.
                      Nothing is being spent yet.
                    </Text>
                  ) : null}
                  {[
                    "funded_held",
                    "staff_approved",
                    "creating_paused_objects",
                    "creation_failed_retryable",
                  ].includes(activePlanState ?? "") ? (
                    permissions.canLaunch ? (
                      <>
                        <Text style={styles.helper}>
                          Type LAUNCH to start your ad. We&apos;ll set it up on
                          each app and it will start spending up to{" "}
                          {formatMoney(setup.currency, capCents)} from the money
                          you set aside.
                        </Text>
                        <Input
                          value={launchPhrase}
                          onChangeText={setLaunchPhrase}
                          placeholder="LAUNCH"
                          accessibilityLabel="Type LAUNCH to confirm"
                        />
                        <Button
                          label={
                            [
                              "creating_paused_objects",
                              "creation_failed_retryable",
                            ].includes(activePlanState ?? "")
                              ? "Try starting my ad again"
                              : "Start my ad"
                          }
                          onPress={() => void handleLaunch()}
                          disabled={launchPhrase !== "LAUNCH"}
                          loading={busy}
                          fullWidth
                          testID="host-ad-launch"
                        />
                      </>
                    ) : (
                      <Text style={styles.helper}>
                        Your money is set aside. The owner or someone who can
                        launch ads needs to start it.
                      </Text>
                    )
                  ) : null}
                  {permissions.canEnd &&
                  !providerObjectEvidence &&
                  [
                    "ready_for_funding",
                    "funded_held",
                    "staff_review_required",
                    "staff_approved",
                    "creating_paused_objects",
                    "creation_failed_retryable",
                    "creation_failed_terminal",
                  ].includes(activePlanState ?? "") ? (
                    <Button
                      label={
                        activePlanState === "ready_for_funding"
                          ? "Delete this ad"
                          : "Cancel ad and get my money back"
                      }
                      onPress={() => {
                        setCancelError(null);
                        setCancelDialogVisible(true);
                      }}
                      variant="destructiveOutline"
                      loading={busy}
                      fullWidth
                      testID="host-ad-cancel-before-create"
                    />
                  ) : null}
                  {providerObjectEvidence ? (
                    <Text style={styles.helper}>
                      This ad was already set up on at least one app. Your
                      money stays set aside until Mingla checks it, so you
                      can&apos;t delete it here. Contact Mingla support if you
                      need help.
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
          </GlassCard>
        ) : null}

        <View style={styles.stepFooter}>
          {activeStepIndex > 0 ? (
            <Button
              label="Back"
              variant="secondary"
              onPress={() => void goToStep(activeStepIndex - 1)}
              testID="host-ad-step-back"
            />
          ) : (
            <View />
          )}
          {activeStepIndex < HOST_AD_STEPS.length - 1 ? (
            <Button
              label={
                activeStepId === "creative" ? "Review plan" : "Continue"
              }
              variant="step"
              trailingIcon="chevR"
              disabled={Boolean(stepErrors[activeStepId])}
              onPress={() => void goToStep(activeStepIndex + 1)}
              testID="host-ad-step-next"
            />
          ) : null}
        </View>
        {activeStepIndex < HOST_AD_STEPS.length - 1 &&
        stepErrors[activeStepId] ? (
          <Text style={styles.stepHint}>{stepErrors[activeStepId]}</Text>
        ) : null}
      </ScrollView>
      <ConfirmDialog
        visible={cancelDialogVisible}
        onClose={() => {
          if (busy) return;
          setCancelDialogVisible(false);
          setCancelError(null);
        }}
        onConfirm={handleCancelBeforeCreate}
        title="Cancel this ad?"
        description="Type CANCEL PLAN to cancel. Once Mingla confirms the ad was not set up on any app, the money you set aside goes back to your Ads credit. You can't bring this ad back."
        variant="typeToConfirm"
        confirmText="CANCEL PLAN"
        confirmLabel="Cancel ad"
        cancelLabel="Keep ad"
        destructive
        confirmLoading={busy}
        closeDisabled={busy}
        errorMessage={cancelError}
        testID="host-ad-cancel-dialog"
      />
      <CoverPickerSheet
        visible={adVideoPickerVisible}
        onClose={() => setAdVideoPickerVisible(false)}
        // #3040 E-1d — `host-ad:<draftId>`: stable for this draft, so a
        // reopened sheet re-attaches to the same in-flight ad video.
        target={adCreativeCoverTarget(brandId, hostAdOwnerKey(draftIdRef.current ?? ""))}
        initial={adVideoPatch}
        onCoverChange={handleAdVideoChange}
        onShowToast={(message) => setNotice(message)}
        onCoverVideoProcessingChange={setAdVideoProcessing}
        mediaMode="video-only"
        title="Ad video"
        confirmLabel="Use this ad video"
        // #3040 AD-04 — "Fits Meta and TikTok. Snapchat needs 1080×1920."
        adFitSummary={adVideoFitSummary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: canvas.discover,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  back: { ...typography.body, color: textTokens.secondary },
  currency: { ...typography.caption, color: textTokens.tertiary },
  title: { ...typography.h1, color: textTokens.primary },
  intro: { ...typography.bodySm, color: textTokens.secondary, lineHeight: 20 },
  draftStatus: { ...typography.caption, color: textTokens.tertiary },
  stepRail: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  stepPill: {
    minHeight: 48,
    minWidth: 112,
    flexGrow: 1,
    flexBasis: "30%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.chrome.idle,
  },
  stepPillSelected: {
    borderColor: "#FF7A18",
    backgroundColor: "rgba(255,122,24,.13)",
  },
  stepPillDisabled: { opacity: 0.42 },
  stepNumber: {
    ...typography.caption,
    color: textTokens.secondary,
    fontWeight: "700",
  },
  stepNumberSelected: { color: "#FF7A18" },
  stepPillLabel: {
    ...typography.caption,
    color: textTokens.secondary,
    flexShrink: 1,
  },
  stepPillLabelSelected: { color: textTokens.primary, fontWeight: "600" },
  error: {
    ...typography.bodySm,
    color: semantic.errorText,
    backgroundColor: "rgba(239,68,68,.12)",
    padding: spacing.md,
    borderRadius: 14,
  },
  notice: {
    ...typography.bodySm,
    color: textTokens.primary,
    backgroundColor: "rgba(255,122,24,.13)",
    padding: spacing.md,
    borderRadius: 14,
  },
  cardContent: { gap: spacing.sm },
  stepFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  stepHint: {
    ...typography.caption,
    color: textTokens.secondary,
    textAlign: "right",
  },
  step: {
    ...typography.caption,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  sectionTitle: { ...typography.h3, color: textTokens.primary },
  adVideoWorkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  helper: {
    ...typography.caption,
    color: textTokens.secondary,
    lineHeight: 18,
  },
  label: {
    ...typography.caption,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  choice: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.chrome.idle,
  },
  choiceSelected: {
    borderColor: "#FF7A18",
    backgroundColor: "rgba(255,122,24,.11)",
  },
  choiceDisabled: { opacity: 0.5 },
  goalBlock: { gap: spacing.sm, marginBottom: spacing.sm },
  choiceText: { flex: 1, gap: 2 },
  choiceTitle: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  choiceSubtitle: { ...typography.caption, color: textTokens.secondary },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
  },
  checkboxShape: { borderRadius: 5 },
  radioSelected: { borderWidth: 5, borderColor: "#FF7A18" },
  poster: {
    width: 48,
    height: 68,
    borderRadius: 8,
    backgroundColor: glass.tint.chrome.idle,
  },
  fieldRow: { flexDirection: "row", gap: spacing.sm },
  fieldHalf: { flex: 1, gap: spacing.xs },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  searchInput: { flex: 1 },
  searchButton: {
    minWidth: 78,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.chrome.idle,
  },
  searchButtonLabel: {
    ...typography.caption,
    color: textTokens.primary,
    fontWeight: "700",
  },
  searchResult: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: glass.tint.chrome.idle,
  },
  targetingChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  remove: { ...typography.caption, color: semantic.errorText },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  chipSelected: {
    borderColor: "#FF7A18",
    backgroundColor: "rgba(255,122,24,.11)",
  },
  chipLabel: { ...typography.caption, color: textTokens.primary },
  savedPlan: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.chrome,
  },
  resume: { ...typography.caption, color: "#FF7A18", fontWeight: "700" },
  planBox: { gap: spacing.sm, marginTop: spacing.sm },
  validationOk: { ...typography.caption, color: semantic.success },
  targetingRow: {
    gap: 3,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: glass.tint.chrome.idle,
  },
  acceptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
  },
  checkboxChecked: { backgroundColor: "#FF7A18", borderColor: "#FF7A18" },
});
