import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { accent, ariThread, canvas, spacing, websitePaneMaxWidth } from "../../../constants/designSystem";
import { supabase } from "../../../services/supabase";
import { brandSiteKeys } from "../../../sites/brandSiteKeys";
import { firstOfferingRoute } from "../../../sites/planRoutes";
import { useSaveBrandSitePlan } from "../../../sites/planApi";
import { planBuildDone, SetupFlowError, useSetupDraft, useSetupFlowState, useTakeOverSetup } from "../../../sites/setupApi";
import { ariStepToFollow, firstMissingStep, nameInSentence, nextOpenStep, setupBuildBlockers, setupPresence, setupStepChip, setupSteps } from "../../../sites/setupStatus";
import type { SitePlanState } from "../../../sites/sitePlanState";
import { partLabel } from "../../../sites/sitePlanState";
import { useCurrentBrandStore } from "../../../store/currentBrandStore";
import { withReturnTo } from "../../../utils/brandEditReturn";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { SafeScreen } from "../../ui/SafeScreen";
import { Sheet } from "../../ui/Sheet";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { useWebsite } from "../website/WebsiteContext";
import { Banner, CardTitle, Chip, Hint, Skeleton, WButton, ui } from "../website/ui";
import { SitePreviewPanel, type PreviewGrantState } from "../website/preview/SitePreviewPanel";
import { PublishSection } from "../website/sections/PublishSection";
import { OfferingsPart } from "../plan/OfferingsPart";
import { PlanDesignPart } from "../plan/PlanDesignPart";
import { StoryPart } from "../plan/StoryPart";
import { SetupBrandStep } from "./SetupBrandStep";
import { SetupDraftStep } from "./SetupDraftStep";
import { SetupLive } from "./SetupLive";
import { SetupPresenceCard } from "./SetupPresenceCard";
import { SetupStart } from "./SetupStart";
import { SetupMark, SetupStepList } from "./SetupStepList";
import type { PlanPartKey } from "../../../../../packages/site-contracts/src/sitePlan.ts";

/*
 * #2830 — Ari beside the form. An inline React.lazy on purpose: two inline
 * `import()`s of this module (here and the Ari tab) resolve to one chunk and
 * hoist nothing; a shared owner file would itself hoist (I-ARI-CHAT-ONE-CHUNK).
 * Hosts working by hand never fetch it.
 */
const LazyAriChatScreen = React.lazy(() =>
  import("../../../screens/ari/AriChatScreen").then((m) => ({ default: m.AriChatScreen })),
);

const HEARTBEAT_MS = 120_000;
/** An open tab must not hold the lock forever; it lapses on its own expiry after this. */
const IDLE_STOP_MS = 30 * 60_000;

class AriBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const ARI_UNAVAILABLE = "Ari is unavailable right now. You can carry on here.";

const FLOW_PROBLEM: Readonly<Record<string, string>> = {
  flow_run_busy: "Try again in a moment.",
  flow_revision_conflict: "This just changed. Here's the latest.",
  flow_brand_paused: "Mingla has paused your website, so setup is paused too.",
  flow_form_locked: "A teammate is on this form right now. Try again when they've finished.",
  TAKEOVER_UNAVAILABLE: "We couldn't do that just now. Try again in a moment.",
  UNAVAILABLE: "We couldn't do that just now. Try again in a moment.",
};

type AddedKind = "event" | "trip" | "experience";
const ADDED_KINDS: ReadonlySet<string> = new Set(["event", "trip", "experience"]);
const KIND_PAGE: Readonly<Record<AddedKind, string>> = { event: "Events", trip: "Trips", experience: "Experiences" };

/**
 * What came back from a creator, read from the server: state 12 only once it is
 * published (Seth, C1), otherwise the draft line. Null while unknown.
 */
function useAddedOffering(kind: AddedKind | null, id: string | null) {
  return useQuery({
    queryKey: [...brandSiteKeys.all, "setup-added", kind, id] as const,
    enabled: kind !== null && id !== null,
    staleTime: 0,
    queryFn: async () => {
      // Trips and experiences are events too (event_type); there is no other table.
      const { data, error } = await supabase.from("events").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as { name?: unknown; title?: unknown; status?: unknown; deleted_at?: unknown } | null;
      if (!row || row.deleted_at) return null;
      const name = typeof row.name === "string" && row.name ? row.name : typeof row.title === "string" && row.title ? row.title : null;
      return { name, published: typeof row.status === "string" && row.status !== "draft" };
    },
  });
}

export function WebsiteSetupScreen({ step, search, planQuery, grant, onHeartbeat }: {
  step: PlanPartKey | null;
  search: Record<string, string | undefined>;
  planQuery: UseQueryResult<SitePlanState>;
  grant: PreviewGrantState;
  onHeartbeat: () => void;
}): React.ReactElement {
  const ctx = useWebsite();
  const { brandId, brandName, controller, phone, toast } = ctx;
  const router = useRouter();
  const queryClient = useQueryClient();
  const plan = planQuery.data ?? null;
  const canManage = plan?.canManage === true;
  const site = controller.site.data ?? null;
  const published = plan?.site?.published === true;
  const paused = plan?.site?.paused === true;
  const fields = useMemo(() => plan?.completeness?.fields ?? [], [plan?.completeness]);

  // ── Ari ────────────────────────────────────────────────────────────────
  const [ariOpen, setAriOpen] = useState(search.ari === "1");
  // Back from a creator on this same mounted screen: ?ari=1 reopens the panel.
  useEffect(() => {
    if (search.ari === "1") setAriOpen(true);
  }, [search.ari]);
  const [ariAttempt, setAriAttempt] = useState(0);
  const [hotField, setHotField] = useState<string | null>(null);
  // #2830 — "Add it myself" in the panel: the field, on this screen.
  const [focusRequest, setFocusRequest] = useState<{ key: string; at: number } | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  // ── Presence ───────────────────────────────────────────────────────────
  const [watching, setWatching] = useState(false);
  const [confirmTake, setConfirmTake] = useState(false);
  const [flowProblem, setFlowProblem] = useState<string | null>(null);
  const [flowPoll, setFlowPoll] = useState(false);
  const flow = useSetupFlowState(brandId, plan !== null, flowPoll || ariOpen);
  const takeOver = useTakeOverSetup(brandId);
  const flowView = flow.data ?? null;
  const lockView = plan?.lock ?? null;
  const wasMineRef = useRef(false);
  const wasMyRunRef = useRef(false);
  const lockMine = lockView?.active === true && lockView.heldByMe;
  const presence = setupPresence({ paused, flow: flowView, lock: lockView, canManage, wasMine: wasMineRef.current && !lockMine, wasMyRun: wasMyRunRef.current });
  if (lockMine) wasMineRef.current = true;
  if (flowView?.mine === true) wasMyRunRef.current = true;
  // Who else is here isn't known until this answers. Until then nothing locks.
  const presenceKnown = flow.data !== undefined || flow.isError;
  const free = presence.kind === "free";
  const readOnly = !free || !canManage || !presenceKnown;
  useEffect(() => {
    setFlowPoll(flowView !== null && !flowView.mine);
  }, [flowView]);

  // Lose the run or the lock while on this screen: the form must go read-only
  // on the next poll, and take back nothing.
  useEffect(() => {
    if (!free || !ariOpen) return;
    const timer = setInterval(() => { void planQuery.refetch(); }, 5_000);
    return () => clearInterval(timer);
  }, [ariOpen, free, planQuery]);

  // By hand: keep the lock while someone is actually here.
  const lastTouchRef = useRef(Date.now());
  const heartbeatRef = useRef(onHeartbeat);
  heartbeatRef.current = onHeartbeat;
  const hasPlanRow = plan?.plan !== null && plan?.plan !== undefined;
  useEffect(() => {
    // A watcher must not lock: a heartbeat here would refuse the active owner's
    // Ari writes (sites_plan_locked) for ten minutes.
    if (!canManage || !free || !hasPlanRow || !presenceKnown) return undefined;
    heartbeatRef.current();
    const timer = setInterval(() => {
      if (Date.now() - lastTouchRef.current < IDLE_STOP_MS) heartbeatRef.current();
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [canManage, free, hasPlanRow, presenceKnown]);

  // ── Steps ──────────────────────────────────────────────────────────────
  const save = useSaveBrandSitePlan(brandId);
  const siteDraft = site
    ? { status: site.status, provisioning_error_code: site.provisioning_error_code, latest_provision_operation: site.latest_provision_operation ?? null }
    : null;
  const refetchSite = useCallback(() => { void controller.site.refetch(); }, [controller.site]);
  const buildDone = planBuildDone(plan);
  const approved = Boolean(plan?.plan?.approvedAt);
  // Only the person working on setup moves the draft on: a watcher never composes.
  const draft = useSetupDraft({ brandId, site: siteDraft, refetchSite, approved, buildDone, canManage: canManage && free && presenceKnown });
  const publishFailed = controller.publicationReceipt.data?.status === "failed";
  const status = useMemo(() => setupSteps({
    setupStatus: plan?.setupStatus ?? null,
    fallbackParts: plan?.parts ?? [],
    fields,
    // A refusal is not a failure: it names what is missing (no "Didn't work" chip).
    draftFailed: draft.state.kind === "failed" && !draft.refusal,
    publishFailed,
  }), [draft.refusal, draft.state.kind, fields, plan?.parts, plan?.setupStatus, publishFailed]);
  // #2830 — the same list Ari gives at Build, before anyone presses it.
  const buildBlockers = useMemo(() => (plan ? setupBuildBlockers(plan) : []), [plan]);
  const missingStep = firstMissingStep(plan, buildBlockers, status.nextKey);
  const activeStep: PlanPartKey = step ?? plan?.plan?.activePart ?? status.nextKey ?? "offer";
  const activeIndex = status.steps.findIndex((row) => row.key === activeStep);
  const active = status.steps[activeIndex] ?? status.steps[0];

  const goStep = useCallback((next: PlanPartKey, persist = true) => {
    setShowSteps(false);
    (router as unknown as { setParams: (params: Record<string, string | undefined>) => void }).setParams({ step: next });
    if (persist && plan?.plan && !readOnly) {
      // Best effort: on a conflict the latest plan is applied and the step stays.
      save.mutate({ revision: plan.plan.revision, patch: { active_part: next } }, { onError: () => undefined });
    }
  }, [plan?.plan, readOnly, router, save]);

  // #2830 — when Ari moves on to another part, the form goes with it.
  const ariStepRef = useRef<string | null>(null);
  const onFlowStep = useCallback((stepKey: string | null) => {
    const follow = ariStepToFollow(ariStepRef.current, stepKey);
    if (stepKey) ariStepRef.current = stepKey;
    if (follow) goStep(follow, false);
  }, [goStep]);

  const startWith = useCallback((withAri: boolean) => {
    // The start screen is a way in, not a way past a teammate who is already here.
    if (!free || !presenceKnown) return;
    onHeartbeat();
    if (withAri) setAriOpen(true);
  }, [free, onHeartbeat, presenceKnown]);

  // ── Takeover ───────────────────────────────────────────────────────────
  const runTakeOver = (mode: "continue" | "take_over") => {
    // Someone's form, not someone's run (even my own run's lock): the lock's take over.
    if (!flowView || (presence.kind === "active" && presence.source === "hand")) {
      ctx.lock.takeOver();
      return;
    }
    setFlowProblem(null);
    takeOver.mutate(
      { runId: flowView.runId, expectedRevision: flowView.revision, mode },
      {
        onSuccess: () => {
          toast("You're on Website setup now.", "success");
          wasMineRef.current = false;
        },
        onError: (error) => {
          const code = error instanceof SetupFlowError ? error.code : "UNAVAILABLE";
          if (code === "flow_run_active") {
            // It woke up while the owner was deciding: show the warning state.
            void flow.refetch();
            return;
          }
          setFlowProblem(FLOW_PROBLEM[code] ?? FLOW_PROBLEM.UNAVAILABLE);
          void flow.refetch();
        },
      },
    );
  };

  // ── The first trip or event ────────────────────────────────────────────
  const setCurrentBrandId = useCurrentBrandStore((store) => store.setCurrentBrandId);
  // The way back keeps Ari open if it was (the creator comes back with ?ari=1).
  const setupPath = `/brand/${brandId}/website/setup?step=first_offering${ariOpen ? "&ari=1" : ""}`;
  const openCreator = () => {
    if (!plan) return;
    const route = firstOfferingRoute(plan);
    if (!route) {
      toast("There's nothing to add for what you ticked. Skip this step, or tick Trips, Events or Experiences in What you'll offer.");
      return;
    }
    setCurrentBrandId(brandId);
    router.push(withReturnTo(route, setupPath) as never);
  };
  const addedKind = search.added && ADDED_KINDS.has(search.added) ? search.added as AddedKind : null;
  const [addedFrom, setAddedFrom] = useState<{ kind: AddedKind; id: string } | null>(null);
  useEffect(() => {
    if (!addedKind || !search.addedId) return;
    setAddedFrom({ kind: addedKind, id: search.addedId });
    controller.previewGrant.refetch().catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) });
    (router as unknown as { setParams: (params: Record<string, string | undefined>) => void }).setParams({ added: undefined, addedId: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addedKind, search.addedId]);
  const added = useAddedOffering(addedFrom?.kind ?? null, addedFrom?.id ?? null);

  // ── Body ───────────────────────────────────────────────────────────────
  const renderStep = (): React.ReactNode => {
    if (!plan) return null;
    switch (activeStep) {
      case "offer":
        return <OfferingsPart brandId={brandId} readOnly={readOnly} onDone={() => goStep(nextOpenStep(status.steps, "offer"))} />;
      case "brand": {
        // "Next" is the next part still open, never one already done.
        const next = nextOpenStep(status.steps, "brand");
        return (
          <SetupBrandStep
            brandId={brandId}
            plan={plan}
            readOnly={readOnly}
            hotField={hotField}
            focusRequest={focusRequest}
            onNext={() => goStep(next)}
            nextStepLabel={partLabel(next)}
          />
        );
      }
      case "look":
        return plan.site ? (
          <View style={styles.gap}>
            <CardTitle>Choose your design</CardTitle>
            <Hint>Your draft has a design. Change it, its colours and fonts in Website design.</Hint>
            <View style={styles.row}>
              <WButton label="Open Website design" onPress={() => router.push(`/brand/${brandId}/website/design?returnTo=${encodeURIComponent(`/brand/${brandId}/website/setup?step=look`)}` as never)} testID="setup-open-design" />
            </View>
          </View>
        ) : <PlanDesignPart brandId={brandId} planState={plan} readOnly={readOnly} onDone={() => goStep(nextOpenStep(status.steps, "look"))} />;
      case "story":
        return <StoryPart brandId={brandId} step="questions" readOnly={readOnly} onDone={(next) => goStep(next)} />;
      case "approve":
        return <StoryPart brandId={brandId} step="approve" readOnly={readOnly} onDone={(next) => goStep(next)} />;
      case "build":
        return draft.state.kind === "ready" ? (
          <DraftReady grant={grant} onPublish={() => goStep("publish")} onAdd={openCreator} onAskAri={() => setAriOpen(true)} ariReady={free && canManage} />
        ) : (
          <SetupDraftStep
            brandId={brandId}
            brandName={brandName}
            state={draft.state}
            canManage={canManage && free && presenceKnown}
            refusal={draft.refusal}
            blockers={buildBlockers}
            nextStep={missingStep}
            onStart={draft.start}
            onRetry={draft.retry}
            onTellMingla={() => router.push("/support/inbox" as never)}
            onDone={(next) => goStep(next)}
          />
        );
      case "first_offering":
        return (
          <View style={styles.gap} testID="setup-first-offering">
            {addedFrom && added.data ? (
              <AddedNotice
                name={added.data.name ?? `Your ${addedFrom.kind}`}
                page={KIND_PAGE[addedFrom.kind]}
                published={added.data.published}
                onPublish={() => goStep("publish")}
                onAddAnother={openCreator}
              />
            ) : (
              <>
                <CardTitle>Add your first trip or event</CardTitle>
                <Hint>Optional. It opens on top of setup and comes straight back here.</Hint>
                <View style={styles.row}>
                  <WButton label="Add your first trip or event" variant="primary" disabled={readOnly} onPress={openCreator} testID="setup-add-first" />
                  <WButton
                    label="Skip for now"
                    variant="ghost"
                    disabled={readOnly || !plan.plan}
                    onPress={() => {
                      if (!plan.plan) return;
                      save.mutate(
                        { revision: plan.plan.revision, patch: { skipped_parts: [...new Set([...plan.plan.skippedParts, "first_offering"])] } },
                        {
                          onSuccess: () => goStep("publish"),
                          onError: () => toast("That didn't save. Try again.", "error"),
                        },
                      );
                    }}
                    testID="setup-skip-first"
                  />
                </View>
              </>
            )}
          </View>
        );
      case "publish":
        if (published) {
          const host = site?.brand_site_hosts.find((entry) => entry.is_primary)?.hostname ?? null;
          return <SetupLive hostname={host} onEdit={() => router.push(`/brand/${brandId}/website` as never)} toast={toast} />;
        }
        if (!site || site.status === "provisioning") {
          return (
            <View style={styles.gap}>
              <CardTitle>Check and publish</CardTitle>
              <Hint>Available once your draft exists.</Hint>
            </View>
          );
        }
        return (
          <PublishSection
            variant="setup"
            onFix={(section) => router.push(`/brand/${brandId}/website/${section}?returnTo=${encodeURIComponent(`/brand/${brandId}/website/setup?step=publish`)}` as never)}
          />
        );
    }
  };

  const ariPanel = ariOpen ? (
    <AriBoundary
      key={ariAttempt}
      fallback={
        <View style={styles.ariFallback} testID="setup-ari-unavailable">
          <Text style={styles.ariFallbackText}>{ARI_UNAVAILABLE}</Text>
          <WButton label="Close" size="sm" onPress={() => { setAriOpen(false); setAriAttempt((value) => value + 1); }} />
        </View>
      }
    >
      <Suspense fallback={<View style={styles.ariFallback}><ActivityIndicator color={accent.warm} accessibilityLabel="Opening Ari" /></View>}>
        <LazyAriChatScreen
          embedded
          setup={{
            brandId,
            step: activeStep,
            conversationId: flowView?.mine ? flowView.conversationId : null,
            runKnown: presenceKnown,
            onOpenStep: (next: string) => goStep(next as PlanPartKey, false),
            onClose: () => setAriOpen(false),
            onFlowField: setHotField,
            onFlowStep,
            onFocusField: (key: string) => {
              setFocusRequest({ key, at: Date.now() });
              // On a phone Ari covers the form: step aside so the field shows.
              if (phone) setAriOpen(false);
            },
          }}
        />
      </Suspense>
    </AriBoundary>
  ) : null;

  const loading = planQuery.isLoading || controller.site.isLoading;
  const stateOne = !loading && plan !== null && plan.plan === null && plan.site === null && canManage;
  const askAri = free && canManage && !published && flow.isError === false;
  const brandStep = status.steps.find((row) => row.key === "brand");
  const openBrandCount = brandStep && (brandStep.status.kind === "open" || brandStep.status.kind === "needs_upload")
    ? brandStep.status.left
    : fields.filter((field) => field.requirement !== "optional" && field.state !== "verified" && field.state !== "not_applicable" && field.group === "Brand").length;

  const presenceCard = presence.kind === "free" ? null : (
        <SetupPresenceCard
          presence={presence}
          watching={watching}
          busy={takeOver.isPending || ctx.lock.takingOver}
          problem={flowProblem}
          onContinue={() => runTakeOver("continue")}
          onWatch={() => setWatching(true)}
          // The form's take over brings its own warning.
          onTakeOver={() => {
            if (presence.kind === "active" && presence.source === "hand") ctx.lock.takeOver();
            else setConfirmTake(true);
          }}
          onAskAdmin={() => ctx.askAdmin("plan")}
          asking={ctx.asking}
        />
  );

  const body = (
    <View style={styles.gapLarge} onTouchStart={() => { lastTouchRef.current = Date.now(); }}>
      {planQuery.isError ? (
        <Banner tone="err" icon="alert" title="We couldn't load your setup. Nothing is lost." testID="setup-load-error">
          <WButton label="Try again" size="sm" onPress={() => { void planQuery.refetch(); }} testID="setup-load-retry" />
        </Banner>
      ) : null}
      {presenceCard}
      {flowView?.lastTakeover && !flowView.mine && presence.kind === "free" ? (
        <Chip label={`${flowView.lastTakeover.toName} took over`} />
      ) : null}
      {flow.isError && ariOpen ? <Banner tone="info" icon="alert" title={ARI_UNAVAILABLE} testID="setup-ari-unavailable" /> : null}
      {!canManage && active && active.ownerOnly && active.status.kind !== "done" ? (
        <Banner tone="info" icon="msg" title="A brand admin or the owner does this step." testID="setup-needs-admin">
          <WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("plan")} loading={ctx.asking} testID="setup-ask" />
        </Banner>
      ) : null}
      {renderStep()}
    </View>
  );

  const takeDialog = (
    <ConfirmDialog
      visible={confirmTake}
      onClose={() => setConfirmTake(false)}
      onConfirm={() => {
        setConfirmTake(false);
        runTakeOver("take_over");
      }}
      title="Take over Website setup?"
      description={presence.kind === "active"
        ? `If you take over, ${nameInSentence(presence.name)}'s next answer won't save, and we'll tell ${nameInSentence(presence.name)} why.`
        : "Your teammate's next answer won't save, and we'll tell them why."}
      confirmLabel="Take over"
      testID="setup-take-over-confirm"
    />
  );

  if (loading) {
    return (
      <SafeScreen style={{ backgroundColor: canvas.discover }}>
        <View style={styles.loadingShell} role="status" accessibilityLabel="Loading your setup" testID="setup-loading">
          <View style={styles.loadingRail}>
            {status.steps.map((row) => <Skeleton key={row.key} height={38} />)}
          </View>
          <View style={styles.grow}>
            <Skeleton height={28} width="40%" />
            <Skeleton height={180} style={styles.loadingBlock} />
          </View>
        </View>
      </SafeScreen>
    );
  }

  if (stateOne && plan) {
    return (
      <SafeScreen style={{ backgroundColor: canvas.discover }}>
        <ScrollView contentContainerStyle={styles.startPane} keyboardShouldPersistTaps="handled">
          {/* A teammate already here: say who, and the start buttons do nothing (startWith). */}
          {presenceCard}
          <SetupStart
            brandName={brandName}
            openCount={openBrandCount}
            known={knownWords(plan)}
            onAri={() => startWith(true)}
            onHand={() => startWith(false)}
            busy={false}
            ariAvailable={!flow.isError}
          />
        </ScrollView>
        {takeDialog}
      </SafeScreen>
    );
  }

  const chip = active ? setupStepChip(active.status) : null;

  if (!phone) {
    return (
      <SafeScreen style={{ backgroundColor: canvas.discover }}>
        <View style={styles.flex}>
          <View style={styles.topbar}>
            <WButton label="Back to Website" size="sm" variant="ghost" onPress={() => router.replace(`/brand/${brandId}/website` as never)} testID="setup-back" />
            <Text style={styles.topTitle} role="heading" aria-level={1}>Website setup</Text>
            <Text style={styles.count} testID="setup-count">{`${status.doneCount} of ${status.total} done`}</Text>
            {askAri && !ariOpen ? <WButton label="Ask Ari" icon="spark" size="sm" variant="ghost" onPress={() => setAriOpen(true)} testID="setup-ask-ari" /> : null}
          </View>
          <View style={styles.bodyRow}>
            <ScrollView style={styles.rail} contentContainerStyle={styles.railContent}>
              <SetupStepList steps={status.steps} active={activeStep} canManage={canManage} published={published} onSelect={(key) => goStep(key)} />
            </ScrollView>
            <ScrollView style={styles.main} contentContainerStyle={styles.mainContent} keyboardShouldPersistTaps="handled">
              <View style={styles.mainInner}>{body}</View>
            </ScrollView>
            {ariOpen ? <View style={styles.ariColumn} testID="setup-ari-column">{ariPanel}</View> : null}
          </View>
        </View>
        {takeDialog}
      </SafeScreen>
    );
  }

  return (
    <SafeScreen style={{ backgroundColor: canvas.discover }}>
      <View style={styles.flex}>
        <View style={styles.phoneHead}>
          <View style={styles.phoneTitleRow}>
            <WButton label="Back" size="sm" variant="ghost" onPress={() => router.replace(`/brand/${brandId}/website` as never)} testID="setup-back" />
            <Text style={styles.phoneTitle} role="heading" aria-level={1} numberOfLines={1}>{active?.label ?? "Website setup"}</Text>
            {chip ? <Chip label={chip} tone={active?.status.kind === "failed" ? "err" : active?.status.kind === "done" ? "ok" : "warn"} testID="setup-chip" /> : null}
          </View>
          <View
            style={styles.pgbar}
            role="img"
            accessibilityRole="image"
            accessibilityLabel={`${status.doneCount} of ${status.total} steps done`}
            testID="setup-progress"
          >
            <View style={[styles.pgfill, { width: `${Math.round((status.doneCount / status.total) * 100)}%` }]} />
          </View>
          <WButton label={`Step ${activeIndex + 1} of ${status.total}. Show all steps`} size="sm" variant="ghost" onPress={() => setShowSteps(true)} testID="setup-show-steps" />
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.phoneBody} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
        {askAri ? (
          <View style={styles.phoneActions}>
            <WButton label="Ask Ari" icon="spark" grow onPress={() => setAriOpen(true)} testID="setup-ask-ari" />
          </View>
        ) : null}
      </View>
      <Sheet visible={showSteps} onClose={() => setShowSteps(false)} snapPoint="half">
        <View style={styles.sheetBody}>
          <CardTitle>All steps</CardTitle>
          <SetupStepList steps={status.steps} active={activeStep} canManage={canManage} published={published} onSelect={(key) => goStep(key)} />
          {active ? <View style={styles.hidden}><SetupMark step={active} /></View> : null}
        </View>
      </Sheet>
      {/* The form stays mounted behind Ari, so an answer shows up in its field. */}
      <Sheet visible={ariOpen} onClose={() => setAriOpen(false)} snapPoint="full">
        <View style={styles.flex} testID="setup-ari-sheet">{ariPanel}</View>
      </Sheet>
      {takeDialog}
    </SafeScreen>
  );
}

function knownWords(plan: SitePlanState): string | null {
  const known = (plan.completeness?.fields ?? [])
    .filter((field) => field.state === "verified" && ["name", "profile_photo", "description"].includes(field.key))
    .map((field) => (field.key === "name" ? "name" : field.key === "profile_photo" ? "logo" : "description"));
  if (known.length === 0) return null;
  return known.length === 1 ? known[0] : `${known.slice(0, -1).join(", ")} and ${known[known.length - 1]}`;
}

/** Design state 10: the real draft on the same screen, next steps beside it. */
function DraftReady({ grant, onPublish, onAdd, onAskAri, ariReady }: {
  grant: PreviewGrantState;
  onPublish: () => void;
  onAdd: () => void;
  onAskAri: () => void;
  ariReady: boolean;
}): React.ReactElement {
  const ctx = useWebsite();
  const preview = (
    <SitePreviewPanel
      grant={grant}
      preference={ctx.previewPreference}
      onPreference={ctx.setPreviewPreference}
      purpose="Your draft"
      onOpenFullScreen={ctx.openFullScreenPreview}
      variant={ctx.phone ? "sheet" : "side"}
    />
  );
  return (
    <View style={styles.gap} testID="setup-draft-ready">
      <View style={styles.readyBar}>
        <CardTitle>Your draft is ready</CardTitle>
        <Hint>Only your team can see it</Hint>
      </View>
      {preview}
      <View style={styles.gap}>
        {ctx.phone ? null : <CardTitle>What&apos;s next</CardTitle>}
        <WButton label="Check and publish" variant="primary" onPress={onPublish} testID="setup-go-publish" />
        <WButton label="Add your first trip or event" onPress={onAdd} testID="setup-add-first" />
        {ariReady ? <WButton label="Ask Ari to change something" variant="ghost" onPress={onAskAri} testID="setup-ask-change" /> : null}
      </View>
    </View>
  );
}

/** State 12 once published; Seth's draft line until then. */
function AddedNotice({ name, page, published, onPublish, onAddAnother }: {
  name: string;
  page: string;
  published: boolean;
  onPublish: () => void;
  onAddAnother: () => void;
}): React.ReactElement {
  return (
    <View style={styles.gap} testID={published ? "setup-added-published" : "setup-added-draft"}>
      {published ? (
        <>
          <CardTitle>{`${name} added to your website.`}</CardTitle>
          <Text style={styles.body}>{`It's on your ${page} page in this draft. It reaches the public when you publish your website.`}</Text>
        </>
      ) : (
        <Text style={styles.body}>{`${name} is saved as a draft. It shows on your website once you publish it.`}</Text>
      )}
      <View style={styles.row}>
        <WButton label="Check and publish" variant="primary" onPress={onPublish} testID="setup-go-publish" />
        <WButton label="Add another" onPress={onAddAnother} testID="setup-add-another" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  gap: { gap: 12 },
  gapLarge: { gap: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  body: { fontSize: 15, lineHeight: 22, color: ui.t2 },
  hidden: { display: "none" },
  loadingShell: { flexDirection: "row", gap: spacing.lg, padding: spacing.lg },
  loadingRail: { width: 210, gap: 4 },
  loadingBlock: { marginTop: 14 },
  startPane: { padding: spacing.lg, alignItems: "center" },
  topbar: { height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  topTitle: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: "700", color: ui.t1 } as TextStyle,
  count: { fontSize: 13, color: ui.t3 },
  bodyRow: { flex: 1, flexDirection: "row", minHeight: 0 },
  rail: { width: 240, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: ui.cardBorder },
  railContent: { padding: 14 },
  main: { flex: 1, minWidth: 0 },
  mainContent: { padding: spacing.lg, paddingBottom: 96 },
  mainInner: { maxWidth: websitePaneMaxWidth, width: "100%" },
  ariColumn: { flex: 1, minWidth: ariThread.websiteAriMinWidth, maxWidth: ariThread.websiteAriMaxWidth, borderLeftWidth: 1, borderLeftColor: ui.cardBorder },
  ariFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: spacing.lg },
  ariFallbackText: { fontSize: 15, lineHeight: 22, color: ui.t2, textAlign: "center" },
  phoneHead: { paddingHorizontal: 14, paddingTop: 8, gap: 8 },
  phoneTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  phoneTitle: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "600", color: ui.t1 },
  pgbar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255, 255, 255, 0.14)", overflow: "hidden" },
  pgfill: { height: "100%", backgroundColor: ui.accent },
  phoneBody: { padding: 14, paddingBottom: 120 },
  phoneActions: { padding: 14, gap: 8 },
  sheetBody: { padding: spacing.md, gap: 8 },
  readyBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
});
