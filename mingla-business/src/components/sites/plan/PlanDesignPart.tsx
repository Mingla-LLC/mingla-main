import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import {
  DESIGNS,
  designSwatches,
  isDesignKey,
  type DesignKey,
} from "../../../../../packages/site-contracts/src/designs.ts";
import { lookPickerKeys, planFormatOf, styleFitLabel } from "../../../sites/styleLibrary";
import { resolveTokens } from "../../../../../packages/site-contracts/src/tokens.ts";
import { useSaveBrandSitePlanDesign } from "../../../sites/planApi";
import { swatchHex } from "../../../sites/siteLook";
import type { SitePlanState } from "../../../sites/sitePlanState";
import { BrandSitesError } from "../../../services/brandSitesService";
import { Sheet } from "../../ui/Sheet";
import { useWebsite } from "../website/WebsiteContext";
import { PlanStylePreview } from "./PlanStylePreview";
import {
  Card,
  CardTitle,
  Chip,
  Hint,
  SectionHead,
  WButton,
  ui,
} from "../website/ui";

/** #2830 — choose the design before a site or draft exists. */
export function PlanDesignPart({
  brandId,
  planState,
  onDone,
  readOnly: forcedReadOnly = false,
}: {
  brandId: string;
  planState: SitePlanState;
  onDone: () => void;
  readOnly?: boolean;
}): React.ReactElement {
  const ctx = useWebsite();
  const save = useSaveBrandSitePlanDesign(brandId);
  const stored = planState.plan?.designKey;
  const [choice, setChoice] = useState<DesignKey | null>(isDesignKey(stored) ? stored : null);
  // #4453 — SITES_STYLE_LIBRARY: the ten styles with their fit, else Atelier and Voyage.
  const keys = lookPickerKeys(planState.styleLibrary, stored);
  const format = planState.styleLibrary ? planFormatOf(planState.plan) : null;
  const choiceFit = choice ? styleFitLabel(format, choice) : null;
  const readOnly = forcedReadOnly || ctx.lock.heldByOther || planState.site?.paused === true;
  // #4453 — the picked style's live preview: beside the picker on desktop web,
  // in a sheet on phone and narrow screens.
  const { width, height } = useWindowDimensions();
  const wide = Platform.OS === "web" && width >= 1200;
  const [sheetOpen, setSheetOpen] = useState(false);

  const persist = (designKey: DesignKey, sourceType: "owner" | "mingla") => {
    if (!planState.plan) return;
    save.mutate(
      { revision: planState.plan.revision, designKey, sourceType },
      {
        onSuccess: () => {
          ctx.toast("Design saved to your setup plan. No draft was created.", "success");
          onDone();
        },
        onError: (error) =>
          ctx.toast(
            error instanceof BrandSitesError
              ? error.message
              : "That design couldn’t be saved. Read the latest plan and try again.",
            "error",
          ),
      },
    );
  };

  const onSave = () => {
    if (choice) persist(choice, "owner");
  };

  return (
    <View testID="plan-design-part">
      <SectionHead
        ref={ctx.headingRef}
        phone={ctx.phone}
        title="Choose your design"
        subtitle={wide
          ? "Pick a style to see your site in it on the right. You can fine-tune colours and fonts after Build your pages creates the first draft."
          : "Pick a style, then tap Preview to see your site in it. You can fine-tune colours and fonts after Build your pages creates the first draft."}
        right={<Chip label="No draft yet" tone="accent" />}
      />
      <View style={wide ? styles.split : null}>
      <View style={wide ? styles.pickerColumn : null}>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {keys.map((key) => {
          const design = DESIGNS[key];
          const selected = choice === key;
          const fit = styleFitLabel(format, key);
          return (
            <Pressable
              key={key}
              accessibilityLabel={`${design.label}: ${design.description}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: readOnly }}
              disabled={readOnly}
              onPress={() => setChoice(key)}
              style={[styles.tile, selected ? styles.selected : null]}
              testID={`plan-design-${key}`}
            >
              <View style={styles.titleRow}>
                <CardTitle>{design.label}</CardTitle>
                {selected ? <Chip label="Selected" tone="ok" /> : null}
              </View>
              <Text style={styles.description}>{design.description}</Text>
              {fit ? (
                <View style={styles.fitRow} testID={`plan-design-fit-${key}`}>
                  <Chip label={fit.label} tone={fit.fit === "avoid" ? "warn" : fit.fit === "pick" ? "accent" : "neutral"} />
                  <Text style={styles.description}>{fit.reason}</Text>
                </View>
              ) : null}
              {selected && !wide ? (
                <View style={styles.previewRow}>
                  <WButton
                    label={`Preview ${design.label}`}
                    icon="eye"
                    size="sm"
                    variant="secondary"
                    onPress={() => setSheetOpen(true)}
                    testID="plan-design-preview-open"
                  />
                </View>
              ) : null}
              <View style={styles.swatches}>
                {designSwatches(design).slice(0, 5).map((swatch) => (
                  <View
                    key={`${swatch.role}:${swatch.step ?? "single"}`}
                    style={[styles.swatch, { backgroundColor: swatchHex(resolveTokens(design.tokens, {}), swatch) }]}
                    accessibilityLabel={swatch.label}
                  />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      {choiceFit?.warning ? (
        <Card tone="warn" testID="plan-design-avoid-warning">
          <Hint>{choiceFit.warning}</Hint>
        </Card>
      ) : null}
      <Card>
        <CardTitle>This choice does not create a website</CardTitle>
        <Hint>
          It saves only to the shared setup plan. Ari and every teammate will
          see the same choice. You can change it before approval.
        </Hint>
      </Card>
      <View style={styles.actions}>
        {/* Skip is not offered: a design is required before a draft. This is
            the server's own default (WEBSITE_DEFAULT_DESIGN), and it can change. */}
        <WButton
          label="Use Mingla's default design"
          variant="secondary"
          disabled={readOnly || save.isPending}
          onPress={() => persist("atelier", "mingla")}
          testID="plan-design-default"
        />
        <WButton
          label="Save design"
          variant="primary"
          disabled={!choice || choice === stored || readOnly}
          loading={save.isPending}
          onPress={onSave}
          testID="plan-design-save"
        />
      </View>
      </View>
      {wide ? (
        <View style={styles.previewColumn}>
          <PlanStylePreview brandId={brandId} brandName={ctx.brandName} planState={planState} style={choice} wide />
        </View>
      ) : null}
      </View>
      {wide ? null : (
        <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} snapPoint={0.9} testID="plan-design-preview-sheet">
          <ScrollView contentContainerStyle={styles.sheet}>
            <PlanStylePreview
              brandId={brandId}
              brandName={ctx.brandName}
              planState={planState}
              style={choice}
              wide={false}
              // The sheet is 90% of the screen: leave room for the title row, the buttons and breathing room.
              frameMaxHeight={Math.max(280, Math.round(height * 0.9) - 230)}
            />
            <View style={styles.actions}>
              <WButton label="Close" variant="secondary" onPress={() => setSheetOpen(false)} testID="plan-design-preview-close" />
              {readOnly || !choice || choice === stored ? null : (
                <WButton
                  label={`Save ${DESIGNS[choice].label}`}
                  variant="primary"
                  loading={save.isPending}
                  onPress={() => { setSheetOpen(false); onSave(); }}
                  testID="plan-design-preview-save"
                />
              )}
            </View>
          </ScrollView>
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", gap: 14, flexWrap: "wrap", marginBottom: 16 },
  split: { flexDirection: "row", alignItems: "flex-start", gap: 24 },
  pickerColumn: { flex: 1, minWidth: 0 },
  // Web only (the side panel is web only): the preview stays in view while the styles scroll.
  previewColumn: { flexGrow: 0, flexShrink: 0, flexBasis: "46%", minWidth: 420, ...(Platform.OS === "web" ? ({ position: "sticky", top: 16 } as unknown as object) : null) },
  previewRow: { flexDirection: "row", marginTop: 12 },
  sheet: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 72, gap: 16 },
  tile: {
    flexGrow: 1,
    flexBasis: 260,
    minHeight: 170,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    backgroundColor: ui.card,
    padding: 18,
  },
  selected: { borderColor: ui.accent, borderWidth: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  description: { color: ui.t2, fontSize: 14, lineHeight: 20, marginTop: 8 },
  swatches: { flexDirection: "row", gap: 8, marginTop: 20 },
  fitRow: { gap: 6, marginTop: 10, alignItems: "flex-start" },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: ui.cardBorder },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", marginTop: 16 },
});
