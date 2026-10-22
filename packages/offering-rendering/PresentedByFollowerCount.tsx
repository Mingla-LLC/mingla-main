import { StyleSheet, View } from "react-native";

import type { FollowerCountLabels } from "./FollowerCountLine";
import { LazyFollowerCountLine } from "./LazyFollowerCountLine";
import type { ThemePalette } from "./themePalette";

export type { FollowerCountLabels };

export type PresentedByFollowerCountProps = {
  count?: number | null;
  loading?: boolean;
  labels?: FollowerCountLabels;
  palette: ThemePalette;
  testID: string;
};

/** One shared secondary-count row for every Presented-by identity card. */
export function PresentedByFollowerCount(
  props: PresentedByFollowerCountProps,
) {
  const { count, loading = false, labels, palette, testID } = props;
  if (!loading && count == null) return null;
  return (
    <View style={styles.wrap}>
      <LazyFollowerCountLine
        count={count}
        loading={loading}
        labels={labels}
        palette={palette}
        testID={testID}
        variant="presentedBy"
      />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { marginTop: 1 } });
