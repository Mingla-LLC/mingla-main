/**
 * ISSUE-864 WP4 [Full Rooms Ad Engine] — the Campaign Builder wizard.
 *
 * v1.4 five-stage spine: promote → audience → budget & dates → creative &
 * copy → review & create. Provider health, goal and destination are one
 * coherent Promote stage; creative, copy and policy are one production stage.
 * The CHANNEL PICKER IS
 * AN OUTPUT of preflight ∩ goal ∩ market ∩ budget (channelPlan.js) — never an
 * operator step; manual narrowing lives in Budget → Advanced.
 *
 * Everything is created PAUSED (SC-10 / I-PROPOSED-864-CREATE-PAUSED):
 * the builder NEVER invokes the launch/pause action service — Launch lives on
 * #/campaigns (the regression suite greps this file for the action symbol).
 *
 * Mutable work autosaves to a revisioned server draft after one idle second and
 * at every step navigation. Executable plan versions remain immutable.
 */

import { adsErrorWords } from "../lib/systemPages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { useToast } from "../context/ToastContext";
import { Stepper } from "../components/campaign-builder/Stepper";
import { AdPreview } from "../components/campaign-builder/AdPreview";
import { StepLane } from "../components/campaign-builder/StepLane";
import { StepPreflight } from "../components/campaign-builder/StepPreflight";
import { StepGoal } from "../components/campaign-builder/StepGoal";
import { StepDestination } from "../components/campaign-builder/StepDestination";
import { StepAudience } from "../components/campaign-builder/StepAudience";
import { StepBudget } from "../components/campaign-builder/StepBudget";
import { StepCreative } from "../components/campaign-builder/StepCreative";
import { StepCopy } from "../components/campaign-builder/StepCopy";
import { StepPolicy } from "../components/campaign-builder/StepPolicy";
import { StepReview } from "../components/campaign-builder/StepReview";
import {
  adPlanAction,
  appCertificationAction,
  createCampaign,
  creativeUpload,
  getAdCreativeForReuse,
  getAdminAdPlanDraft,
  getConnection,
  parseEdgeError,
  prepareBoundVideoCreative,
  runPreflight,
  saveAdminAdPlanDraft,
} from "../services/adEngineService";
import {
  resolveGoalForPayload,
  resolveMetaObjective,
} from "../lib/adBuilder/objectiveResolver";
import { classifyCreateResult } from "../lib/adBuilder/createResult";
import {
  applyChannelSelection,
  budgetCurrencyPlatforms,
  planChannels,
  splitBudget,
} from "../lib/adBuilder/channelPlan";
import {
  CREATE_PAUSED_PHRASE,
  housePlanCreateSteps,
  initialStepStates,
  preparationPlatformsFor,
  setStepState,
} from "../lib/adBuilder/housePlanPath";
import {
  defaultScheduleTimeZone,
  isValidTimeZone,
  zonedLocalToIso,
} from "../lib/adBuilder/scheduleTimeZone";
import { complianceExclusions } from "../lib/adBuilder/compliance";
import {
  validateAudience,
  DEFAULT_AGE_MAX,
  DEFAULT_AGE_MIN,
  DEFAULT_COUNTRIES,
} from "../lib/adBuilder/audienceRules";
import { DEFAULT_RADIUS_MI } from "../lib/adBuilder/targeting";
import {
  allocateLifetimeCents,
  calendarDaysBetween,
  validateBudget,
} from "../lib/adBuilder/budgetRules";
import { validateCopy } from "../lib/adBuilder/copyRules";
import { runPolicyPrecheck } from "../lib/adBuilder/policyLinter";
import { partitionFundedCreative } from "../lib/adBuilder/creativeGate";
import {
  audienceIntentFromState,
  buildCreatePayload,
  resolvePlanCurrency,
  suggestCampaignName,
  targetingRefsFromState,
} from "../lib/adBuilder/payload";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary";
import {
  placementGapsLine,
  reviewPlacementGaps,
} from "../lib/adBuilder/reviewPlacementGaps";
import { areAllExpectedCreatePairsSuccessful } from "../lib/adBuilder/createProgress";
import { loadFeatureFlags } from "../lib/featureFlags";
import { AlertCard } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";

const STEPS = [
  { id: "promote", label: "What are you promoting?" },
  { id: "audience", label: "Who should see it?" },
  { id: "budget", label: "Budget and dates" },
  { id: "creative", label: "Creative and copy" },
  { id: "review", label: "Review and create" },
];

const STEP_ALIASES = {
  lane: "promote",
  preflight: "promote",
  goal: "promote",
  destination: "promote",
  copy: "creative",
  policy: "creative",
};

const CERTIFICATION_PROVIDERS = new Set([
  "meta",
  "tiktok",
  "snapchat",
  "google",
  "reddit",
]);

function certificationContextFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  const provider = params.get("provider");
  const appKey = params.get("app");
  const os = params.get("os");
  const valid =
    params.get("certification") === "1" &&
    CERTIFICATION_PROVIDERS.has(provider) &&
    ["explorer", "business"].includes(appKey) &&
    ["ios", "android"].includes(os);
  return valid ? { enabled: true, provider, appKey, os } : { enabled: false };
}

function stepIndexFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  const requested = new URLSearchParams(query).get("step");
  const step = STEP_ALIASES[requested] ?? requested;
  const index = STEPS.findIndex((s) => s.id === step);
  return index >= 0 ? index : 0;
}

function draftIdFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  const draftId = new URLSearchParams(query).get("draft");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    draftId ?? "",
  )
    ? draftId
    : null;
}

function creativeIdFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  const creativeId = new URLSearchParams(query).get("creative");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    creativeId ?? "",
  )
    ? creativeId
    : null;
}

function replaceBuilderHash(draftId, stepId) {
  const [route, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  params.set("draft", draftId);
  if (stepId) params.set("step", stepId);
  const nextHash = `${route || "#/campaign-builder"}?${params.toString()}`;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${nextHash}`,
  );
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function CampaignBuilderPage() {
  const { addToast } = useToast();
  const certificationContext = useMemo(
    () => certificationContextFromHash(),
    [],
  );
  const certificationMode = certificationContext.enabled === true;
  const creativePresetId = useMemo(() => creativeIdFromHash(), []);
  // #3697: decided once at mount. Draft setup writes `draft=` into the hash
  // before the draft is ready, so re-reading the hash on later renders turned
  // a library "Use in campaign" into an empty builder.
  const isNewCreativeReuse = useMemo(
    () => Boolean(creativePresetId && !draftIdFromHash()),
    [creativePresetId],
  );
  // toward #3697 Wave 3 — console flag (missing key defaults ON in featureFlags).
  const [adsConsoleEnabled, setAdsConsoleEnabled] = useState(true);
  const [adsConsoleReady, setAdsConsoleReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadFeatureFlags().then((flags) => {
      if (!mounted) return;
      setAdsConsoleEnabled(flags.enable_ads_console !== false);
      setAdsConsoleReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // ── Wizard navigation ──
  const [activeIndex, setActiveIndex] = useState(() =>
    isNewCreativeReuse ? stepIndexFromHash() : 0,
  );
  const [maxVisitedIndex, setMaxVisitedIndex] = useState(() =>
    isNewCreativeReuse ? stepIndexFromHash() : 0,
  );
  const [pendingJump, setPendingJump] = useState(null); // discard-confirm target
  const draftContextRef = useRef(null);
  if (draftContextRef.current === null) {
    const existingId = draftIdFromHash();
    draftContextRef.current = {
      id: existingId ?? crypto.randomUUID(),
      shouldHydrate: Boolean(existingId),
    };
  }
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState("loading");
  const draftRevisionRef = useRef(0);
  const draftPlanIdRef = useRef(null);
  const draftSaveChainRef = useRef(Promise.resolve());
  const draftHydrationStartedRef = useRef(false);
  const creativePresetStartedRef = useRef(false);

  // ── Step state ──
  const [lane, setLane] = useState("consumer");
  const [preflightRows, setPreflightRows] = useState(null);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [recheckBusy, setRecheckBusy] = useState(null);
  const [connections, setConnections] = useState({});
  const [goalIds, setGoalIds] = useState(["traffic"]);
  // ISSUE-986 [Campaign Builder platform picker] — the operator's explicit
  // platform selection, made in the Channel-health step. `null` = the default
  // "all currently-eligible platforms selected"; an array = an explicit pick.
  // This is the SINGLE SOURCE OF TRUTH for the channel set (superseding the
  // silent eligibility∩concentrate auto-derivation). It can only narrow WITHIN
  // the eligible set — an ineligible platform can never be selected in.
  const [selectedPlatforms, setSelectedPlatforms] = useState(
    certificationMode ? [certificationContext.provider] : null,
  );
  // ISSUE-1002 [multi-destination fan-out] — Wave 4 of #977. The destination is
  // now an ARRAY (was a single object): the operator picks any mix of event pages
  // + the brand page, and the wizard fans out one ad per (destination × platform).
  // A single-element array behaves exactly as the old single object did.
  const [destinations, setDestinations] = useState([]);
  const [audience, setAudience] = useState({
    countries: DEFAULT_COUNTRIES,
    // ISSUE-989 [Campaign Builder real targeting] — city + radius + interest
    // targeting state. cities carry per-platform resolved keys; interests are
    // platform-tagged chips; radius (mi) applies to Meta city targeting. Empty
    // by default → the builder targets whole countries exactly as before.
    cities: [],
    interests: [],
    radius: DEFAULT_RADIUS_MI,
    distanceUnit: "mile",
    ageMin: DEFAULT_AGE_MIN,
    ageMax: DEFAULT_AGE_MAX,
    gender: "all",
    stages: {
      prospecting: true,
      retarget: true,
      abandoners: true,
    },
  });
  const handleGoalsChange = useCallback(
    (nextGoalIds) => {
      setGoalIds(nextGoalIds);
      if (nextGoalIds.length === 1 && nextGoalIds[0] === "retargeting") {
        setAudience((current) => ({
          ...current,
          stages: {
            prospecting: false,
            retarget: true,
            abandoners: true,
          },
        }));
      } else if (goalIds.includes("retargeting")) {
        setAudience((current) => ({
          ...current,
          stages: {
            prospecting: true,
            retarget: true,
            abandoners: true,
          },
        }));
      }
    },
    [goalIds],
  );
  const [budget, setBudget] = useState({
    mode: "daily",
    totalDailyCents: 0,
    totalLifetimeCents: 0,
    startsAt: null,
    endsAt: null,
    startsAtLocal: "",
    endsAtLocal: "",
    capCents: null,
    strategy: "auto",
    allowlist: null,
  });
  const [creative, setCreative] = useState({
    // ISSUE-995 [Campaign Builder creative] Wave 3 — media kind. "image" keeps
    // the existing byte-upload flow; "video" chooses a server-owned canonical
    // Creative Library row. Infrastructure ids and URLs are never operator
    // inputs.
    kind: "image",
    file: null,
    localPreviewUrl: null,
    publicUrl: null,
    path: null,
    // Video refs (kind === "video"):
    mp4MasterUrl: "",
    bunnyVideoId: "",
    posterUrl: null,
    posterPath: null,
    // Per-ratio pre-cropped variant slots (4:5 / 1:1 / 9:16 / 1.91:1) →
    // { source_url, storage_path } — probed server-side, rescues off-ratio masters.
    variants: {},
    stageCreativeIds: {
      prospecting: [],
      retarget: [],
      abandoners: [],
    },
    // #3697: TikTok-only is deliberately narrow and video-only. Pangle is an
    // explicit operator choice, never a silent placement broadening.
    tiktokPlacement: "tiktok",
    tiktokCreativeSource: "library",
    tiktokSparkPostIds: [],
    validation: null,
    creativeRow: null,
    aiGenerated: false,
    rightsConfirmed: false,
    rightsBasis: "owned",
    name: "",
  });
  // ISSUE-1184: server lifecycle is authoritative; this map is page-memory
  // presentation only and is reset whenever the recorded creative identity
  // changes. The queue runs exactly one request at a time.
  const [preparationRows, setPreparationRows] = useState({});
  const [, setPreparationRunningPlatform] = useState(null);
  const [copy, setCopy] = useState({
    primary: "",
    headline: "",
    description: "",
    cta: "BUY_TICKETS",
    platformCtas: {
      meta: "BUY_TICKETS",
      snapchat: "BUY_TICKETS",
      tiktok: "Get ticket now",
      reddit: "Buy Tickets",
    },
    googleHeadlines: ["", "", ""],
    googleDescriptions: ["", ""],
    keywords: [],
    negativeKeywords: [],
    // ISSUE-1282 [Google video bespoke copy] — a Google VIDEO (Demand Gen) ad can
    // carry operator-written long headlines (≤90) + an optional business name
    // (≤25). Empty by default → payload.js sends nothing and the create branch
    // derives the fallback (RSA headlines / title-cased brand slug), exactly as
    // before. Only surfaced in StepCopy on the Google-video path.
    googleLongHeadlines: [""],
    googleBusinessName: "",
  });
  const [specialAdCategory, setSpecialAdCategory] = useState("NONE");
  const [stageCreativeValidation, setStageCreativeValidation] = useState({
    ok: false,
    reason: "Choose stage creatives.",
    stages: {},
  });
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  // ── Create ──
  const [submitting, setSubmitting] = useState(false);
  const [validatingShapes, setValidatingShapes] = useState(false);
  const [createResults, setCreateResults] = useState(null);
  const [planPreview, setPlanPreview] = useState(null);
  const [broaderAccepted, setBroaderAccepted] = useState(false);
  const [launchPhrase, setLaunchPhrase] = useState("");
  // #3697: the visible create sequence (bind → fund → confirm → prepare →
  // create paused) and the last failure, kept on screen — never toast-only.
  const [createSteps, setCreateSteps] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [certificationState, setCertificationState] = useState(null);
  const [certificationApprovalReference, setCertificationApprovalReference] =
    useState("");
  const [certificationApprovalPhrase, setCertificationApprovalPhrase] =
    useState("");
  const [certificationApprovalBusy, setCertificationApprovalBusy] =
    useState(false);
  // One request_id per (platform, destination, wizard session) — server
  // idempotency replay. ISSUE-1002: the fan-out is per (platform × destination),
  // so the idempotency key gains the destination axis (a single-destination build
  // keeps exactly one request_id per platform, byte-identical to before).
  const requestIdsRef = useRef({});
  const requestIdFor = (platform, destSlot = "") => {
    const key = destSlot ? `${platform}::${destSlot}` : platform;
    if (!requestIdsRef.current[key]) {
      requestIdsRef.current[key] = crypto.randomUUID();
    }
    return requestIdsRef.current[key];
  };
  // ISSUE-1002: the shared fan-out group id, minted once per session and reused
  // across retries so every (platform × destination) row shares it. Only attached
  // when there is more than one destination — a single-destination build carries
  // no group (NULL), keeping that path byte-identical.

  useEffect(() => {
    if (draftHydrationStartedRef.current) return;
    draftHydrationStartedRef.current = true;
    const context = draftContextRef.current;
    replaceBuilderHash(context.id, STEPS[activeIndex].id);
    if (!context.shouldHydrate) {
      setDraftReady(true);
      setDraftSaveStatus("unsaved");
      return;
    }
    let mounted = true;
    getAdminAdPlanDraft(context.id).then(async ({ data, error }) => {
      if (!mounted) return;
      if (error) {
        const parsed = await parseEdgeError(error);
        if (parsed?.status === 404) {
          setDraftReady(true);
          setDraftSaveStatus("unsaved");
          return;
        }
        setDraftSaveStatus("error");
        addToast({
          variant: "error",
          title: "Draft could not be restored",
          description: adsErrorWords(parsed?.message, "Reload and try again."),
        });
        return;
      }
      const draft = data?.draft;
      const state = objectValue(draft?.draft_state);
      if (!state) {
        setDraftSaveStatus("error");
        return;
      }
      if (["consumer", "business"].includes(state.lane)) setLane(state.lane);
      if (Array.isArray(state.goal_ids)) setGoalIds(state.goal_ids);
      if (
        state.selected_platforms === null ||
        Array.isArray(state.selected_platforms)
      ) {
        setSelectedPlatforms(state.selected_platforms);
      }
      if (Array.isArray(state.destinations))
        setDestinations(state.destinations);
      if (objectValue(state.audience)) setAudience(state.audience);
      if (objectValue(state.budget)) setBudget(state.budget);
      if (objectValue(state.creative)) {
        setCreative((current) => ({
          ...current,
          ...state.creative,
          file: null,
          localPreviewUrl:
            state.creative.publicUrl ?? state.creative.posterUrl ?? null,
        }));
      }
      if (objectValue(state.copy)) setCopy(state.copy);
      if (typeof state.special_ad_category === "string") {
        setSpecialAdCategory(state.special_ad_category);
      }
      if (typeof state.name === "string") setName(state.name);
      if (typeof state.name_touched === "boolean") {
        setNameTouched(state.name_touched);
      }
      if (objectValue(state.preparation_rows)) {
        setPreparationRows(state.preparation_rows);
      }
      if (objectValue(state.plan_preview)) setPlanPreview(state.plan_preview);
      if (objectValue(state.certification_state)) {
        setCertificationState(state.certification_state);
      }
      if (typeof state.certification_approval_reference === "string") {
        setCertificationApprovalReference(
          state.certification_approval_reference,
        );
      }
      if (typeof state.broader_accepted === "boolean") {
        setBroaderAccepted(state.broader_accepted);
      }
      if (objectValue(state.create_results)) {
        setCreateResults(state.create_results);
      }
      if (objectValue(state.request_ids)) {
        requestIdsRef.current = state.request_ids;
      }
      const restoredIndex = STEPS.findIndex(
        (step) => step.id === draft.current_step,
      );
      if (restoredIndex >= 0) {
        setActiveIndex(restoredIndex);
        setMaxVisitedIndex(
          Math.max(
            restoredIndex,
            Number.isInteger(state.max_visited_index)
              ? state.max_visited_index
              : 0,
          ),
        );
        replaceBuilderHash(context.id, STEPS[restoredIndex].id);
      }
      draftRevisionRef.current = Number(draft.revision ?? 0);
      draftPlanIdRef.current = draft.plan_id ?? null;
      setDraftReady(true);
      setDraftSaveStatus("saved");
    });
    return () => {
      mounted = false;
    };
  }, [activeIndex, addToast]);

  useEffect(() => {
    if (
      !draftReady ||
      !isNewCreativeReuse ||
      !creativePresetId ||
      creativePresetStartedRef.current
    )
      return;
    creativePresetStartedRef.current = true;
    let mounted = true;
    (async () => {
      const { data, error } = await getAdCreativeForReuse(creativePresetId);
      if (!mounted) return;
      if (error || !data?.creative) {
        const parsed = await parseEdgeError(error);
        addToast({
          variant: "error",
          title: "Creative could not be reused",
          description: String(
            parsed?.message ??
              "Choose another asset from the Creative Library.",
          ),
        });
        return;
      }
      const row = data.creative;
      // #3697 — a library video's per-channel report comes with the reuse
      // answer (server-judged from stored probe facts). Video validation by
      // media URL was retired with the #3040 lane.
      const validated =
        row.kind === "video"
          ? { data: { validation: data.validation ?? null }, error: null }
          : await creativeUpload({
              action: "validate",
              kind: row.kind,
              name: row.name,
              source_url: row.source_url,
              storage_bucket: row.storage_bucket,
              storage_path: row.storage_path,
              variants: row.variants ?? {},
              ai_generated: row.ai_generated === true,
            });
      if (!mounted) return;
      if (validated.error) {
        const parsed = await parseEdgeError(validated.error);
        addToast({
          variant: "error",
          title: "Creative needs attention",
          description: String(
            parsed?.message ??
              "The saved media could not be revalidated. Nothing was created.",
          ),
        });
        return;
      }
      setCreative((current) => ({
        ...current,
        kind: row.kind,
        file: null,
        localPreviewUrl: row.poster_url ?? row.source_url ?? null,
        publicUrl: row.kind === "image" ? row.source_url : null,
        path: row.storage_path ?? null,
        mp4MasterUrl: row.mp4_master_url ?? "",
        bunnyVideoId: row.bunny_video_id ?? "",
        posterUrl: row.poster_url ?? null,
        posterPath: null,
        variants: row.variants ?? {},
        validation: validated.data?.validation ?? null,
        creativeRow: row,
        aiGenerated: row.ai_generated === true,
        rightsConfirmed: false,
        name: row.name ?? "",
      }));
      addToast({
        variant: "success",
        title: "Creative selected from the library",
        description:
          "Confirm paid-media rights for this campaign before review.",
      });
    })();
    return () => {
      mounted = false;
    };
  }, [addToast, creativePresetId, draftReady, isNewCreativeReuse]);

  const draftSnapshot = useMemo(
    () => ({
      active_step: STEPS[activeIndex].id,
      max_visited_index: maxVisitedIndex,
      lane,
      goal_ids: goalIds,
      selected_platforms: selectedPlatforms,
      destinations,
      audience,
      budget,
      creative: {
        ...creative,
        file: null,
        localPreviewUrl: null,
      },
      copy,
      special_ad_category: specialAdCategory,
      name,
      name_touched: nameTouched,
      preparation_rows: preparationRows,
      plan_preview: planPreview,
      certification_state: certificationState,
      certification_approval_reference: certificationApprovalReference,
      broader_accepted: broaderAccepted,
      create_results: createResults,
      // Typed LAUNCH/certification phrases are authorization, not draft data.
    }),
    [
      activeIndex,
      audience,
      broaderAccepted,
      budget,
      certificationApprovalReference,
      certificationState,
      copy,
      createResults,
      creative,
      destinations,
      goalIds,
      lane,
      maxVisitedIndex,
      name,
      nameTouched,
      planPreview,
      preparationRows,
      selectedPlatforms,
      specialAdCategory,
    ],
  );

  const persistDraft = useCallback(
    (snapshot = draftSnapshot, step = STEPS[activeIndex].id) => {
      if (!draftReady) return Promise.resolve();
      setDraftSaveStatus("saving");
      const save = async () => {
        const { data, error } = await saveAdminAdPlanDraft({
          draft_id: draftContextRef.current.id,
          expected_revision: draftRevisionRef.current,
          current_step: step,
          draft_state: {
            ...snapshot,
            active_step: step,
            request_ids: requestIdsRef.current,
          },
          plan_id: planPreview?.plan_id ?? draftPlanIdRef.current,
        });
        if (error) {
          const parsed = await parseEdgeError(error);
          setDraftSaveStatus(parsed?.status === 409 ? "conflict" : "error");
          return;
        }
        draftRevisionRef.current = Number(data?.draft?.revision ?? 0);
        draftPlanIdRef.current = data?.draft?.plan_id ?? draftPlanIdRef.current;
        setDraftSaveStatus("saved");
      };
      draftSaveChainRef.current = draftSaveChainRef.current
        .catch(() => undefined)
        .then(save);
      return draftSaveChainRef.current;
    },
    [activeIndex, draftReady, draftSnapshot, planPreview?.plan_id],
  );

  useEffect(() => {
    if (!draftReady) return undefined;
    const statusTimer = window.setTimeout(() => {
      setDraftSaveStatus((current) =>
        current === "saving" ? current : "unsaved",
      );
    }, 0);
    const timer = window.setTimeout(() => {
      void persistDraft();
    }, 1000);
    return () => {
      window.clearTimeout(statusTimer);
      window.clearTimeout(timer);
    };
  }, [draftReady, draftSnapshot, persistDraft]);

  const dirty = Boolean(
    destinations.length > 0 ||
    creative.publicUrl ||
    copy.primary ||
    budget.totalDailyCents > 0,
  );

  // ── Preflight + connections load ──
  const loadPreflight = useCallback(
    async (platform) => {
      if (platform) setRecheckBusy(platform);
      else setPreflightRunning(true);
      const { data, error } = await runPreflight(platform);
      if (error) {
        const parsed = await parseEdgeError(error);
        addToast({
          variant: "error",
          title: "Preflight failed",
          description: adsErrorWords(parsed?.message, ""),
        });
      } else if (platform) {
        const row = (data?.rows ?? [])[0];
        if (row) {
          setPreflightRows((prev) =>
            (prev ?? []).map((r) => (r.platform === platform ? row : r)),
          );
          addToast({
            variant: row.overall === "green" ? "success" : "warning",
            title:
              row.overall === "green"
                ? `${platform} is ready.`
                : `Still ${row.overall} — see the card.`,
          });
        }
      } else {
        setPreflightRows(data?.rows ?? []);
        const ready = (data?.rows ?? []).filter(
          (r) => r.overall === "green" || r.overall === "amber",
        ).length;
        addToast({
          variant: "info",
          title: `${ready} of ${(data?.rows ?? []).length} channels ready.`,
        });
      }
      if (platform) setRecheckBusy(null);
      else setPreflightRunning(false);
    },
    [addToast],
  );

  useEffect(() => {
    const preflightTimer = window.setTimeout(() => {
      void loadPreflight();
    }, 0);
    // Connection rows carry Meta's per-category floors (extra.minimum_budgets).
    (async () => {
      const loaded = {};
      for (const platform of [
        "meta",
        "google",
        "tiktok",
        "snapchat",
        "reddit",
      ]) {
        const { data } = await getConnection(platform, "consumer");
        if (data) loaded[platform] = data;
      }
      setConnections(loaded);
    })();
    return () => window.clearTimeout(preflightTimer);
  }, [loadPreflight]);

  // Deep-link ?step= (visited steps only — no forward skip).
  useEffect(() => {
    const applyHash = () => {
      const index = stepIndexFromHash();
      setActiveIndex((prev) => (index <= maxVisitedIndex ? index : prev));
    };
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [maxVisitedIndex]);

  const goalSignals = useMemo(
    () => ({
      metaPixelHasSignal: connections.meta?.extra?.pixel_has_signal === true,
      snapPurchaseEvents28d:
        preflightRows?.find((row) => row.platform === "snapchat")
          ?.purchase_events_28d ?? null,
      tiktokPurchaseEvents28d:
        preflightRows?.find((row) => row.platform === "tiktok")
          ?.purchase_events_28d ?? null,
    }),
    [connections.meta?.extra?.pixel_has_signal, preflightRows],
  );

  // ── The channel plan (the A4.0(1) output) ──
  // ISSUE-979 Bug 1: Meta's optimization_goal comes from the SAME coherent
  // resolution the create payload uses (objectiveResolver) — one Meta goal in
  // play, so the per-category budget floor here and the create pair never
  // disagree. (Traffic wins over awareness for the two live goals, in any click
  // order — the valid OUTCOME_TRAFFIC / LINK_CLICKS pair.)
  const metaGoal = resolveMetaObjective(goalIds, goalSignals).optimization_goal;
  // Lifetime: plan floors against the daily equivalent so channel eligibility
  // matches create-time D1 checks (not a zero daily while the total is large).
  const planningDailyCents = useMemo(() => {
    if (budget.mode === "lifetime") {
      const days = calendarDaysBetween(budget.startsAt, budget.endsAt);
      if (!days || days < 1) return 0;
      return Math.floor((budget.totalLifetimeCents || 0) / days);
    }
    return budget.totalDailyCents;
  }, [
    budget.mode,
    budget.totalDailyCents,
    budget.totalLifetimeCents,
    budget.startsAt,
    budget.endsAt,
  ]);
  const channelRows = useMemo(
    () =>
      planChannels({
        preflightRows: preflightRows ?? [],
        goalIds,
        countries: audience.countries,
        totalDailyCents: planningDailyCents,
        allowlist: budget.allowlist,
        connections,
        metaGoal,
        goalSignals,
      }),
    [
      preflightRows,
      goalIds,
      audience.countries,
      planningDailyCents,
      budget.allowlist,
      connections,
      metaGoal,
      goalSignals,
    ],
  );
  // ── ISSUE-986: the platform picker resolves the channel set ──
  // The candidate set (`channelRows`) is what the picker renders. The COMPLIANCE
  // guard drops any platform that can't declare an active special ad category
  // (only Meta can) — a special-category ad must never silently run un-declared
  // on TikTok/Snap/Reddit/Google. `plannedRows` folds the operator's selection
  // AND the compliance exclusions into `eligible`, so every downstream consumer
  // (splitBudget, StepCopy/Budget/Creative/Audience, launchSummary, create)
  // respects the picked set with no further wiring.
  const eligiblePlatforms = useMemo(
    () => channelRows.filter((r) => r.eligible).map((r) => r.platform),
    [channelRows],
  );
  const complianceExcluded = useMemo(
    () => complianceExclusions(specialAdCategory, eligiblePlatforms),
    [specialAdCategory, eligiblePlatforms],
  );
  const plannedRows = useMemo(
    () =>
      applyChannelSelection({
        channelRows,
        selectedPlatforms,
        excluded: complianceExcluded,
      }),
    [channelRows, selectedPlatforms, complianceExcluded],
  );
  // The effective selected+buildable platform ids (post eligibility + compliance).
  const effectivePlatforms = useMemo(
    () => plannedRows.filter((r) => r.eligible).map((r) => r.platform),
    [plannedRows],
  );

  // toward #3697 Wave 3 — money currency from ad_connections (not hardcoded USD).
  // #3697: budget-entry currency ignores the budget floor. Typing "30" passes
  // "3" first; that keystroke is below Meta's floor, which used to drop Meta,
  // make the currency unresolved and DISABLE the budget input mid-typing (the
  // saved draft froze at 300 minor units). The floor still blocks create via
  // the allocations, never via the currency.
  const currencyPlatforms = useMemo(
    () =>
      budgetCurrencyPlatforms({
        planInput: {
          preflightRows: preflightRows ?? [],
          goalIds,
          countries: audience.countries,
          allowlist: budget.allowlist,
          connections,
          metaGoal,
          goalSignals,
        },
        selectedPlatforms,
        excluded: complianceExcluded,
      }),
    [
      preflightRows,
      goalIds,
      audience.countries,
      budget.allowlist,
      connections,
      metaGoal,
      goalSignals,
      selectedPlatforms,
      complianceExcluded,
    ],
  );
  const planCurrency = useMemo(
    () => resolvePlanCurrency(connections, currencyPlatforms),
    [connections, currencyPlatforms],
  );
  // #3697: schedule times are wall-clock in a named zone (operator-chosen, or
  // the single targeted country's zone, e.g. Nigeria → Africa/Lagos).
  const scheduleZone = isValidTimeZone(budget.timeZone)
    ? budget.timeZone
    : defaultScheduleTimeZone(audience.countries);
  useEffect(() => {
    const startsAt = budget.startsAtLocal
      ? zonedLocalToIso(budget.startsAtLocal, scheduleZone)
      : null;
    const endsAt = budget.endsAtLocal
      ? zonedLocalToIso(budget.endsAtLocal, scheduleZone)
      : null;
    if (startsAt !== budget.startsAt || endsAt !== budget.endsAt) {
      const timer = window.setTimeout(() => {
        setBudget((current) => ({ ...current, startsAt, endsAt }));
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [
    scheduleZone,
    budget.startsAtLocal,
    budget.endsAtLocal,
    budget.startsAt,
    budget.endsAt,
  ]);
  const currencyBlockedReason = planCurrency.unresolved
    ? "Connect the selected ad account and load its billing currency before creating anything."
    : planCurrency.mixed
      ? "Selected ad accounts use different currencies. Split this into one campaign per billing currency."
      : null;

  const togglePlatform = useCallback(
    (platform) => {
      setSelectedPlatforms((prev) => {
        // Materialize the "all eligible" default on the first explicit toggle so
        // the operator owns the set from then on.
        const current = prev === null ? eligiblePlatforms : prev;
        return current.includes(platform)
          ? current.filter((p) => p !== platform)
          : [...current, platform];
      });
    },
    [eligiblePlatforms],
  );

  // Lifetime mode: split the daily equivalent so strategy/weights still apply,
  // then allocateLifetimeCents conserves the entered total at create.
  const allocations = useMemo(
    // ISSUE-986: split across the PICKED channel set (plannedRows) — never the
    // full eligible set. The picker is the single source of truth for who gets
    // funded; a deselected/compliance-excluded channel is already ineligible here.
    () =>
      splitBudget({
        totalDailyCents: planningDailyCents,
        channelRows: plannedRows,
        strategy: budget.strategy,
      }),
    [planningDailyCents, budget.strategy, plannedRows],
  );

  // ISSUE-980 [Campaign Builder clarity] finding #3: the SAME coherent
  // per-platform resolution runCreate uses for the actual create payload
  // (ISSUE-979's objectiveResolver), recomputed here (pure, cheap, byte-
  // identical for the same goalIds) purely for display — Review reads this
  // to show each channel's REAL resolved objective instead of one repeated
  // goal-label string. Never touches runCreate's own resolution.
  const resolvedGoalForDisplay = useMemo(
    () => resolveGoalForPayload(goalIds, goalSignals),
    [goalIds, goalSignals],
  );

  // ── ISSUE-995 [Campaign Builder creative] Wave 3 — PROCEED-WITH-PASSING ──
  // The funded set (allocations) partitioned into the channels this creative can
  // build NOW and the ones to exclude. `buildable` requires ok AND not
  // needs_transcode (reconciling the matrix `ok`-ignores-needs_transcode vs
  // resolveCreativeRef-blocks-needs_transcode mismatch), so a channel shown
  // "ready" can never fail at create. The build proceeds on `buildable` and
  // simply does not create the `excluded` ones — the backend create loop is
  // already per-channel independent.
  const fundedPlatforms = useMemo(
    () => allocations.map((a) => a.platform),
    [allocations],
  );
  const firstDestination = destinations[0] ?? null;
  const usesTikTokSpark =
    fundedPlatforms.includes("tiktok") &&
    creative.tiktokCreativeSource === "spark";
  const nonSparkFundedPlatforms = useMemo(
    () =>
      fundedPlatforms.filter(
        (platform) => !(usesTikTokSpark && platform === "tiktok"),
      ),
    [fundedPlatforms, usesTikTokSpark],
  );
  const sparkOnly = usesTikTokSpark && nonSparkFundedPlatforms.length === 0;
  const sparkDestinationSupported =
    !usesTikTokSpark ||
    ["event", "rsvp", "trip", "experience"].includes(
      firstDestination?.page_type,
    );
  const creativePartition = useMemo(() => {
    const libraryPartition = partitionFundedCreative({
      fundedPlatforms: nonSparkFundedPlatforms,
      channels: creative.validation?.channels ?? [],
      // ISSUE-995 REWORK: video ad create isn't wired yet (#997) — a video
      // creative excludes every funded channel (preview-only), so nothing
      // misleading builds.
      kind: creative.kind,
      preparationByPlatform: preparationRows,
      // v1.4: creative/placement validation decides whether a channel can be
      // planned. Native provider copies are created later, only after the
      // exact plan is funded, reviewed and launch-confirmed.
      requirePreparation: false,
    });
    if (!usesTikTokSpark) return libraryPartition;
    return {
      buildable: fundedPlatforms.filter(
        (platform) =>
          platform === "tiktok" ||
          libraryPartition.buildable.includes(platform),
      ),
      excluded: libraryPartition.excluded,
    };
  }, [
    fundedPlatforms,
    nonSparkFundedPlatforms,
    usesTikTokSpark,
    creative.validation,
    creative.kind,
    preparationRows,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreparationRows({});
      setPreparationRunningPlatform(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [creative.creativeRow?.id]);

  // ISSUE-1009 [partial-failure retry lockout] — the page owns completion
  // truth because it owns all three inputs. Expected create work is exactly the
  // current destinations × creative-buildable platforms; funded-but-excluded
  // channels and stale result keys cannot complete or permanently block Review.
  const allExpectedPairsSucceeded = useMemo(
    () =>
      areAllExpectedCreatePairsSuccessful({
        destinations,
        buildablePlatforms: creativePartition.buildable,
        createResults,
      }),
    [destinations, creativePartition.buildable, createResults],
  );

  // Auto-suggest the campaign name from the first destination (editable — §4.4).
  // ISSUE-1002: the base name is derived from the first selected destination; on a
  // multi-destination fan-out each ad's name is suffixed with its own destination
  // title in runCreate, so the created campaigns stay distinguishable.
  useEffect(() => {
    if (!nameTouched && firstDestination) {
      const timer = window.setTimeout(() => {
        setName(
          suggestCampaignName({
            brandName: firstDestination.brand_name,
            title: firstDestination.title,
          }),
        );
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [firstDestination, nameTouched]);

  const planFingerprint = useMemo(
    () =>
      JSON.stringify({
        lane,
        goals: goalIds,
        destination: firstDestination
          ? {
              page_type: firstDestination.page_type,
              brand_slug: firstDestination.brand_slug,
              slug: firstDestination.slug,
              url: firstDestination.dest_url,
            }
          : null,
        audience,
        budget,
        allocations,
        creative: creative.creativeRow?.id ?? creative.publicUrl ?? null,
        tiktokPlacement: creative.tiktokPlacement,
        tiktokCreativeSource: creative.tiktokCreativeSource,
        tiktokSparkPostIds: creative.tiktokSparkPostIds,
        stageCreativeIds: creative.stageCreativeIds,
        copy,
        specialAdCategory,
        name,
      }),
    [
      lane,
      goalIds,
      firstDestination,
      audience,
      budget,
      allocations,
      creative.creativeRow?.id,
      creative.publicUrl,
      creative.tiktokPlacement,
      creative.tiktokCreativeSource,
      creative.tiktokSparkPostIds,
      creative.stageCreativeIds,
      copy,
      specialAdCategory,
      name,
    ],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPlanPreview(null);
      setBroaderAccepted(false);
      setLaunchPhrase("");
      setCreateSteps(null);
      setCreateError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [planFingerprint]);

  // ── Per-step gate (Next disabled until the step is valid) ──
  const stepValid = (stepId) => {
    switch (stepId) {
      case "promote":
        // ISSUE-986: at least one platform must be healthy AND picked — the
        // picker can't proceed with an empty channel set. v1.4 also keeps goal
        // and deterministic destination in this same Promote stage.
        return (
          lane === "consumer" &&
          Boolean(preflightRows) &&
          preflightRows.some(
            (r) => r.overall === "green" || r.overall === "amber",
          ) &&
          effectivePlatforms.length > 0 &&
          goalIds.length > 0 &&
          destinations.length === 1
        );
      case "audience":
        return validateAudience(audience).length === 0;
      case "budget": {
        if (currencyBlockedReason) return false;
        const mode = budget.mode === "lifetime" ? "lifetime" : "daily";
        const amount =
          mode === "lifetime"
            ? budget.totalLifetimeCents
            : budget.totalDailyCents;
        if (mode === "lifetime" && !budget.endsAt) return false;
        const finiteCap = Number(budget.capCents);
        if (!Number.isSafeInteger(finiteCap) || finiteCap < (amount || 0))
          return false;
        return (
          validateBudget({
            totalDailyCents: amount || 0,
            channelRows,
            currency: planCurrency.currency,
          }).length === 0 && allocations.length > 0
        );
      }
      case "creative": {
        if (!sparkDestinationSupported) return false;
        // ISSUE-995: a video creative must be RECORDED (its bytes live off-
        // client, so the library row id is the only way to reference it);
        // an image can build from its inline public URL.
        const hasMedia =
          creative.kind === "video"
            ? Boolean(creative.creativeRow)
            : Boolean(creative.publicUrl);
        if (
          !creative.rightsConfirmed ||
          (!sparkOnly && (!hasMedia || !creative.validation))
        )
          return false;
        // #3697: every plan binds a creative-library row (ad-plan refuses
        // creative_library_id_required), so an image must be recorded with
        // "Use this creative" before Next — never discovered at create.
        if (!sparkOnly && !creative.creativeRow) return false;
        if (
          fundedPlatforms.includes("tiktok") &&
          !usesTikTokSpark &&
          creative.kind !== "video" &&
          creative.tiktokPlacement !== "tiktok_pangle"
        )
          return false;
        if (
          fundedPlatforms.some((platform) =>
            ["meta", "snapchat", "tiktok"].includes(platform),
          ) &&
          !stageCreativeValidation.ok
        )
          return false;
        // #3697 (design §9) — the Builder blocks a video that does not fit a
        // platform this campaign runs on; change platforms or pick another.
        // The server backstop is the ad-plan funding fit gate.
        if (creative.kind === "video" && creativePartition.excluded.length > 0)
          return false;
        // ISSUE-995 PROCEED-WITH-PASSING: Next is enabled as long as AT LEAST
        // ONE funded channel can build with this creative — the failing ones are
        // excluded and the build proceeds on the rest (was: every funded channel
        // had to pass, so one reject blocked the whole build).
        if (creativePartition.buildable.length === 0) return false;
        const funded =
          creative.kind === "video"
            ? creativePartition.buildable.filter(
                (platform) => platform !== "tiktok" || !usesTikTokSpark,
              )
            : nonSparkFundedPlatforms;
        const validation = validateCopy(copy, funded);
        return (
          funded.every((p) => (validation[p]?.hard ?? []).length === 0) &&
          (funded.length === 0 || copy.primary.trim().length > 0) &&
          specialAdCategory !== "CREDIT"
        );
      }
      default:
        return true;
    }
  };

  const nextDisabledReason = () => {
    const stepId = STEPS[activeIndex].id;
    if (stepValid(stepId)) return null;
    switch (stepId) {
      case "promote":
        if (
          effectivePlatforms.length === 0 &&
          preflightRows?.some(
            (r) => r.overall === "green" || r.overall === "amber",
          )
        )
          return "Pick at least one platform to build for.";
        if (!goalIds.length) return "Pick at least one goal.";
        if (destinations.length !== 1) {
          return "Pick one deterministic destination to promote.";
        }
        return "No channel can run an ad right now. Fix at least one blocker above to continue.";
      case "budget":
        return "Set a hard cap at or above the campaign budget.";
      case "creative": {
        if (!sparkDestinationSupported) {
          return "Spark Ads currently support event, RSVP, trip and experience pages only.";
        }
        const hasMedia =
          creative.kind === "video"
            ? Boolean(creative.creativeRow)
            : Boolean(creative.publicUrl);
        if (!sparkOnly && !hasMedia) {
          return creative.kind === "video"
            ? "Add the video and record it to the library first."
            : "Upload an ad image first.";
        }
        if (!sparkOnly && !creative.validation)
          return "Validate the creative first.";
        if (!creative.rightsConfirmed)
          return "Confirm the brand's right to use this creative in paid ads.";
        if (!sparkOnly && !creative.creativeRow) {
          return "Press “Use this creative” to record it to the library before continuing.";
        }
        if (
          fundedPlatforms.includes("tiktok") &&
          !usesTikTokSpark &&
          creative.kind !== "video" &&
          creative.tiktokPlacement !== "tiktok_pangle"
        ) {
          return "TikTok-only needs a video. Pick a video or choose TikTok + Pangle.";
        }
        if (
          fundedPlatforms.some((platform) =>
            ["meta", "snapchat", "tiktok"].includes(platform),
          ) &&
          !stageCreativeValidation.ok
        ) {
          return (
            stageCreativeValidation.reason ??
            "Choose 2–4 valid creatives for every enabled stage."
          );
        }
        if (
          creative.kind === "video" &&
          creativePartition.buildable.length === 0
        ) {
          return "The recorded video does not fit any funded channel. Fix the media or add a matching variant.";
        }
        if (creativePartition.buildable.length === 0) {
          return "No funded channel can run this creative. Fix a problem above, or add a variant, to build at least one.";
        }
        const funded =
          creative.kind === "video"
            ? creativePartition.buildable.filter(
                (platform) => platform !== "tiktok" || !usesTikTokSpark,
              )
            : nonSparkFundedPlatforms;
        const copyValidation = validateCopy(copy, funded);
        if (
          (funded.length > 0 && !copy.primary.trim()) ||
          funded.some(
            (platform) => (copyValidation[platform]?.hard ?? []).length > 0,
          )
        )
          return "Fix the copy problems below first.";
        if (specialAdCategory === "CREDIT") {
          return "Credit-category campaigns are not supported by this governed flow.";
        }
        return "Finish the creative, copy and policy checks.";
      }
      default:
        return "Finish this step first.";
    }
  };

  const goTo = (index) => {
    const nextStep = STEPS[index]?.id;
    if (!nextStep) return;
    const nextMaxVisited = Math.max(maxVisitedIndex, index);
    replaceBuilderHash(draftContextRef.current.id, nextStep);
    void persistDraft(
      {
        ...draftSnapshot,
        active_step: nextStep,
        max_visited_index: nextMaxVisited,
      },
      nextStep,
    );
    setActiveIndex(index);
    setMaxVisitedIndex(nextMaxVisited);
  };
  const jumpToStepId = (stepId) => {
    const target = STEP_ALIASES[stepId] ?? stepId;
    const index = STEPS.findIndex((s) => s.id === target);
    if (index >= 0) goTo(index);
  };

  const callPlan = async (payload) => {
    const { data, error } = await adPlanAction(payload);
    if (!error) return data;
    const parsed = await parseEdgeError(error);
    throw new Error(
      String(
        parsed?.body?.detail ??
          parsed?.body?.error ??
          parsed?.message ??
          "The immutable plan could not be prepared.",
      ),
    );
  };

  const prepareImmutablePlan = async (
    executionAllocations,
    capByPlatform,
    executionPayloads,
  ) => {
    if (
      planPreview?.status === "ready" &&
      planPreview.fingerprint === planFingerprint
    ) {
      return planPreview;
    }
    if (
      planPreview?.status === "blocked" &&
      planPreview.fingerprint === planFingerprint
    )
      return planPreview;
    if (
      planPreview?.status === "broader" &&
      planPreview.fingerprint === planFingerprint &&
      !broaderAccepted
    )
      return planPreview;

    const nativeAppDestination = ["explorer_app", "host_app"].includes(
      firstDestination.page_type,
    );
    const destinationFamily =
      firstDestination.page_type === "marketing"
        ? "marketing_page"
        : nativeAppDestination
          ? firstDestination.page_type
          : "public_mingla_page";
    const destinationKey =
      firstDestination.page_type === "marketing" || nativeAppDestination
        ? firstDestination.slug
        : [
            firstDestination.page_type,
            firstDestination.brand_slug,
            firstDestination.page_type === "brand"
              ? null
              : firstDestination.slug,
          ]
            .filter(Boolean)
            .join(":");
    let planId =
      planPreview?.fingerprint === planFingerprint ? planPreview.plan_id : null;
    if (!planId) {
      const opened = await callPlan({
        action: "open",
        client_kind: "admin",
        owner_kind: "mingla",
        destination_family: destinationFamily,
        destination_key: destinationKey,
      });
      planId = opened?.plan?.id;
    }
    if (!planId) throw new Error("The server did not return a plan ID.");
    draftPlanIdRef.current = planId;

    const audienceIntent = audienceIntentFromState(audience);
    const platforms = executionAllocations.map((row) => row.platform);
    const broaderAcceptance = Object.fromEntries(
      platforms.map((platform) => [platform, broaderAccepted]),
    );
    const versioned = await callPlan({
      action: "create_version",
      plan_id: planId,
      canonical_plan: {
        name,
        lane,
        budget_mode: budget.mode === "lifetime" ? "lifetime" : "daily",
        ...(certificationMode ? { certification_mode: true } : {}),
        goal_ids: goalIds,
        schedule: {
          starts_at: budget.startsAt,
          ends_at: budget.endsAt,
          time_zone: scheduleZone,
        },
        audience_intent: audienceIntent,
        stage_selection: audience.stages ?? {
          prospecting: true,
          retarget: true,
          abandoners: true,
        },
        stage_creative_ids: creative.stageCreativeIds,
        ...(creative.tiktokCreativeSource === "spark"
          ? { tiktok_spark_post_ids: creative.tiktokSparkPostIds }
          : {}),
        creative_library_id: creative.creativeRow?.id ?? null,
        creative_url: creative.kind === "image" ? creative.publicUrl : null,
        media_rights: {
          rights_confirmed: creative.rightsConfirmed,
          rights_basis: creative.rightsBasis,
          ai_generated: creative.aiGenerated,
        },
        copy,
        special_ad_category: specialAdCategory,
        confirmation_phrase: "CREATE PAUSED",
        broader_acceptance: broaderAcceptance,
        execution_payloads: executionPayloads,
      },
      provider_allocations: executionAllocations.map((allocation) => ({
        platform: allocation.platform,
        connection_id: connections[allocation.platform]?.id,
        host_budget_cents: capByPlatform.get(allocation.platform),
        // The immutable delivery amount must be the exact amount sent to the
        // provider: per-day for daily campaigns, total for lifetime campaigns.
        host_delivery_budget_cents:
          budget.mode === "lifetime"
            ? capByPlatform.get(allocation.platform)
            : allocation.dailyCents,
      })),
    });
    const versionId = versioned?.version?.id;
    const planHash = versioned?.version?.plan_hash;
    const measurement = versioned?.version?.canonical_plan?.measurement ?? null;
    const mediaRights =
      versioned?.version?.canonical_plan?.media_rights ?? null;
    if (!versionId || !planHash) {
      throw new Error("The server did not return an immutable plan binding.");
    }
    const frozen = await callPlan({
      action: "freeze_targeting",
      plan_version_id: versionId,
      audience_intent: audienceIntent,
      refs_by_platform: targetingRefsFromState(audience, platforms),
    });
    const targetingSnapshots = frozen?.targeting_snapshots ?? [];
    const hardBlocks = targetingSnapshots.filter(
      (row) =>
        row.verdict === "unavailable" || row.verdict === "check_required",
    );
    const broaderRows = targetingSnapshots.filter(
      (row) => row.verdict === "broader" && row.broader_accepted !== true,
    );
    if (hardBlocks.length > 0) {
      const preview = {
        status: "blocked",
        fingerprint: planFingerprint,
        plan_id: planId,
        plan_version_id: versionId,
        plan_hash: planHash,
        targeting_snapshots: targetingSnapshots,
        measurement,
        media_rights: mediaRights,
      };
      setPlanPreview(preview);
      return preview;
    }
    if (broaderRows.length > 0) {
      const preview = {
        status: "broader",
        fingerprint: planFingerprint,
        plan_id: planId,
        plan_version_id: versionId,
        plan_hash: planHash,
        targeting_snapshots: targetingSnapshots,
        measurement,
        media_rights: mediaRights,
      };
      setPlanPreview(preview);
      return preview;
    }
    await callPlan({
      action: "mark_ready",
      plan_version_id: versionId,
      plan_hash: planHash,
    });
    const preview = {
      status: "ready",
      fingerprint: planFingerprint,
      plan_id: planId,
      plan_version_id: versionId,
      plan_hash: planHash,
      targeting_snapshots: targetingSnapshots,
      measurement,
      media_rights: mediaRights,
      funded: false,
      confirmed: false,
    };
    setPlanPreview(preview);
    return preview;
  };

  const loadCertificationCell = async () => {
    if (!certificationMode) return null;
    const { data, error } = await appCertificationAction({
      action: "load",
      app_key: certificationContext.appKey,
      os: certificationContext.os,
      provider: certificationContext.provider,
    });
    if (error) {
      const parsed = await parseEdgeError(error);
      throw new Error(
        String(
          parsed?.body?.detail ??
            parsed?.message ??
            "Certification state unavailable.",
        ),
      );
    }
    setCertificationState(data?.canary ?? null);
    return data?.canary ?? null;
  };

  const approveCertification = async () => {
    if (
      !certificationState ||
      certificationState.status !== "approval_required"
    ) {
      return;
    }
    setCertificationApprovalBusy(true);
    const { data, error } = await appCertificationAction({
      action: "approve",
      app_key: certificationContext.appKey,
      os: certificationContext.os,
      provider: certificationContext.provider,
      expected_canary_version: certificationState.canary_version,
      idempotency_key: crypto.randomUUID(),
      reason: "Approve this exact bounded native-app certification canary.",
      approval_reference: certificationApprovalReference.trim(),
      confirm_phrase: certificationApprovalPhrase,
    });
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({
        variant: "error",
        title: "Certification approval failed",
        description: String(
          parsed?.body?.detail ??
            parsed?.message ??
            "The exact approval was not accepted.",
        ),
      });
    } else {
      setCertificationState(data?.canary ?? null);
      addToast({
        variant: "success",
        title: "Exact certification scope approved",
        description:
          "The approval expires in 24 hours. The next step can only create paused provider objects.",
      });
    }
    setCertificationApprovalBusy(false);
  };

  // ── Create (paused) — one call per (destination × funded channel); NEVER launches ──
  const runCreate = async ({ validateOnly }) => {
    if (currencyBlockedReason) {
      addToast({
        variant: "error",
        title: "Currency setup is incomplete",
        description: currencyBlockedReason,
      });
      return;
    }
    // #3697: the typed phrase is checked BEFORE anything is bound, and the
    // field is visible before the first click. It used to be checked only
    // after the plan was bound and marked ready, so the first click silently
    // left a ready_for_funding plan behind with no funding, no provider call
    // and a disabled button.
    if (!validateOnly && launchPhrase !== CREATE_PAUSED_PHRASE) {
      const message = `Type ${CREATE_PAUSED_PHRASE} in the confirmation field, then press Create again. Nothing was created.`;
      setCreateError({ title: "Confirmation phrase required", message });
      addToast({
        variant: "warning",
        title: `Type ${CREATE_PAUSED_PHRASE} to continue`,
        description: message,
      });
      return;
    }
    if (validateOnly) setValidatingShapes(true);
    else setSubmitting(true);
    const results = { ...(createResults ?? {}) };
    const executionAllocations = allocations.filter((row) =>
      creativePartition.buildable.includes(row.platform),
    );
    const totalCap =
      budget.mode === "lifetime"
        ? Number(budget.totalLifetimeCents)
        : Number(budget.capCents);
    const capByPlatform = new Map(
      allocateLifetimeCents(executionAllocations, totalCap).map((row) => [
        row.platform,
        row.amountCents,
      ]),
    );
    let immutablePlan = null;
    // ISSUE-979 Bug 1: resolve every platform's objective AND optimization_goal
    // ONCE, coherently, from the whole selected goal set (single source of
    // truth) — never goalIds[0] for one field and the full array for another.
    // Each platform's pair now comes from a single goals.js entry, so the Meta
    // objective/optimization_goal pairing is always valid, in any click order.
    const resolvedGoal = resolveGoalForPayload(goalIds, goalSignals);
    // ISSUE-995 PROCEED-WITH-PASSING: skip funded channels this creative can't
    // build (reject or unresolved needs_transcode). The backend loop is already
    // per-channel independent — we simply don't issue their create call.
    const creativeExcluded = new Set(
      creativePartition.excluded.map((e) => e.platform),
    );
    // ISSUE-1002 [multi-destination fan-out] — the DESTINATION axis is the OUTER
    // loop around the existing per-platform allocations loop, so one campaign fans
    // out to one ad per (destination × platform), each with its own landing URL
    // and pid attribution. A single-destination selection runs exactly one
    // destination iteration, keyed by bare platform → byte-identical to before.
    // toward #3697 Wave 2 (#3707): one destination per create — never silent budget multiply.
    if (destinations.length > 1) {
      addToast({
        variant: "error",
        title: "One page per campaign",
        description:
          "Pick a single destination. Create a separate campaign for another page.",
      });
      if (validateOnly) setValidatingShapes(false);
      else setSubmitting(false);
      return;
    }
    if (budget.mode === "lifetime" && !budget.endsAt) {
      addToast({
        variant: "error",
        title: "End date required",
        description: "A total (lifetime) budget needs an end date.",
      });
      if (validateOnly) setValidatingShapes(false);
      else setSubmitting(false);
      return;
    }
    if (
      budget.mode === "lifetime" &&
      allocations.some((a) => a.platform !== "meta")
    ) {
      addToast({
        variant: "error",
        title: "Lifetime is Meta-only",
        description:
          "Deselect other platforms or switch to Daily before creating.",
      });
      if (validateOnly) setValidatingShapes(false);
      else setSubmitting(false);
      return;
    }
    // Legacy multi-destination plans carried one group id across their fan-out.
    // v1.4 creates one deterministic destination per campaign, so the same
    // payload seam remains explicit and intentionally null.
    const groupId = null;
    // Conserve the admin-entered lifetime total (avoid floor(total/days)*days loss).
    const lifetimeByPlatform =
      budget.mode === "lifetime"
        ? new Map(
            allocateLifetimeCents(
              executionAllocations,
              budget.totalLifetimeCents || 0,
            ).map((row) => [row.platform, row.amountCents]),
          )
        : null;
    const buildExecutionPayload = (allocation, dest) => {
      const platform = allocation.platform;
      const destSlot = `${dest.page_type}:${dest.id}`;
      const lifetimeAmount = lifetimeByPlatform?.get(platform) ?? null;
      return buildCreatePayload(platform, {
        lane,
        name:
          name ||
          suggestCampaignName({
            brandName: dest.brand_name,
            title: dest.title,
          }),
        goal: resolvedGoal,
        destination: {
          page_type: dest.page_type,
          brand_slug: dest.brand_slug,
          entity_slug: dest.page_type === "brand" ? null : dest.slug,
        },
        destinationGroupId: groupId,
        audience,
        budget: {
          dailyCentsForChannel: allocation.dailyCents,
          mode: budget.mode === "lifetime" ? "lifetime" : "daily",
          amountCents:
            budget.mode === "lifetime" && lifetimeAmount != null
              ? lifetimeAmount
              : allocation.dailyCents,
          capCents:
            budget.mode === "lifetime" && lifetimeAmount != null
              ? (capByPlatform.get(platform) ?? lifetimeAmount)
              : (capByPlatform.get(platform) ?? null),
          startsAt: budget.startsAt,
          endsAt: budget.endsAt,
          currency: planCurrency.currency,
        },
        creative: {
          kind: creative.kind,
          imageUrl: creative.publicUrl,
          aiGenerated: creative.aiGenerated,
          creativeLibraryId: creative.creativeRow?.id ?? null,
          brandName: dest.brand_name ?? null,
          tiktokPlacement: creative.tiktokPlacement,
          tiktokCreativeSource: creative.tiktokCreativeSource,
          tiktokSparkPostIds: creative.tiktokSparkPostIds,
        },
        copy,
        specialAdCategory,
        requestId: requestIdFor(platform, destSlot),
        validateOnly,
      });
    };
    const executionPayloads = Object.fromEntries(
      executionAllocations.map((allocation) => [
        allocation.platform,
        buildExecutionPayload(allocation, firstDestination),
      ]),
    );
    // #3697: visible progress for every required step, in order.
    let steps = null;
    let runningStepId = null;
    const markStep = (id, state, detail = null) => {
      if (!steps) return;
      steps = setStepState(steps, id, state, detail);
      runningStepId =
        state === "running" ? id : runningStepId === id ? null : runningStepId;
      setCreateSteps(steps);
    };
    const failCreate = (title, rawMessage) => {
      // #4130: the create error line never shows the generic edge text.
      const message = adsErrorWords(rawMessage);
      if (runningStepId) markStep(runningStepId, "failed", message);
      setCreateError({ title, message });
    };
    // #3697: a video prepares on every platform; an image prepares only where
    // the provider needs its own uploaded copy (Snapchat media id).
    const preparePlatforms = preparationPlatformsFor({
      platforms:
        creative.kind === "video"
          ? executionAllocations
              .map((row) => row.platform)
              .filter((platform) => platform !== "tiktok" || !usesTikTokSpark)
          : executionAllocations
              .map((row) => row.platform)
              .filter((platform) => !creativeExcluded.has(platform)),
      kind: creative.kind,
    });
    if (!validateOnly) {
      steps = initialStepStates(
        housePlanCreateSteps({
          platforms: executionAllocations
            .map((row) => row.platform)
            .filter((platform) => !creativeExcluded.has(platform)),
          isVideo: creative.kind === "video",
          isImage: creative.kind === "image",
        }).filter((step) => !(usesTikTokSpark && step.id === "prepare:tiktok")),
      );
      setCreateSteps(steps);
      setCreateError(null);
    }
    if (!validateOnly) {
      try {
        markStep("bind", "running");
        immutablePlan = await prepareImmutablePlan(
          executionAllocations,
          capByPlatform,
          executionPayloads,
        );
        if (immutablePlan.status !== "ready") {
          failCreate(
            immutablePlan.status === "broader"
              ? "Review the targeting differences"
              : "The plan has targeting blockers",
            immutablePlan.status === "broader"
              ? "Accept each named provider widening below, then press Create again."
              : "Return to Audience and resolve the provider checks shown in Review. Nothing was funded or created.",
          );
          addToast({
            variant: immutablePlan.status === "broader" ? "warning" : "error",
            title:
              immutablePlan.status === "broader"
                ? "Review the targeting differences"
                : "The plan has targeting blockers",
            description:
              immutablePlan.status === "broader"
                ? "Accept each named provider widening, then prepare the bound plan again."
                : "Return to Audience and resolve the provider checks shown in Review.",
          });
          setSubmitting(false);
          return;
        }
        markStep("bind", "done", immutablePlan.plan_hash ?? null);
        markStep("fund", "running");
        if (!immutablePlan.funded) {
          await callPlan({
            action: "fund",
            plan_version_id: immutablePlan.plan_version_id,
            plan_hash: immutablePlan.plan_hash,
          });
        }
        markStep("fund", "done");
        markStep("confirm", "running");
        // Reconfirm idempotently on every real create attempt. Besides binding
        // the exact phrase/hash, the server uses this to move a durable partial
        // failure back into creating_paused_objects before an idempotent retry.
        await callPlan({
          action: "confirm_launch",
          plan_version_id: immutablePlan.plan_version_id,
          plan_hash: immutablePlan.plan_hash,
          phrase: launchPhrase,
        });
        immutablePlan = { ...immutablePlan, funded: true, confirmed: true };
        setPlanPreview(immutablePlan);
        markStep("confirm", "done");
        if (certificationMode) {
          let cell = await loadCertificationCell();
          const samePlan =
            cell?.plan_version_id === immutablePlan.plan_version_id &&
            cell?.plan_hash === immutablePlan.plan_hash;
          if (
            cell &&
            !samePlan &&
            !["not_started", "expired", "failed"].includes(cell.status)
          ) {
            const { data: expired, error: expireError } =
              await appCertificationAction({
                action: "expire",
                app_key: certificationContext.appKey,
                os: certificationContext.os,
                provider: certificationContext.provider,
                expected_canary_version: cell.canary_version,
                idempotency_key: crypto.randomUUID(),
                reason:
                  "Replace the prior unspent certification scope with this plan.",
              });
            if (expireError) {
              throw new Error(
                "The prior certification scope must be stopped or completed before it can be replaced.",
              );
            }
            cell = expired?.canary ?? null;
            setCertificationState(cell);
          }
          if (
            !cell ||
            !samePlan ||
            ["not_started", "expired", "failed"].includes(cell.status)
          ) {
            const { data: requested, error: requestError } =
              await appCertificationAction({
                action: "request_approval",
                app_key: certificationContext.appKey,
                os: certificationContext.os,
                provider: certificationContext.provider,
                expected_canary_version: cell?.canary_version ?? 1,
                idempotency_key: crypto.randomUUID(),
                reason:
                  "Request approval for this exact bounded native-app certification canary.",
                plan_version_id: immutablePlan.plan_version_id,
                plan_hash: immutablePlan.plan_hash,
              });
            if (requestError) {
              const parsed = await parseEdgeError(requestError);
              throw new Error(
                String(
                  parsed?.body?.detail ??
                    parsed?.message ??
                    "Certification approval could not be requested.",
                ),
              );
            }
            cell = requested?.canary ?? null;
            setCertificationState(cell);
          }
          if (cell?.status === "approval_required") {
            addToast({
              variant: "info",
              title: "Exact owner approval required",
              description:
                "Review the app, provider, currency and hard cap below. No provider object has been created.",
            });
            setSubmitting(false);
            return;
          }
          if (cell?.status !== "approved_to_prepare") {
            throw new Error(
              `Certification is ${cell?.status ?? "unavailable"}; it cannot create new provider objects.`,
            );
          }
        }
        if (preparePlatforms.length > 0) {
          try {
            await prepareBoundVideoCreative({
              creativeLibraryId: creative.creativeRow?.id,
              platforms: preparePlatforms,
              noun: creative.kind,
              lane,
              planVersionId: immutablePlan.plan_version_id,
              planHash: immutablePlan.plan_hash,
              onProgress: (platform, row) => {
                markStep(
                  `prepare:${platform}`,
                  row?.state === "ready" ? "done" : "running",
                  row?.state === "ready"
                    ? null
                    : `Provider state: ${row?.state ?? "pending"}`,
                );
                setPreparationRunningPlatform(platform);
                setPreparationRows((current) => ({
                  ...current,
                  [platform]: row,
                }));
              },
            });
          } catch (error) {
            if (error?.platform) {
              markStep(`prepare:${error.platform}`, "running");
              await adPlanAction({
                action: "record_create_failure",
                plan_version_id: immutablePlan.plan_version_id,
                plan_hash: immutablePlan.plan_hash,
                platform: error.platform,
                error_detail: error.message,
              });
            }
            throw error;
          } finally {
            setPreparationRunningPlatform(null);
          }
        }
      } catch (error) {
        const message = adsErrorWords(error instanceof Error ? error.message : String(error));
        failCreate("Plan preparation failed", message);
        addToast({
          variant: "error",
          title: "Plan preparation failed",
          description: message,
        });
        setSubmitting(false);
        return;
      }
    }
    const multiDest = false;
    for (const dest of destinations) {
      const destSlot = `${dest.page_type}:${dest.id}`;
      for (const allocation of executionAllocations) {
        const platform = allocation.platform;
        const resultKey = multiDest ? `${platform}::${destSlot}` : platform;
        const meta = { platform, destTitle: dest.title, multiDest };
        if (results[resultKey]?.campaign) continue; // idempotent per session
        if (creativeExcluded.has(platform)) continue; // excluded — build the passing ones
        const payload = buildExecutionPayload(allocation, dest);
        if (immutablePlan) {
          payload.plan_version_id = immutablePlan.plan_version_id;
          payload.plan_hash = immutablePlan.plan_hash;
        }
        if (
          validateOnly &&
          creative.kind === "video" &&
          !(usesTikTokSpark && platform === "tiktok")
        ) {
          results[resultKey] = {
            ...meta,
            validated: true,
            validated_layers: ["canonical_video_bytes", "placement_matrix"],
            skipped_layers: ["provider_native_shape_requires_confirmed_plan"],
          };
          setCreateResults({ ...results });
          continue;
        }
        if (!validateOnly) markStep(`create:${platform}`, "running");
        const { data, error } = await createCampaign(payload);
        if (error) {
          const parsed = await parseEdgeError(error);
          if (!validateOnly) {
            failCreate(
              `${platform} create failed`,
              String(
                typeof parsed?.body?.detail === "string"
                  ? parsed.body.detail
                  : (parsed?.body?.detail?.message ??
                      parsed?.message ??
                      "Create failed."),
              ),
            );
          }
          if (!validateOnly && immutablePlan) {
            await adPlanAction({
              action: "record_create_failure",
              plan_version_id: immutablePlan.plan_version_id,
              plan_hash: immutablePlan.plan_hash,
              platform,
              error_detail: String(
                parsed?.body?.detail ?? parsed?.message ?? "Create failed.",
              ),
            });
          }
          results[resultKey] = {
            ...meta,
            ...(validateOnly ? { validateOnly: true } : {}),
            error: {
              code: parsed?.body?.error,
              message:
                typeof parsed?.body?.detail === "string"
                  ? parsed.body.detail
                  : (parsed?.body?.detail?.message ??
                    parsed?.message ??
                    "Create failed."),
              trace: parsed?.body?.detail?.trace_id ?? null,
            },
          };
        } else {
          // ISSUE-979 Bug 2: only "Created" when something was actually created or
          // validated. TikTok/Snap/Reddit have no validate-only mode and return
          // { validated: false, skipped_layers } to a validate_only call — that is
          // NOT a create, so it must never fire the "Created" toast.
          const outcome = classifyCreateResult(data);
          const destLabel = multiDest ? ` → ${dest.title}` : "";
          if (outcome.outcome === "validated") {
            results[resultKey] = {
              ...meta,
              validated: true,
              validated_layers: outcome.validatedLayers,
              skipped_layers: outcome.skippedLayers,
            };
          } else if (outcome.outcome === "created") {
            results[resultKey] = { ...meta, campaign: outcome.campaign };
            markStep(
              `create:${platform}`,
              "done",
              "Paused. Nothing is spending.",
            );
            if (certificationMode) {
              await loadCertificationCell().catch(() => null);
            }
            addToast({
              variant: "success",
              title: `Created on ${platform}${destLabel}. Nothing is spending yet.`,
            });
          } else {
            if (!validateOnly && immutablePlan) {
              await adPlanAction({
                action: "record_create_failure",
                plan_version_id: immutablePlan.plan_version_id,
                plan_hash: immutablePlan.plan_hash,
                platform,
                error_detail: "Provider create returned no campaign object.",
              });
              failCreate(
                `${platform}: nothing was created`,
                "The provider returned no campaign object. The failure is recorded on the plan; press Create again to retry it.",
              );
            }
            // Honest "nothing happened": no dry-run exists on this platform (or the
            // create returned no object). Record it truthfully — never a false
            // "Created" — so Review shows the honest state.
            results[resultKey] = {
              ...meta,
              noPlatformValidate: true,
              skipped_layers: outcome.skippedLayers,
              detail: outcome.detail,
            };
            addToast({
              variant: "info",
              title: `${platform}${destLabel}: nothing was created or validated.`,
              description: validateOnly
                ? "This platform has no dry-run, so the real create is its first check. Use “Create campaign (paused)” to build it."
                : "The platform returned no object — check the card for details.",
            });
          }
        }
        setCreateResults({ ...results });
      }
    }
    if (validateOnly) setValidatingShapes(false);
    else setSubmitting(false);
  };

  const summary = buildLaunchSummary({
    channelRows: plannedRows,
    allocations: allocations.filter((a) =>
      creativePartition.buildable.includes(a.platform),
    ),
    goalIds,
    resolvedGoal: resolvedGoalForDisplay,
    destinations: destinations.map((d) => ({
      title: d.title,
      dest_url: d.dest_url,
    })),
    creative: sparkOnly
      ? {
          kind: "video",
          name: `@usemingla Spark posts (${(creative.tiktokSparkPostIds ?? []).length})`,
        }
      : (creative.kind === "video" ? creative.creativeRow : creative.publicUrl)
        ? {
            kind: creative.kind,
            name: creative.name,
            width: creative.validation?.probe?.width,
            height: creative.validation?.probe?.height,
          }
        : null,
    copyCheck: (() => {
      const funded = nonSparkFundedPlatforms;
      const validation = validateCopy(copy, funded);
      const copyHardBlocks = funded.reduce(
        (n, p) => n + (validation[p]?.hard ?? []).length,
        0,
      );
      const copyText = [copy.primary, copy.headline, copy.description]
        .filter(Boolean)
        .join("\n");
      const { personalAttributes, dating, alcohol } = runPolicyPrecheck({
        copyText,
        channelSet: funded,
      });
      return {
        copyHardBlocks,
        policyFindings:
          personalAttributes.length + (dating ? 1 : 0) + (alcohol ? 1 : 0),
      };
    })(),
    totalDailyCents:
      budget.mode === "lifetime"
        ? (budget.totalLifetimeCents ?? budget.totalDailyCents)
        : budget.totalDailyCents,
    preparationByPlatform: preparationRows,
    // toward #3697 Wave 3 — Review mirrors server hard-cap / schedule.
    budgetMode: budget.mode,
    capCents:
      budget.mode === "lifetime"
        ? (budget.totalLifetimeCents ?? budget.capCents)
        : budget.capCents,
    startsAt: budget.startsAt,
    endsAt: budget.endsAt,
    currency: planCurrency.currency,
    timeZone: scheduleZone,
  });

  const stepId = STEPS[activeIndex].id;
  const disabledReason = nextDisabledReason();
  const goBack = () => goTo(activeIndex - 1);

  if (adsConsoleReady && !adsConsoleEnabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Campaign Builder" />
        <AlertCard variant="info" title="Ads console is off">
          Campaign Builder is gated by{" "}
          <code className="text-xs">enable_ads_console</code>. Turn it on in
          admin_config, or use{" "}
          <a className="underline" href="#/ad-engine">
            Ad Engine
          </a>{" "}
          for connections.
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaign Builder"
        description="Five resumable stages produce one immutable, provider-specific plan. Provider objects remain paused until every control gate passes."
        actions={
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span aria-live="polite">
              {draftSaveStatus === "loading"
                ? "Restoring draft…"
                : draftSaveStatus === "saving"
                  ? "Saving…"
                  : draftSaveStatus === "saved"
                    ? "Saved to Mingla"
                    : draftSaveStatus === "conflict"
                      ? "Newer draft found"
                      : draftSaveStatus === "error"
                        ? "Draft save failed"
                        : "Changes not saved yet"}
            </span>
            {draftSaveStatus === "conflict" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => window.location.reload()}
              >
                Reload newer draft
              </Button>
            )}
            {draftSaveStatus === "error" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void persistDraft()}
              >
                Retry save
              </Button>
            )}
          </div>
        }
      />
      <Stepper
        steps={STEPS}
        activeIndex={activeIndex}
        maxVisitedIndex={maxVisitedIndex}
        onJump={(index) => {
          if (
            index < activeIndex &&
            dirty &&
            stepId === "review" &&
            createResults
          ) {
            setPendingJump(index);
          } else {
            goTo(index);
          }
        }}
      />

      {/* ISSUE-980 [Campaign Builder clarity] finding #1(b): a fixed
          minmax(0,720px)_320px first track left-anchored the builder and
          stranded unclaimed width on the right on wide monitors (ISSUE-977
          Lane A F-6). A flexible first track (matching the existing
          ScoreTunerPanel.jsx lg:grid-cols-[1fr_372px] two-column idiom) fills
          the whole width AppShell already centers, so no leftover strip
          remains and the padding around the builder stays balanced. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        <div className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl p-5">
          {stepId === "promote" && (
            <div className="space-y-8">
              <section className="space-y-3" aria-labelledby="promote-lane">
                <h2 id="promote-lane" className="text-base font-semibold">
                  Advertiser and payer
                </h2>
                <StepLane lane={lane} onLaneChange={setLane} />
              </section>
              <section
                className="space-y-3 border-t border-[var(--gray-100)] pt-6"
                aria-labelledby="promote-channels"
              >
                <h2 id="promote-channels" className="text-base font-semibold">
                  Connected platforms
                </h2>
                <StepPreflight
                  rows={preflightRows}
                  running={preflightRunning}
                  recheckBusy={recheckBusy}
                  onRecheck={(platform) => loadPreflight(platform)}
                  onRecheckAll={() => loadPreflight()}
                  channelRows={channelRows}
                  selectedPlatforms={effectivePlatforms}
                  onTogglePlatform={togglePlatform}
                  complianceExcluded={complianceExcluded}
                  specialAdCategory={specialAdCategory}
                />
              </section>
              <section
                className="space-y-3 border-t border-[var(--gray-100)] pt-6"
                aria-labelledby="promote-goal"
              >
                <h2 id="promote-goal" className="text-base font-semibold">
                  Result
                </h2>
                <StepGoal
                  goalIds={goalIds}
                  onGoalsChange={handleGoalsChange}
                  metaPixelHasSignal={goalSignals.metaPixelHasSignal}
                  snapPurchaseEvents28d={goalSignals.snapPurchaseEvents28d}
                  tiktokPurchaseEvents28d={goalSignals.tiktokPurchaseEvents28d}
                />
              </section>
              <section
                className="space-y-3 border-t border-[var(--gray-100)] pt-6"
                aria-labelledby="promote-destination"
              >
                <h2
                  id="promote-destination"
                  className="text-base font-semibold"
                >
                  Destination
                </h2>
                <StepDestination
                  destinations={destinations}
                  onDestinationsChange={setDestinations}
                  platforms={effectivePlatforms}
                  certificationMode={certificationMode}
                  initialAppFamily={
                    certificationMode
                      ? certificationContext.appKey === "explorer"
                        ? "explorer_app"
                        : "host_app"
                      : null
                  }
                  certificationAppKey={
                    certificationMode ? certificationContext.appKey : null
                  }
                  certificationOs={
                    certificationMode ? certificationContext.os : null
                  }
                />
              </section>
            </div>
          )}
          {stepId === "audience" && (
            <StepAudience
              audience={audience}
              onAudienceChange={setAudience}
              channelRows={plannedRows}
            />
          )}
          {stepId === "budget" && (
            <StepBudget
              budget={budget}
              onBudgetChange={setBudget}
              channelRows={plannedRows}
              currency={planCurrency.currency}
              currencyBlockedReason={currencyBlockedReason}
              scheduleTimeZone={scheduleZone}
            />
          )}
          {stepId === "creative" && (
            <div className="space-y-8">
              <StepCreative
                creative={creative}
                onCreativeChange={setCreative}
                channelRows={plannedRows}
                destination={firstDestination}
                fundedPlatforms={fundedPlatforms}
                creativeExcluded={creativePartition.excluded}
                creativeBuildable={creativePartition.buildable}
                onChangePlatforms={() => jumpToStepId("promote")}
                audienceStages={audience.stages}
                onStageCreativeValidationChange={setStageCreativeValidation}
              />
              <section className="border-t border-[var(--gray-100)] pt-6">
                <StepCopy
                  copy={copy}
                  onCopyChange={setCopy}
                  channelRows={plannedRows}
                  /* ISSUE-1282: the Google-video (Demand Gen) bespoke long-headline +
                     business-name fields render ONLY when the creative is a video. */
                  isVideo={creative.kind === "video"}
                  tiktokSpark={usesTikTokSpark}
                />
              </section>
              <section className="border-t border-[var(--gray-100)] pt-6">
                <StepPolicy
                  copy={copy}
                  creative={creative}
                  /* ISSUE-987 P3: pass the PICKED set (plannedRows), like every sibling
                     step, so a deselected/compliance-excluded platform never produces
                     a stale policy warning for a channel that won't be built. */
                  channelRows={plannedRows}
                  specialAdCategory={specialAdCategory}
                  onSpecialAdCategoryChange={setSpecialAdCategory}
                />
              </section>
            </div>
          )}
          {stepId === "review" && (
            <StepReview
              summary={summary}
              name={name}
              onNameChange={(value) => {
                setName(value);
                setNameTouched(true);
              }}
              submitting={submitting}
              validatingShapes={validatingShapes}
              createResults={createResults}
              allExpectedPairsSucceeded={allExpectedPairsSucceeded}
              onCreate={() => runCreate({ validateOnly: false })}
              onValidateShapes={() => runCreate({ validateOnly: true })}
              onJumpToStep={jumpToStepId}
              currencyBlockedReason={currencyBlockedReason}
              planPreview={planPreview}
              broaderAccepted={broaderAccepted}
              onBroaderAcceptedChange={setBroaderAccepted}
              confirmationPhrase={launchPhrase}
              onConfirmationPhraseChange={setLaunchPhrase}
              createSteps={createSteps}
              createError={createError}
              placementGapsText={placementGapsLine(
                reviewPlacementGaps({
                  kind: creative.kind,
                  probe: creative.validation?.probe ?? null,
                  platforms: summary.channels.map((line) => line.platform),
                  variants: creative.variants,
                }),
              )}
              certificationMode={certificationMode}
              certificationState={certificationState}
              certificationApprovalReference={certificationApprovalReference}
              onCertificationApprovalReferenceChange={
                setCertificationApprovalReference
              }
              certificationApprovalPhrase={certificationApprovalPhrase}
              onCertificationApprovalPhraseChange={
                setCertificationApprovalPhrase
              }
              certificationApprovalBusy={certificationApprovalBusy}
              onApproveCertification={approveCertification}
            />
          )}

          {/* Footer nav — Back / Next (SPEC §4.1 sticky footer pattern). */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--gray-100)]">
            <Button
              variant="secondary"
              icon={ArrowLeft}
              disabled={activeIndex === 0}
              onClick={goBack}
            >
              Back
            </Button>
            {activeIndex < STEPS.length - 1 && (
              <div className="flex items-center gap-3">
                {disabledReason && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {disabledReason}
                  </span>
                )}
                <Button
                  iconRight={ArrowRight}
                  disabled={Boolean(disabledReason)}
                  onClick={() => goTo(activeIndex + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Sticky live ad preview rail (SC-6 — updates on every keystroke). */}
        <div className="hidden lg:block sticky top-4">
          <AdPreview
            brandName={firstDestination?.brand_name}
            primary={copy.primary}
            headline={copy.headline}
            description={copy.description}
            cta={copy.cta}
            imageUrl={creative.localPreviewUrl ?? creative.publicUrl}
            destUrl={firstDestination?.dest_url}
            creative={creative}
            destination={firstDestination}
            fundedPlatforms={fundedPlatforms}
            preparationRows={preparationRows}
          />
          <p className="text-[10px] text-[var(--color-text-tertiary)] mt-2">
            Preview source is labeled above every frame.
            {destinations.length > 1 && (
              <>
                {" "}
                Showing the first of {destinations.length} destinations — each
                gets its own ad.
              </>
            )}
          </p>
        </div>
      </div>

      {/* OD-3 step-back confirm. The server draft remains recoverable. */}
      <Modal
        open={pendingJump !== null}
        onClose={() => setPendingJump(null)}
        title="Leave this step?"
      >
        <ModalBody>
          <p className="text-sm">
            Campaigns already created stay created (they're paused). Going back
            lets you edit the plan for the next create.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setPendingJump(null)}>
            Stay
          </Button>
          <Button
            onClick={() => {
              goTo(pendingJump);
              setPendingJump(null);
            }}
          >
            Go back
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
