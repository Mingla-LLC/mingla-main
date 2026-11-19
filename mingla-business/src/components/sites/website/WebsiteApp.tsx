import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeScreen } from "../../ui/SafeScreen";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Toast } from "../../ui/Toast";
import {
  color,
  radius,
  space,
  websitePaneMaxWidth,
  websiteRailWidth,
} from "../../../constants/designSystem";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import { useBrandSiteDomains } from "../../../hooks/useBrandSite";
import {
  navRowAccessibilityLabel,
  parseWebsitePath,
  PREVIEW_PURPOSE,
  routeToRender,
  sectionInNav,
  showsPublishStep,
  SECTION_LABELS,
  websiteNavGroups,
  websitePath,
  type WebsiteNavGroup,
  type WebsiteRoute,
  type WebsiteSection,
} from "../../../sites/websiteNav";
import { fullScreenPreviewPath, preferenceFromQuery } from "../../../sites/previewDevice";
import { DESIGNS, designFor } from "../../../../../packages/site-contracts/src/designs.ts";
import { useBrandSitePlan, useBrandSitePlanHeartbeat, useTakeOverBrandSitePlan } from "../../../sites/planApi";
import {
  ASK_WORDS,
  useAskAdmin,
  useContentList,
  useDraftChanges,
  usePastTrips,
  useSitePages,
  type AdminAsk,
  type ReviewSummary,
} from "../../../sites/contentApi";
import type { StudioReturnResult } from "../../../sites/websiteJourney";
import { BrandSitesError } from "../../../services/brandSitesService";
import { useWebsiteController, type WebsiteController } from "./useWebsiteController";
import { WebsiteProvider, useWebsite, type StickyBar, type TopbarSave, type WebsiteContextValue } from "./WebsiteContext";
import { WebsiteIcon } from "./WebsiteIcon";
import { Banner, Chip, LoadingPane, WButton, Card, CardTitle, Body, ui } from "./ui";
import { SiteStatusChip } from "./StatusChip";
import { SitePreviewPanel, type PreviewGrantState } from "./preview/SitePreviewPanel";
import { FullScreenPreviewBar } from "./preview/FullScreenPreviewBar";
import { NoticeBanner } from "./NoticeBanner";
import { LockBanner } from "./LockBanner";
// #2829 W11 — every scroll area through the keyboard-aware wrapper (ORCH-0892).
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { usePreviewDevicePreference } from "./preview/usePreviewDevicePreference";
import { OverviewSection } from "./sections/OverviewSection";
import { WebsiteSetupScreen } from "../setup/WebsiteSetupScreen";
import { isSetupReturn } from "../../../utils/brandEditReturn";
import { WorkspaceShell } from "./workspace/WorkspaceShell";

// #4453 — Ari's page plan sheet (web) loads through this chunk; see
// components/ari/LazySitePagePlanSheet.web.tsx.
export { SitePagePlanSheet } from "../../ari/SitePagePlanSheet";

const STUDIO_RESULTS = new Set<StudioReturnResult>(["exchange_expired", "session_expired", "preview_expired", "preview_publish"]);

/**
 * #2829 W9r / #4453 — every Website address renders here (old addresses
 * redirect), so the owner never loses their place:
 *  - a site that exists opens in the Website workspace (workspace/WorkspaceShell);
 *  - Website setup is its own screen (setup/WebsiteSetupScreen);
 *  - a brand with no site yet, a draft still being created, and a site that
 *    could not be loaded get the small shell below: the Overview (what to do
 *    next), a loading state, or "try again". No section of an existing site
 *    is drawn by that shell any more.
 */
export default function WebsiteApp({ brandId, segments, search }: {
  brandId: string;
  segments: string[];
  search: Record<string, string | undefined>;
}): React.ReactElement {
  const safeBrandId = brandId;
  const route = parseWebsitePath(brandId, segments, { part: search.part ?? null, step: search.step ?? null });
  const studioResult = STUDIO_RESULTS.has(search.studioResult as StudioReturnResult) ? (search.studioResult as StudioReturnResult) : null;
  const section: WebsiteSection = route.kind === "section" ? route.section : route.kind === "editor" ? route.section : route.kind === "setup" ? "plan" : "overview";
  const controller = useWebsiteController(safeBrandId, studioResult, showsPublishStep(route));
  const { canCheckAvailability, websiteAvailable } = controller;

  if (route.kind === "redirect") return <Redirect href={route.to as never} />;
  if (!controller.globallyEnabled) return <Redirect href={`/brand/${safeBrandId}` as never} />;
  // Core said this member gets nothing here (or the brand has no website access).
  if (canCheckAvailability && websiteAvailable === false) {
    return <Redirect href={`/brand/${safeBrandId}` as never} />;
  }
  if (websiteAvailable !== true) {
    return (
      <SafeScreen style={{ backgroundColor: color.canvas }}>
        <View style={styles.loadingShell}>
          <LoadingPane />
        </View>
      </SafeScreen>
    );
  }
  return (
    <WebsiteWorkspace
      brandId={safeBrandId}
      route={route}
      section={section}
      segments={segments}
      search={search}
      controller={controller}
      capabilities={controller.capabilities}
    />
  );
}

function WebsiteWorkspace(props: {
  brandId: string;
  route: Exclude<WebsiteRoute, { kind: "redirect" }>;
  section: WebsiteSection;
  segments: string[];
  search: Record<string, string | undefined>;
  controller: WebsiteController;
  capabilities: WebsiteController["capabilities"];
}): React.ReactElement | null {
  const canPublish = props.capabilities.canPublish;
  const canProvision = props.capabilities.canCreate;
  // Members Core gives no Website capability get nothing (availability answer, A5).
  if (!props.capabilities.canEdit && !canPublish && !canProvision) return null;
  return <WorkspaceBody {...props} />;
}

function WorkspaceBody({ brandId, route, section, segments, search, controller }: {
  brandId: string;
  route: Exclude<WebsiteRoute, { kind: "redirect" }>;
  section: WebsiteSection;
  segments: string[];
  search: Record<string, string | undefined>;
  controller: WebsiteController;
}): React.ReactElement {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const phone = !isWideDesktop;
  const site = controller.site.data ?? null;
  const siteId = site?.id ?? null;
  // A draft still being created (state 4) has nothing to edit, preview or publish yet.
  const hasSite = site !== null && site.status !== "provisioning";
  const brandName = controller.brand.data?.displayName ?? "Your brand";
  const capabilities = controller.capabilities;

  const [toastState, setToastState] = useState<{ message: string; kind: "success" | "info" | "warn" | "error" } | null>(null);
  const toast = useCallback((message: string, kind: "success" | "info" | "warn" | "error" = "info") => setToastState({ message, kind }), []);

  const plan = useBrandSitePlan(brandId, true);
  const heartbeat = useBrandSitePlanHeartbeat(brandId);
  const takeOver = useTakeOverBrandSitePlan(brandId);
  const offerings = plan.data?.plan?.offeringsSelected ?? plan.data?.prefillOfferings ?? [];
  const tripsTicked = offerings.includes("trips");

  const destinations = useContentList(siteId, "destinations", hasSite);
  const stories = useContentList(siteId, "stories", hasSite);
  const reviews = useContentList<ReviewSummary>(siteId, "testimonials", hasSite);
  const past = usePastTrips(siteId, hasSite && tripsTicked);
  const changes = useDraftChanges(siteId, hasSite);
  const domains = useBrandSiteDomains(siteId, hasSite);
  const ask = useAskAdmin(brandId);
  const sitePages = useSitePages(siteId, hasSite);

  const [designDirty, setDesignDirty] = useState(false);
  const [tokenDeclarations, setTokenDeclarations] = useState<readonly string[] | null>(null);
  const [previewSheet, setPreviewSheet] = useState(false);
  // Only the workspace's editors use a sticky bar or a top-bar Save; it supplies its own.
  const setStickyBar = useCallback((_bar: StickyBar | null) => undefined, []);
  const setTopbarSave = useCallback((_save: TopbarSave | null) => undefined, []);
  const headingRef = useRef<Text | null>(null);

  const { preference, setPreference } = usePreviewDevicePreference(controller.user?.id ?? null, isWideDesktop, (message) => toast(message, "warn"));

  // The website lock (rank 50 holds it while working on the design or the plan).
  const lockState = plan.data?.lock ?? null;
  // Core answers null when the holder has no name on file (#2829 W11); the
  // banner and dialog word a nameless holder themselves.
  const holderName = lockState?.holderName ?? null;
  const canManage = plan.data?.canManage === true;
  // #2830 — the setup screen owns its own heartbeat (a heartbeat creates the
  // plan row its first state keys on, and an idle tab must not keep the lock).
  // #4453 — a site that exists is edited in the workspace, which holds the
  // lock itself. Nothing in this shell holds it.
  const heartbeatRef = useRef(heartbeat.mutate);
  heartbeatRef.current = heartbeat.mutate;
  const [confirmTakeOver, setConfirmTakeOver] = useState(false);

  const designKey = plan.data?.site?.designKey ?? null;
  const design = designFor(designKey) ?? null;
  const designHasCollectionPages = design?.key === "voyage";
  const reviewsNeeding = (reviews.data?.entries ?? []).filter((entry) => !entry.confirmed).length;
  const hosts = domains.data?.hosts ?? [];
  const domainNeedsAttention = hosts.some((host) => host.kind === "custom_domain" &&
    (host.status === "suspended" || (host.status === "active" && (host.dns_state === "misconfigured" || host.tls_state === "failed"))));
  const offline = Boolean(site?.owner_offline_at);
  const unpublished = changes.data?.changes.length ?? 0;

  const groups: WebsiteNavGroup[] = useMemo(() => websiteNavGroups({
    hasSite,
    designLabel: design ? DESIGNS[design.key].label : null,
    designHasCollectionPages,
    designDirty,
    pagesInMenu: sitePages.data ? sitePages.data.pages.filter((page) => page.in_menu || page.path === "").length : null,
    counts: {
      destinations: destinations.data ? destinations.data.entries.length : null,
      stories: stories.data ? stories.data.entries.length : null,
      reviews: reviews.data ? reviews.data.entries.length : null,
      past: past.data ? past.data.trips.length : null,
    },
    reviewsNeedingConfirmation: reviewsNeeding,
    tripsTicked,
    unpublishedChanges: unpublished,
    domainNeedsAttention,
    // #2830 — the same number the setup screen shows.
    plan: plan.data ? { done: plan.data.setupStatus?.doneCount ?? plan.data.doneCount, total: plan.data.parts.length || 8 } : null,
    offline,
  }), [sitePages.data, hasSite, design, designHasCollectionPages, designDirty, destinations.data, stories.data, reviews.data, past.data, reviewsNeeding, tripsTicked, unpublished, domainNeedsAttention, plan.data, offline]);

  const navigate = useCallback((next: Exclude<WebsiteRoute, { kind: "redirect" }>) => {
    const path = websitePath(brandId, next);
    if (phone) router.push(path as never);
    else router.replace(path as never);
  }, [brandId, phone, router]);

  const go = useCallback((next: Exclude<WebsiteRoute, { kind: "redirect" }>) => {
    const target = next.kind === "section" ? next.section : next.kind === "editor" ? next.section : next.kind === "setup" ? "plan" : section;
    if (!hasSite && next.kind !== "preview" && target !== "overview" && target !== "plan") {
      toast("Available once your draft exists");
      return;
    }
    // Phone: "Overview" is a section of its own (the root is the list).
    if (phone && next.kind === "section" && next.section === "overview") {
      router.push(`/brand/${brandId}/website/overview` as never);
      return;
    }
    navigate(next);
  }, [brandId, hasSite, navigate, phone, router, section, toast]);

  const back = useCallback(() => {
    if (route.kind === "editor") {
      navigate({ kind: "section", section: route.section });
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace(`/brand/${brandId}/website` as never);
  }, [brandId, navigate, route, router]);

  // A section this site doesn't have (yet) resolves to the Overview.
  const sectionMissing = route.kind !== "preview" && route.kind !== "setup" && !sectionInNav(groups, section) && !controller.site.isLoading;
  useEffect(() => {
    if (!sectionMissing || section === "overview") return;
    if (!hasSite) toast("Available once your draft exists");
    router.replace(`/brand/${brandId}/website` as never);
  }, [brandId, hasSite, router, section, sectionMissing, toast]);

  // Rail switches move focus to the section heading (desktop).
  useEffect(() => {
    if (phone) return;
    const timer = setTimeout(() => {
      const node = headingRef.current as unknown as { focus?: () => void } | null;
      node?.focus?.();
    }, 60);
    return () => clearTimeout(timer);
  }, [phone, section, route.kind]);

  const askAdmin = useCallback((action: AdminAsk) => {
    ask.mutate(action, {
      onSuccess: (result) => toast(result.already_asked
        ? "You already asked today. Your admins have it."
        : `Asked your brand admins to ${ASK_WORDS[action]}. They get a notification with a link.`, "success"),
      onError: (error) => toast(error instanceof BrandSitesError ? error.message : "Couldn’t reach your admins. Try again.", "error"),
    });
  }, [ask, toast]);

  const openFullScreenPreview = useCallback(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(fullScreenPreviewPath(brandId, preference), "_blank", "noopener");
      return;
    }
    setPreviewSheet(true);
  }, [brandId, preference]);

  const grantState: PreviewGrantState = !hasSite
    ? { kind: "nodraft" }
    : controller.previewGrant.data
      ? { kind: "ready", previewUrl: controller.previewGrant.data.preview_url, siteId: siteId!, pages: controller.previewGrant.data.pages ?? [] }
      : controller.previewGrant.isError
        ? { kind: "error", onRetry: () => { void controller.previewGrant.refetch(); } }
        : { kind: "loading" };

  const value: WebsiteContextValue = {
    brandId,
    brandName,
    controller,
    phone,
    section,
    go,
    back,
    toast,
    askAdmin,
    asking: ask.isPending,
    lock: {
      heldByOther: lockState !== null && lockState.active && !lockState.heldByMe,
      holderName,
      canTakeOver: canManage,
      takeOver: () => setConfirmTakeOver(true),
      takingOver: takeOver.isPending,
    },
    plan: plan.data ?? null,
    previewPreference: preference,
    setPreviewPreference: setPreference,
    openFullScreenPreview,
    openPreviewSheet: () => setPreviewSheet(true),
    designDirty,
    setDesignDirty,
    tokenDeclarations,
    setTokenDeclarations,
    headingRef,
    offerings,
    setStickyBar,
    setTopbarSave,
  };

  if (route.kind === "preview") {
    return (
      <WebsiteProvider value={value}>
        <FullScreenPreview grant={grantState} search={search} />
      </WebsiteProvider>
    );
  }

  const shown = routeToRender(route, sectionMissing);
  const setupBack = isSetupReturn(search.returnTo) ? search.returnTo ?? null : null;
  const content = (
    <>
      {/* #2830 — "Fix" on the final check came here; this is the way back. */}
      {setupBack ? (
        <View style={styles.setupBack}>
          <WButton label="Back to website setup" size="sm" onPress={() => router.replace(setupBack as never)} testID="website-back-to-setup" />
        </View>
      ) : null}
      <SectionContent section={shown.kind === "section" && shown.section === "plan" ? "plan" : "overview"} />
    </>
  );
  const statusChip = <SiteStatusChip controller={controller} />;
  const dialogs = (
    <>
      <ConfirmDialog
        visible={confirmTakeOver}
        onClose={() => setConfirmTakeOver(false)}
        onConfirm={() => {
          setConfirmTakeOver(false);
          takeOver.mutate(undefined, {
            onSuccess: () => toast(`You're editing now. ${holderName ?? "Your teammate"} has been told.`, "success"),
            onError: (error) => toast(error instanceof BrandSitesError ? error.message : "Couldn’t take over. Try again.", "error"),
          });
        }}
        title={`Take over from ${holderName ?? "your teammate"}?`}
        description={`${holderName ? `${holderName}'s` : "Their"} saved changes are kept. Anything they haven't saved in the last few seconds may be lost, and they'll see that you took over.`}
        confirmLabel="Take over"
        testID="lock-takeover-confirm"
      />
      <Toast
        visible={toastState !== null}
        kind={toastState?.kind ?? "info"}
        message={toastState?.message ?? ""}
        onDismiss={() => setToastState(null)}
        testID="website-toast"
      />
      {/*
        The draft full screen on phones and native ("Open the draft full
        screen" in the workspace's more menu, "Preview" on the phone status
        card). It lives with the dialogs so every shell that can ask for it,
        the workspace included, can show it.
      */}
      <Modal visible={previewSheet} animationType="slide" onRequestClose={() => setPreviewSheet(false)} presentationStyle="fullScreen">
        <SafeScreen style={{ backgroundColor: color.ink }}>
          <FullScreenPreviewBar brandName={brandName} onClose={() => setPreviewSheet(false)} canShare={controller.capabilities.canPublish} shareReady={grantState.kind === "ready"} />
          <View style={styles.fullBody}>
            <SitePreviewPanel
              grant={grantState}
              preference={preference}
              onPreference={setPreference}
              purpose={PREVIEW_PURPOSE[section] ?? "Your draft"}
              tokenDeclarations={tokenDeclarations}
              onOpenFullScreen={openFullScreenPreview}
              variant="full"
            />
          </View>
        </SafeScreen>
      </Modal>
    </>
  );

  if (route.kind === "setup") {
    return (
      <WebsiteProvider value={value}>
        <WebsiteSetupScreen
          step={route.step}
          search={search}
          planQuery={plan}
          grant={grantState}
          onHeartbeat={() => heartbeatRef.current()}
        />
        {dialogs}
      </WebsiteProvider>
    );
  }

  /*
   * #4453 — a site that exists opens in the ONE Website workspace (left panel
   * Ari · Edit · Design, the live draft, one Publish). Every old address lands
   * in it (sites/workspaceRoute.ts). The shells below remain for a brand with
   * no site yet, a draft still being created, and a site that failed to load.
   */
  if (hasSite && !controller.site.isError && controller.publicationCacheChecked && shown.kind !== "preview" && shown.kind !== "setup") {
    const inNav = new Set<string>(groups.flatMap((group) => group.items.map((entry) => entry.key)));
    const contentDetails = (["destinations", "stories", "reviews", "past"] as const).filter((key) => inNav.has(key));
    return (
      <WorkspaceShell
        base={value}
        route={shown}
        search={search}
        segments={segments}
        contentDetails={contentDetails}
        dialogs={dialogs}
        offlineDevice={controller.notice?.kind === "offline"}
      />
    );
  }

  if (!phone) {
    return (
      <WebsiteProvider value={value}>
        <SafeScreen style={{ backgroundColor: color.canvas }}>
          <View style={styles.desktop}>
            <View style={styles.topbar}>
              <BackButton label="Back to Brand profile" onPress={() => router.canGoBack() ? router.back() : router.replace(`/brand/${brandId}` as never)} />
              <Text style={styles.topTitle} role="heading" aria-level={1}>Website</Text>
              {hasSite ? (
                <View style={styles.topRight}>
                  {statusChip}
                  <WButton label="Preview draft" icon="eye" size="sm" onPress={openFullScreenPreview} testID="topbar-preview" />
                  {capabilities.canPublish && unpublished > 0 ? (
                    <WButton label="Review and publish" variant="primary" size="sm" onPress={() => go({ kind: "section", section: "publish" })} testID="topbar-publish" />
                  ) : null}
                </View>
              ) : null}
            </View>
            <View style={styles.body}>
              <Rail groups={groups} active={section} onSelect={(key) => go({ kind: "section", section: key })} />
              <ScrollView style={styles.pane} contentContainerStyle={styles.paneContent} keyboardShouldPersistTaps="handled">
                <View style={styles.paneInner}>{content}</View>
              </ScrollView>
            </View>
          </View>
          {dialogs}
        </SafeScreen>
      </WebsiteProvider>
    );
  }

  // ── Phone and tablet ──────────────────────────────────────────────────
  const atRoot = segments.filter(Boolean).length === 0;
  const phoneTitle = SECTION_LABELS[section];
  return (
    <WebsiteProvider value={value}>
      <SafeScreen style={{ backgroundColor: color.canvas }}>
        <View style={styles.phoneTopbar}>
          <BackButton
            label={atRoot ? "Back to Brand profile" : "Back to Website"}
            onPress={atRoot ? () => (router.canGoBack() ? router.back() : router.replace(`/brand/${brandId}` as never)) : back}
          />
          <Text style={styles.topTitle} role="heading" aria-level={1} numberOfLines={1}>{atRoot ? "Website" : phoneTitle}</Text>
        </View>
        {atRoot ? (
          <ScrollView contentContainerStyle={styles.phoneList} keyboardShouldPersistTaps="handled">
            <PhoneStatusCard />
            <PhoneNavList groups={groups} onSelect={(key) => go({ kind: "section", section: key })} />
          </ScrollView>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={styles.phonePane} keyboardShouldPersistTaps="handled">
            <View style={styles.phoneInner}>{content}</View>
          </ScrollView>
        )}
        {dialogs}
      </SafeScreen>
    </WebsiteProvider>
  );
}

/**
 * What the small shell shows: loading, "try again", or the Overview (a brand
 * with no site yet, or a draft still being created). A site that exists never
 * reaches this: it opens in the workspace.
 */
function SectionContent({ section }: { section: WebsiteSection }): React.ReactElement {
  const { controller, lock } = useWebsite();
  if (controller.site.isLoading || (controller.site.data && !controller.publicationCacheChecked)) return <LoadingPane />;
  if (controller.site.isError) return <LoadError />;
  return (
    <>
      <NoticeBanner />
      {lock.heldByOther ? <LockBanner section={section === "plan" ? "plan" : "overview"} /> : null}
      {/* #2830 — Website setup is its own screen; its old address redirects there. */}
      {section === "plan" ? <LoadingPane /> : <OverviewSection />}
    </>
  );
}

function LoadError(): React.ReactElement {
  const { controller } = useWebsite();
  return (
    <Card style={styles.center} testID="website-load-error">
      <WebsiteIcon name="alert" size={28} color={ui.t2} />
      <CardTitle style={styles.centerTitle}>We couldn&apos;t load your website settings</CardTitle>
      <Body style={styles.centerBody}>Your public website isn&apos;t affected. Check your connection and try again.</Body>
      <WButton label="Try again" variant="primary" onPress={controller.actions.retry} testID="website-retry" />
    </Card>
  );
}

function BackButton({ label, onPress, icon = "left" }: { label: string; onPress: () => void; icon?: "left" | "close" }): React.ReactElement {
  return (
    <Pressable onPress={onPress} role="button" accessibilityRole="button" accessibilityLabel={label} style={styles.iconButton} testID="website-back">
      <WebsiteIcon name={icon} size={18} color={ui.t1} />
    </Pressable>
  );
}

function Rail({ groups, active, onSelect }: { groups: WebsiteNavGroup[]; active: WebsiteSection; onSelect: (key: WebsiteSection) => void }): React.ReactElement {
  return (
    <ScrollView style={styles.rail} contentContainerStyle={styles.railContent}>
      <View role="navigation" accessibilityLabel="Website sections" aria-label="Website sections">
        {groups.map((group, index) => (
          <View key={group.heading ?? `g${index}`}>
            {group.heading ? <Text style={[styles.railHeading, index === 0 ? styles.railHeadingFirst : null]}>{group.heading}</Text> : null}
            {group.items.map((entry) => {
              const current = entry.key === active;
              return (
                <Pressable
                  key={entry.key}
                  onPress={() => onSelect(entry.key)}
                  role="link"
                  accessibilityRole="link"
                  aria-current={current ? "page" : undefined}
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={navRowAccessibilityLabel(entry)}
                  testID={`website-rail-${entry.key}`}
                  style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.railRow, current ? styles.railRowActive : hovered ? styles.railRowHover : null]}
                >
                  {current ? <View style={styles.railBar} /> : null}
                  <WebsiteIcon name={entry.icon} size={18} color={current ? ui.t1 : ui.t2} />
                  <Text style={[styles.railLabel, current ? styles.railLabelActive : null]} numberOfLines={1}>{entry.label}</Text>
                  {entry.attention
                    ? <View style={styles.dot} aria-label="needs attention" accessibilityLabel="needs attention" />
                    : entry.meta ? <Text style={styles.railMeta}>{entry.meta}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function PhoneNavList({ groups, onSelect }: { groups: WebsiteNavGroup[]; onSelect: (key: WebsiteSection) => void }): React.ReactElement {
  return (
    <View role="navigation" accessibilityLabel="Website sections">
      {groups.map((group, index) => (
        <View key={group.heading ?? `g${index}`}>
          {group.heading ? <Text style={styles.phoneGroup}>{group.heading}</Text> : <View style={{ height: 12 }} />}
          <View style={styles.phoneGroupBox}>
            {group.items.map((entry, itemIndex) => (
              <Pressable
                key={entry.key}
                onPress={() => onSelect(entry.key)}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={navRowAccessibilityLabel(entry)}
                testID={`website-list-${entry.key}`}
                style={[styles.phoneRow, itemIndex > 0 ? styles.phoneRowDivider : null]}
              >
                <WebsiteIcon name={entry.icon} size={18} color={ui.t1} />
                <Text style={styles.phoneRowLabel}>{entry.label}</Text>
                <View style={styles.phoneRowMeta}>
                  {entry.attention ? <Chip label="Check" tone="warn" /> : entry.meta ? <Text style={styles.railMeta}>{entry.meta}</Text> : null}
                  <WebsiteIcon name="right" size={16} color={ui.t3} />
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function PhoneStatusCard(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, brandName, lock } = ctx;
  const site = controller.site.data ?? null;
  const changes = useDraftChanges(site?.id ?? null, site !== null);
  const host = site?.brand_site_hosts.find((entry) => entry.is_primary)?.hostname ?? null;
  const count = changes.data?.changes.length ?? 0;
  const published = Boolean(site?.active_publication_id);
  return (
    <View style={styles.phoneStatusWrap}>
      {lock.heldByOther ? <LockBanner section="overview" /> : null}
      {site?.owner_offline_at ? (
        <Banner tone="err" icon="power" title="Your website is offline" body={'Visitors see a short "temporarily unavailable" page. Your drafts, versions and address are kept.'} />
      ) : null}
      <NoticeBanner />
      <Card style={styles.phoneStatus} testID="phone-status-card">
        {site === null ? (
          <>
            <CardTitle>Build your website</CardTitle>
            <Text style={styles.phoneStatusHint}>
              {ctx.plan ? `${ctx.plan.setupStatus?.doneCount ?? ctx.plan.doneCount} of ${ctx.plan.parts.length || 8} done${(ctx.plan.setupStatus?.nextPart ?? ctx.plan.nextPart) ? " · next: Website setup" : ""}` : "Your website setup"}
            </Text>
            <WButton label="Open Website setup" variant="primary" onPress={() => ctx.go({ kind: "setup", step: null })} testID="phone-see-plan" />
          </>
        ) : (
          <>
            <View style={styles.rowCenter}>
              <View style={styles.flex}>
                <Text style={styles.phoneBrand}>{brandName}</Text>
                {host ? <Text style={styles.phoneHost} numberOfLines={1}>{host}</Text> : null}
              </View>
              <SiteStatusChip controller={controller} />
            </View>
            <Text style={styles.phoneStatusHint}>
              {!published ? "Draft · not published yet" : count > 0 ? `${count} ${count === 1 ? "change" : "changes"} not published yet` : "Draft and live match"}
            </Text>
            <View style={styles.rowGap}>
              <WButton label="Preview" icon="eye" size="sm" grow onPress={ctx.openPreviewSheet} testID="phone-status-preview" />
              {count > 0 || !published ? (
                controller.capabilities.canPublish
                  ? <WButton label="Review and publish" variant="primary" size="sm" grow onPress={() => ctx.go({ kind: "section", section: "publish" })} testID="phone-status-publish" />
                  : <WButton label="Ask an admin" icon="msg" size="sm" grow onPress={() => ctx.askAdmin("publish")} loading={ctx.asking} testID="phone-status-ask" />
              ) : null}
            </View>
          </>
        )}
      </Card>
    </View>
  );
}

function FullScreenPreview({ grant, search }: { grant: PreviewGrantState; search: Record<string, string | undefined> }): React.ReactElement {
  const { previewPreference, setPreviewPreference, brandId, brandName, controller } = useWebsite();
  const router = useRouter();
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (applied) return;
    const fromQuery = preferenceFromQuery(previewPreference, { device: search.device ?? null, orientation: search.orientation ?? null });
    if (JSON.stringify(fromQuery) !== JSON.stringify(previewPreference)) setPreviewPreference(fromQuery);
    setApplied(true);
  }, [applied, previewPreference, search.device, search.orientation, setPreviewPreference]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const close = () => {
    if (Platform.OS === "web" && typeof window !== "undefined" && window.opener) {
      window.close();
      return;
    }
    router.replace(`/brand/${brandId}/website` as never);
  };
  return (
    <SafeScreen style={{ backgroundColor: color.ink }}>
      <FullScreenPreviewBar brandName={brandName} onClose={close} canShare={controller.capabilities.canPublish} shareReady={grant.kind === "ready"} />
      <View style={styles.fullBody}>
        <SitePreviewPanel
          grant={grant}
          preference={previewPreference}
          onPreference={setPreviewPreference}
          purpose="Your draft"
          onOpenFullScreen={() => undefined}
          variant="full"
        />
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  setupBack: { alignSelf: "flex-start", marginBottom: space[4] },
  loadingShell: { padding: 24 },
  desktop: { flex: 1 },
  topbar: { height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  topTitle: { fontSize: 20, lineHeight: 28, fontWeight: "700", color: ui.t1, flex: 1 } as TextStyle,
  topRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconButton: { width: 44, height: 44, borderRadius: radius.full, borderWidth: 1, borderColor: ui.border2, backgroundColor: ui.card, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  rail: { width: websiteRailWidth, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: ui.cardBorder },
  railContent: { paddingTop: 12, paddingBottom: 16, paddingLeft: 16, paddingRight: 8 },
  railHeading: { marginTop: 16, marginBottom: 4, marginHorizontal: 8, fontSize: 12, lineHeight: 16, fontWeight: "600", color: ui.t3 },
  railHeadingFirst: { marginTop: 4 },
  railRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, borderRadius: radius.sm, marginBottom: 2 },
  railRowActive: { backgroundColor: color.fill.railOn },
  railRowHover: { backgroundColor: ui.card },
  railBar: { position: "absolute", left: -8, top: 10, bottom: 10, width: 3, borderRadius: 2, backgroundColor: ui.accent },
  railLabel: { flex: 1, fontSize: 15, color: ui.t2 },
  railLabelActive: { color: ui.t1, fontWeight: "600" },
  railMeta: { fontSize: 12, color: ui.t3 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ui.warn },
  pane: { flex: 1, minWidth: 0 },
  paneContent: { paddingTop: space[6], paddingHorizontal: space[7], paddingBottom: 96 },
  paneInner: { maxWidth: websitePaneMaxWidth, width: "100%" },
  phoneTopbar: { height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  phoneList: { paddingBottom: 24 },
  phonePane: { padding: space[4], paddingBottom: 140, alignItems: "center" },
  phoneInner: { width: "100%", maxWidth: 720 },
  phoneStatusWrap: { paddingHorizontal: 16, paddingTop: 16 },
  phoneStatus: { marginBottom: 0 },
  phoneBrand: { fontSize: 15, fontWeight: "600", color: ui.t1 },
  phoneHost: { fontSize: 12, color: ui.t3, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }) },
  phoneStatusHint: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 8, marginBottom: 12 },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowGap: { flexDirection: "row", gap: 8 },
  phoneGroup: { marginTop: 18, marginBottom: 6, marginHorizontal: 16, fontSize: 12, fontWeight: "600", color: ui.t3 },
  phoneGroupBox: { marginHorizontal: 16, borderWidth: 1, borderColor: ui.cardBorder, borderRadius: radius.md, overflow: "hidden", backgroundColor: ui.card },
  phoneRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  phoneRowDivider: { borderTopWidth: 1, borderTopColor: ui.cardBorder },
  phoneRowLabel: { flex: 1, fontSize: 15, color: ui.t1 },
  phoneRowMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  fullBody: { flex: 1, padding: 16 },
  center: { alignItems: "center", paddingVertical: 40, paddingHorizontal: 24, gap: 10 },
  centerTitle: { textAlign: "center" },
  centerBody: { textAlign: "center", maxWidth: 420 },
});
