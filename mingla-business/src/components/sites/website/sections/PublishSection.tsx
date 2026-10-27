import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useWebsite } from "../WebsiteContext";
import { OfflineBanner } from "./OverviewSection";
import { Banner, Card, CardTitle, CheckCircle, Chip, Hint, ListBox, Row, SectionHead, Spinner, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { useDesignChecks, useDraftChanges, useWorkLog, type DesignCheck, type WorkLogEntry } from "../../../../sites/contentApi";
import { BrandSitesError, SITES_ERROR_MESSAGES } from "../../../../services/brandSitesService";
import { formatWebsiteDateTime } from "../../../../sites/websiteCopy";
import { publicationReceiptLine } from "../../../../sites/publicationFlow";
import type { BrandSiteVersion } from "../../../../sites/contracts";
import { WEBSITE_SECTIONS, type WebsiteSection } from "../../../../sites/websiteNav";

/** #2829 W2 — why a publish was refused, when the owner can fix it. */
export const PUBLISH_REFUSAL_COPY: Readonly<Record<string, string>> = {
  PATH_COLLISION: "Two parts of your website use the same address. Change one page\u2019s address in Pages, then publish again.",
  PAGE_LIMIT_EXCEEDED: "Your website has more than 100 pages. Remove some in Pages, then publish again.",
  // #2829 W9b — a first publish waits until the design checks ran on that draft.
  DESIGN_CHECKS_REQUIRED: "Your first publish needs the design checks run on this draft. Run them below, then publish again.",
};

function failureReason(receipt: { error_code?: string | null; result_summary?: Record<string, unknown> | null } | null): string {
  const reason = receipt?.result_summary?.reason_code;
  if (typeof reason === "string" && PUBLISH_REFUSAL_COPY[reason]) return PUBLISH_REFUSAL_COPY[reason]!;
  return `Reason: ${(receipt?.error_code && SITES_ERROR_MESSAGES[receipt.error_code]) ?? "Mingla couldn't finish publishing."}`;
}

const STEPS = ["Checking your draft", "Building your pages", "Making sure it loads", "Switching it live"] as const;

/** Which plain step a publication's status is on. */
export function publishStep(status: BrandSiteVersion["status"] | null | undefined): number {
  if (status === "materializing") return 1;
  if (status === "probing") return 2;
  if (status === "published") return 3;
  return 0;
}

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Publish & history) — what changed, honest
 * checks (only a real problem blocks; warnings never do), one Publish button
 * that publishes exactly what was checked, and a plain history to restore
 * from. A publish is followed to its receipt whatever it takes (A18 #1).
 */
export function PublishSection(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, toast } = ctx;
  const router = useRouter();
  const site = controller.site.data!;
  const changes = useDraftChanges(site.id);
  const count = changes.data?.changes.length ?? 0;
  const canPublish = controller.capabilities.canPublish;
  const validation = controller.validation;
  const [restoring, setRestoring] = useState<BrandSiteVersion | null>(null);
  const operation = controller.publicationOperation;
  const receipt = controller.publicationReceipt.data ?? null;
  const tracking = operation !== null && receipt?.status !== "succeeded" && receipt?.status !== "failed";
  const failed = operation !== null && receipt?.status === "failed";
  const [now, setNow] = useState(Date.now());
  const [showReference, setShowReference] = useState(false);
  const liveHost = site.active_publication_id
    ? site.brand_site_hosts.find((entry) => entry.is_primary && entry.status === "active")?.hostname ?? null
    : null;
  useEffect(() => {
    if (!tracking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [tracking]);
  useEffect(() => {
    // Follow the publication's steps while it runs.
    if (!tracking) return undefined;
    const timer = setInterval(() => { void controller.versions.refetch(); }, 3000);
    return () => clearInterval(timer);
  }, [controller.versions, tracking]);

  const versions = controller.versions.data ?? [];
  const current = versions.find((row) => row.status !== "published" && row.status !== "failed" && row.status !== "ambiguous" && row.status !== "rolled_back");
  const step = tracking ? publishStep(current?.status) : 0;
  const slow = tracking && operation !== null && now - operation.startedAt > 15_000;
  const blocker = validation.error instanceof BrandSitesError &&
    ["VALIDATION_FAILED", "PATH_COLLISION", "PAGE_LIMIT_EXCEEDED", "REVISION_CONFLICT", "INVALID_STATE"].includes(validation.error.code)
    ? validation.error
    : null;
  // #2829 W9b — the six design checks run on open (warnings only). A site's
  // FIRST publish needs them run on this draft, so it waits for that run.
  const designChecks = useDesignChecks(site.id);
  const firstPublish = site.last_successful_publication_id === null;
  const checksRan = designChecks.data !== undefined && !designChecks.isFetching;
  const readyToPublish = validation.data !== undefined && blocker === null && (!firstPublish || checksRan);

  return (
    <View testID="website-publish">
      <OfflineBanner />
      <SectionHead ref={headingRef} phone={phone} title="Publish & history" subtitle="Changes you make are saved to your draft. Publishing makes them visible." />
      {tracking ? (
        <Card testID="publish-progress">
          <View role="status" accessibilityLiveRegion="polite">
            <CardTitle>Publishing…</CardTitle>
            <Hint>Usually under a minute. You can leave this screen; we&apos;ll tell you when it&apos;s live.</Hint>
            <View style={styles.steps}>
              {STEPS.map((label, index) => (
                <View key={label} style={styles.step}>
                  {index < step ? <CheckCircle state="on" /> : index === step ? <Spinner /> : <CheckCircle state="off" />}
                  <Text style={[styles.stepText, index <= step ? styles.stepActive : null]}>{label}</Text>
                </View>
              ))}
            </View>
            {slow ? (
              <Banner tone="info" icon="clock" title="Still publishing" body="This is taking longer than usual. Nothing is wrong: your current website stays live until the new one is ready." testID="publish-still" />
            ) : null}
            {controller.publicationPollingTimedOut || receipt?.status === "ambiguous" ? (
              <View style={styles.row}>
                <Hint style={styles.grow}>{publicationReceiptLine(receipt, true)}</Hint>
                <WButton label="Check the same operation" size="sm" onPress={controller.actions.onReconcilePublication} testID="publish-reconcile" />
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}
      {controller.publishedJustNow && !tracking ? (
        <Banner tone="ok" icon="check" title={controller.publishedJustNow === "rollback" ? "That version is live again" : "Your changes are live"} body="Published just now. Visitors see the new version." testID="publish-live">
          <WButton label="View live website" size="sm" onPress={() => {
            const host = site.brand_site_hosts.find((entry) => entry.is_primary)?.hostname;
            if (host) controller.actions.openUrl(`https://${host}`);
          }} />
        </Banner>
      ) : null}
      {failed ? (
        <Banner
          tone="err"
          icon="alert"
          alert
          title="That publish didn't go live"
          // #2829 W11 (design contract: "The first publish fails a check") — a
          // first publish has no previous version to keep live: nothing is.
          body={site.last_successful_publication_id
            ? `Last good preserved: your previous version is still live, so visitors saw no change. ${failureReason(receipt)}`
            : `Nothing went live: your website isn't public yet. ${failureReason(receipt)}`}
          testID="publish-failed"
        >
          {receipt?.result_summary?.retryable === true ? (
            <WButton label="Try again" size="sm" onPress={controller.actions.onResetFailedPublication} testID="publish-reset" />
          ) : (
            <WButton label="Review fixes" size="sm" onPress={() => { controller.actions.onResetFailedPublication(); ctx.go({ kind: "section", section: "pages" }); }} testID="publish-review-fixes" />
          )}
          <WButton label="Fix with Ari" icon="spark" size="sm" onPress={() => router.push(`/brand/${ctx.brandId}/website/ari` as never)} testID="publish-fix-with-ari" />
          {liveHost ? <WButton label="View live website" size="sm" onPress={() => controller.actions.openUrl(`https://${liveHost}`)} testID="publish-failed-live" /> : null}
          <WButton label="View operation details" size="sm" variant="ghost" onPress={() => setShowReference((value) => !value)} testID="publish-failed-details" />
          {showReference && operation ? (
            <Text style={styles.reference} selectable>{`Reference · ${operation.operationId}${receipt?.error_code ? ` · ${receipt.error_code}` : ""}`}</Text>
          ) : null}
        </Banner>
      ) : null}

      <Card testID="publish-changes">
        <CardTitle>{count ? `${count} ${count === 1 ? "change" : "changes"} since you last published` : changes.isLoading ? "Changes since you last published" : "Your draft matches your live website"}</CardTitle>
        {changes.isLoading ? <Hint>Comparing your draft with your live website…</Hint> : changes.isError ? (
          <Hint>Mingla couldn&apos;t compare your draft with your live website just now. You can still check and publish.</Hint>
        ) : count ? (
          <ListBox style={styles.changeList}>
            {(changes.data?.changes ?? []).map((change, index) => {
              const target = (WEBSITE_SECTIONS as readonly string[]).includes(change.section) ? change.section as WebsiteSection : "pages";
              return (
                <Pressable key={`${change.title}-${index}`} onPress={() => ctx.go({ kind: "section", section: target })} role="button" accessibilityRole="button" accessibilityLabel={`${change.title}: ${change.detail}`}
                  style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.changeRow, hovered ? styles.hover : null]}>
                  <View style={styles.grow}>
                    <Text style={styles.changeTitle}>{change.title}</Text>
                    <Text style={styles.changeDetail}>{change.detail}</Text>
                  </View>
                  <WebsiteIcon name="right" color={ui.t3} />
                </Pressable>
              );
            })}
          </ListBox>
        ) : <Hint>Nothing to publish.</Hint>}
      </Card>

      <ChecksCard blocker={blocker} designChecks={designChecks} firstPublish={firstPublish} />

      <Card>
        <View style={styles.actions}>
          {canPublish ? (
            <WButton
              label={count ? `Publish ${count} ${count === 1 ? "change" : "changes"}` : "Publish"}
              variant="primary"
              onPress={controller.actions.publish}
              disabled={!readyToPublish || tracking || ctx.lock.heldByOther || operation !== null || (count === 0 && site.active_publication_id !== null && !changes.isError)}
              loading={controller.isPublishing}
              testID="publish-button"
            />
          ) : (
            <WButton label="Ask an admin" icon="msg" onPress={() => ctx.askAdmin("publish")} loading={ctx.asking} testID="publish-ask-admin" />
          )}
          <WButton label="Preview draft" icon="eye" onPress={ctx.openFullScreenPreview} testID="publish-preview" />
        </View>
        {blocker ? <Text style={styles.blockerNote}>Fix the item marked ✕ to publish</Text> : null}
        {!blocker && firstPublish && !checksRan ? <Hint style={styles.mmNote}>Your first publish waits for the design checks to finish on this draft.</Hint> : null}
        {!canPublish ? <Hint style={styles.mmNote}>Marketing managers can change the draft. Publishing needs a brand admin or the owner; they get a notification with a link here.</Hint> : null}
      </Card>

      <History versions={versions} activeId={site.active_publication_id} canRestore={canPublish && !tracking} onRestore={setRestoring} loading={controller.versions.isLoading} />

      <WhyItLooksLikeThis />

      <ConfirmDialog
        visible={restoring !== null}
        onClose={() => setRestoring(null)}
        onConfirm={() => {
          const version = restoring;
          setRestoring(null);
          if (version) {
            controller.actions.rollback(version);
            toast(`Restoring the ${formatWebsiteDateTime(version.completed_at ?? version.requested_at)} version…`);
          }
        }}
        title={`Make the ${restoring ? formatWebsiteDateTime(restoring.completed_at ?? restoring.requested_at) : ""} version live again?`}
        description="Visitors will see that version within a minute. Your current version stays in History, so you can switch back. Your draft isn't changed."
        confirmLabel="Restore this version"
        testID="restore-confirm"
      />
    </View>
  );
}

/** #2829 W9b — what each design check says when it passes, and the plain heading of its warnings. */
const CHECK_COPY: Readonly<Record<DesignCheck["key"], { pass: string; warn: (n: number) => string; section: WebsiteSection }>> = {
  words: { pass: "Your words read as finished", warn: (n) => `${n} ${n === 1 ? "thing" : "things"} to check in your words`, section: "pages" },
  photos: { pass: "Every picture spot is filled and sharp", warn: (n) => `${n} ${n === 1 ? "photo note" : "photo notes"}`, section: "pages" },
  readability: { pass: "Text is easy to read", warn: () => "Some text is hard to read (your choice)", section: "design" },
  links: { pass: "Every link and button goes somewhere", warn: (n) => `${n} ${n === 1 ? "link" : "links"} to check`, section: "pages" },
  truth: { pass: "Every number, price and date is backed by Mingla", warn: (n) => `${n} ${n === 1 ? "claim" : "claims"} Mingla can\u2019t back`, section: "pages" },
  phone: { pass: "Pages fit phone screens", warn: (n) => `${n} phone layout ${n === 1 ? "note" : "notes"}`, section: "pages" },
};

function ChecksCard({ blocker, designChecks, firstPublish }: {
  blocker: BrandSitesError | null;
  designChecks: ReturnType<typeof useDesignChecks>;
  firstPublish: boolean;
}): React.ReactElement {
  const ctx = useWebsite();
  const { controller } = ctx;
  const validation = controller.validation;
  const checking = validation.isLoading || validation.isFetching || designChecks.isFetching;
  const warnings = designChecks.data?.warning_count ?? 0;
  return (
    <Card testID="publish-checks">
      <View style={styles.row}>
        <CardTitle style={styles.grow}>Checks</CardTitle>
        {checking ? (
          <View style={styles.row}><Spinner label="Checking your draft" /><Hint>{"Checking your pages\u2026"}</Hint></View>
        ) : blocker ? <Chip label="Needs a fix" tone="err" /> : validation.data && designChecks.data
          ? <Chip label={warnings ? `Ready to publish \u00b7 ${warnings} to look at` : "Ready to publish"} tone="ok" testID="checks-ready" />
          : null}
      </View>
      {!checking ? (
        <View style={styles.steps}>
          {blocker ? (
            <View style={styles.step}>
              <CheckCircle state="fail" />
              <Text style={[styles.stepText, styles.stepActive, styles.grow]}>{blocker.message}</Text>
              <WButton label="Fix" size="sm" onPress={() => ctx.go({ kind: "section", section: "pages" })} />
            </View>
          ) : validation.data ? (
            <View style={styles.step}>
              <CheckCircle state="on" />
              <Text style={[styles.stepText, styles.stepActive]}>{`All ${validation.data.checked_pages} ${validation.data.checked_pages === 1 ? "page builds" : "pages build"} correctly`}</Text>
            </View>
          ) : validation.isError ? (
            <View style={styles.step}>
              <CheckCircle state="warn" />
              <Text style={[styles.stepText, styles.stepActive, styles.grow]}>{validation.error instanceof BrandSitesError ? validation.error.message : "Mingla couldn't check your draft just now."}</Text>
              <WButton label="Check again" size="sm" onPress={() => { void validation.refetch(); }} testID="checks-retry" />
            </View>
          ) : null}
          {designChecks.isError ? (
            <View style={styles.step} testID="design-checks-error">
              <CheckCircle state="warn" />
              <Text style={[styles.stepText, styles.stepActive, styles.grow]}>
                {firstPublish ? "The design checks couldn\u2019t run. Your first publish needs them, so try again." : "The design checks couldn\u2019t run just now. They only warn, so you can still publish."}
              </Text>
              <WButton label="Run them again" size="sm" onPress={() => { void designChecks.refetch(); }} testID="design-checks-retry" />
            </View>
          ) : null}
          {(designChecks.data?.checks ?? []).map((check) => <CheckRow key={check.key} check={check} />)}
        </View>
      ) : null}
    </Card>
  );
}

function CheckRow({ check }: { check: DesignCheck }): React.ReactElement {
  const ctx = useWebsite();
  const [open, setOpen] = useState(false);
  const copy = CHECK_COPY[check.key];
  if (check.status === "pass") {
    return (
      <View style={styles.step} testID={`design-check-${check.key}`}>
        <CheckCircle state="on" />
        <Text style={[styles.stepText, styles.stepActive]}>{copy.pass}</Text>
      </View>
    );
  }
  const shown = open ? check.items.slice(0, 20) : check.items.slice(0, 2);
  return (
    <View testID={`design-check-${check.key}`}>
      <View style={styles.step}>
        <CheckCircle state="warn" />
        <Text style={[styles.stepText, styles.stepActive, styles.grow]}>
          {copy.warn(check.items.length)}<Text style={styles.soft}>{" \u00b7 doesn\u2019t block publishing"}</Text>
        </Text>
        <WButton label={check.key === "readability" ? "Review" : "Fix"} size="sm" onPress={() => ctx.go({ kind: "section", section: copy.section })} />
      </View>
      {shown.map((item, index) => (
        <Text key={`${check.key}-${index}`} style={styles.checkItem}>{item.message}</Text>
      ))}
      {check.items.length > 2 ? (
        <Pressable onPress={() => setOpen((value) => !value)} role="button" accessibilityRole="button" aria-expanded={open}
          accessibilityLabel={open ? "Show fewer" : `Show all ${check.items.length}`} style={styles.checkMore} testID={`design-check-${check.key}-more`}>
          <Text style={styles.checkMoreText}>{open ? "Show fewer" : `Show all ${check.items.length}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const CITE_PART_LABELS: Readonly<Record<string, string>> = {
  plan: "Website plan",
  draft: "First draft",
  composition: "Pages and menu",
  variant: "Layout",
  tokens: "Design",
  copy: "Words",
  imagery: "Photos and video",
  collection: "Content",
  trip_guide: "Trip guide",
};

function citeLine(cite: WorkLogEntry["cites"][number]): string {
  if (cite.kind === "owner_words" && cite.quote) return `Your words: \u201c${cite.quote}\u201d`;
  if (cite.kind === "mingla_record") return "Your details in Mingla";
  return "Your photo or video";
}

/**
 * #2829 W9b — "Why it looks like this": every change Ari made, why, and what
 * it was based on (the owner's own words, their Mingla details, or their own
 * photos). Only the team sees it; it is never published, and it travels in
 * "Download everything".
 */
function WhyItLooksLikeThis(): React.ReactElement {
  const ctx = useWebsite();
  const log = useWorkLog(ctx.controller.siteId);
  const entries = log.data ?? [];
  return (
    <View testID="publish-why">
      <Text style={styles.subhead} role="heading" aria-level={2}>Why it looks like this</Text>
      <Hint style={styles.whyIntro}>What Ari changed on your website, why, and what it was based on. Only your team sees this.</Hint>
      {log.isLoading ? <Hint>{"Loading\u2026"}</Hint> : log.isError ? (
        <View style={styles.row}>
          <Hint style={styles.grow}>Mingla couldn&apos;t load this just now.</Hint>
          <WButton label="Try again" size="sm" onPress={() => { void log.refetch(); }} testID="publish-why-retry" />
        </View>
      ) : entries.length === 0 ? (
        <Hint>Nothing yet. When Ari changes your website, the reason shows here.</Hint>
      ) : (
        <ListBox>
          {entries.map((entry) => (
            <Row key={entry.id} testID={`why-${entry.id}`}>
              <View style={styles.grow}>
                <Text style={styles.changeTitle}>{entry.decision}</Text>
                <Text style={styles.changeDetail}>{[entry.actor === "ari" ? "Ari" : "Your team", CITE_PART_LABELS[entry.part] ?? null, formatWebsiteDateTime(entry.created_at)].filter(Boolean).join(" \u00b7 ")}</Text>
                {entry.cites.map((cite, index) => (
                  <Text key={`${entry.id}-cite-${index}`} style={styles.citeLine}>{citeLine(cite)}</Text>
                ))}
              </View>
            </Row>
          ))}
        </ListBox>
      )}
    </View>
  );
}

function History({ versions, activeId, canRestore, onRestore, loading }: {
  versions: BrandSiteVersion[];
  activeId: string | null;
  canRestore: boolean;
  onRestore: (version: BrandSiteVersion) => void;
  loading: boolean;
}): React.ReactElement {
  const live = versions.filter((row) => row.status === "published" || row.status === "rolled_back");
  const attempts = versions.filter((row) => row.status === "failed" || row.status === "ambiguous");
  const [showAttempts, setShowAttempts] = useState(false);
  return (
    <View testID="publish-history">
      <Text style={styles.subhead} role="heading" aria-level={2}>History</Text>
      {loading ? <Hint>Loading your history…</Hint> : live.length === 0 && attempts.length === 0 ? <Hint>Nothing published yet.</Hint> : (
        <ListBox>
          {live.map((version) => {
            const isLive = version.id === activeId;
            const by = (version as BrandSiteVersion & { requested_by_name?: string | null }).requested_by_name;
            return (
              <Row key={version.id} testID={`history-${version.id}`}>
                <View style={styles.grow}>
                  <View style={styles.row}>
                    <Text style={styles.changeTitle}>{`Published ${formatWebsiteDateTime(version.completed_at ?? version.requested_at)}`}</Text>
                    {isLive ? <Chip label="Live now" tone="ok" /> : null}
                  </View>
                  <Text style={styles.changeDetail}>{[by ? `by ${by}` : null, version.rollback_source_publication_id ? "restored an earlier version" : null].filter(Boolean).join(" · ") || " "}</Text>
                </View>
                {!isLive && canRestore ? <WButton label="Restore" size="sm" onPress={() => onRestore(version)} testID={`history-restore-${version.id}`} /> : null}
              </Row>
            );
          })}
          {attempts.length ? (
            <View>
              <Pressable onPress={() => setShowAttempts((value) => !value)} role="button" accessibilityRole="button" aria-expanded={showAttempts}
                accessibilityLabel={`${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"} that didn't go live (your website didn't change)`} style={styles.attemptsToggle} testID="history-attempts">
                <WebsiteIcon name={showAttempts ? "down" : "right"} size={16} color={ui.t2} />
                <Text style={styles.attemptsText}>{`${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"} that didn't go live (your website didn't change)`}</Text>
              </Pressable>
              {showAttempts ? attempts.map((row) => (
                <Text key={row.id} style={styles.attempt}>{`${formatWebsiteDateTime(row.requested_at)} · ${row.status === "ambiguous"
                  ? "we couldn't confirm the result in time; it never went live."
                  : `stopped before going live${row.failure_code && SITES_ERROR_MESSAGES[row.failure_code] ? `: ${SITES_ERROR_MESSAGES[row.failure_code]!.replace(/\.$/, "").toLowerCase()}` : ""}.`}`}</Text>
              )) : null}
            </View>
          ) : null}
        </ListBox>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  steps: { gap: 10, marginTop: 12 },
  step: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  stepText: { fontSize: 14, color: ui.t3 },
  stepActive: { color: ui.t1 },
  soft: { color: ui.t3, fontSize: 12 },
  changeList: { marginTop: 10 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14 },
  hover: { backgroundColor: ui.card2 },
  changeTitle: { fontSize: 14, fontWeight: "600", color: ui.t1 },
  changeDetail: { fontSize: 12.5, lineHeight: 17, color: ui.t3 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  blockerNote: { marginTop: 8, fontSize: 12, color: ui.err },
  mmNote: { marginTop: 8 },
  subhead: { fontSize: 16, fontWeight: "600", color: ui.t1, marginTop: 8, marginBottom: 10 },
  attemptsToggle: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 14 },
  attemptsText: { fontSize: 13, color: ui.t2, flex: 1 },
  reference: { fontSize: 12, color: ui.t3, marginTop: 6, width: "100%" },
  attempt: { fontSize: 12.5, lineHeight: 18, color: ui.t3, paddingHorizontal: 14, paddingBottom: 8 },
  checkItem: { fontSize: 12.5, lineHeight: 18, color: ui.t2, paddingLeft: 30, marginTop: 4 },
  checkMore: { minHeight: 44, justifyContent: "center", paddingLeft: 30 },
  checkMoreText: { fontSize: 12.5, color: ui.t1, textDecorationLine: "underline" },
  whyIntro: { marginBottom: 10 },
  citeLine: { fontSize: 12.5, lineHeight: 17, color: ui.t2, marginTop: 4 },
});
