import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, space, type } from "../../constants/designSystem";
import { Spinner } from "../ui/Spinner";
import type { EditPublishedScreenProps } from "./EditPublishedScreen";

export type { EditPublishedScreenProps } from "./EditPublishedScreen";

let editPublishedModule: Promise<typeof import("./EditPublishedScreen")> | null =
  null;

/**
 * #4420 — starts the published-event editor's chunk. The edit routes call it
 * as soon as `?mode=edit-published` is known, so the chunk loads while the
 * live event is still being read and the editor does not wait on it after.
 */
export function loadEditPublishedScreen(): Promise<
  typeof import("./EditPublishedScreen")
> {
  editPublishedModule ??= import("./EditPublishedScreen").catch((error) => {
    editPublishedModule = null;
    throw error;
  });
  return editPublishedModule;
}

const DeferredEditPublishedScreen = React.lazy(async () => {
  const module = await loadEditPublishedScreen();
  return { default: module.EditPublishedScreen };
});

/** The same loading shell the edit routes show while the live event resolves. */
function EditPublishedLoadingShell(): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: color.canvas },
      ]}
    >
      <View style={styles.center}>
        <Spinner size={36} />
        <Text style={styles.label}>Loading…</Text>
      </View>
    </View>
  );
}

/**
 * The published-event editor is only ever opened on intent
 * (`?mode=edit-published`) by the event and RSVP edit routes. Keeping it behind
 * one dynamic boundary stops Metro hoisting it (two route chunks reach it) into
 * the eager `__common` chunk every visitor downloads at boot.
 */
export const EditPublishedScreen: React.FC<EditPublishedScreenProps> = (
  props,
) => (
  <React.Suspense fallback={<EditPublishedLoadingShell />}>
    <DeferredEditPublishedScreen {...props} />
  </React.Suspense>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
  },
  label: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
});
