import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeScreen } from "../../../ui/SafeScreen";
import { Sheet } from "../../../ui/Sheet";
import { Toast } from "../../../ui/Toast";
import { HostShellInsetContext } from "../../../ui/hostShellContext";
import { color, radius, space, websitePaneMaxWidth, websiteWorkspaceBarHeight, websiteWorkspacePanelWidth } from "../../../../constants/designSystem";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useBrandSiteLook } from "../../../../hooks/useBrandSite";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { useBrandSitePlanHeartbeat } from "../../../../sites/planApi";
import { useDraftChanges } from "../../../../sites/contentApi";
import { publishBlockingPairs } from "../../../../sites/designMoods";
import { saveStateLine } from "../../../../sites/draftWriter";
import { withDevice } from "../../../../sites/previewDevice";
import { buildMarks } from "../../../../sites/previewBridge";
import { undoTooltip } from "../../../../sites/sectionEdits";
import { designOfSettings, safeTokenOverrides } from "../../../../sites/siteLook";
import { teamRequestFromCouldnt, teamRequestFromSection, type AriSiteFocus } from "../../../../sites/ariWorkspace";
import { useSendTeamRequest, useTeamRequests, type TeamRequest } from "../../../../sites/teamRequestsPort";
import { publishBarButton, workspaceStatus, type WorkspaceStatusInput } from "../../../../sites/workspaceStatus";
import {
  detailSection,
  sectionJump,
  WORKSPACE_DETAIL_LABELS,
  workspaceTarget,
  workspaceTargetKey,
  type WorkspaceDetail,
  type WorkspaceMode,
} from "../../../../sites/workspaceRoute";
import type { CollectionSection as CollectionKind, WebsiteRoute } from "../../../../sites/websiteNav";
import type { WorkspaceSection } from "../../../../sites/contentApi";
import { WebsiteProvider, type StickyBar, type TopbarSave, type WebsiteContextValue } from "../WebsiteContext";
import { WorkspaceBrandSwitcher } from "../../../brand/WorkspaceBrandSwitcher";
import { LockBanner } from "../LockBanner";
import { NoticeBanner } from "../NoticeBanner";
import { Banner, Chip, Skeleton, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { OverviewSection } from "../sections/OverviewSection";
import { PagesSection } from "../sections/PagesSection";
import { CollectionSection } from "../sections/CollectionSection";
import { DestinationEditor } from "../sections/DestinationEditor";
import { StoryEditor } from "../sections/StoryEditor";
import { ReviewEditor } from "../sections/ReviewEditor";
import { PastTripsSection } from "../sections/PastTripsSection";
import { PublishSection } from "../sections/PublishSection";
import { AddressesSection } from "../sections/AddressesSection";
import { SettingsSection } from "../sections/SettingsSection";
import { AriPanel } from "./AriPanel";
import { DesignPanel } from "./DesignPanel";
import { EditPanel } from "./EditPanel";
import { LivePreview } from "./LivePreview";
import { MoreMenu, moreItems } from "./MoreMenu";
import { PublishPanel } from "./PublishPanel";
import { RequestsPane } from "./RequestsPane";
import { SectionAriCard } from "./SectionAriCard";
import { IconButton, ModeSwitch } from "./parts";
import { useLazyAriRun } from "./AriRunHost";
import type { AriTurn } from "./useAriRun";
import { useWorkspace, type WorkspaceToast } from "./useWorkspace";

/*
 * #4453 — the Website workspace. One screen for a site that exists: the left
 * panel holds every control (Ari · Edit · Design), the rest is the live
 * draft; one status chip, one Publish button, and a "more" menu for the
 * rest. Phones get the draft full screen with the same three modes in a
 * bottom sheet. Old Website addresses land here in the right place.
 */
const HEARTBEAT_MS = 120_000;
type Shown = Exclude<WebsiteRoute, { kind: "redirect" | "preview" | "setup" }>;

export function WorkspaceShell({ base, route, search, segments, contentDetails, dialogs, offlineDevice }: {
  base: WebsiteContextValue;
  route: Shown;
  search: Record<string, string | undefined>;
  segments: string[];
  /** The content lists this site has (Destinations, Stories, Reviews, Past trips). */
  contentDetails: readonly WorkspaceDetail[];
  dialogs: React.ReactNode;
  offlineDevice: boolean;
}): React.ReactElement {
  const { brandId, brandName, controller, lock } = base;
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const phone = !isWideDesktop;
  // The desktop shell's top bar already carries the brand switcher: one per screen.
  const shellHasSwitcher = useContext(HostShellInsetContext);
  const siteId = controller.siteId!;
  const site = controller.site.data ?? null;

  const [toast, setToast] = useState<WorkspaceToast | null>(null);
  const notify = useCallback((next: WorkspaceToast) => setToast(next), []);

  const target = useMemo(
    () => workspaceTarget(route, { mode: search.mode ?? null, panel: search.panel ?? null, request: search.request ?? null }, segments[0] === "overview"),
    [route, search.mode, search.panel, search.request, segments],
  );
  const readOnlyReason = lock.heldByOther
    ? `${lock.holderName ?? "A teammate"} is editing the website right now. Take over to make changes.`
    : !controller.capabilities.canEdit
      ? "You can look around, but only people who manage this brand’s website can change it."
      : null;
  const ws = useWorkspace({ brandId, siteId, controller, target, targetKey: workspaceTargetKey(target), readOnlyReason, notify });

  /* ── The lock: hold it while the design is being worked on ─────────── */
  const heartbeat = useBrandSitePlanHeartbeat(brandId);
  const beat = useRef(heartbeat.mutate);
  beat.current = heartbeat.mutate;
  const holdsLock = base.plan?.canManage === true && ws.mode === "design" && ws.detail === null && !lock.heldByOther;
  useEffect(() => {
    if (!holdsLock) return undefined;
    beat.current();
    const timer = setInterval(() => beat.current(), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [holdsLock]);

  /* ── Ari and team requests ─────────────────────────────────────────── */
  const pageTitleOf = useCallback((pagePath: string | null) => {
    // Null is "the whole website", not the home page.
    if (pagePath === null) return null;
    const clean = pagePath.replace(/^\/+|\/+$/g, "");
    return ws.pages.find((entry) => (entry.path ?? "") === clean)?.title ?? null;
  }, [ws.pages]);
  const allPageIds = useMemo(() => ws.pages.map((entry) => entry.id), [ws.pages]);
  const afterChange = ws.afterChange;
  const { run, host: ariHost } = useLazyAriRun({
    brandId,
    blockedReason: readOnlyReason,
    pageTitleOf,
    onActiveSection: ws.setAriSectionId,
    onDraftChanged: () => afterChange({ pages: allPageIds, look: true, menu: true }),
  });
  const [ariDraft, setAriDraft] = useState("");
  const [teamSent, setTeamSent] = useState(false);
  const [panelSheet, setPanelSheet] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const teamRequests = useTeamRequests(brandId);
  const sendTeam = useSendTeamRequest();
  const moreRef = useRef<View | null>(null);
  const publishRef = useRef<View | null>(null);

  const showMode = (mode: WorkspaceMode) => {
    ws.setMode(mode);
    if (phone) setPanelSheet(true);
  };
  const focusOf = (section: WorkspaceSection | null): AriSiteFocus | null => (section && ws.page
    ? { page_id: ws.page.id, page_path: ws.page.path ?? "", section_id: section.id, section_type: section.type, section_label: section.label }
    : null);
  const askAri = (text: string, section: WorkspaceSection | null): string | null => {
    const refused = run.ask(text, focusOf(section));
    if (refused) return refused;
    setTeamSent(false);
    ws.closeCard();
    showMode("ari");
    return null;
  };
  const openTeamDraft = (draft: Parameters<typeof run.openTeamDraft>[0], turnId: string | null = null) => {
    setTeamSent(false);
    run.openTeamDraft(draft, turnId);
    ws.closeCard();
    showMode("ari");
  };
  const sendTeamRequest = async (what: string): Promise<string | null> => {
    const current = run.teamDraft;
    if (!current) return "That request is no longer open.";
    if (current.pendingActionId) {
      const result = await run.confirmTeamDraft(what);
      if (!result.ok) return result.message;
    } else {
      try {
        await sendTeam.send({
          brandId,
          siteId,
          what,
          where: current.draft.where,
          why: current.draft.why,
          missingCapability: current.draft.missingCapability,
          draftDigest: ws.workspace?.draft_digest ?? "",
        });
      } catch (error) {
        return error instanceof Error && error.message ? error.message : "The request wasn’t sent. Check your connection and try again.";
      }
    }
    run.closeTeamDraft();
    setTeamSent(true);
    teamRequests.refetch();
    return null;
  };
  const undoRun = async (turn: AriTurn): Promise<boolean> => {
    // Only ever Ari's own change set: without its id, the top Undo button is
    // the owner's call (it steps back the latest change, whoever made it).
    const groupId = turn.result?.groupId ?? null;
    if (!groupId) {
      notify({ message: "I can’t tell which change that was. Use Undo at the top to step back one change at a time.", kind: "info" });
      return false;
    }
    const done = await ws.undoGroup(groupId);
    if (done) run.settle(turn.id, "undone");
    return done;
  };
  const keepRun = (turn: AriTurn) => {
    if (!turn.result?.ok) return;
    const byPage = new Map<string, string[]>();
    for (const touched of turn.result.touched) byPage.set(touched.pageId, [...(byPage.get(touched.pageId) ?? []), touched.sectionId]);
    byPage.forEach((ids, pageId) => ws.looksGood(pageId, ids));
    run.settle(turn.id, "kept");
  };

  /* ── A team request opened from its notification (?request=<id>) ───── */
  const pageOfRequest = useCallback((request: TeamRequest) => (request.pagePath === null
    ? null
    : ws.pages.find((entry) => (entry.path ?? "") === request.pagePath) ?? null), [ws.pages]);
  const focusedRequest = useRef<string | null>(null);
  const preselect = ws.preselect;
  useEffect(() => {
    const requestId = ws.requestId;
    if (!requestId) {
      focusedRequest.current = null;
      return;
    }
    if (focusedRequest.current === requestId || ws.pages.length === 0) return;
    const request = teamRequests.requests.find((entry) => entry.ticketId === requestId);
    if (!request) return;
    focusedRequest.current = requestId;
    // The Requests list stays in front with this request marked; the page and
    // section it is about are already chosen and in view behind it.
    const page = pageOfRequest(request);
    if (page) preselect(page.id, request.sectionId);
  }, [pageOfRequest, preselect, teamRequests.requests, ws.pages.length, ws.requestId]);

  /* ── Status, Publish ───────────────────────────────────────────────── */
  const changes = useDraftChanges(siteId);
  const look = useBrandSiteLook(brandId, siteId);
  const unreadablePairs = useMemo(() => (look.data
    ? publishBlockingPairs(designOfSettings(look.data), safeTokenOverrides(look.data.tokens))
    : 0), [look.data]);
  const operation = controller.publicationOperation;
  const receipt = controller.publicationReceipt.data ?? null;
  const statusInput: WorkspaceStatusInput = {
    live: Boolean(site?.active_publication_id),
    offline: Boolean(site?.owner_offline_at),
    unpublished: changes.data ? changes.data.changes.length : null,
    unread: ws.unread,
    publishing: (operation !== null && receipt?.status !== "succeeded" && receipt?.status !== "failed") || site?.status === "publishing",
    failed: operation !== null && receipt?.status === "failed",
  };
  const status = workspaceStatus(statusInput);
  const publishButton = publishBarButton({ ...statusInput, canPublish: controller.capabilities.canPublish }, phone);
  const host = site?.brand_site_hosts.find((entry) => entry.is_primary)?.hostname ?? null;
  const liveHost = statusInput.live ? host : null;

  const published = controller.publishedJustNow;
  const seenPublished = useRef(published);
  const closePublish = ws.closePublish;
  const openUrl = controller.actions.openUrl;
  useEffect(() => {
    if (seenPublished.current === published) return;
    seenPublished.current = published;
    if (!published) return;
    closePublish();
    notify({
      message: published === "rollback" ? "That version is live again." : "Live. Visitors see your changes now.",
      kind: "success",
      ...(host ? { action: { label: "View site", onPress: () => openUrl(`https://${host}`) } } : {}),
    });
  }, [closePublish, host, notify, openUrl, published]);

  /* ── What the existing section screens see ─────────────────────────── */
  const [stickyBar, setStickyBar] = useState<StickyBar | null>(null);
  const [topbarSave, setTopbarSave] = useState<TopbarSave | null>(null);
  const baseGo = base.go;
  const baseBack = base.back;
  const { setMode, openDetail, closeDetail, openPublish } = ws;
  const go = useCallback<WebsiteContextValue["go"]>((next) => {
    if (next.kind !== "section" || next.section === "plan") {
      baseGo(next);
      return;
    }
    const jump = sectionJump(next.section);
    if (jump.mode) setMode(jump.mode);
    if (jump.detail) openDetail(jump.detail);
    else if (jump.detail === null) closeDetail();
    if (jump.publish) openPublish();
  }, [baseGo, closeDetail, openDetail, openPublish, setMode]);
  const value: WebsiteContextValue = {
    ...base,
    phone,
    section: detailSection(ws.detail, ws.mode),
    go,
    back: route.kind === "editor" ? baseBack : closeDetail,
    toast: (message, kind = "info") => notify({ message, kind }),
    editPage: (pageId) => {
      ws.selectPage(pageId);
      ws.setMode("edit");
    },
    setStickyBar,
    setTopbarSave,
  };

  const closeMore = useCallback(() => {
    setMoreOpen(false);
    (moreRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);
  const closePublishPanel = useCallback(() => {
    closePublish();
    (publishRef.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [closePublish]);
  const items = moreItems({
    content: contentDetails,
    requestsReady: teamRequests.requests.filter((entry) => entry.status === "ready").length,
    requestsOpen: teamRequests.requests.filter((entry) => entry.status === "received").length,
    showSetup: site?.last_successful_publication_id === null,
    onSetup: () => baseGo({ kind: "setup", step: null }),
    onFullScreen: base.openFullScreenPreview,
  });

  const exit = () => (router.canGoBack() ? router.back() : router.replace(`/brand/${brandId}` as never));
  const say = (reason: string) => notify({ message: reason, kind: "info" });
  const history = ws.history;
  const undoBlocked = readOnlyReason ?? (ws.workspaceDown ? "Undo isn’t available right now." : !history?.can_undo ? "Nothing to undo yet" : null);
  const redoBlocked = readOnlyReason ?? (ws.workspaceDown ? "Redo isn’t available right now." : !history?.can_redo ? "Nothing to redo" : null);
  const undoRedo = (
    <>
      <IconButton icon="undo" label={undoTooltip("undo", history?.undo_label, !undoBlocked)} onPress={() => { void ws.undo(); }} disabledReason={undoBlocked} onDisabledPress={say} busy={ws.undoing === "undo"} testID="workspace-undo" />
      <IconButton icon="redo" label={undoTooltip("redo", history?.redo_label, !redoBlocked)} onPress={() => { void ws.redo(); }} disabledReason={redoBlocked} onDisabledPress={say} busy={ws.undoing === "redo"} testID="workspace-redo" />
    </>
  );

  const banners = (
    <>
      {lock.heldByOther ? <View style={styles.banner}><LockBanner section={detailSection(null, ws.mode)} /></View> : null}
      {offlineDevice ? (
        <View style={styles.banner}>
          <Banner tone="warn" icon="alert" title="You’re offline" body="You can look around. Changes are saved once you’re back online." testID="workspace-offline">
            <WButton label="Try again" size="sm" onPress={ws.retry} testID="workspace-offline-retry" />
          </Banner>
        </View>
      ) : ws.workspaceDown ? (
        <View style={styles.banner}>
          <Banner tone="err" icon="alert" title="Mingla’s website service isn’t answering" body="Your live website isn’t affected. Editing is paused until it’s back." alert testID="workspace-down">
            <WButton label="Try again" size="sm" onPress={ws.retry} testID="workspace-down-retry" />
          </Banner>
        </View>
      ) : null}
    </>
  );

  const selectedSection = ws.sections.find((entry) => entry.id === ws.cardFor) ?? null;
  const card = selectedSection ? (
    <SectionAriCard
      section={selectedSection}
      sheet={phone}
      disabledReason={readOnlyReason ?? (run.working ? "Ari is still working on your last request." : null)}
      onAsk={(text) => askAri(text, selectedSection)}
      onEditByHand={() => {
        ws.select(selectedSection.id, { expand: true });
        showMode("edit");
      }}
      onAskTeam={(typed) => openTeamDraft(teamRequestFromSection({
        typed, pageTitle: ws.page?.title ?? null, pagePath: ws.page?.path ?? "", sectionId: selectedSection.id, sectionLabel: selectedSection.label,
      }))}
      onClose={ws.closeCard}
    />
  ) : null;

  const marks = useMemo(() => buildMarks({ sections: ws.sections, selected: ws.selectedId, ari: ws.ariSectionId }), [ws.ariSectionId, ws.sections, ws.selectedId]);
  const preference = phone ? withDevice(base.previewPreference, "phone") : base.previewPreference;
  const preview = (
    <View style={styles.fill} testID="workspace-preview">
      {ws.previewState === "error" ? (
        <View style={styles.stageNote} testID="workspace-preview-error">
          <Text style={styles.stageTitle}>Your draft preview couldn’t be built</Text>
          <Text style={styles.stageBody}>Your live website isn’t affected. Your changes are still saved.</Text>
          <WButton label="Try again" variant="primary" size="sm" onPress={ws.retry} testID="workspace-preview-retry" />
        </View>
      ) : ws.page && !ws.pagePreviewable ? (
        <View style={styles.stageNote} testID="workspace-preview-off">
          <Text style={styles.stageTitle}>{ws.page.enabled ? "This page has no address yet" : `“${ws.page.title}” is off`}</Text>
          <Text style={styles.stageBody}>
            {ws.page.enabled
              ? "It can’t be shown until it has an address. Open Pages and menu to give it one."
              : "Visitors can’t open it, so there is no draft page to show. Its sections are kept: turn the page on to see and publish it."}
          </Text>
          {ws.page.enabled
            ? <WButton label="Open Pages and menu" size="sm" onPress={() => ws.openDetail("pages")} testID="workspace-preview-off-pages" />
            : <WButton label="Turn this page on" variant="primary" size="sm" onPress={() => { void ws.togglePage(ws.page!, true); }} disabled={readOnlyReason !== null} accessibilityLabel={readOnlyReason ? `Turn this page on. ${readOnlyReason}` : "Turn this page on"} testID="workspace-preview-off-turn-on" />}
        </View>
      ) : ws.frameUrl === null ? (
        <View style={styles.stageNote} role="status" accessibilityLabel="Building your draft preview" testID="workspace-preview-loading">
          <Skeleton height={48} width="60%" /><Skeleton height={160} /><Skeleton height={96} />
        </View>
      ) : (
        <LivePreview
          ref={ws.previewRef}
          url={ws.frameUrl}
          pageKey={ws.page?.id ?? null}
          preference={preference}
          editMode
          marks={marks}
          tokenDeclarations={base.tokenDeclarations}
          selectedId={ws.cardFor}
          onSelect={(sectionId) => ws.select(sectionId, { card: true })}
          onRetry={ws.retry}
          renderCard={!phone && card ? () => card : null}
        />
      )}
    </View>
  );

  const panelBody = ws.mode === "ari" ? (
    <AriPanel
      run={run}
      disabledReason={readOnlyReason}
      draftText={ariDraft}
      onDraftText={setAriDraft}
      onUndoRun={undoRun}
      onKeepRun={keepRun}
      onAskTeam={(turn) => openTeamDraft(teamRequestFromCouldnt({
        request: turn.request,
        couldnt: turn.result?.ok ? (turn.result.couldnt.length ? turn.result.couldnt : turn.plan?.couldnt ?? []) : turn.plan?.couldnt ?? [],
        pageTitle: ws.page?.title ?? null,
        pagePath: ws.page?.path ?? "",
        focus: turn.focus,
      }), turn.id)}
      onSendTeam={sendTeamRequest}
      teamSent={teamSent}
      onOpenRequests={() => { setTeamSent(false); setPanelSheet(false); ws.openDetail("requests"); }}
      onOpenFullAri={() => router.push(`/brand/${encodeURIComponent(brandId)}/website/ari?intent=chat` as never)}
    />
  ) : (
    <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" testID="workspace-panel-scroll">
      {ws.mode === "edit" ? (
        <EditPanel
          ws={ws}
          onAskAri={(section) => {
            ws.select(section.id, { card: true });
            if (phone) setPanelSheet(false);
          }}
          onManagePages={() => { setPanelSheet(false); ws.openDetail("pages"); }}
          onRenameInMenu={(title) => {
            setAriDraft(`Rename “${title}” in the menu to `);
            showMode("ari");
          }}
        />
      ) : (
        <DesignPanel ws={ws} onAskAri={(request) => { const refused = askAri(request, null); if (refused) say(refused); }} />
      )}
    </ScrollView>
  );

  const detailBody = ws.detail ? (
    <DetailBody
      detail={ws.detail}
      route={route}
      requests={(
        <RequestsPane
          requests={teamRequests.requests}
          loading={teamRequests.isLoading}
          failed={teamRequests.isError}
          onRetry={teamRequests.refetch}
          highlightId={ws.requestId}
          pageTitleOf={pageTitleOf}
          onRead={(request) => {
            const page = pageOfRequest(request);
            if (page && request.sectionId) {
              ws.showSection(page.id, request.sectionId);
              return;
            }
            if (page) ws.selectPage(page.id);
            ws.setMode("edit");
          }}
          onAsk={() => openTeamDraft(teamRequestFromSection({ typed: "", pageTitle: ws.page?.title ?? null, pagePath: ws.page?.path ?? "", sectionId: null, sectionLabel: null }))}
        />
      )}
    />
  ) : null;
  const detailTitle = ws.detail ? WORKSPACE_DETAIL_LABELS[ws.detail] : "";
  const detailPane = ws.detail ? (
    <View style={styles.detail} testID={`workspace-detail-${ws.detail}`}>
      <View style={styles.detailBar}>
        <IconButton icon={phone ? "left" : "close"} label={route.kind === "editor" ? `Back to ${detailTitle}` : phone ? "Back to your page" : `Close ${detailTitle} and go back to your page`} onPress={value.back} testID="workspace-detail-close" />
        <Text style={styles.detailTitle} numberOfLines={1}>{detailTitle}</Text>
        {topbarSave && route.kind === "editor" && phone ? (
          <WButton label={topbarSave.label} variant="primary" size="sm" onPress={topbarSave.onPress} loading={topbarSave.loading} disabled={topbarSave.disabled} testID={topbarSave.testID} />
        ) : !phone ? <WButton label="Back to your page" size="sm" onPress={ws.closeDetail} testID="workspace-detail-back" /> : null}
      </View>
      <ScrollView style={styles.fill} contentContainerStyle={phone ? styles.detailContentPhone : styles.detailContent} keyboardShouldPersistTaps="handled">
        <View style={styles.detailInner}>
          <NoticeBanner />
          {detailBody}
        </View>
      </ScrollView>
      {stickyBar ? (
        <View style={styles.sticky} role="region" accessibilityLabel={stickyBar.text} testID="website-sticky-bar">
          <Text style={styles.stickyText}>{stickyBar.text}</Text>
          {stickyBar.actions.map((action) => (
            <WButton key={action.label} label={action.label} variant={action.variant} onPress={action.onPress} loading={action.loading} disabled={action.disabled} testID={action.testID} />
          ))}
        </View>
      ) : null}
    </View>
  ) : null;

  const statusChip = <Chip label={status.text} tone={status.tone} testID="workspace-status" />;
  const publishControl = (
    <WButton
      ref={publishRef}
      label={publishButton.label}
      variant={publishButton.primary ? "primary" : "secondary"}
      size="sm"
      onPress={ws.openPublish}
      accessibilityLabel={`${publishButton.label}. Opens the Publish panel. ${status.text}`}
      testID="workspace-publish"
    />
  );
  const moreButton = (
    <IconButton ref={moreRef} icon="more" label="More: stats, history, address, settings, requests" onPress={() => setMoreOpen((open) => !open)} expanded={moreOpen} hasPopup testID="workspace-more" />
  );
  const overlays = (
    <>
      {ariHost}
      <PublishPanel ws={ws} visible={ws.publishOpen} onClose={closePublishPanel} unreadablePairs={unreadablePairs} onOpenDesign={() => showMode("design")} offlineDevice={offlineDevice} />
      {dialogs}
      <Toast visible={toast !== null} kind={toast?.kind ?? "info"} message={toast?.message ?? ""} action={toast?.action} onDismiss={() => setToast(null)} testID="website-toast" />
    </>
  );
  const saveLine = saveStateLine(ws.saveState, readOnlyReason !== null);

  if (!phone) {
    return (
      <WebsiteProvider value={value}>
        <SafeScreen style={{ backgroundColor: color.canvas }}>
          <View style={styles.desktop} testID="website-workspace">
            <View style={styles.panel} role="complementary" accessibilityLabel="Website controls" testID="workspace-panel">
              <View style={styles.panelHead}>
                <IconButton icon="left" label={`Back to ${brandName}`} onPress={exit} testID="website-back" />
                <BrandHead brandId={brandId} line={saveLine} switcher={!shellHasSwitcher} />
                {undoRedo}
              </View>
              <View style={styles.modes}><ModeSwitch mode={ws.mode} onChange={ws.setMode} /></View>
              {banners}
              <View style={styles.fill} role="tabpanel" accessibilityLabel={`${ws.mode === "ari" ? "Ari" : ws.mode === "edit" ? "Edit" : "Design"} controls`}>{panelBody}</View>
            </View>
            <View style={styles.main}>
              <View style={styles.bar} testID="workspace-bar">
                <View style={styles.devices} role="radiogroup" accessibilityRole="radiogroup" accessibilityLabel="Preview size">
                  {(["desktop", "phone"] as const).map((device) => {
                    const on = base.previewPreference.device === device || (device === "desktop" && base.previewPreference.device === "tablet");
                    return (
                      <Pressable
                        key={device}
                        onPress={() => base.setPreviewPreference(withDevice(base.previewPreference, device))}
                        role="radio"
                        accessibilityRole="radio"
                        aria-checked={on}
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={device === "desktop" ? "Desktop size" : "Phone size"}
                        testID={`workspace-device-${device}`}
                        style={[styles.device, on ? styles.deviceOn : null]}
                      >
                        <WebsiteIcon name={device === "desktop" ? "monitor" : "phone"} size={16} color={on ? ui.t1 : ui.t3} />
                        <Text style={[styles.deviceText, on ? styles.deviceTextOn : null]}>{device === "desktop" ? "Desktop" : "Phone"}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {liveHost ? (
                  <Pressable onPress={() => openUrl(`https://${liveHost}`)} role="link" accessibilityRole="link" accessibilityLabel={`Open your live website, ${liveHost}, in a new tab`} style={styles.address} testID="workspace-address">
                    <Text style={styles.addressText} numberOfLines={1}>{liveHost}</Text>
                    <WebsiteIcon name="ext" size={14} color={color.infoText} />
                  </Pressable>
                ) : (
                  <Text style={[styles.addressOff, styles.address]} numberOfLines={1} testID="workspace-address-off">{host ? `${host} · not live yet` : "Not live yet"}</Text>
                )}
                {statusChip}
                {moreButton}
                {publishControl}
              </View>
              <View style={styles.stageWrap}>
                <View style={[styles.fill, ws.detail ? styles.hidden : null]} aria-hidden={ws.detail ? true : undefined}>{preview}</View>
                {detailPane}
              </View>
              <MoreMenu visible={moreOpen} phone={false} items={items} onDetail={ws.openDetail} onClose={closeMore} />
            </View>
          </View>
          {overlays}
        </SafeScreen>
      </WebsiteProvider>
    );
  }

  // ── Phones, tablets and narrow web ───────────────────────────────────
  return (
    <WebsiteProvider value={value}>
      <SafeScreen style={{ backgroundColor: color.canvas }}>
        <View style={styles.phone} testID="website-workspace-phone">
          <View style={styles.phoneBar}>
            <IconButton icon="left" label={`Back to ${brandName}`} onPress={exit} testID="website-back" />
            <BrandHead brandId={brandId} line={saveLine} switcher />
            {moreButton}
            {publishControl}
          </View>
          <View style={styles.phoneStatus}>{statusChip}</View>
          {banners}
          {ws.detail ? detailPane : (
            <>
              {preview}
              <View style={styles.phoneDock} testID="workspace-dock">
                {undoRedo}
                <View style={styles.dockModes}>
                  {(["ari", "edit", "design"] as const).map((mode) => (
                    <WButton key={mode} label={mode === "ari" ? "Ari" : mode === "edit" ? "Edit" : "Design"} icon={mode === "ari" ? "spark" : undefined} size="sm" grow onPress={() => showMode(mode)} accessibilityLabel={`Open ${mode === "ari" ? "Ari" : mode === "edit" ? "Edit" : "Design"} controls`} testID={`workspace-dock-${mode}`} />
                  ))}
                </View>
              </View>
            </>
          )}
        </View>
        <Sheet visible={panelSheet && ws.detail === null} onClose={() => setPanelSheet(false)} snapPoint="full" testID="workspace-panel-sheet">
          <View style={styles.sheetPanel} accessibilityLabel="Website controls">
            <View style={styles.modes}><ModeSwitch mode={ws.mode} onChange={ws.setMode} /></View>
            <View style={styles.fill}>{panelBody}</View>
          </View>
        </Sheet>
        <Sheet visible={card !== null && !panelSheet} onClose={ws.closeCard} snapPoint="half" testID="section-ari-sheet">
          <View style={styles.cardSheet}>{card}</View>
        </Sheet>
        <MoreMenu visible={moreOpen} phone items={items} onDetail={ws.openDetail} onClose={() => setMoreOpen(false)} />
        {overlays}
      </SafeScreen>
    </WebsiteProvider>
  );
}

/**
 * The brand being edited, as the app's brand switcher (it always names this
 * screen's brand; choosing another opens that brand's Website), with the
 * autosave state under it. Where the app's top bar already shows the switcher
 * (desktop), only the autosave state is shown: one switcher per screen.
 */
function BrandHead({ brandId, line, switcher }: { brandId: string; line: string; switcher: boolean }): React.ReactElement {
  return (
    <View style={styles.brandHead} testID="workspace-brand-slot">
      {switcher ? <WorkspaceBrandSwitcher brandId={brandId} compact testID="workspace-brand-switcher" /> : null}
      <Text style={[styles.saveLine, switcher ? null : styles.saveLineAlone]} numberOfLines={1} role="status" accessibilityLiveRegion="polite" testID="workspace-save-state">{line}</Text>
    </View>
  );
}

function DetailBody({ detail, route, requests }: { detail: WorkspaceDetail; route: Shown; requests: React.ReactNode }): React.ReactElement {
  if (route.kind === "editor") {
    return route.section === "destinations" ? <DestinationEditor entryId={route.entryId} />
      : route.section === "stories" ? <StoryEditor entryId={route.entryId} /> : <ReviewEditor entryId={route.entryId} />;
  }
  switch (detail) {
    case "stats": return <OverviewSection />;
    case "history": return <PublishSection variant="history" />;
    case "addresses": return <AddressesSection />;
    case "settings": return <SettingsSection />;
    case "requests": return <>{requests}</>;
    case "pages": return <PagesSection />;
    case "past": return <PastTripsSection />;
    default: return <CollectionSection section={detail as CollectionKind} />;
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, minWidth: 0 },
  // Out of sight behind a "more" screen, but still LAID OUT: a frame with no layout reports every
  // section at top 0 and height 0, and a rebuilt draft would never paint or say it is ready.
  hidden: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, visibility: "hidden", pointerEvents: "none" } as object,
  desktop: { flex: 1, flexDirection: "row", minHeight: 0 },
  panel: { width: websiteWorkspacePanelWidth, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: ui.cardBorder, minHeight: 0 },
  // The switcher keeps its 44pt target; the save line tucks under its name inside the 56pt bar.
  brandHead: { flex: 1, minWidth: 0, justifyContent: "center", alignItems: "flex-start" },
  saveLine: { marginTop: -10, fontSize: 12, lineHeight: 16, color: ui.t3, pointerEvents: "none" },
  saveLineAlone: { marginTop: 0, fontSize: 13, lineHeight: 18, color: ui.t2 },
  panelHead: { height: websiteWorkspaceBarHeight, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  modes: { paddingHorizontal: space[3], paddingVertical: space[2] },
  banner: { paddingHorizontal: space[3], paddingTop: space[2] },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  bar: { height: websiteWorkspaceBarHeight, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  devices: { flexDirection: "row", padding: 3, gap: 2, borderRadius: radius.sm, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.cardBorder },
  device: { minHeight: 36, minWidth: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: radius.xs },
  deviceOn: { backgroundColor: color.fill.railOn },
  deviceText: { fontSize: 13, color: ui.t3 },
  deviceTextOn: { color: ui.t1, fontWeight: "600" },
  address: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 },
  addressText: { flexShrink: 1, fontSize: 13, color: color.infoText },
  addressOff: { fontSize: 13, color: ui.t3, textAlignVertical: "center", lineHeight: 44 },
  stageWrap: { flex: 1, minHeight: 0 },
  stageNote: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3], padding: space[6] },
  stageTitle: { fontSize: 17, fontWeight: "600", color: ui.t1, textAlign: "center" },
  stageBody: { fontSize: 14, lineHeight: 20, color: ui.t2, textAlign: "center", maxWidth: 420 },
  detail: { flex: 1, minHeight: 0, backgroundColor: color.canvas },
  detailBar: { minHeight: websiteWorkspaceBarHeight, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  detailTitle: { flex: 1, fontSize: 17, fontWeight: "600", color: ui.t1 },
  detailContent: { paddingTop: space[6], paddingHorizontal: space[7], paddingBottom: 96 },
  detailContentPhone: { padding: space[4], paddingBottom: 140 },
  detailInner: { width: "100%", maxWidth: websitePaneMaxWidth },
  sticky: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingVertical: 12, paddingHorizontal: space[4], borderTopWidth: 1, borderTopColor: ui.border2, backgroundColor: color.canvas },
  stickyText: { flex: 1, minWidth: 140, fontSize: 13, color: ui.t2 },
  phone: { flex: 1, minHeight: 0 },
  phoneBar: { minHeight: websiteWorkspaceBarHeight, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  phoneStatus: { flexDirection: "row", paddingHorizontal: space[3], paddingVertical: 6 },
  phoneDock: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: ui.cardBorder, backgroundColor: color.canvas },
  dockModes: { flex: 1, flexDirection: "row", gap: 6 },
  sheetPanel: { flex: 1, minHeight: 420 },
  cardSheet: { paddingBottom: space[2] },
});
