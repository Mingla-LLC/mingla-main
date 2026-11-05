import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { partLabel } from "../../../sites/sitePlanState";
import { nameInSentence, type SetupPresence } from "../../../sites/setupStatus";
import { Card, Chip, WButton, ui } from "../website/ui";
import { PLAN_PARTS, type PlanPartKey } from "../../../../../packages/site-contracts/src/sitePlan.ts";

function stepWords(stepKey: string | null): string {
  const known = PLAN_PARTS.some((part) => part.key === stepKey);
  return known ? partLabel(stepKey as PlanPartKey) : "Website setup";
}

function dayWords(iso: string | null): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(when);
}

/** Design states 4 and 5, the displaced notice, and the paused edge state. */
export function SetupPresenceCard({ presence, watching, busy, problem, onContinue, onWatch, onTakeOver, onAskAdmin, asking }: {
  presence: Exclude<SetupPresence, { kind: "free" }>;
  watching: boolean;
  busy: boolean;
  problem: string | null;
  onContinue: () => void;
  onWatch: () => void;
  onTakeOver: () => void;
  onAskAdmin: () => void;
  asking: boolean;
}): React.ReactElement {
  const problemLine = problem ? <Text style={styles.problem} accessibilityRole="alert" testID="setup-presence-problem">{problem}</Text> : null;
  switch (presence.kind) {
    case "paused":
      return (
        <Card testID="setup-paused">
          <Text style={styles.title}>Mingla has paused your website, so setup is paused too.</Text>
          <Text style={styles.body}>You can read everything here. We&apos;ll tell you when it can resume.</Text>
        </Card>
      );
    case "displaced":
      return (
        <Card testID="setup-displaced">
          <Text style={styles.title}>{`${presence.name} took over Website setup, so that didn't save. Everything you answered before is still there.`}</Text>
        </Card>
      );
    case "stopped": {
      const day = dayWords(presence.since);
      return (
        <Card testID="setup-stopped">
          <View style={styles.gap}>
            <View style={styles.chip}><Chip label="Started by a teammate" /></View>
            <Text style={styles.title}>{`${presence.name} started this${day ? ` on ${day}` : ""} and stopped at ${stepWords(presence.stepKey)}.`}</Text>
            <Text style={styles.body}>Everything they answered is saved. Continue from there, and your team can see that you took over.</Text>
            {problemLine}
            {presence.canContinue ? (
              <View style={styles.row}><WButton label="Continue setup" variant="primary" onPress={onContinue} loading={busy} testID="setup-continue" /></View>
            ) : (
              <View style={styles.row}><WButton label="Ask an admin" icon="msg" onPress={onAskAdmin} loading={asking} testID="setup-ask-admin" /></View>
            )}
          </View>
        </Card>
      );
    }
    case "active":
      return (
        <Card testID="setup-active">
          <View style={styles.gap}>
            <View style={styles.chip}><Chip label="Active now" tone="ok" /></View>
            <Text style={styles.title}>{`${presence.name} is on ${stepWords(presence.stepKey)} right now.`}</Text>
            <Text style={styles.body}>
              {presence.canTakeOver
                ? `You can watch progress here. If you take over, ${nameInSentence(presence.name)}'s next answer won't save, and we'll tell ${nameInSentence(presence.name)} why.`
                : "You can watch progress here. A brand admin can take this over if it needs to move on."}
            </Text>
            {problemLine}
            <View style={styles.row}>
              {watching ? null : <WButton label="Watch" onPress={onWatch} testID="setup-watch" />}
              {presence.canTakeOver
                ? <WButton label="Take over" variant="ghost" onPress={onTakeOver} loading={busy} testID="setup-take-over" />
                : <WButton label="Ask an admin" icon="msg" onPress={onAskAdmin} loading={asking} testID="setup-ask-admin" />}
            </View>
          </View>
        </Card>
      );
  }
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  chip: { alignSelf: "flex-start" },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "600", color: ui.t1 },
  body: { fontSize: 15, lineHeight: 22, color: ui.t2 },
  problem: { fontSize: 13, color: ui.err },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
