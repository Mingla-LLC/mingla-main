import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  DESIGN_KEYS,
  DESIGNS,
  designSwatches,
  type DesignKey,
} from "../../../../../packages/site-contracts/src/designs.ts";
import { resolveTokens } from "../../../../../packages/site-contracts/src/tokens.ts";
import { useSaveBrandSitePlanDesign } from "../../../sites/planApi";
import { swatchHex } from "../../../sites/siteLook";
import type { SitePlanState } from "../../../sites/sitePlanState";
import { BrandSitesError } from "../../../services/brandSitesService";
import { useWebsite } from "../website/WebsiteContext";
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
}: {
  brandId: string;
  planState: SitePlanState;
}): React.ReactElement {
  const ctx = useWebsite();
  const save = useSaveBrandSitePlanDesign(brandId);
  const stored = planState.plan?.designKey;
  const [choice, setChoice] = useState<DesignKey | null>(
    stored === "atelier" || stored === "voyage" ? stored : null,
  );
  const readOnly = ctx.lock.heldByOther || planState.site?.paused === true;

  const onSave = () => {
    if (!choice || !planState.plan) return;
    save.mutate(
      { revision: planState.plan.revision, designKey: choice },
      {
        onSuccess: () => {
          ctx.toast("Design saved to your setup plan. No draft was created.", "success");
          ctx.go({ kind: "section", section: "plan" });
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

  return (
    <View testID="plan-design-part">
      <SectionHead
        ref={ctx.headingRef}
        phone={ctx.phone}
        title="Choose your design"
        subtitle="Pick the starting system now. Detailed colours, fonts and preview come after Build your pages creates the first draft."
        right={<Chip label="No draft yet" tone="accent" />}
      />
      <View style={styles.grid} accessibilityRole="radiogroup">
        {DESIGN_KEYS.map((key) => {
          const design = DESIGNS[key];
          const selected = choice === key;
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
      <Card>
        <CardTitle>This choice does not create a website</CardTitle>
        <Hint>
          It saves only to the shared setup plan. Ari and every teammate will
          see the same choice. You can change it before approval.
        </Hint>
      </Card>
      <View style={styles.actions}>
        <WButton
          label="Back to setup plan"
          variant="secondary"
          onPress={() => ctx.go({ kind: "section", section: "plan" })}
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
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", gap: 14, flexWrap: "wrap", marginBottom: 16 },
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
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: ui.cardBorder },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", marginTop: 16 },
});
