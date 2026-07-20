/**
 * ISSUE-864 WP4 [Full Rooms Ad Engine] — the Campaign Builder wizard.
 *
 * Spine (SPEC A4.0(1), supersedes A2/A3 order): lane → preflight → goal(s,
 * multi-select) → destination → audience → budget & schedule → creative →
 * copy → preview & policy pre-check → review & create. The CHANNEL PICKER IS
 * AN OUTPUT of preflight ∩ goal ∩ market ∩ budget (channelPlan.js) — never an
 * operator step; manual narrowing lives in Budget → Advanced.
 *
 * Everything is created PAUSED (SC-10 / I-PROPOSED-864-CREATE-PAUSED):
 * the builder NEVER invokes the launch/pause action service — Launch lives on
 * #/campaigns (the regression suite greps this file for the action symbol).
 *
 * Drafts are client-state only, guarded by a discard confirm (OD-3).
 */

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
  createCampaign,
  getConnection,
  parseEdgeError,
  runPreflight,
} from "../services/adEngineService";
import { resolveGoalForPayload, resolveMetaObjective } from "../lib/adBuilder/objectiveResolver";
import { classifyCreateResult } from "../lib/adBuilder/createResult";
import { applyChannelSelection, planChannels, splitBudget } from "../lib/adBuilder/channelPlan";
import { complianceExclusions } from "../lib/adBuilder/compliance";
import { validateAudience, DEFAULT_AGE_MAX, DEFAULT_AGE_MIN, DEFAULT_COUNTRIES } from "../lib/adBuilder/audienceRules";
import { DEFAULT_RADIUS_MI } from "../lib/adBuilder/targeting";
import { validateBudget } from "../lib/adBuilder/budgetRules";
import { validateCopy } from "../lib/adBuilder/copyRules";
import { runPolicyPrecheck } from "../lib/adBuilder/policyLinter";
import { partitionFundedCreative } from "../lib/adBuilder/creativeGate";
import { buildCreatePayload, suggestCampaignName } from "../lib/adBuilder/payload";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary";

const STEPS = [
  { id: "lane", label: "Lane" },
  { id: "preflight", label: "Channel health" },
  { id: "goal", label: "Goal" },
  { id: "destination", label: "Destination" },
  { id: "audience", label: "Audience" },
  { id: "budget", label: "Budget" },
  { id: "creative", label: "Creative" },
  { id: "copy", label: "Copy" },
  { id: "policy", label: "Policy check" },
  { id: "review", label: "Review" },
];

function stepIndexFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  const step = new URLSearchParams(query).get("step");
  const index = STEPS.findIndex((s) => s.id === step);
  return index >= 0 ? index : 0;
}

export function CampaignBuilderPage() {
  const { addToast } = useToast();

  // ── Wizard navigation ──
  const [activeIndex, setActiveIndex] = useState(0);
  const [maxVisitedIndex, setMaxVisitedIndex] = useState(0);
  const [pendingJump, setPendingJump] = useState(null); // discard-confirm target

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
  const [selectedPlatforms, setSelectedPlatforms] = useState(null);
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
  });
  const [budget, setBudget] = useState({ totalDailyCents: 0, strategy: "auto", allowlist: null });
  const [creative, setCreative] = useState({
    // ISSUE-995 [Campaign Builder creative] Wave 3 — media kind. "image" keeps
    // the existing byte-upload flow; "video" references an already-hosted asset
    // (Bunny id + MP4 master URL + a poster image) — the edge runtime can't
    // transcode, so the admin supplies the refs the #866 library records.
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
    validation: null,
    creativeRow: null,
    aiGenerated: true,
    name: "",
  });
  const [copy, setCopy] = useState({
    primary: "",
    headline: "",
    description: "",
    cta: "BUY_TICKETS",
    googleHeadlines: ["", "", ""],
    googleDescriptions: ["", ""],
    keywords: [],
    negativeKeywords: [],
  });
  const [specialAdCategory, setSpecialAdCategory] = useState("NONE");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  // ── Create ──
  const [submitting, setSubmitting] = useState(false);
  const [validatingShapes, setValidatingShapes] = useState(false);
  const [createResults, setCreateResults] = useState(null);
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
  const destGroupIdRef = useRef(null);
  const destGroupId = () => {
    if (!destGroupIdRef.current) destGroupIdRef.current = crypto.randomUUID();
    return destGroupIdRef.current;
  };

  const dirty = Boolean(
    destinations.length > 0 || creative.publicUrl || copy.primary || budget.totalDailyCents > 0,
  );

  // ── Preflight + connections load ──
  const loadPreflight = useCallback(async (platform) => {
    if (platform) setRecheckBusy(platform);
    else setPreflightRunning(true);
    const { data, error } = await runPreflight(platform);
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({ variant: "error", title: "Preflight failed", description: String(parsed?.message ?? "") });
    } else if (platform) {
      const row = (data?.rows ?? [])[0];
      if (row) {
        setPreflightRows((prev) =>
          (prev ?? []).map((r) => (r.platform === platform ? row : r)),
        );
        addToast({
          variant: row.overall === "green" ? "success" : "warning",
          title: row.overall === "green"
            ? `${platform} is ready.`
            : `Still ${row.overall} — see the card.`,
        });
      }
    } else {
      setPreflightRows(data?.rows ?? []);
      const ready = (data?.rows ?? []).filter((r) => r.overall === "green" || r.overall === "amber").length;
      addToast({ variant: "info", title: `${ready} of ${(data?.rows ?? []).length} channels ready.` });
    }
    if (platform) setRecheckBusy(null);
    else setPreflightRunning(false);
  }, [addToast]);

  useEffect(() => {
    loadPreflight();
    // Connection rows carry Meta's per-category floors (extra.minimum_budgets).
    (async () => {
      const loaded = {};
      for (const platform of ["meta", "google"]) {
        const { data } = await getConnection(platform, "consumer");
        if (data) loaded[platform] = data;
      }
      setConnections(loaded);
    })();
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

  // ── The channel plan (the A4.0(1) output) ──
  // ISSUE-979 Bug 1: Meta's optimization_goal comes from the SAME coherent
  // resolution the create payload uses (objectiveResolver) — one Meta goal in
  // play, so the per-category budget floor here and the create pair never
  // disagree. (Traffic wins over awareness for the two live goals, in any click
  // order — the valid OUTCOME_TRAFFIC / LINK_CLICKS pair.)
  const metaGoal = resolveMetaObjective(goalIds).optimization_goal;
  const channelRows = useMemo(
    () =>
      planChannels({
        preflightRows: preflightRows ?? [],
        goalIds,
        countries: audience.countries,
        totalDailyCents: budget.totalDailyCents,
        allowlist: budget.allowlist,
        connections,
        metaGoal,
      }),
    [preflightRows, goalIds, audience.countries, budget.totalDailyCents, budget.allowlist, connections, metaGoal],
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
    () => applyChannelSelection({ channelRows, selectedPlatforms, excluded: complianceExcluded }),
    [channelRows, selectedPlatforms, complianceExcluded],
  );
  // The effective selected+buildable platform ids (post eligibility + compliance).
  const effectivePlatforms = useMemo(
    () => plannedRows.filter((r) => r.eligible).map((r) => r.platform),
    [plannedRows],
  );

  const togglePlatform = useCallback((platform) => {
    setSelectedPlatforms((prev) => {
      // Materialize the "all eligible" default on the first explicit toggle so
      // the operator owns the set from then on.
      const current = prev === null ? eligiblePlatforms : prev;
      return current.includes(platform)
        ? current.filter((p) => p !== platform)
        : [...current, platform];
    });
  }, [eligiblePlatforms]);

  const allocations = useMemo(
    // ISSUE-986: split across the PICKED channel set (plannedRows) — never the
    // full eligible set. The picker is the single source of truth for who gets
    // funded; a deselected/compliance-excluded channel is already ineligible here.
    () => splitBudget({ totalDailyCents: budget.totalDailyCents, channelRows: plannedRows, strategy: budget.strategy }),
    [budget.totalDailyCents, budget.strategy, plannedRows],
  );

  // ISSUE-980 [Campaign Builder clarity] finding #3: the SAME coherent
  // per-platform resolution runCreate uses for the actual create payload
  // (ISSUE-979's objectiveResolver), recomputed here (pure, cheap, byte-
  // identical for the same goalIds) purely for display — Review reads this
  // to show each channel's REAL resolved objective instead of one repeated
  // goal-label string. Never touches runCreate's own resolution.
  const resolvedGoalForDisplay = useMemo(() => resolveGoalForPayload(goalIds), [goalIds]);

  // ── ISSUE-995 [Campaign Builder creative] Wave 3 — PROCEED-WITH-PASSING ──
  // The funded set (allocations) partitioned into the channels this creative can
  // build NOW and the ones to exclude. `buildable` requires ok AND not
  // needs_transcode (reconciling the matrix `ok`-ignores-needs_transcode vs
  // resolveCreativeRef-blocks-needs_transcode mismatch), so a channel shown
  // "ready" can never fail at create. The build proceeds on `buildable` and
  // simply does not create the `excluded` ones — the backend create loop is
  // already per-channel independent.
  const fundedPlatforms = useMemo(() => allocations.map((a) => a.platform), [allocations]);
  const creativePartition = useMemo(
    () => partitionFundedCreative({
      fundedPlatforms,
      channels: creative.validation?.channels ?? [],
      // ISSUE-995 REWORK: video ad create isn't wired yet (#997) — a video
      // creative excludes every funded channel (preview-only), so nothing
      // misleading builds.
      kind: creative.kind,
    }),
    [fundedPlatforms, creative.validation, creative.kind],
  );

  // Auto-suggest the campaign name from the first destination (editable — §4.4).
  // ISSUE-1002: the base name is derived from the first selected destination; on a
  // multi-destination fan-out each ad's name is suffixed with its own destination
  // title in runCreate, so the created campaigns stay distinguishable.
  const firstDestination = destinations[0] ?? null;
  useEffect(() => {
    if (!nameTouched && firstDestination) {
      setName(suggestCampaignName({ brandName: firstDestination.brand_name, title: firstDestination.title }));
    }
  }, [firstDestination, nameTouched]);

  // ── Per-step gate (Next disabled until the step is valid) ──
  const stepValid = (stepId) => {
    switch (stepId) {
      case "lane":
        return lane === "consumer";
      case "preflight":
        // ISSUE-986: at least one platform must be healthy AND picked — the
        // picker can't proceed with an empty channel set.
        return Boolean(preflightRows) &&
          preflightRows.some((r) => r.overall === "green" || r.overall === "amber") &&
          effectivePlatforms.length > 0;
      case "goal":
        return goalIds.length > 0;
      case "destination":
        return destinations.length > 0;
      case "audience":
        return validateAudience(audience).length === 0;
      case "budget":
        return validateBudget({ totalDailyCents: budget.totalDailyCents, channelRows }).length === 0 &&
          allocations.length > 0;
      case "creative": {
        // ISSUE-995: a video creative must be RECORDED (its bytes live off-
        // client, so the library row id is the only way to reference it);
        // an image can build from its inline public URL.
        const hasMedia = creative.kind === "video"
          ? Boolean(creative.creativeRow)
          : Boolean(creative.publicUrl);
        if (!hasMedia || !creative.validation) return false;
        // ISSUE-995 PROCEED-WITH-PASSING: Next is enabled as long as AT LEAST
        // ONE funded channel can build with this creative — the failing ones are
        // excluded and the build proceeds on the rest (was: every funded channel
        // had to pass, so one reject blocked the whole build).
        return creativePartition.buildable.length > 0;
      }
      case "copy": {
        const funded = allocations.map((a) => a.platform);
        const validation = validateCopy(copy, funded);
        return funded.every((p) => (validation[p]?.hard ?? []).length === 0) &&
          copy.primary.trim().length > 0;
      }
      case "policy":
        return specialAdCategory !== "CREDIT";
      default:
        return true;
    }
  };

  const nextDisabledReason = () => {
    const stepId = STEPS[activeIndex].id;
    if (stepValid(stepId)) return null;
    switch (stepId) {
      case "preflight":
        return effectivePlatforms.length === 0 && preflightRows?.some((r) => r.overall === "green" || r.overall === "amber")
          ? "Pick at least one platform to build for."
          : "No channel can run an ad right now. Fix at least one blocker above to continue.";
      case "goal":
        return "Pick at least one goal.";
      case "destination":
        return "Pick a page to send people to.";
      case "creative": {
        const hasMedia = creative.kind === "video" ? Boolean(creative.creativeRow) : Boolean(creative.publicUrl);
        if (!hasMedia) {
          return creative.kind === "video"
            ? "Add the video and record it to the library first."
            : "Upload an ad image first.";
        }
        if (!creative.validation) return "Validate the creative first.";
        // ISSUE-995 REWORK: video ad creation isn't available yet — the builder
        // is preview-only for video, so Next-to-build is intentionally blocked.
        if (creative.kind === "video") {
          return "Video ad creation isn't available yet — this is a preview. Switch to an image to build a campaign.";
        }
        // Has media + validation, but no funded channel can build → every one failed.
        return "No funded channel can run this creative. Fix a problem above, or add a variant, to build at least one.";
      }
      case "copy":
        return "Fix the copy problems above first.";
      default:
        return "Finish this step first.";
    }
  };

  const goTo = (index) => {
    setActiveIndex(index);
    setMaxVisitedIndex((prev) => Math.max(prev, index));
  };
  const jumpToStepId = (stepId) => {
    const index = STEPS.findIndex((s) => s.id === stepId);
    if (index >= 0) goTo(index);
  };

  // ── Create (paused) — one call per (destination × funded channel); NEVER launches ──
  const runCreate = async ({ validateOnly }) => {
    if (validateOnly) setValidatingShapes(true);
    else setSubmitting(true);
    const results = { ...(createResults ?? {}) };
    // ISSUE-979 Bug 1: resolve every platform's objective AND optimization_goal
    // ONCE, coherently, from the whole selected goal set (single source of
    // truth) — never goalIds[0] for one field and the full array for another.
    // Each platform's pair now comes from a single goals.js entry, so the Meta
    // objective/optimization_goal pairing is always valid, in any click order.
    const resolvedGoal = resolveGoalForPayload(goalIds);
    // ISSUE-995 PROCEED-WITH-PASSING: skip funded channels this creative can't
    // build (reject or unresolved needs_transcode). The backend loop is already
    // per-channel independent — we simply don't issue their create call.
    const creativeExcluded = new Set(creativePartition.excluded.map((e) => e.platform));
    // ISSUE-1002 [multi-destination fan-out] — the DESTINATION axis is the OUTER
    // loop around the existing per-platform allocations loop, so one campaign fans
    // out to one ad per (destination × platform), each with its own landing URL
    // and pid attribution. A single-destination selection runs exactly one
    // destination iteration, keyed by bare platform → byte-identical to before.
    const multiDest = destinations.length > 1;
    const groupId = multiDest ? destGroupId() : null;
    const baseName = name || suggestCampaignName({ brandName: firstDestination?.brand_name, title: firstDestination?.title });
    for (const dest of destinations) {
      const destSlot = `${dest.page_type}:${dest.id}`;
      const destBody = {
        page_type: dest.page_type,
        brand_slug: dest.brand_slug,
        entity_slug: dest.page_type === "event" ? dest.slug : null,
      };
      // Each fanned-out ad carries its own name (base name + destination title) so
      // the created campaigns stay distinguishable; a single-destination build
      // keeps the base name exactly.
      const perCallName = multiDest ? `${baseName} — ${dest.title}` : baseName;
      for (const allocation of allocations) {
        const platform = allocation.platform;
        const resultKey = multiDest ? `${platform}::${destSlot}` : platform;
        const meta = { platform, destTitle: dest.title, multiDest };
        if (results[resultKey]?.campaign) continue; // idempotent per session
        if (creativeExcluded.has(platform)) continue; // excluded — build the passing ones
        const payload = buildCreatePayload(platform, {
          lane,
          name: perCallName,
          goal: resolvedGoal,
          destination: destBody,
          // ISSUE-1002: the shared fan-out group id (null for single-destination),
          // and payload.js emits the destinations[] array + destination_group_id.
          destinationGroupId: groupId,
          audience,
          budget: { dailyCentsForChannel: allocation.dailyCents },
          creative: {
            // ISSUE-995: kind drives the payload media descriptor — video rides
            // on the library ref (creative_library_id), image on the inline URL.
            kind: creative.kind,
            imageUrl: creative.publicUrl,
            aiGenerated: creative.aiGenerated,
            // ISSUE-927: the #866 library row (recorded in StepCreative) —
            // snapchat consumes media ONLY through the library; tiktok reuses a
            // READY ref when one exists; a video creative REQUIRES it.
            creativeLibraryId: creative.creativeRow?.id ?? null,
            brandName: dest.brand_name ?? null,
          },
          copy,
          specialAdCategory,
          requestId: requestIdFor(platform, destSlot),
          validateOnly,
        });
        const { data, error } = await createCampaign(payload);
      if (error) {
        const parsed = await parseEdgeError(error);
        results[resultKey] = {
          ...meta,
          error: {
            code: parsed?.body?.error,
            message: typeof parsed?.body?.detail === "string"
              ? parsed.body.detail
              : parsed?.body?.detail?.message ?? parsed?.message ?? "Create failed.",
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
          addToast({
            variant: "success",
            title: `Created on ${platform}${destLabel}. Nothing is spending yet.`,
          });
        } else {
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
    allocations,
    goalIds,
    resolvedGoal: resolvedGoalForDisplay,
    destinations: destinations.map((d) => ({ title: d.title, dest_url: d.dest_url })),
    creative: (creative.kind === "video" ? creative.creativeRow : creative.publicUrl)
      ? {
        kind: creative.kind,
        name: creative.name,
        width: creative.validation?.probe?.width,
        height: creative.validation?.probe?.height,
      }
      : null,
    copyCheck: (() => {
      const funded = allocations.map((a) => a.platform);
      const validation = validateCopy(copy, funded);
      const copyHardBlocks = funded.reduce((n, p) => n + (validation[p]?.hard ?? []).length, 0);
      const copyText = [copy.primary, copy.headline, copy.description].filter(Boolean).join("\n");
      const { personalAttributes, dating, alcohol } = runPolicyPrecheck({ copyText, channelSet: funded });
      return {
        copyHardBlocks,
        policyFindings: personalAttributes.length + (dating ? 1 : 0) + (alcohol ? 1 : 0),
      };
    })(),
    totalDailyCents: budget.totalDailyCents,
  });

  const stepId = STEPS[activeIndex].id;
  const disabledReason = nextDisabledReason();

  return (
    <div className="space-y-4">
      <Stepper
        steps={STEPS}
        activeIndex={activeIndex}
        maxVisitedIndex={maxVisitedIndex}
        onJump={(index) => {
          if (index < activeIndex && dirty && stepId === "review" && createResults) {
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
          {stepId === "lane" && <StepLane lane={lane} onLaneChange={setLane} />}
          {stepId === "preflight" && (
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
          )}
          {stepId === "goal" && <StepGoal goalIds={goalIds} onGoalsChange={setGoalIds} />}
          {stepId === "destination" && (
            <StepDestination destinations={destinations} onDestinationsChange={setDestinations} />
          )}
          {stepId === "audience" && (
            <StepAudience audience={audience} onAudienceChange={setAudience} channelRows={plannedRows} />
          )}
          {stepId === "budget" && (
            <StepBudget budget={budget} onBudgetChange={setBudget} channelRows={plannedRows} />
          )}
          {stepId === "creative" && (
            <StepCreative
              creative={creative}
              onCreativeChange={setCreative}
              channelRows={plannedRows}
              destination={firstDestination}
              fundedPlatforms={fundedPlatforms}
              creativeExcluded={creativePartition.excluded}
              creativeBuildable={creativePartition.buildable}
            />
          )}
          {stepId === "copy" && (
            <StepCopy copy={copy} onCopyChange={setCopy} channelRows={plannedRows} />
          )}
          {stepId === "policy" && (
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
              onCreate={() => runCreate({ validateOnly: false })}
              onValidateShapes={() => runCreate({ validateOnly: true })}
              onJumpToStep={jumpToStepId}
            />
          )}

          {/* Footer nav — Back / Next (SPEC §4.1 sticky footer pattern). */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--gray-100)]">
            <Button
              variant="secondary"
              icon={ArrowLeft}
              disabled={activeIndex === 0}
              onClick={() => goTo(activeIndex - 1)}
            >
              Back
            </Button>
            {activeIndex < STEPS.length - 1 && (
              <div className="flex items-center gap-3">
                {disabledReason && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">{disabledReason}</span>
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
            cta={copy.cta}
            imageUrl={creative.localPreviewUrl ?? creative.publicUrl}
            destUrl={firstDestination?.dest_url}
          />
          <p className="text-[10px] text-[var(--color-text-tertiary)] mt-2">
            Approximation of the Facebook mobile feed. Platform-rendered previews arrive with
            the preview endpoint.
            {destinations.length > 1 && (
              <> Showing the first of {destinations.length} destinations — each gets its own ad.</>
            )}
          </p>
        </div>
      </div>

      {/* OD-3 discard confirm (client-state drafts only). */}
      <Modal
        open={pendingJump !== null}
        onClose={() => setPendingJump(null)}
        title="Leave this step?"
      >
        <ModalBody>
          <p className="text-sm">
            Campaigns already created stay created (they're paused). Going back lets you edit
            the plan for the next create.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setPendingJump(null)}>Stay</Button>
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
