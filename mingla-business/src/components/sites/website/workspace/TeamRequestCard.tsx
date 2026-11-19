import React, { useEffect, useRef, useState } from "react";
import { useUnsavedChangesGuard } from "../../../../hooks/useUnsavedChangesGuard";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { radius, space } from "../../../../constants/designSystem";
import { Field, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { TEAM_REQUEST_MAX, TEAM_REQUEST_SENT, teamRequestBlocked, type TeamRequestDraft } from "../../../../sites/ariWorkspace";
import { parts } from "./parts";

/*
 * #4453 — "Request for the Mingla team": the request as it will be sent,
 * editable before sending. Sending reports the truth: sent, or not sent with
 * the reason and the words still in the box.
 */
export const TEAM_REQUEST_INTRO = {
  ari: "Ari wrote this so the team gets it right. Change anything, then send.",
  owner: "Say what you’d like in your own words. The team sees where you are on your website.",
} as const;

export function TeamRequestCard({ draft, onSend, onCancel, disabledReason, byAri = false }: {
  draft: TeamRequestDraft;
  /** Ari wrote the request (it proposed it, or filled it in from what it could not do). */
  byAri?: boolean;
  /** Resolves with null when sent, or the plain reason it was not. */
  onSend: (what: string) => Promise<string | null>;
  onCancel: () => void;
  disabledReason?: string | null;
}): React.ReactElement {
  const [what, setWhat] = useState(draft.what);
  // #4453 — a request the owner wrote or changed, not yet sent, holds a brand switch.
  useUnsavedChangesGuard({
    dirty: what.trim() !== draft.what.trim(),
    onRequestLeave: () => undefined,
    hardwareBack: false,
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  useEffect(() => {
    setWhat(draft.what);
    setError(null);
    if (Platform.OS !== "web") return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [draft]);
  const blocked = disabledReason ?? teamRequestBlocked(what, sending);
  const send = async () => {
    if (blocked) {
      setError(blocked);
      return;
    }
    setSending(true);
    setError(null);
    const refused = await onSend(what.trim()).catch(() => "The request wasn’t sent. Check your connection and try again.");
    setSending(false);
    if (refused) setError(refused);
  };
  return (
    <View style={[parts.box, styles.card]} testID="team-request-card" role="group" accessibilityLabel="Request for the Mingla team">
      <Text style={parts.title} role="heading" aria-level={2}>Request for the Mingla team</Text>
      <Text style={parts.body} testID="team-request-intro">{byAri || draft.what.trim() ? TEAM_REQUEST_INTRO.ari : TEAM_REQUEST_INTRO.owner}</Text>
      <Field
        ref={inputRef}
        label="What you want"
        value={what}
        onChangeText={(value) => { setWhat(value); if (error) setError(null); }}
        multiline
        max={TEAM_REQUEST_MAX}
        error={error}
        placeholder="Describe the change you’d like"
        editable={!sending}
        testID="team-request-what"
      />
      <View style={styles.facts}>
        <Text style={parts.small}><Text style={styles.factKey}>Where: </Text>{draft.whereLine}</Text>
        <Text style={parts.small}><Text style={styles.factKey}>Why: </Text>{draft.why}</Text>
        <Text style={parts.small}><Text style={styles.factKey}>Attached: </Text>your draft as it is now</Text>
      </View>
      <View style={styles.actions}>
        <WButton label="Not now" variant="ghost" onPress={onCancel} disabled={sending} testID="team-request-cancel" />
        <WButton label="Send to the Mingla team" variant="primary" onPress={() => { void send(); }} loading={sending} grow testID="team-request-send" />
      </View>
    </View>
  );
}

export function TeamRequestSent({ onDone }: { onDone: () => void }): React.ReactElement {
  return (
    <View style={[parts.box, styles.sent]} role="status" accessibilityLiveRegion="polite" testID="team-request-sent">
      <View style={parts.row}>
        <WebsiteIcon name="check" size={16} color={ui.ok} />
        <Text style={[parts.title, parts.grow]}>{TEAM_REQUEST_SENT.title}</Text>
      </View>
      <Text style={parts.body}>{TEAM_REQUEST_SENT.body}</Text>
      <WButton label="See your requests" size="sm" onPress={onDone} style={styles.sentButton} testID="team-request-open-list" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  facts: { gap: 4, padding: space[3], borderRadius: radius.xs, backgroundColor: ui.card2 },
  factKey: { fontWeight: "600", color: ui.t2 },
  actions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  sent: { gap: space[2] },
  sentButton: { alignSelf: "flex-start" },
});
