/**
 * #4271 — a sheet whose code loads on intent. Nothing mounts until the sheet is
 * first opened; from then on it stays mounted so closing animates and reopening
 * keeps the sheet's own reset-on-open behaviour. While the chunk loads, an empty
 * sheet with a spinner opens in its place (ShareModal precedent).
 *
 * Use it for host-only sheets that would otherwise be hoisted into the eager web
 * __common chunk because more than one route renders them.
 */
import React, { Suspense, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { spacing } from "../../constants/designSystem";
import { Sheet } from "./Sheet";

export interface OnIntentSheetProps {
  visible: boolean;
  onClose: () => void;
}

export interface OnIntentLazySheetOptions {
  /** Spoken while the sheet's code loads. */
  loadingLabel: string;
  /** Fetch the chunk when the host screen mounts, so the first open is prompt. */
  preload?: boolean;
}

export function createOnIntentLazySheet<Props extends OnIntentSheetProps>(
  load: () => Promise<React.ComponentType<Props>>,
  options: OnIntentLazySheetOptions,
): React.FC<Props> {
  const LazySheet = React.lazy(async () => ({ default: await load() }));
  const OnIntentSheet: React.FC<Props> = (props) => {
    const [opened, setOpened] = useState<boolean>(props.visible);
    useEffect(() => {
      if (props.visible) setOpened(true);
    }, [props.visible]);
    useEffect(() => {
      if (options.preload !== true) return;
      load().catch((error: unknown) => {
        // Only a warm-up: opening the sheet loads it again and fails loudly there.
        if (__DEV__) console.warn(`[sheet] preload failed: ${options.loadingLabel}`, error);
      });
    }, []);
    if (!opened && !props.visible) return null;
    return (
      <Suspense
        fallback={
          <Sheet visible={props.visible} onClose={props.onClose} snapPoint={0.32}>
            <View style={styles.loading}>
              <ActivityIndicator accessibilityLabel={options.loadingLabel} />
            </View>
          </Sheet>
        }
      >
        <LazySheet {...props} />
      </Suspense>
    );
  };
  return OnIntentSheet;
}

const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", padding: spacing.md },
});
