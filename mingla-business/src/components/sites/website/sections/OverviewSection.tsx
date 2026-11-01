import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useWebsite } from "../WebsiteContext";
import { SiteStatusChip } from "../StatusChip";
import { Banner, Body, Card, CardTitle, Chip, Hint, SectionHead, Spinner, WButton, ui } from "../ui";
import { WebsiteIcon, type WebsiteIconName } from "../WebsiteIcon";
import {
  useContentList,
  useDraftChanges,
  useOverviewCounts,
  type DestinationSummary,
  type OverviewCounts,
  type ReviewSummary,
} from "../../../../sites/contentApi";
import { formatWebsiteDateTime, offeringChangedLine } from "../../../../sites/websiteCopy";
import { useBrandSiteDomains } from "../../../../hooks/useBrandSite";
import { plannedPagesFor } from "../../../../../../packages/site-contracts/src/sitePlan.ts";
import { PLANNED_PAGE_LABELS } from "../../../../../../packages/site-contracts/src/emptyStates.ts";
import type { WebsiteSection } from "../../../../sites/websiteNav";

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Overview) — status first, the one decision
 * (publish what changed, or ask an admin), what is worth a look, and the
 * last 30 days. Before a site exists: the plan's progress and what the brand
 * will get, in its own words.
 */
export function OverviewSection(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, brandName, phone, headingRef } = ctx;
  const site = controller.site.data ?? null;
  if (!site) return <NoSiteOverview />;
  if (site.status === "provisioning") return <ProvisioningOverview />;

  const host = site.brand_site_hosts.find((entry) => entry.is_primary)?.hostname ?? site.brand_site_hosts[0]?.hostname ?? "";
  const published = Boolean(site.active_publication_id);
  const offline = Boolean(site.owner_offline_at);
  return (
    <View testID="website-overview">
      <OfflineBanner />
      <SectionHead
        ref={headingRef}
        phone={phone}
        title={`${brandName} website`}
        subtitle={host ? <Text style={styles.mono} testID="overview-host">{host}</Text> : null}
        right={<SiteStatusChip controller={controller} />}
      />
      <StatusCard published={published} offline={offline} host={host} />
      <WorthALook />
      {published ? <LastThirtyDays /> : null}
    </View>
  );
}

export function OfflineBanner(): React.ReactElement | null {
  const { controller, askAdmin, asking } = useWebsite();
  const site = controller.site.data;
  if (!site?.owner_offline_at) return null;
  return (
    <Banner tone="err" icon="power" title="Your website is offline" body={'Visitors see a short "temporarily unavailable" page. Your drafts, versions and address are kept.'} testID="offline-banner">
      {controller.capabilities.canPublish
        ? <WButton label="Bring it back online" size="sm" onPress={() => controller.actions.setOffline(false)} loading={controller.isTogglingOffline} testID="offline-bring-back" />
        : <WButton label="Ask an admin" icon="msg" size="sm" onPress={() => askAdmin("offline")} loading={asking} />}
    </Banner>
  );
}

function StatusCard({ published, offline, host }: { published: boolean; offline: boolean; host: string }): React.ReactElement {
  const ctx = useWebsite();
  const { controller } = ctx;
  const router = useRouter();
  const site = controller.site.data!;
  const changes = useDraftChanges(site.id);
  const count = changes.data?.changes.length ?? 0;
  const publishedAt = changes.data?.published_at ?? null;
  const title = offline
    ? `Offline since ${formatWebsiteDateTime(site.owner_offline_at)}`
    : !published
      ? "Draft ready · not published yet"
      : `Live · published ${formatWebsiteDateTime(publishedAt ?? site.updated_at)}`;
  const hint = !published
    ? "Add content, then publish when you're happy"
    : count > 0
      ? `${count} ${count === 1 ? "change" : "changes"} in your draft that visitors can't see yet`
      : changes.isLoading ? " " : changes.isError ? "Mingla couldn't compare your draft with your live website just now" : "Your draft and live website match";
  const showDecision = count > 0 || !published;
  return (
    <Card testID="overview-status">
      <View style={styles.statusRow}>
        <View style={styles.grow}>
          <CardTitle>{title}</CardTitle>
          <Hint>{hint}</Hint>
        </View>
        {showDecision ? (
          controller.capabilities.canPublish
            ? <WButton label="Review and publish" variant="primary" onPress={() => ctx.go({ kind: "section", section: "publish" })} testID="overview-review-publish" />
            : <WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("publish")} loading={ctx.asking} testID="overview-ask-publish" />
        ) : null}
      </View>
      <View style={styles.actions}>
        <WButton label="Preview draft" icon="eye" size="sm" onPress={ctx.openFullScreenPreview} testID="overview-preview" />
        {published && host ? (
          <WButton label="View live website" icon="ext" size="sm" onPress={() => controller.actions.openUrl(`https://${host}`)} testID="overview-view-live" />
        ) : null}
        <WButton label="Change it with Ari" icon="spark" size="sm" onPress={() => router.push(`/brand/${ctx.brandId}/website/ari` as never)} testID="overview-ari" />
      </View>
    </Card>
  );
}

type Look = { icon: WebsiteIconName; text: string; section: WebsiteSection };

function WorthALook(): React.ReactElement | null {
  const ctx = useWebsite();
  const site = ctx.controller.site.data!;
  const reviews = useContentList<ReviewSummary>(site.id, "testimonials");
  const destinations = useContentList<DestinationSummary>(site.id, "destinations");
  const domains = useBrandSiteDomains(site.id, true);
  const looks: Look[] = [];
  const unconfirmed = (reviews.data?.entries ?? []).filter((entry) => !entry.confirmed).length;
  if (unconfirmed > 0) {
    looks.push({ icon: "quote", text: `${unconfirmed} ${unconfirmed === 1 ? "review needs" : "reviews need"} your confirmation before it can show`, section: "reviews" });
  }
  const missing = (destinations.data?.entries ?? []).filter((entry) => entry.photos_missing_alt > 0);
  const missingCount = missing.reduce((total, entry) => total + entry.photos_missing_alt, 0);
  if (missingCount > 0) {
    looks.push({
      icon: "image",
      text: `${missingCount} ${missingCount === 1 ? "photo" : "photos"} in ${missing.length === 1 ? missing[0]!.title : `${missing.length} destinations`} ${missingCount === 1 ? "needs" : "need"} a short description`,
      section: "destinations",
    });
  }
  for (const host of domains.data?.hosts ?? []) {
    if (host.kind === "custom_domain" && (host.status === "suspended" || (host.status === "active" && (host.dns_state === "misconfigured" || host.tls_state === "failed")))) {
      looks.push({ icon: "globe", text: `${host.hostname} isn't pointing at your website any more`, section: "addresses" });
    }
  }
  if (destinations.data && destinations.data.entries.filter((entry) => entry.enabled).length === 0 && ctx.plan?.site?.designKey === "voyage") {
    looks.push({ icon: "pin", text: "Your destinations page is empty and hidden from search", section: "destinations" });
  }
  if (site.menu_changed_since_publish === true) {
    looks.push({ icon: "upload", text: offeringChangedLine(ctx.offerings), section: "publish" });
  }
  if (!looks.length) return null;
  return (
    <Card testID="overview-worth-a-look">
      <CardTitle>Worth a look</CardTitle>
      <View style={styles.stack}>
        {looks.slice(0, 5).map((look) => (
          <Pressable
            key={look.text}
            onPress={() => ctx.go({ kind: "section", section: look.section })}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={look.text}
            style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.look, hovered ? styles.lookHover : null]}
          >
            <WebsiteIcon name={look.icon} color={ui.t2} />
            <Text style={styles.lookText}>{look.text}</Text>
            <WebsiteIcon name="right" color={ui.t2} />
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function LastThirtyDays(): React.ReactElement {
  const ctx = useWebsite();
  const router = useRouter();
  const counts = useOverviewCounts(ctx.controller.site.data!.id);
  const value = (n: number | undefined) => (n === undefined ? "—" : String(n));
  return (
    <View testID="overview-last-30">
      <Text style={styles.subhead} role="heading" aria-level={2}>Last 30 days</Text>
      {counts.isError ? (
        <Hint>Your website numbers couldn&apos;t be loaded. They&apos;ll show here when Mingla can reach them.</Hint>
      ) : (
        <View style={[styles.kpis, ctx.phone ? styles.kpisPhone : null]}>
          <View style={styles.kpi}><Text style={styles.kpiValue}>{value(counts.data?.visits_30d)}</Text><Hint>Visits</Hint></View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{value(counts.data?.enquiries_30d)}</Text>
            <View style={styles.inline}>
              <Hint>Enquiries · </Hint>
              <Pressable onPress={() => router.push("/messages" as never)} role="link" accessibilityRole="link" accessibilityLabel="Open Messages, Customer enquiries" hitSlop={12}>
                <Text style={styles.link}>open</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.kpi}><Text style={styles.kpiValue}>{value(counts.data?.bookings_30d)}</Text><Hint>Bookings that started here</Hint></View>
        </View>
      )}
      {counts.data ? <VisitDetails counts={counts.data} phone={ctx.phone} /> : null}
      <Text style={styles.help}>Visits are counted only for visitors who allow analytics on your website. Enquiries live in Messages; this is only a count.</Text>
    </View>
  );
}

const SOURCE_LABELS: Record<keyof OverviewCounts["sources"], string> = {
  direct: "Typed or bookmarked",
  search: "Search engines",
  social: "Social media",
  mingla: "Mingla",
  other: "Other websites",
};

/**
 * #2829 W10 — the rest of the website's numbers (SPEC W10: top pages, book
 * clicks, sources), inside the same "Last 30 days" block the approved design
 * gives analytics. Nothing is shown for a number Mingla has none of.
 */
function VisitDetails({ counts, phone }: { counts: OverviewCounts; phone: boolean }): React.ReactElement | null {
  const sources = (Object.keys(SOURCE_LABELS) as Array<keyof OverviewCounts["sources"]>)
    .filter((key) => (counts.sources[key] ?? 0) > 0);
  return (
    <View style={[styles.details, phone ? styles.kpisPhone : null]} testID="overview-visit-details">
      <View style={styles.kpi}>
        <Text style={styles.kpiValue}>{String(counts.book_clicks_30d)}</Text>
        <Hint>Book clicks (to your Mingla pages)</Hint>
      </View>
      <View style={[styles.kpi, styles.detailList]} testID="overview-top-pages">
        <CardTitle>Top pages</CardTitle>
        {counts.top_pages.length ? counts.top_pages.map((row) => (
          <View key={row.path} style={styles.detailRow}>
            <Text style={styles.detailLabel} numberOfLines={1}>{row.path}</Text>
            <Text style={styles.detailValue}>{String(row.views)}</Text>
          </View>
        )) : <Hint>No page views yet.</Hint>}
      </View>
      <View style={[styles.kpi, styles.detailList]} testID="overview-sources">
        <CardTitle>Where visitors came from</CardTitle>
        {sources.length ? sources.map((key) => (
          <View key={key} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{SOURCE_LABELS[key]}</Text>
            <Text style={styles.detailValue}>{String(counts.sources[key])}</Text>
          </View>
        )) : <Hint>No visits yet.</Hint>}
      </View>
    </View>
  );
}

/**
 * #2830 state 4 — the draft is being created: receipt progress only, no
 * editing, preview, publish or numbers. After the polling window a brand
 * admin or owner (Core's can_create) can check the same operation again;
 * everyone else is told Mingla is waiting for the setup receipt.
 */
function ProvisioningOverview(): React.ReactElement {
  const { controller, phone, headingRef } = useWebsite();
  const timedOut = controller.provisionPollingTimedOut;
  return (
    <View testID="website-provisioning">
      <SectionHead ref={headingRef} phone={phone} title="Creating your website draft" subtitle="This usually takes under a minute. You can leave this screen." />
      <Card>
        <View role="status" accessibilityLiveRegion="polite" style={styles.statusRow}>
          {timedOut ? null : <Spinner label="Creating your website draft" />}
          <View style={styles.grow}>
            <CardTitle>{timedOut ? "Still creating your draft" : "Creating your website draft"}</CardTitle>
            <Hint>{timedOut
              ? "Mingla hasn't received the authoritative setup receipt yet. Nothing is lost; the same setup is still on record."
              : "Setting up your pages and your address."}</Hint>
          </View>
        </View>
        {timedOut && controller.capabilities.canCreate ? (
          <View style={styles.actions}>
            <WButton label="Check setup status" onPress={controller.actions.reconcileProvision} loading={controller.isProvisioning} testID="provision-reconcile" />
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function NoSiteOverview(): React.ReactElement {
  const ctx = useWebsite();
  const { plan, phone, headingRef, controller } = ctx;
  const router = useRouter();
  const done = plan?.doneCount ?? 0;
  const total = plan?.parts.length || 8;
  const next = plan?.parts.find((part) => !part.done);
  const pages = plannedPagesFor(ctx.offerings).map((key) => PLANNED_PAGE_LABELS[key].menu);
  const pageWords = ["Home", ...pages.filter((name) => name !== "Home"), "About", "Contact"];
  const uniquePages = [...new Set(pageWords)];
  return (
    <View testID="website-no-site">
      <SectionHead ref={headingRef} phone={phone} title="Build your website" subtitle="Ari walks you through it, or do each part yourself. About 15 minutes; your progress saves as you go." />
      <Card>
        <View style={styles.statusRow}>
          <View style={styles.grow}>
            <CardTitle>{`Setup plan · ${done} of ${total} done`}</CardTitle>
            {next ? <Hint>{`Next: ${partName(next.key)}`}</Hint> : null}
          </View>
          <Chip label="Private until you publish" />
        </View>
        <View style={styles.progress} role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} accessibilityLabel={`${done} of ${total} done`}>
          <View style={[styles.progressFill, { width: `${Math.round((done / total) * 100)}%` }]} />
        </View>
        <View style={styles.actions}>
          <WButton label="Continue with Ari" icon="spark" variant="primary" onPress={() => router.push(`/brand/${ctx.brandId}/website/ari?intent=setup` as never)} testID="nosite-ari" />
          <WButton label="See the plan" onPress={() => ctx.go({ kind: "section", section: "plan" })} testID="nosite-plan" />
        </View>
      </Card>
      <Card>
        <CardTitle>What you&apos;ll get</CardTitle>
        {controller.label.data?.hostname ? (
          <Text style={styles.mono} testID="nosite-address">{`Address · ${controller.label.data.hostname}`}</Text>
        ) : null}
        <Body>
          {`A page for everything you offer, even before it has anything on it: ${uniquePages.join(", ").replace(/, ([^,]*)$/, " and $1")} for ${ctx.brandName}.${ctx.offerings.some((key) => ["trips", "events", "experiences"].includes(key)) ? " These come straight from Mingla, so spots left and sold out update by themselves." : ""}`}
        </Body>
      </Card>
      {controller.capabilities.canCreate ? null : <Hint>Only a brand admin or the owner can create the website draft.</Hint>}
    </View>
  );
}

export function partName(key: string): string {
  const names: Record<string, string> = {
    offer: "What you'll offer",
    brand: "Your brand details",
    look: "Choose your design",
    story: "Your story",
    approve: "Approve the plan",
    build: "Build your pages",
    first_offering: "Add your first trip or event",
    publish: "Check and publish",
  };
  return names[key] ?? key;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }), fontSize: 12.5, color: ui.t2, marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, flexWrap: "wrap" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  stack: { gap: 8, marginTop: 8 },
  look: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: ui.cardBorder },
  lookHover: { backgroundColor: ui.card2 },
  lookText: { flex: 1, fontSize: 14, color: ui.t1 },
  subhead: { fontSize: 16, fontWeight: "600", color: ui.t1, marginTop: 24, marginBottom: 10 },
  kpis: { flexDirection: "row", gap: 12 },
  kpisPhone: { flexDirection: "column" },
  kpi: { flex: 1, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.cardBorder, borderRadius: 16, padding: 14 },
  kpiValue: { fontSize: 26, lineHeight: 32, fontWeight: "700", color: ui.t1, letterSpacing: -0.4 },
  details: { flexDirection: "row", gap: 12, marginTop: 12 },
  detailList: { gap: 6 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  detailLabel: { flex: 1, minWidth: 0, fontSize: 13, color: ui.t2 },
  detailValue: { fontSize: 13, fontWeight: "600", color: ui.t1 },
  inline: { flexDirection: "row", alignItems: "center" },
  link: { fontSize: 12, fontWeight: "600", color: ui.accent },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 6 },
  progress: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.09)", overflow: "hidden", marginVertical: 12 },
  progressFill: { height: "100%", backgroundColor: ui.accent },
});
