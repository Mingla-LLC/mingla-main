import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { space } from "../../../../constants/designSystem";
import { Sheet } from "../../../ui/Sheet";
import { SheetScrollLayout } from "../../../ui/SheetScrollLayout";
import { useWebsite } from "../WebsiteContext";
import { NoticeBanner } from "../NoticeBanner";
import { Banner, CheckCircle, Chip, Spinner, WButton, ui } from "../ui";
import { CHECK_COPY, failureReason, publishStep, STEPS } from "../sections/PublishSection";
import { sectionName } from "../sections/DraftReviewCard";
import { useDesignChecks, useDraftChanges, type ReviewStatus } from "../../../../sites/contentApi";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { publishGate, PUBLISH_PROMISE } from "../../../../sites/workspaceStatus";
import type { Workspace } from "./useWorkspace";
import { IconButton, parts } from "./parts";

/*
 * #4453 — the ONE way to go live. In order: what changes, what to read
 * first ("Show me" / "Looks good"), the checks (what blocks, and tips that
 * do not), then one button whose label is the thing in the way. The draft is
 * checked again at the moment of publishing, so the revision sent is never
 * stale. A side sheet on desktop, a full sheet on phones.
 */
const BLOCKER_CODES = ["VALIDATION_FAILED", "PATH_COLLISION", "PAGE_LIMIT_EXCEEDED", "REVISION_CONFLICT", "INVALID_STATE"];

type UnreadRow = { pageId: string; pageTitle: string; sectionId: string; label: string; team: boolean };

export function unreadRows(status: ReviewStatus | undefined, labelOf: (pageId: string, sectionId: string) => string | null): UnreadRow[] {
  return (status?.pages ?? []).filter((page) => page.enabled).flatMap((page) => page.blocks.map((block) => ({
    pageId: page.id,
    pageTitle: page.title,
    sectionId: block.id,
    label: labelOf(page.id, block.id) ?? sectionName(block.type),
    team: (block.source as string) === "team",
  })));
}

export function PublishPanel({ ws, visible, onClose, unreadablePairs, onOpenDesign, offlineDevice }: {
  ws: Workspace;
  visible: boolean;
  onClose: () => void;
  unreadablePairs: number;
  onOpenDesign: () => void;
  offlineDevice: boolean;
}): React.ReactElement {
  const ctx = useWebsite();
  const { controller, lock } = ctx;
  const site = controller.site.data ?? null;
  const siteId = ws.siteId;
  const changes = useDraftChanges(siteId, visible);
  const designChecks = useDesignChecks(siteId, visible);
  const validation = controller.validation;
  const refetchValidation = validation.refetch;
  const [starting, setStarting] = useState(false);
  const headingRef = useRef<Text | null>(null);

  // Check the draft every time the panel opens (and after each "Looks good").
  useEffect(() => {
    if (!visible) return;
    void refetchValidation();
    const timer = setTimeout(() => (headingRef.current as unknown as { focus?: () => void } | null)?.focus?.(), 120);
    return () => clearTimeout(timer);
  }, [refetchValidation, visible, ws.unread]);

  const operation = controller.publicationOperation;
  const receipt = controller.publicationReceipt.data ?? null;
  const tracking = operation !== null && receipt?.status !== "succeeded" && receipt?.status !== "failed";
  const failed = operation !== null && receipt?.status === "failed";
  const versions = controller.versions.data ?? [];
  const refetchVersions = controller.versions.refetch;
  useEffect(() => {
    if (!tracking || !visible) return undefined;
    const timer = setInterval(() => { void refetchVersions(); }, 3000);
    return () => clearInterval(timer);
  }, [refetchVersions, tracking, visible]);
  const running = versions.find((row) => row.status !== "published" && row.status !== "failed" && row.status !== "ambiguous" && row.status !== "rolled_back");
  const step = tracking ? publishStep(running?.status) : 0;

  const live = Boolean(site?.active_publication_id);
  const firstPublish = site?.last_successful_publication_id === null;
  const blocker = validation.error instanceof BrandSitesError && BLOCKER_CODES.includes(validation.error.code) ? validation.error : null;
  const checkFailed = validation.isError && !blocker;
  const checking = validation.isFetching || (validation.data === undefined && !validation.isError) || (firstPublish && (designChecks.isFetching || (designChecks.data === undefined && !designChecks.isError)));
  const count = changes.data ? changes.data.changes.length : null;
  const rows = unreadRows(ws.review.data, (pageId, sectionId) => (pageId === ws.page?.id ? ws.sections.find((entry) => entry.id === sectionId)?.label ?? null : null));
  const unread = Math.max(ws.unread, rows.length);

  const gate = publishGate({
    canPublish: controller.capabilities.canPublish,
    live,
    unpublished: count,
    unread,
    unreadablePairs,
    checking,
    blocker: blocker?.message ?? null,
    checkFailed,
    publishing: tracking || starting || controller.isPublishing,
    lockedBy: lock.heldByOther ? lock.holderName : false,
    offlineDevice,
  });

  const act = async () => {
    if (gate.next === "ask") {
      ctx.askAdmin("publish");
      return;
    }
    if (gate.next === "retry") {
      void refetchValidation();
      void designChecks.refetch();
      return;
    }
    if (gate.blocked) return;
    setStarting(true);
    await ws.flush();
    const refused = await controller.actions.publishChecked();
    setStarting(false);
    if (refused) ws.notify({ message: refused, kind: "error" });
  };

  const tips = (designChecks.data?.checks ?? []).filter((check) => check.status === "warn" && check.key !== "readability");
  const passed = (designChecks.data?.checks ?? []).filter((check) => check.status === "pass");

  return (
    <Sheet visible={visible} onClose={onClose} presentation="panel" snapPoint="full" testID="publish-panel">
      {/* The sheet's own scroll layout: the list scrolls, the button stays in reach. */}
      <SheetScrollLayout
        testID="publish-layout"
        contentStyle={styles.content}
        footer={(
          <>
            <WButton
              label={gate.label}
              variant="primary"
              onPress={() => { void act(); }}
              disabled={gate.blocked}
              loading={starting && !gate.blocked}
              accessibilityLabel={gate.reason ? `${gate.label}. ${gate.reason}` : gate.label}
              testID="publish-final"
            />
            {gate.reason ? <Text style={styles.reason} testID="publish-reason">{gate.reason}</Text> : null}
            <Text style={styles.promise}>{PUBLISH_PROMISE}</Text>
          </>
        )}
      >
          <View style={styles.head}>
            <Text ref={headingRef} style={styles.title} role="heading" aria-level={2} {...({ tabIndex: -1 } as object)}>Publish</Text>
            <IconButton icon="close" label="Close" onPress={onClose} testID="publish-close" />
          </View>
          <NoticeBanner />
          {tracking ? (
            <View style={parts.box} role="status" accessibilityLiveRegion="polite" testID="publish-progress">
              <Text style={parts.title}>Publishing…</Text>
              <Text style={parts.small}>Usually under a minute. You can close this; we’ll tell you when it’s live.</Text>
              {STEPS.map((label, index) => (
                <View key={label} style={styles.line}>
                  {index < step ? <CheckCircle state="on" /> : index === step ? <Spinner /> : <CheckCircle state="off" />}
                  <Text style={[styles.lineText, index <= step ? styles.lineOn : null]}>{label}</Text>
                </View>
              ))}
              {controller.publicationPollingTimedOut || receipt?.status === "ambiguous" ? (
                <WButton label="Check the same operation" size="sm" onPress={controller.actions.onReconcilePublication} style={styles.start} testID="publish-reconcile" />
              ) : null}
            </View>
          ) : null}
          {failed ? (
            <Banner
              tone="err"
              icon="alert"
              alert
              title="That publish didn’t go live"
              body={site?.last_successful_publication_id
                ? `Your previous version is still live, so visitors saw no change. ${failureReason(receipt)}`
                : `Nothing went live: your website isn’t public yet. ${failureReason(receipt)}`}
              testID="publish-failed"
            >
              <WButton label="Try again" size="sm" onPress={controller.actions.onResetFailedPublication} testID="publish-reset" />
            </Banner>
          ) : null}

          <View testID="publish-changes">
            <Text style={styles.group} role="heading" aria-level={3}>What changes</Text>
            {changes.isLoading ? <Text style={parts.small}>Comparing your draft with your live website…</Text>
              : changes.isError ? <Text style={parts.small}>We couldn’t compare your draft with your live website just now. You can still publish.</Text>
                : count === 0 ? <Text style={parts.body}>{live ? "Nothing new: your live website matches your draft." : "Your whole website goes live for the first time."}</Text>
                  : (changes.data?.changes ?? []).map((change, index) => (
                    <View key={`${change.title}-${index}`} style={styles.change}>
                      <Text style={styles.changeTitle}>{change.title}</Text>
                      <Text style={parts.small}>{change.detail}</Text>
                    </View>
                  ))}
          </View>

          {rows.length > 0 ? (
            <View testID="publish-read-first">
              <Text style={styles.group} role="heading" aria-level={3}>Read before it goes live</Text>
              <Text style={parts.small}>Ari and the Mingla team wrote these. Nothing goes live until you have read it.</Text>
              {rows.map((row) => (
                <View key={`${row.pageId}-${row.sectionId}`} style={styles.readRow} testID={`publish-read-${row.sectionId}`}>
                  <View style={parts.grow}>
                    <Text style={styles.changeTitle} numberOfLines={2}>{row.label}</Text>
                    <Text style={parts.small} numberOfLines={1}>{row.team ? `${row.pageTitle} · made by the Mingla team` : row.pageTitle}</Text>
                  </View>
                  <WButton label="Show me" size="sm" accessibilityLabel={`Show me ${row.label} on ${row.pageTitle}`} onPress={() => { onClose(); ws.showSection(row.pageId, row.sectionId); }} testID={`publish-show-${row.sectionId}`} />
                  <WButton label="Looks good" size="sm" accessibilityLabel={`${row.label} looks good`} onPress={() => ws.looksGood(row.pageId, [row.sectionId])} disabled={ws.readOnly} testID={`publish-ok-${row.sectionId}`} />
                </View>
              ))}
            </View>
          ) : null}

          <View testID="publish-checks">
            <View style={parts.row}>
              <Text style={[styles.group, parts.grow]} role="heading" aria-level={3}>Checks</Text>
              {checking ? <Spinner label="Checking your draft" /> : blocker || unreadablePairs > 0 ? <Chip label="Needs a fix" tone="err" /> : validation.data ? <Chip label="Ready" tone="ok" testID="publish-checks-ready" /> : null}
            </View>
            {blocker ? (
              <View style={styles.line} testID="publish-blocker">
                <CheckCircle state="fail" />
                <Text style={[styles.lineText, styles.lineOn, parts.grow]}>{blocker.message}</Text>
                <WButton label="Fix" size="sm" onPress={() => { onClose(); ws.setMode("edit"); }} />
              </View>
            ) : validation.data ? (
              <View style={styles.line}>
                <CheckCircle state="on" />
                <Text style={[styles.lineText, styles.lineOn]}>{`All ${validation.data.checked_pages} ${validation.data.checked_pages === 1 ? "page builds" : "pages build"}`}</Text>
              </View>
            ) : checkFailed ? (
              <View style={styles.line} testID="publish-check-failed">
                <CheckCircle state="warn" />
                <Text style={[styles.lineText, styles.lineOn, parts.grow]}>{validation.error instanceof BrandSitesError ? validation.error.message : "We couldn’t check your draft just now."}</Text>
              </View>
            ) : null}
            {unreadablePairs > 0 ? (
              <View style={styles.line} testID="publish-unreadable">
                <CheckCircle state="fail" />
                <Text style={[styles.lineText, styles.lineOn, parts.grow]}>Some text is hard to read on its background. Fix it in Design before publishing.</Text>
                <WButton label="Open Design" size="sm" onPress={() => { onClose(); onOpenDesign(); }} testID="publish-open-design" />
              </View>
            ) : validation.data ? (
              <View style={styles.line}><CheckCircle state="on" /><Text style={[styles.lineText, styles.lineOn]}>Text is readable</Text></View>
            ) : null}
            {passed.filter((check) => check.key !== "readability").map((check) => (
              <View key={check.key} style={styles.line}><CheckCircle state="on" /><Text style={[styles.lineText, styles.lineOn]}>{CHECK_COPY[check.key].pass}</Text></View>
            ))}
            {tips.map((check) => (
              <View key={check.key} testID={`publish-tip-${check.key}`}>
                <View style={styles.line}>
                  <CheckCircle state="warn" />
                  <Text style={[styles.lineText, styles.lineOn, parts.grow]}>
                    {CHECK_COPY[check.key].warn(check.items.length)}<Text style={styles.soft}>{" · a tip, doesn’t block publishing"}</Text>
                  </Text>
                </View>
                {check.items.slice(0, 2).map((item, index) => <Text key={`${check.key}-${index}`} style={styles.tipItem}>{item.message}</Text>)}
              </View>
            ))}
            {designChecks.isError ? (
              <View style={styles.line} testID="publish-tips-error">
                <CheckCircle state="warn" />
                <Text style={[styles.lineText, styles.lineOn, parts.grow]}>
                  {firstPublish ? "The design checks couldn’t run. Your first publish needs them." : "The design tips couldn’t load. They never block publishing."}
                </Text>
                <WButton label="Run again" size="sm" onPress={() => { void designChecks.refetch(); }} testID="publish-tips-retry" />
              </View>
            ) : null}
          </View>
      </SheetScrollLayout>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space[2] },
  title: { flex: 1, fontSize: 24, lineHeight: 32, fontWeight: "700", color: ui.t1 },
  content: { gap: space[5] },
  group: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: ui.t2, marginBottom: 6 },
  change: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  changeTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: ui.t1 },
  readRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2], paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: ui.cardBorder },
  line: { flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: 6 },
  lineText: { fontSize: 14, lineHeight: 20, color: ui.t3 },
  lineOn: { color: ui.t1 },
  soft: { color: ui.t3 },
  tipItem: { fontSize: 13, lineHeight: 18, color: ui.t2, marginLeft: 30, marginBottom: 2 },
  start: { alignSelf: "flex-start" },
  reason: { fontSize: 13, lineHeight: 18, color: ui.t2 },
  promise: { fontSize: 12, lineHeight: 16, color: ui.t3 },
});
