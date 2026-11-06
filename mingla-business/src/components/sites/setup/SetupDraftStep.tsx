import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SetupDraftState } from "../../../sites/setupStatus";
import { Chip, Skeleton, WButton, ui } from "../website/ui";
import { BuildPart } from "../plan/BuildPart";
import type { PlanPartKey } from "../../../../../packages/site-contracts/src/sitePlan.ts";

/** Design states 7, 8, 9 and the idle card. State 10 is drawn by the screen. */
export function SetupDraftStep({ brandId, brandName, state, canManage, refusal, nextStep, onStart, onRetry, onTellMingla, onDone }: {
  brandId: string;
  brandName: string;
  state: SetupDraftState;
  canManage: boolean;
  /** Core refused and said why, so it is not "on our side". */
  refusal?: string | null;
  /** The first step still open, for "what's missing". */
  nextStep?: PlanPartKey | null;
  onStart: () => void;
  onRetry: () => void;
  onTellMingla: () => void;
  onDone: (next: PlanPartKey) => void;
}): React.ReactElement | null {
  const refused = refusal ? (
    <View style={styles.host} testID="setup-draft-refused">
      <Text style={styles.title} accessibilityRole="alert">Your draft can&apos;t be built yet.</Text>
      <Text style={styles.body}>{refusal}</Text>
      {nextStep ? (
        <View style={styles.row}>
          <WButton label="Go to what's missing" variant="primary" onPress={() => onDone(nextStep)} testID="setup-draft-missing" />
        </View>
      ) : null}
    </View>
  ) : null;
  if (refused && state.kind !== "ready" && state.kind !== "building" && state.kind !== "checking") return refused;
  switch (state.kind) {
    case "not_ready":
    case "can_start":
      return <BuildPart brandId={brandId} readOnly={!canManage} onBuild={onStart} onDone={onDone} />;
    case "building":
      return (
        <View style={styles.host} role="status" accessibilityLiveRegion="polite" testID="setup-draft-building">
          <View style={styles.chip}><Chip label="Building your draft" tone="accent" /></View>
          <Text style={styles.title}>{`Building ${brandName}'s website.`}</Text>
          <Text style={styles.body}>This usually takes under a minute. You can leave this screen, and it will be here when you come back.</Text>
          <Skeleton height={26} width="60%" />
          <Skeleton height={120} />
          <View style={styles.row}>
            <View style={styles.grow}><Skeleton height={60} /></View>
            <View style={styles.grow}><Skeleton height={60} /></View>
          </View>
        </View>
      );
    case "checking":
      return (
        <View style={styles.host} role="status" accessibilityLiveRegion="polite" testID="setup-draft-checking">
          <View style={styles.chip}><Chip label="Checking" /></View>
          <Text style={styles.title}>Checking whether your draft was created.</Text>
          <Text style={styles.body}>The connection dropped before we got an answer. We&apos;re checking now, so there&apos;s no need to start again.</Text>
          <Skeleton height={8} />
        </View>
      );
    case "failed":
      return (
        <View style={styles.host} testID="setup-draft-failed">
          <View style={styles.chip}><Chip label="Didn't work" tone="err" /></View>
          <Text style={styles.title} accessibilityRole="alert">We couldn&apos;t create your draft.</Text>
          <Text style={styles.body}>This was on our side, not your answers, and everything you entered is saved. Try again now, and it won&apos;t create a second website.</Text>
          <View style={styles.row}>
            {canManage ? <WButton label="Try again" variant="primary" onPress={onRetry} testID="setup-draft-retry" /> : null}
            <WButton label="Tell Mingla" onPress={onTellMingla} testID="setup-draft-tell" />
          </View>
        </View>
      );
    case "ready":
      return null;
  }
}

const styles = StyleSheet.create({
  host: { gap: 12 },
  chip: { alignSelf: "flex-start" },
  title: { fontSize: 19, lineHeight: 24, fontWeight: "600", color: ui.t1 },
  body: { fontSize: 15, lineHeight: 22, color: ui.t2 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  grow: { flex: 1, minWidth: 100 },
});
