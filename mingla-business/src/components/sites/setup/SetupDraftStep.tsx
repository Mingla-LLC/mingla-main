import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SetupDraftState } from "../../../sites/setupStatus";
import { Chip, Skeleton, WButton, ui } from "../website/ui";
import { BuildPart } from "../plan/BuildPart";
import { NOT_APPLICABLE_KEYS } from "../../../sites/setupFields";
import type { PlanPartKey } from "../../../../../packages/site-contracts/src/sitePlan.ts";

/** Design states 7, 8, 9 and the idle card. State 10 is drawn by the screen. */
/** "a, b and c" — the way Ari lists what is still needed. */
function listWords(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

export function SetupDraftStep({ brandId, brandName, state, canManage, refusal, blockers = [], nextStep, onStart, onRetry, onTellMingla, onDone, onNotApplicable }: {
  brandId: string;
  brandName: string;
  state: SetupDraftState;
  canManage: boolean;
  /** Core refused and said why, so it is not "on our side". */
  refusal?: string | null;
  /**
   * What still stands before Build, from the same rule Ari reads
   * (`planBuildBlockers`). Shown before any press; Build stays off until empty.
   */
  blockers?: readonly { key: string; label: string; requirement?: "required" | "recommended" }[];
  /** #4572 item 4 (D1) — "Doesn't apply to my brand" for a recommended row (absent: read-only, no button). */
  onNotApplicable?: (fieldKey: string) => Promise<void>;
  /** The first step still open, for "what's missing". */
  nextStep?: PlanPartKey | null;
  onStart: () => void;
  onRetry: () => void;
  onTellMingla: () => void;
  onDone: (next: PlanPartKey) => void;
}): React.ReactElement | null {
  const [marking, setMarking] = useState<ReadonlyMap<string, "saving" | "error">>(() => new Map());
  const markNotApplicable = (key: string) => {
    if (!onNotApplicable) return;
    setMarking((current) => new Map(current).set(key, "saving"));
    onNotApplicable(key).then(
      () => setMarking((current) => { const next = new Map(current); next.delete(key); return next; }),
      () => setMarking((current) => new Map(current).set(key, "error")),
    );
  };
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
  if (blockers.length > 0 && (state.kind === "not_ready" || state.kind === "can_start")) {
    return (
      <View style={styles.host} testID="setup-draft-blocked">
        <Text style={styles.title}>Your draft can&apos;t be built yet.</Text>
        <Text style={styles.body} testID="setup-draft-still-needed">Still needed. Nothing has been created.</Text>
        {/* #4572 item 4 (D1) — one row per item; a recommended one the owner can mark "Doesn't apply". */}
        <View style={styles.rows} accessibilityRole="list" accessibilityLabel={`Still needed: ${listWords(blockers.map((item) => lowerFirst(item.label)))}`}>
          {blockers.map((item) => {
            const optional = item.requirement === "recommended" && NOT_APPLICABLE_KEYS.has(item.key) && Boolean(onNotApplicable) && canManage;
            const status = marking.get(item.key);
            return (
              <View key={item.key} style={styles.blockerRow} testID={`setup-draft-row-${item.key}`}>
                <View style={styles.grow}>
                  <Text style={styles.rowTitle}>{item.label}</Text>
                  <Text style={styles.rowMeta}>
                    {item.requirement === "recommended" ? "Recommended" : "Required"}
                    {status === "error" ? <Text style={styles.rowError} testID={`setup-draft-row-${item.key}-error`}>{" · That didn't save"}</Text> : null}
                  </Text>
                </View>
                {optional ? (
                  <WButton
                    label={status === "saving" ? "Saving…" : status === "error" ? "Try again" : "Doesn't apply to my brand"}
                    variant="ghost"
                    size="sm"
                    loading={status === "saving"}
                    disabled={status === "saving"}
                    onPress={() => markNotApplicable(item.key)}
                    accessibilityLabel={`${item.label} doesn't apply to my brand`}
                    testID={`setup-draft-na-${item.key}`}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
        {nextStep ? (
          <View style={styles.row}>
            <WButton label="Go to what's missing" variant="primary" onPress={() => onDone(nextStep)} testID="setup-draft-missing" />
          </View>
        ) : null}
      </View>
    );
  }
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
  // #4572 item 4 — the "Still needed" rows.
  rows: { gap: 8 },
  blockerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: ui.cardBorder, backgroundColor: ui.card },
  rowTitle: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: ui.t1 },
  rowMeta: { fontSize: 12, lineHeight: 16, color: ui.t3 },
  rowError: { color: ui.err },
});
