import React, { Suspense, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { DESIGNS, type DesignKey } from "../../../../../packages/site-contracts/src/designs.ts";
import { defaultPreviewPreference } from "../../../sites/previewDevice";
import { useStylePreview } from "../../../sites/planPreviewApi";
import { stylePreviewBlocker } from "../../../sites/styleLibrary";
import type { SitePlanState } from "../../../sites/sitePlanState";
import { BrandSitesError } from "../../../services/brandSitesService";
import { Card, CardTitle, Hint, Skeleton, WButton, ui } from "../website/ui";
import type { ScaledPreviewFrameProps } from "../website/preview/ScaledPreviewFrame";

// The native frame imports `react-native-webview` at module scope, so it is
// resolved at first render (the PlanPreviewChooser pattern): Website setup
// must not pull the WebView into every suite or the boot path.
const LazyScaledPreviewFrame = React.lazy(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../website/preview/ScaledPreviewFrame") as typeof import("../website/preview/ScaledPreviewFrame");
  return { default: mod.ScaledPreviewFrame };
});

function Frame(props: ScaledPreviewFrameProps): React.ReactElement {
  return (
    <Suspense fallback={<Skeleton height={Math.min(props.maxHeight ?? 560, 360)} />}>
      <LazyScaledPreviewFrame {...props} />
    </Suspense>
  );
}

/**
 * #4453 — a live preview of the style picked in "Choose your design": a real
 * render of the brand's own plan and Mingla listings (Core's plan-previews
 * route with `styles: [style]`; nothing is written). Desktop shows it beside
 * the picker; phone opens it in a sheet.
 */
export function PlanStylePreview({
  brandId,
  brandName,
  planState,
  style,
  wide,
  frameMaxHeight,
  queue = [],
}: {
  brandId: string;
  brandName: string;
  planState: SitePlanState;
  style: DesignKey | null;
  wide: boolean;
  /** The tallest the frame may draw (the phone sheet sizes it to the screen). */
  frameMaxHeight?: number;
  /** The previewable styles in the picker's order: neighbours share a request. */
  queue?: readonly DesignKey[];
}): React.ReactElement {
  const blocker = stylePreviewBlocker(planState, style);
  const revision = planState.plan?.revision ?? null;
  const previews = useStylePreview(brandId, revision, style, blocker === null, queue);
  const [reload, setReload] = useState(0);
  const card = previews.data?.cards.find((entry) => entry.style === style) ?? previews.data?.cards[0] ?? null;
  const label = style ? DESIGNS[style].label : "";

  return (
    <View style={styles.root} testID="plan-style-preview">
      <View style={styles.head}>
        <CardTitle>{style ? `Preview: ${label}` : "Preview"}</CardTitle>
        {card ? (
          <WButton label="Reload" size="sm" variant="secondary" onPress={() => setReload((value) => value + 1)} testID="plan-style-preview-reload" />
        ) : null}
      </View>
      {blocker ? (
        <Card testID="plan-style-preview-blocked">
          <Hint>{blocker}</Hint>
        </Card>
      ) : previews.isError ? (
        <Card testID="plan-style-preview-error">
          <Hint>{previews.error instanceof BrandSitesError ? previews.error.message : "Couldn't load this preview. Try again."}</Hint>
          <View style={styles.row}>
            <WButton label="Try again" size="sm" onPress={() => previews.refetch()} testID="plan-style-preview-retry" />
          </View>
        </Card>
      ) : !card ? (
        <View role="status" accessibilityLabel={`Laying out ${brandName} in ${label}`}>
          <Skeleton height={Math.min(frameMaxHeight ?? 520, wide ? 460 : 520)} />
          <Hint style={styles.loading}>Laying out {brandName} in {label}…</Hint>
        </View>
      ) : (
        <View style={styles.frame}>
          <Frame
            key={`${card.url}#${reload}`}
            url={card.url}
            preference={defaultPreviewPreference(wide && Platform.OS === "web")}
            maxHeight={frameMaxHeight ?? (wide ? 640 : 560)}
          />
        </View>
      )}
      {previews.data?.hasSamples ? <Hint>Your name and details, with sample listings where you have none yet.</Hint> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  row: { flexDirection: "row", gap: 8, marginTop: 10 },
  frame: { minHeight: 280, minWidth: 0, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: ui.cardBorder },
  loading: { marginTop: 8 },
});
