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

import { Button } from "../../../../src/components/ui/Button";
import { ConfirmDialog } from "../../../../src/components/ui/ConfirmDialog";
import { DateField } from "../../../../src/components/ui/DateField";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import { Input } from "../../../../src/components/ui/Input";
import { CoverPickerSheet } from "../../../../src/components/ui/CoverPickerSheet";
import type { CoverPatch } from "../../../../src/components/ui/CoverPicker";
import { adCreativeCoverTarget } from "../../../../src/components/ui/coverTarget";
import {
  accent,
  canvas,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useHostAdPermissions } from "../../../../src/hooks/useHostAdPermissions";
import { ScrollView } from "../../../../src/wrappers/SmartScrollView";
import type {
  HostAdConnection,
  HostAdCreative,
  HostAdPage,
  HostAdPlanAggregate,
  HostAdSetup,
  HostAdTargetingCity,
  HostAdTargetingInterest,
  HostAdTargetingSearchResult,
  PreparedHostAdPlan,
} from "../../../../src/services/hostAdPlanService";
import { loadHostAdPlanService } from "../../../../src/services/lazyHostAdPlanService";
import { hostAdOwnerKey } from "../../../../src/services/eventCoverVideoEdgeContract";
import { randomUuid } from "../../../../src/utils/randomId";
import { adVideoFitSummaryFor } from "../../../../src/utils/adVideoFit";

const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
  reddit: "Reddit",
};

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
  { id: "creative", label: "Creative and copy" },
  { id: "review", label: "Review and launch" },
] as const;

type HostAdStepId = (typeof HOST_AD_STEPS)[number]["id"];

function hostAdStepId(value: string | null | undefined): HostAdStepId | null {
  return HOST_AD_STEPS.some((step) => step.id === value)
    ? (value as HostAdStepId)
    : null;
}

function localCalendarDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduleBoundaryIso(value: string, boundary: "start" | "end"): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = boundary === "start" ? "00:00:00.000" : "23:59:59.999";
  const date = new Date(`${value}T${time}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hostAdBuilderHref(input: {
  draftId: string;
  planId?: string | null;
  step: HostAdStepId;
}): string {
  const query = new URLSearchParams({
    draft_id: input.draftId,
    step: input.step,
  });
  if (input.planId) query.set("plan_id", input.planId);
  return `/(tabs)/marketing/ads/create?${query.toString()}`;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return null;
}

function normalizedTargetName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function targetingResultName(result: HostAdTargetingSearchResult): string {
  return String(
    result.meta.city ?? result.meta.name ?? result.name ?? "",
  ).trim();
}

function targetingResultCountry(
  result: HostAdTargetingSearchResult,
  fallback: string,
): string {
  return String(result.meta.country_code ?? result.meta.countryCode ?? fallback)
    .trim()
    .toUpperCase();
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

function providerEstimateLabel(
  estimate: PreparedHostAdPlan["targeting"][number]["provider_estimate"],
): string {
  if (
    estimate?.state === "available" &&
    Number.isFinite(estimate.lower_bound) &&
    Number.isFinite(estimate.upper_bound)
  ) {
    return `${Number(estimate.lower_bound).toLocaleString()}–${Number(
      estimate.upper_bound,
    ).toLocaleString()} potential reach`;
  }
  return String(estimate?.state ?? "unavailable").replaceAll("_", " ");
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

function ChoiceCard(props: {
  selected: boolean;
  title: string;
  subtitle?: string;
  onPress: () => void;
  testID: string;
  multiple?: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <Pressable
      style={[styles.choice, props.selected && styles.choiceSelected]}
      onPress={props.onPress}
      accessibilityRole={props.multiple ? "checkbox" : "radio"}
      accessibilityState={
        props.multiple
          ? { checked: props.selected }
          : { selected: props.selected }
      }
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
  const [countriesText, setCountriesText] = useState("NG");
  const [ageMin, setAgeMin] = useState("21");
  const [ageMax, setAgeMax] = useState("45");
  const [gender, setGender] = useState<"all" | "men" | "women">("all");
  const [cities, setCities] = useState<HostAdTargetingCity[]>([]);
  const [radiusKm, setRadiusKm] = useState("15");
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState<HostAdTargetingSearchResult[]>(
    [],
  );
  const [interests, setInterests] = useState<HostAdTargetingInterest[]>([]);
  const [interestQuery, setInterestQuery] = useState("");
  const [interestResults, setInterestResults] = useState<
    HostAdTargetingSearchResult[]
  >([]);
  const [targetingSearchBusy, setTargetingSearchBusy] = useState(false);
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
    router.replace(
      hostAdBuilderHref({
        draftId: draftIdRef.current,
        planId: requestedPlanId,
        step: activeStepId,
      }) as never,
    );
  }, [activeStepId, requestedDraftId, requestedPlanId, router]);

  const load = useCallback(async () => {
    if (!brandId || !permissions.canRead) return;
    setLoading(true);
    setError(null);
    try {
      const { loadHostAdSetup } = await loadHostAdPlanService();
      setSetup(await loadHostAdSetup(brandId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Ads setup could not load.",
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
        const refreshed = await loadHostAdSetup(brandId);
        const recorded = refreshed.creatives.find(
          (item) => item.id === creativeId,
        );
        if (!recorded) {
          throw new Error("Your ad video is saved, but it didn't show up here yet. Try linking it again.");
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
          cause instanceof Error
            ? cause.message
            : "Your ad video is saved, but it didn't link to this ad. Try linking it again.",
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
      setCountriesText(
        Array.isArray(audience?.countries)
          ? audience.countries.join(", ")
          : "NG",
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
      setInterests(targeting.interests);
      setRadiusKm(String(targeting.radiusKm ?? 15));
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
      setStartDate(localCalendarDate(String(schedule?.starts_at ?? "")));
      setEndDate(localCalendarDate(String(schedule?.ends_at ?? "")));
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
          router.replace(
            hostAdBuilderHref({
              draftId: draftIdRef.current,
              planId,
              step: "review",
            }) as never,
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
            providerValidations: [],
          });
          setActivePlanState(aggregate.plan.state);
          setNotice(
            "Mingla staff is reviewing this plan. Funds are held; no provider object exists and nothing is spending.",
          );
        } else if (aggregate.plan.state === "changes_requested") {
          setPrepared(null);
          setActivePlanState(aggregate.plan.state);
          const reason = aggregate.reviews[0]?.reason;
          setNotice(
            `Staff requested changes${reason ? `: ${reason}` : "."} Your held funds were returned to Ads credit. Update the fields below and prepare a new immutable version.`,
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
            providerValidations: [],
          });
          setActivePlanState(aggregate.plan.state);
          setNotice(
            "Plan restored. Review the exact hash, type LAUNCH, and resume.",
          );
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The plan could not be restored.",
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
        const connectionIds = Array.isArray(state.connection_ids)
          ? new Set(state.connection_ids)
          : new Set();
        setConnections(
          setup.connections.filter((item) => connectionIds.has(item.id)),
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
        if (typeof state.countries_text === "string") {
          setCountriesText(state.countries_text);
        }
        if (typeof state.age_min === "string") setAgeMin(state.age_min);
        if (typeof state.age_max === "string") setAgeMax(state.age_max);
        if (["all", "men", "women"].includes(String(state.gender))) {
          setGender(state.gender as "all" | "men" | "women");
        }
        if (Array.isArray(state.cities)) {
          setCities(state.cities as HostAdTargetingCity[]);
        }
        if (typeof state.radius_km === "string") setRadiusKm(state.radius_km);
        if (Array.isArray(state.interests)) {
          setInterests(state.interests as HostAdTargetingInterest[]);
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
            router.replace(
              hostAdBuilderHref({
                draftId: draftIdRef.current,
                planId: draft.plan_id,
                step: restoredStep,
              }) as never,
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
          setDraftReady(true);
          setDraftSaveStatus("unsaved");
          return;
        }
        setDraftSaveStatus("error");
        setError(
          cause instanceof Error
            ? cause.message
            : "The saved ad draft could not be restored.",
        );
      });
    return () => {
      mounted = false;
    };
  }, [brandId, permissions.canRead, requestedStepId, router, setup]);

  const countries = useMemo(
    () => [
      ...new Set(
        countriesText
          .split(/[\s,]+/)
          .map((value) => value.trim().toUpperCase())
          .filter((value) => /^[A-Z]{2}$/.test(value)),
      ),
    ],
    [countriesText],
  );
  const dailyBudgetCents = parseMoney(dailyAmount);
  const capCents = parseMoney(capAmount);
  const radiusKmNumber = Number(radiusKm);
  const today = useMemo(
    () => localCalendarDate(new Date().toISOString()),
    [],
  );
  const promoteError = !page
    ? "Choose the Mingla page people should land on."
    : null;
  const audienceError =
    connections.length === 0
      ? "Choose at least one connected ad platform."
      : countries.length === 0
        ? "Enter at least one two-letter country code."
        : cities.length > 0 &&
            (!Number.isFinite(radiusKmNumber) ||
              radiusKmNumber < 1 ||
              radiusKmNumber > 80)
          ? "Use a city radius from 1 to 80 kilometers."
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
        ? "The hard cap must be at least one day of budget."
        : startDate !== "" && startDate < today
          ? "The start date cannot be in the past."
          : endDate !== "" && endDate < (startDate || today)
            ? "The end date must be on or after the start date."
            : null;
  const creativeError = !creative
    ? "Choose a ready video creative."
    : !rightsConfirmed
      ? "Confirm that this brand may use the creative in paid ads."
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
      countries_text: countriesText,
      age_min: ageMin,
      age_max: ageMax,
      gender,
      cities,
      radius_km: radiusKm,
      interests,
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
      ageMax,
      ageMin,
      aiGenerated,
      capAmount,
      cities,
      connections,
      countriesText,
      creative?.id,
      dailyAmount,
      endDate,
      gender,
      headline,
      interests,
      name,
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
      router.replace(
        hostAdBuilderHref({
          draftId: draftIdRef.current,
          planId: draftPlanIdRef.current ?? existingPlanId,
          step: next.id,
        }) as never,
      );
    }
    await persistDraft(draftSnapshot, next.id);
  };

  const searchPlatform = (
    kind: "city" | "interest",
  ): HostAdConnection["platform"] | null => {
    const supported =
      kind === "city"
        ? ["meta", "tiktok", "google", "snapchat"]
        : ["meta", "tiktok", "google", "snapchat", "reddit"];
    return (supported.find((platform) =>
      connections.some((connection) => connection.platform === platform),
    ) ?? null) as HostAdConnection["platform"] | null;
  };

  const handleCitySearch = async () => {
    if (!brandId || cityQuery.trim().length < 2) return;
    const platform = searchPlatform("city");
    if (!platform) {
      setError("Choose a connected platform before searching cities.");
      return;
    }
    setTargetingSearchBusy(true);
    setError(null);
    try {
      const { searchHostAdTargeting } = await loadHostAdPlanService();
      // orch-strict-grep-allow stripe-country-out-of-scope — This is an ad-audience search country, never a Stripe account or payout country.
      const country = countries[0] ?? "NG";
      const result = await searchHostAdTargeting({
        brandId,
        platform,
        kind: "city",
        query: cityQuery.trim(),
        country,
      });
      setCityResults(result.results);
      if (result.results.length === 0) {
        setNotice(
          result.warning ??
            "No verified city match was found. Keep country targeting or try another spelling.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "City search failed.");
    } finally {
      setTargetingSearchBusy(false);
    }
  };

  const addCityResult = async (result: HostAdTargetingSearchResult) => {
    if (!brandId) return;
    const countryCode = targetingResultCountry(result, countries[0] ?? "NG");
    const name = targetingResultName(result);
    if (!name || !/^[A-Z]{2}$/.test(countryCode)) return;
    setTargetingSearchBusy(true);
    setError(null);
    try {
      const { searchHostAdTargeting } = await loadHostAdPlanService();
      const refs: HostAdTargetingCity["refs"] = {};
      const seed = searchPlatform("city");
      if (seed && ["meta", "tiktok", "google"].includes(seed)) {
        refs[seed] = String(result.id);
      }
      await Promise.all(
        connections.map(async (connection) => {
          if (
            connection.platform === seed ||
            !["meta", "tiktok", "google"].includes(connection.platform)
          ) {
            return;
          }
          const found = await searchHostAdTargeting({
            brandId,
            platform: connection.platform,
            kind: "city",
            query: name,
            country: countryCode,
          });
          const exact = found.results.find(
            (candidate) =>
              normalizedTargetName(targetingResultName(candidate)) ===
              normalizedTargetName(name),
          );
          if (exact) refs[connection.platform] = String(exact.id);
        }),
      );
      setCities((current) =>
        current.some(
          (city) =>
            normalizedTargetName(city.name) === normalizedTargetName(name) &&
            city.countryCode === countryCode,
        )
          ? current
          : [...current, { name, countryCode, refs }],
      );
      setPrepared(null);
      setCityQuery("");
      setCityResults([]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "City resolution failed.",
      );
    } finally {
      setTargetingSearchBusy(false);
    }
  };

  const handleInterestSearch = async () => {
    if (!brandId || interestQuery.trim().length < 2) return;
    const platform = searchPlatform("interest");
    if (!platform) {
      setError("Choose a connected platform before searching interests.");
      return;
    }
    setTargetingSearchBusy(true);
    setError(null);
    try {
      const { searchHostAdTargeting } = await loadHostAdPlanService();
      const result = await searchHostAdTargeting({
        brandId,
        platform,
        kind: "interest",
        query: interestQuery.trim(),
      });
      setInterestResults(result.results);
      if (result.results.length === 0) {
        setNotice(
          result.warning ??
            "No provider interest match was found. Try a broader term.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Interest search failed.",
      );
    } finally {
      setTargetingSearchBusy(false);
    }
  };

  const addInterestResult = async (result: HostAdTargetingSearchResult) => {
    if (!brandId) return;
    const name = result.name.trim();
    if (!name) return;
    setTargetingSearchBusy(true);
    setError(null);
    try {
      const { searchHostAdTargeting } = await loadHostAdPlanService();
      const refs: HostAdTargetingInterest["refs"] = {};
      const seed = searchPlatform("interest");
      if (seed) refs[seed] = seed === "reddit" ? name : String(result.id);
      await Promise.all(
        connections.map(async (connection) => {
          if (connection.platform === seed) return;
          if (connection.platform === "reddit") {
            refs.reddit = name;
            return;
          }
          const found = await searchHostAdTargeting({
            brandId,
            platform: connection.platform,
            kind: "interest",
            query: name,
          });
          const exact = found.results.find(
            (candidate) =>
              normalizedTargetName(candidate.name) ===
              normalizedTargetName(name),
          );
          if (exact) refs[connection.platform] = String(exact.id);
        }),
      );
      setInterests((current) =>
        current.some(
          (interest) =>
            normalizedTargetName(interest.name) === normalizedTargetName(name),
        )
          ? current
          : [...current, { name, refs }],
      );
      setPrepared(null);
      setInterestQuery("");
      setInterestResults([]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Interest resolution failed.",
      );
    } finally {
      setTargetingSearchBusy(false);
    }
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
        ageMin: Number(ageMin),
        ageMax: Number(ageMax),
        gender,
        dailyBudgetCents,
        capCents,
        startsAt: scheduleBoundaryIso(startDate, "start"),
        endsAt: scheduleBoundaryIso(endDate, "end"),
        acceptBroader: forceAcceptance || acceptBroader,
        rightsConfirmed,
        rightsBasis,
        aiGenerated,
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
          "This provider needs more verified targeting data. No funds were held and nothing was created.",
        );
      } else if (next.status === "broader") {
        setNotice(
          "This provider can run a broader audience. Review the exact widening before accepting it.",
        );
      } else {
        setNotice(
          "Immutable plan ready. Review the hash and targeting, then type LAUNCH.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The plan could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleFund = async () => {
    if (!permissions.canFund) {
      setError(
        "A finance manager, owner or approved ads spender must hold funds.",
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
          "Submitted for Mingla staff review. Your funds are held, no provider objects exist, and nothing is spending.",
        );
      } else {
        setNotice(
          "Funds are held. An authorized ads operator can now type LAUNCH and start the approved plan.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The campaign budget could not be held.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLaunch = async () => {
    if (!permissions.canLaunch) {
      setError("Your role cannot launch provider delivery.");
      return;
    }
    if (!prepared || prepared.status !== "ready") return;
    if (launchPhrase !== "LAUNCH") {
      setError(
        "Type LAUNCH exactly before funds are held or provider objects are created.",
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
        "The campaign was created and launched. Provider review may still gate delivery.",
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
        cause instanceof Error
          ? cause.message
          : "The campaign could not launch.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCancelBeforeCreate = async () => {
    if (!permissions.canEnd) {
      setError(
        "Only the brand owner can cancel a funded plan and release its hold.",
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
        reason: "Host canceled the frozen plan before provider creation.",
      });
      setPrepared(null);
      setExistingPlanId(null);
      setActivePlanState("cancelled_before_create");
      setLaunchPhrase("");
      setProviderObjectEvidence(false);
      setCancelDialogVisible(false);
      setNotice(
        "Plan canceled. Any held amount was returned to Ads credit; no provider object was created.",
      );
      await load();
    } catch (cause) {
      setCancelError(
        cause instanceof Error
          ? cause.message
          : "The plan could not be canceled.",
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
          cta={{ label: "Retry", onPress: () => void load() }}
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
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to Ads"
          >
            <Text style={styles.back}>‹ Ads</Text>
          </Pressable>
          <Text style={styles.currency}>
            {setup.currency} settlement currency
          </Text>
        </View>
        <Text style={styles.title}>Create an ad</Text>
        <Text style={styles.intro}>
          Pick one public Mingla page, one or more connected platforms and one
          ready video. The exact plan is frozen before funds or provider objects
          can move.
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
            <Text style={styles.sectionTitle}>Continue a saved plan</Text>
            {resumable.map((plan) => (
              <Pressable
                key={plan.id}
                style={styles.savedPlan}
                onPress={() => void resumePlan(plan.id)}
                accessibilityRole="button"
                accessibilityLabel={`Continue plan ${plan.state}`}
              >
                <View style={styles.choiceText}>
                  <Text style={styles.choiceTitle}>
                    {plan.state.replaceAll("_", " ")}
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    {plan.destination_key}
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
          {setup.pages.map((item) => (
            <ChoiceCard
              key={`${item.page_type}:${item.id}`}
              selected={
                page?.page_type === item.page_type && page?.id === item.id
              }
              title={item.title}
              subtitle={item.canonical_url}
              onPress={() => {
                setPage(item);
                setPrepared(null);
              }}
              testID={`host-ad-page-${item.id}`}
            />
          ))}
          </GlassCard>
        ) : null}

        {activeStepId === "audience" ? (
          <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.step}>2 · Who should see it?</Text>
          <Text style={styles.sectionTitle}>Who should see it?</Text>
          {setup.connections.length === 0 ? (
            <Text style={styles.helper}>
              No business-lane ad account is connected. Mingla Admin must
              reconnect a provider first.
            </Text>
          ) : (
            setup.connections.map((item) => (
              <ChoiceCard
                key={item.id}
                selected={connections.some(
                  (connection) => connection.id === item.id,
                )}
                title={PLATFORM_LABELS[item.platform] ?? item.platform}
                subtitle={`Connected · provider account currency ${item.currency}`}
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
            ))
          )}
          <Text style={styles.label}>Country codes</Text>
          <Input
            value={countriesText}
            onChangeText={(value) => {
              setCountriesText(value);
              setPrepared(null);
            }}
            placeholder="NG, GH"
            accessibilityLabel="Target country codes"
          />
          <Text style={styles.label}>Cities (optional)</Text>
          <Text style={styles.helper}>
            Search resolves provider-native city IDs. Snapchat coordinates stay
            server-side. Any platform that cannot preserve the city or radius
            will show the exact widening before funding.
          </Text>
          <View style={styles.searchRow}>
            <View style={styles.searchInput}>
              <Input
                value={cityQuery}
                onChangeText={setCityQuery}
                placeholder={`Search in ${countries[0] ?? "NG"}`}
                accessibilityLabel="Search target city"
              />
            </View>
            <Pressable
              style={styles.searchButton}
              onPress={() => void handleCitySearch()}
              disabled={targetingSearchBusy || cityQuery.trim().length < 2}
              accessibilityRole="button"
              accessibilityLabel="Search cities"
              testID="host-ad-city-search"
            >
              {targetingSearchBusy ? (
                <ActivityIndicator size="small" color={textTokens.primary} />
              ) : (
                <Text style={styles.searchButtonLabel}>Search</Text>
              )}
            </Pressable>
          </View>
          {cityResults.map((result) => (
            <Pressable
              key={`city-result-${result.id}`}
              style={styles.searchResult}
              onPress={() => void addCityResult(result)}
              accessibilityRole="button"
              accessibilityLabel={`Target ${result.name}`}
            >
              <Text style={styles.choiceTitle}>{result.name}</Text>
              <Text style={styles.resume}>Add</Text>
            </Pressable>
          ))}
          {cities.map((city) => (
            <View
              key={`${city.countryCode}:${city.name}`}
              style={styles.targetingChoice}
            >
              <View style={styles.choiceText}>
                <Text style={styles.choiceTitle}>
                  {city.name}, {city.countryCode}
                </Text>
                <Text style={styles.choiceSubtitle}>
                  Provider IDs: {Object.keys(city.refs).length}/
                  {
                    connections.filter((connection) =>
                      ["meta", "tiktok", "google"].includes(
                        connection.platform,
                      ),
                    ).length
                  }{" "}
                  required platforms
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setCities((current) =>
                    current.filter((item) => item !== city),
                  );
                  setPrepared(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${city.name}`}
              >
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
          ))}
          {cities.length > 0 ? (
            <>
              <Text style={styles.label}>Radius (kilometers)</Text>
              <Input
                value={radiusKm}
                onChangeText={(value) => {
                  setRadiusKm(value);
                  setPrepared(null);
                }}
                variant="number"
                accessibilityLabel="City radius in kilometers"
              />
            </>
          ) : null}
          <Text style={styles.label}>Interests (optional)</Text>
          <Text style={styles.helper}>
            One logical interest must resolve on every selected provider that
            needs an ID. Missing mappings block the plan instead of silently
            widening it.
          </Text>
          <View style={styles.searchRow}>
            <View style={styles.searchInput}>
              <Input
                value={interestQuery}
                onChangeText={setInterestQuery}
                placeholder="Live music, nightlife…"
                accessibilityLabel="Search target interest"
              />
            </View>
            <Pressable
              style={styles.searchButton}
              onPress={() => void handleInterestSearch()}
              disabled={targetingSearchBusy || interestQuery.trim().length < 2}
              accessibilityRole="button"
              accessibilityLabel="Search interests"
              testID="host-ad-interest-search"
            >
              {targetingSearchBusy ? (
                <ActivityIndicator size="small" color={textTokens.primary} />
              ) : (
                <Text style={styles.searchButtonLabel}>Search</Text>
              )}
            </Pressable>
          </View>
          {interestResults.map((result) => (
            <Pressable
              key={`interest-result-${result.id}`}
              style={styles.searchResult}
              onPress={() => void addInterestResult(result)}
              accessibilityRole="button"
              accessibilityLabel={`Target interest ${result.name}`}
            >
              <Text style={styles.choiceTitle}>{result.name}</Text>
              <Text style={styles.resume}>Add</Text>
            </Pressable>
          ))}
          {interests.map((interest) => (
            <View key={interest.name} style={styles.targetingChoice}>
              <View style={styles.choiceText}>
                <Text style={styles.choiceTitle}>{interest.name}</Text>
                <Text style={styles.choiceSubtitle}>
                  Provider mappings: {Object.keys(interest.refs).length}/
                  {connections.length}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setInterests((current) =>
                    current.filter((item) => item !== interest),
                  );
                  setPrepared(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${interest.name}`}
              >
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
          ))}
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
          <Text style={styles.sectionTitle}>Set the spend and schedule boundaries</Text>
          <Text style={styles.helper}>
            You pay and see every amount in {setup.currency}. These are
            portfolio totals split evenly across the selected platforms; each
            platform&apos;s exact amount and any FX quote are frozen in the
            plan.
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
              <Text style={styles.label}>Hard cap ({setup.currency})</Text>
              <Input
                value={capAmount}
                onChangeText={(value) => {
                  setCapAmount(value);
                  setPrepared(null);
                }}
                variant="number"
                accessibilityLabel="Campaign hard cap"
              />
            </View>
          </View>
          <Text style={styles.helper}>
            {dailyBudgetCents > 0 && capCents > 0
              ? `${formatMoney(setup.currency, dailyBudgetCents)} per day · never hold more than ${formatMoney(setup.currency, capCents)}`
              : "Enter valid positive amounts."}
          </Text>
          <View style={styles.fieldRow}>
            <View style={styles.fieldHalf}>
              <DateField
                label="Start date (optional)"
                value={startDate}
                min={today}
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
            Leave the start empty to begin after approval. Leave the end empty
            to stop at the hard cap instead of a calendar date.
          </Text>
          </GlassCard>
        ) : null}

        {activeStepId === "creative" ? (
          <GlassCard variant="base" contentStyle={styles.cardContent}>
          <Text style={styles.step}>4 · Creative and copy</Text>
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
                accessibilityLabel={`Creative rights: ${label}`}
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
              I confirm this creative may be used in paid ads. A paid Creator
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
            accessibilityLabel="Creative is AI-generated"
          >
            <View
              style={[styles.checkbox, aiGenerated && styles.checkboxChecked]}
            />
            <Text style={styles.choiceTitle}>
              This creative is AI-generated or materially AI-edited
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
          <Text style={styles.sectionTitle}>Freeze the exact plan</Text>
          <Text style={styles.helper}>
            Preparing performs validation only. It does not hold funds, create
            provider objects or start spend.
          </Text>
          <Button
            label={
              prepared ? "Refresh immutable plan" : "Prepare immutable plan"
            }
            onPress={() => void handlePrepare(false)}
            disabled={Boolean(formError) || !permissions.canPlan}
            loading={busy}
            fullWidth
            testID="host-ad-prepare"
          />
          {!permissions.canPlan ? (
            <Text style={styles.helper}>
              This plan is read-only for your role. You can still complete an
              authorized funding or launch step below.
            </Text>
          ) : null}
          {formError ? <Text style={styles.helper}>{formError}</Text> : null}

          {prepared ? (
            <View style={styles.planBox}>
              <Text style={styles.label}>Immutable plan hash</Text>
              <Text style={styles.hash}>{prepared.planHash}</Text>
              {prepared.measurement ? (
                <View style={styles.targetingRow}>
                  <Text style={styles.choiceTitle}>
                    Measurement ·{" "}
                    {String(prepared.measurement.quality).replaceAll("_", " ")}
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    Result order:{" "}
                    {Array.isArray(prepared.measurement.result_hierarchy)
                      ? prepared.measurement.result_hierarchy
                          .map((value) => String(value).replaceAll("_", " "))
                          .join(" → ")
                      : "Unavailable"}
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    Browser pixels and platform conversion sharing require
                    consent. Trusted Mingla results remain in aggregate reports.
                  </Text>
                </View>
              ) : null}
              {prepared.mediaRights ? (
                <View style={styles.targetingRow}>
                  <Text style={styles.choiceTitle}>Media rights attested</Text>
                  <Text style={styles.choiceSubtitle}>
                    {String(prepared.mediaRights.rights_basis).replaceAll(
                      "_",
                      " ",
                    )}{" "}
                    ·{" "}
                    {prepared.mediaRights.ai_generated === true
                      ? "AI-generated"
                      : "not marked AI-generated"}
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    Paid-ad use only; Mingla house reuse is not authorized.
                  </Text>
                </View>
              ) : null}
              {prepared.providerValidations.map(({ platform }) => (
                <Text
                  key={`validation-${platform}`}
                  style={styles.validationOk}
                >
                  {PLATFORM_LABELS[platform] ?? platform} preflight passed · no
                  object created
                </Text>
              ))}
              {prepared.targeting.length > 0 ? (
                <View style={styles.targetingRow}>
                  <Text style={styles.choiceTitle}>
                    Provider estimates overlap
                  </Text>
                  <Text style={styles.choiceSubtitle}>
                    Read each platform separately. Do not add these estimates
                    into a cross-platform total because the same person may be
                    eligible on more than one platform.
                  </Text>
                </View>
              ) : null}
              {prepared.targeting.map((row) => (
                <View key={row.platform} style={styles.targetingRow}>
                  <Text style={styles.choiceTitle}>
                    {PLATFORM_LABELS[row.platform] ?? row.platform} ·{" "}
                    {row.verdict}
                  </Text>
                  {[
                    ...(row.widening_summary ?? []),
                    ...(row.checks_required ?? []),
                  ].map((line) => (
                    <Text key={line} style={styles.choiceSubtitle}>
                      {line}
                    </Text>
                  ))}
                  {row.provider_estimate ? (
                    <>
                      <Text style={styles.choiceTitle}>
                        Provider estimate ·{" "}
                        {providerEstimateLabel(row.provider_estimate)}
                      </Text>
                      <Text style={styles.choiceSubtitle}>
                        Observed{" "}
                        {row.estimate_observed_at
                          ? new Date(row.estimate_observed_at).toLocaleString()
                          : "time unavailable"}{" "}
                        · {row.provider_estimate.source}
                      </Text>
                      {row.provider_estimate.state !== "available" ? (
                        <Text style={styles.choiceSubtitle}>
                          {String(row.provider_estimate.detail).replaceAll(
                            "_",
                            " ",
                          )}
                        </Text>
                      ) : null}
                      {(row.provider_estimate.assumptions ?? []).map(
                        (assumption) => (
                          <Text key={assumption} style={styles.choiceSubtitle}>
                            {assumption}
                          </Text>
                        ),
                      )}
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
                    accessibilityLabel="I accept the exact widening shown above"
                  >
                    <View
                      style={[
                        styles.checkbox,
                        acceptBroader && styles.checkboxChecked,
                      ]}
                    />
                    <Text style={styles.choiceTitle}>
                      I accept the exact widening shown above
                    </Text>
                  </Pressable>
                  <Button
                    label="Accept and freeze a new version"
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
                          Hold {formatMoney(setup.currency, capCents)} in Ads
                          credit. First-three or flagged Host campaigns then
                          stop for staff approval; no provider object is
                          created.
                        </Text>
                        <Button
                          label="Hold funds"
                          onPress={() => void handleFund()}
                          loading={busy}
                          fullWidth
                          testID="host-ad-fund"
                        />
                      </>
                    ) : (
                      <Text style={styles.helper}>
                        The immutable plan is ready. A finance manager, owner or
                        approved ads spender must hold the budget next.
                      </Text>
                    )
                  ) : null}
                  {activePlanState === "staff_review_required" ? (
                    <Text style={styles.helper}>
                      Funds are held while Mingla staff reviews this exact plan.
                      No provider object exists and nothing is spending.
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
                          Type LAUNCH exactly to create paused provider objects
                          and activate this approved plan.
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
                              ? "Retry provider creation and launch"
                              : "Launch approved plan"
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
                        Funds are held. An owner or ads operator with launch
                        authority must complete the provider launch.
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
                          ? "Discard frozen plan"
                          : "Cancel plan and release funds"
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
                      Provider object evidence is recorded. Funds remain held
                      until Mingla reconciles those provider IDs; this plan
                      cannot be discarded from the app.
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
        title="Cancel this frozen ad plan?"
        description="This releases any held Ads credit only after Mingla confirms that no provider object exists. The frozen plan cannot be resumed."
        variant="typeToConfirm"
        confirmText="CANCEL PLAN"
        confirmLabel="Cancel plan"
        cancelLabel="Keep plan"
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
  hash: { fontFamily: "monospace", fontSize: 11, color: textTokens.tertiary },
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
