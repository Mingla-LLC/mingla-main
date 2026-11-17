import React, { useState } from "react";
import { Modal, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { DESIGNS, type DesignKey } from "../../../../../packages/site-contracts/src/designs.ts";
import { planBuildSentence } from "../../../../../packages/site-contracts/src/planPreview.ts";
import { isFormatKey } from "../../../../../packages/site-contracts/src/formats.ts";
import { defaultPreviewPreference, type PreviewDevicePreference } from "../../../sites/previewDevice";
import { planPreviewUrl, usePlanPreviews, type PlanPreviewCard } from "../../../sites/planPreviewApi";
import { useComposeBrandSiteFromPlan, useSaveBrandSitePlanDesign } from "../../../sites/planApi";
import type { SitePlanState } from "../../../sites/sitePlanState";
import { BrandSitesError } from "../../../services/brandSitesService";
import { Sheet } from "../../ui/Sheet";
import { useWebsite } from "../website/WebsiteContext";
import { Card, CardTitle, Chip, Hint, SectionHead, Segmented, Skeleton, WButton, ui } from "../website/ui";
import { ScaledPreviewFrame } from "../website/preview/ScaledPreviewFrame";
import { FullScreenPreviewBar } from "../website/preview/FullScreenPreviewBar";
import { PreviewDeviceSwitcher } from "../website/preview/SitePreviewPanel";

/**
 * #4453 milestone 10 (spec v2.1 §2.1) — "See your site in three styles",
 * replacing "Choose your design" while SITES_PLAN_PREVIEW is on for the brand.
 *
 * Three real renders of the brand's own plan and Mingla listings in Ari's
 * picks. Nothing is written until "Start the build": it saves the design and
 * runs the existing Build with the same inputs. "See all 10 styles" opens the
 * existing look picker (a ✕ style shows its warning there and still saves).
 * Native mounts ONE WebView at a time (the card in view); the others wait.
 */
export function PlanPreviewChooser({
  brandId,
  planState,
  onDone,
  onSeeAll,
  onChangeDetails,
  readOnly: forcedReadOnly = false,
}: {
  brandId: string;
  planState: SitePlanState;
  onDone: () => void;
  onSeeAll: () => void;
  /** "Change details" goes back to the Story step. */
  onChangeDetails: () => void;
  readOnly?: boolean;
}): React.ReactElement {
  const ctx = useWebsite();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === "web" && width >= 1200;
  const revision = planState.plan?.revision ?? null;
  const previews = usePlanPreviews(brandId, revision, true);
  const save = useSaveBrandSitePlanDesign(brandId);
  const compose = useComposeBrandSiteFromPlan(brandId);
  const readOnly = forcedReadOnly || ctx.lock.heldByOther || planState.site?.paused === true;
  const [active, setActive] = useState(0);
  const [reload, setReload] = useState<Record<string, number>>({});
  const [full, setFull] = useState<PlanPreviewCard | null>(null);
  const [fullPath, setFullPath] = useState("");
  const [fullPref, setFullPref] = useState<PreviewDevicePreference>(defaultPreviewPreference(wide));
  const [confirm, setConfirm] = useState<PlanPreviewCard | null>(null);
  const brandName = ctx.brandName;
  const data = previews.data;
  const picks = data?.picks ?? [];
  const format = data && isFormatKey(data.format) ? data.format : null;

  const startBuild = (card: PlanPreviewCard) => {
    if (revision === null) return;
    const sourceType = picks[0]?.key === card.style ? "mingla" : "owner";
    save.mutate(
      { revision, designKey: card.style, sourceType },
      {
        onSuccess: () => {
          setConfirm(null);
          setFull(null);
          compose.mutate(undefined, {
            onSuccess: () => {
              ctx.toast("Ari is building your pages. Every page arrives as a Draft.", "success");
              onDone();
            },
            onError: (error) => {
              // The style is saved; Build waits for the parts it still needs.
              ctx.toast(
                error instanceof BrandSitesError ? `Style saved. ${error.message}` : "Style saved. Build your pages when the earlier parts are done.",
                "info",
              );
              onDone();
            },
          });
        },
        onError: (error) => ctx.toast(error instanceof BrandSitesError ? error.message : "That style couldn’t be saved. Try again.", "error"),
      },
    );
  };

  const cardFrame = (card: PlanPreviewCard, index: number) => {
    const mountWebView = Platform.OS === "web" || index === active;
    if (!mountWebView) {
      return (
        <View style={styles.waiting} testID={`plan-preview-waiting-${card.style}`}>
          <Hint>Laying out {brandName} in {DESIGNS[card.style].label}…</Hint>
          <WButton label="Show this preview" size="sm" variant="secondary" onPress={() => setActive(index)} testID={`plan-preview-show-${card.style}`} />
        </View>
      );
    }
    return (
      <ScaledPreviewFrame
        key={`${card.url}#${reload[card.style] ?? 0}`}
        url={card.url}
        preference={defaultPreviewPreference(wide)}
        maxHeight={wide ? 420 : 560}
      />
    );
  };

  return (
    <View testID="plan-preview-chooser">
      <SectionHead
        ref={ctx.headingRef}
        phone={ctx.phone}
        title="See your site in three styles"
        subtitle={data?.hasSamples ? "Your name and details, sample listings" : "Your name, your plan and your real Mingla listings, in the three styles Ari picked."}
        right={<Chip label="Nothing built yet" tone="accent" />}
      />
      <View style={styles.row}>
        <WButton label="Change details" variant="secondary" size="sm" onPress={onChangeDetails} testID="plan-preview-change-details" />
      </View>
      {previews.isError ? (
        <Card testID="plan-preview-error">
          <CardTitle>Couldn’t load the previews</CardTitle>
          <Hint>{previews.error instanceof BrandSitesError ? previews.error.message : "Couldn't load this preview. Try again."}</Hint>
          <View style={styles.row}><WButton label="Try again" size="sm" onPress={() => previews.refetch()} testID="plan-preview-retry" /></View>
        </Card>
      ) : null}
      <View style={[styles.cards, wide ? styles.cardsWide : null]}>
        {previews.isPending || !data
          ? !previews.isError ? [0, 1, 2].map((index) => (
            <View key={index} style={[styles.card, wide ? styles.cardWide : null]} role="status" accessibilityLabel={`Laying out ${brandName}`}>
              <Skeleton height={wide ? 360 : 420} />
              <Hint style={styles.loading}>Laying out {brandName}…</Hint>
            </View>
          )) : null
          : data.cards.map((card, index) => {
            const pick = picks.find((entry) => entry.key === card.style);
            return (
              <View key={card.style} style={[styles.card, wide ? styles.cardWide : null]} testID={`plan-preview-card-${card.style}`}>
                <View style={styles.titleRow}>
                  <Chip label={`Ari's pick ${pick?.rank ?? index + 1}`} tone="accent" />
                  <CardTitle>{DESIGNS[card.style].label}</CardTitle>
                </View>
                {pick?.reason ? <Text style={styles.reason}>{pick.reason}</Text> : null}
                <View style={styles.frame}>{cardFrame(card, index)}</View>
                <View style={styles.actions}>
                  <WButton label="Reload" size="sm" variant="secondary" onPress={() => setReload((prev) => ({ ...prev, [card.style]: (prev[card.style] ?? 0) + 1 }))} testID={`plan-preview-reload-${card.style}`} />
                  <WButton label="Open full screen" icon="ext" size="sm" variant="secondary" onPress={() => { setFullPath(""); setFull(card); }} testID={`plan-preview-full-${card.style}`} />
                  {readOnly ? null : (
                    <WButton label="Build with this style" size="sm" variant="primary" onPress={() => setConfirm(card)} testID={`plan-preview-build-${card.style}`} />
                  )}
                </View>
              </View>
            );
          })}
      </View>
      {data?.skippedLine ? <Hint style={styles.skipped}>{data.skippedLine}</Hint> : null}
      <View style={styles.row}>
        <WButton label="See all 10 styles" variant="secondary" onPress={onSeeAll} testID="plan-preview-see-all" />
      </View>

      <Modal visible={full !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setFull(null)}>
        {full ? (
          <View style={styles.fullRoot} testID="plan-preview-fullscreen">
            <FullScreenPreviewBar
              brandName={brandName}
              onClose={() => setFull(null)}
              canShare={false}
              shareReady={false}
              plan={{ onBuild: readOnly ? null : () => setConfirm(full) }}
            />
            <View style={styles.fullBody}>
              <PreviewDeviceSwitcher preference={fullPref} onChange={setFullPref} />
              {full.pages.length > 1 ? (
                <Segmented
                  label="Preview page"
                  compact
                  options={full.pages.slice(0, 8).map((page) => ({ value: page.path || "/", label: page.path ? page.title : "Home" }))}
                  value={fullPath || "/"}
                  onChange={(next) => setFullPath(next === "/" ? "" : next)}
                  testIDPrefix="plan-preview-page"
                />
              ) : null}
              <ScaledPreviewFrame
                url={planPreviewUrl(new URL(full.url).origin, new URL(full.url).searchParams.get("k") ?? "", fullPath)}
                preference={fullPref}
                fill
              />
            </View>
          </View>
        ) : null}
      </Modal>

      <Sheet visible={confirm !== null} onClose={() => setConfirm(null)} snapPoint="half" testID="plan-preview-confirm">
        {confirm ? (
          <ScrollView contentContainerStyle={styles.sheet}>
            <CardTitle>Build with {DESIGNS[confirm.style].label}</CardTitle>
            <Text style={styles.sheetLine}>{format ? planBuildSentence(confirm.pageLabels, format) : "Ari builds your pages."}</Text>
            <Text style={styles.sheetLine}>It fills them from your Mingla listings and photos, and asks you for anything it doesn&apos;t know.</Text>
            <Text style={styles.sheetLine}>Every page arrives as a Draft. Nothing goes live until you publish.</Text>
            <View style={styles.sheetActions}>
              <WButton label="Keep comparing" variant="secondary" onPress={() => setConfirm(null)} testID="plan-preview-keep" />
              <WButton label="Start the build" variant="primary" loading={save.isPending || compose.isPending} disabled={save.isPending || compose.isPending} onPress={() => startBuild(confirm)} testID="plan-preview-start" />
            </View>
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  cards: { gap: 16, marginBottom: 12 },
  cardsWide: { flexDirection: "row", alignItems: "flex-start" },
  card: { borderRadius: 16, borderWidth: 1, borderColor: ui.cardBorder, backgroundColor: ui.card, padding: 14, gap: 10, minWidth: 0 },
  cardWide: { flex: 1, flexBasis: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  reason: { color: ui.t2, fontSize: 14, lineHeight: 20 },
  frame: { minHeight: 360, minWidth: 0 },
  waiting: { minHeight: 360, alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.02)", padding: 16 },
  loading: { marginTop: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  skipped: { marginBottom: 12 },
  fullRoot: { flex: 1, backgroundColor: ui.card },
  fullBody: { flex: 1, padding: 12, gap: 10 },
  sheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 12 },
  sheetLine: { color: ui.t2, fontSize: 15, lineHeight: 22 },
  sheetActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 12 },
});
