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
import { planChannels, splitBudget } from "../lib/adBuilder/channelPlan";
import { validateAudience, DEFAULT_AGE_MAX, DEFAULT_AGE_MIN, DEFAULT_COUNTRIES } from "../lib/adBuilder/audienceRules";
import { validateBudget } from "../lib/adBuilder/budgetRules";
import { validateCopy } from "../lib/adBuilder/copyRules";
import { runPolicyPrecheck } from "../lib/adBuilder/policyLinter";
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
  const [destination, setDestination] = useState(null);
  const [audience, setAudience] = useState({
    countries: DEFAULT_COUNTRIES,
    ageMin: DEFAULT_AGE_MIN,
    ageMax: DEFAULT_AGE_MAX,
    gender: "all",
  });
  const [budget, setBudget] = useState({ totalDailyCents: 0, strategy: "auto", allowlist: null });
  const [creative, setCreative] = useState({
    file: null,
    localPreviewUrl: null,
    publicUrl: null,
    path: null,
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
  // One request_id per (platform, wizard session) — server idempotency replay.
  const requestIdsRef = useRef({});
  const requestIdFor = (platform) => {
    if (!requestIdsRef.current[platform]) {
      requestIdsRef.current[platform] = crypto.randomUUID();
    }
    return requestIdsRef.current[platform];
  };

  const dirty = Boolean(
    destination || creative.publicUrl || copy.primary || budget.totalDailyCents > 0,
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
  const allocations = useMemo(
    () => splitBudget({ totalDailyCents: budget.totalDailyCents, channelRows, strategy: budget.strategy }),
    [budget.totalDailyCents, budget.strategy, channelRows],
  );

  // Auto-suggest the campaign name from the destination (editable — §4.4).
  useEffect(() => {
    if (!nameTouched && destination) {
      setName(suggestCampaignName({ brandName: destination.brand_name, title: destination.title }));
    }
  }, [destination, nameTouched]);

  // ── Per-step gate (Next disabled until the step is valid) ──
  const stepValid = (stepId) => {
    switch (stepId) {
      case "lane":
        return lane === "consumer";
      case "preflight":
        return Boolean(preflightRows) &&
          preflightRows.some((r) => r.overall === "green" || r.overall === "amber");
      case "goal":
        return goalIds.length > 0;
      case "destination":
        return destination !== null;
      case "audience":
        return validateAudience(audience).length === 0;
      case "budget":
        return validateBudget({ totalDailyCents: budget.totalDailyCents, channelRows }).length === 0 &&
          allocations.length > 0;
      case "creative": {
        if (!creative.publicUrl || !creative.validation) return false;
        // A hard-reject on a funded channel blocks — the create would fail.
        const funded = new Set(allocations.map((a) => a.platform));
        return (creative.validation.channels ?? [])
          .filter((c) => funded.has(c.platform))
          .every((c) => c.ok);
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
        return "No channel can run an ad right now. Fix at least one blocker above to continue.";
      case "goal":
        return "Pick at least one goal.";
      case "destination":
        return "Pick a page to send people to.";
      case "creative":
        return creative.publicUrl
          ? creative.validation ? "Fix the creative problems above first." : "Validate the creative first."
          : "Upload an ad image first.";
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

  // ── Create (paused) — one call per funded channel; NEVER launches ──
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
    for (const allocation of allocations) {
      const platform = allocation.platform;
      if (results[platform]?.campaign) continue; // idempotent per session
      const payload = buildCreatePayload(platform, {
        lane,
        name: name || suggestCampaignName({ brandName: destination?.brand_name, title: destination?.title }),
        goal: resolvedGoal,
        destination: {
          page_type: destination.page_type,
          brand_slug: destination.brand_slug,
          entity_slug: destination.page_type === "event" ? destination.slug : null,
        },
        audience,
        budget: { dailyCentsForChannel: allocation.dailyCents },
        creative: {
          imageUrl: creative.publicUrl,
          aiGenerated: creative.aiGenerated,
          // ISSUE-927: the #866 library row (recorded in StepCreative) —
          // snapchat consumes media ONLY through the library; tiktok reuses a
          // READY ref when one exists.
          creativeLibraryId: creative.creativeRow?.id ?? null,
          brandName: destination?.brand_name ?? null,
        },
        copy,
        specialAdCategory,
        requestId: requestIdFor(platform),
        validateOnly,
      });
      const { data, error } = await createCampaign(payload);
      if (error) {
        const parsed = await parseEdgeError(error);
        results[platform] = {
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
        if (outcome.outcome === "validated") {
          results[platform] = {
            validated: true,
            validated_layers: outcome.validatedLayers,
            skipped_layers: outcome.skippedLayers,
          };
        } else if (outcome.outcome === "created") {
          results[platform] = { campaign: outcome.campaign };
          addToast({
            variant: "success",
            title: `Created on ${platform}. Nothing is spending yet.`,
          });
        } else {
          // Honest "nothing happened": no dry-run exists on this platform (or the
          // create returned no object). Record it truthfully — never a false
          // "Created" — so Review shows the honest state.
          results[platform] = {
            noPlatformValidate: true,
            skipped_layers: outcome.skippedLayers,
            detail: outcome.detail,
          };
          addToast({
            variant: "info",
            title: `${platform}: nothing was created or validated.`,
            description: validateOnly
              ? "This platform has no dry-run, so the real create is its first check. Use “Create campaign (paused)” to build it."
              : "The platform returned no object — check the card for details.",
          });
        }
      }
      setCreateResults({ ...results });
    }
    if (validateOnly) setValidatingShapes(false);
    else setSubmitting(false);
  };

  const summary = buildLaunchSummary({
    channelRows,
    allocations,
    goalIds,
    destination: destination ? { title: destination.title, dest_url: destination.dest_url } : null,
    creative: creative.publicUrl
      ? {
        kind: "image",
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

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,720px)_320px] gap-5 items-start">
        <div className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl p-5">
          {stepId === "lane" && <StepLane lane={lane} onLaneChange={setLane} />}
          {stepId === "preflight" && (
            <StepPreflight
              rows={preflightRows}
              running={preflightRunning}
              recheckBusy={recheckBusy}
              onRecheck={(platform) => loadPreflight(platform)}
              onRecheckAll={() => loadPreflight()}
            />
          )}
          {stepId === "goal" && <StepGoal goalIds={goalIds} onGoalsChange={setGoalIds} />}
          {stepId === "destination" && (
            <StepDestination destination={destination} onDestinationChange={setDestination} />
          )}
          {stepId === "audience" && (
            <StepAudience audience={audience} onAudienceChange={setAudience} channelRows={channelRows} />
          )}
          {stepId === "budget" && (
            <StepBudget budget={budget} onBudgetChange={setBudget} channelRows={channelRows} />
          )}
          {stepId === "creative" && (
            <StepCreative
              creative={creative}
              onCreativeChange={setCreative}
              channelRows={channelRows}
              destination={destination}
            />
          )}
          {stepId === "copy" && (
            <StepCopy copy={copy} onCopyChange={setCopy} channelRows={channelRows} />
          )}
          {stepId === "policy" && (
            <StepPolicy
              copy={copy}
              creative={creative}
              channelRows={channelRows}
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
            brandName={destination?.brand_name}
            primary={copy.primary}
            headline={copy.headline}
            cta={copy.cta}
            imageUrl={creative.localPreviewUrl ?? creative.publicUrl}
            destUrl={destination?.dest_url}
          />
          <p className="text-[10px] text-[var(--color-text-tertiary)] mt-2">
            Approximation of the Facebook mobile feed. Platform-rendered previews arrive with
            the preview endpoint.
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
