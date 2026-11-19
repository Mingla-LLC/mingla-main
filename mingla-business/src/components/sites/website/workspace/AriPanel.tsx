import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, space } from "../../../../constants/designSystem";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Spinner, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import {
  ARI_INTRO,
  ARI_SUGGESTIONS,
  adjustedColoursLine,
  couldntLine,
  doneLine,
  failedLine,
  planIntro,
  STEP_STATUS_WORDS,
  stepStatuses,
  type StepStatus,
} from "../../../../sites/ariWorkspace";
import type { AriRun, AriTurn } from "./useAriRun";
import { IconButton, parts, SuggestionChip } from "./parts";
import { TeamRequestCard, TeamRequestSent } from "./TeamRequestCard";

/*
 * #4453 — Ari mode. The owner's request, Ari's plan with each step's live
 * status, one question at a time with answers to tap, then the result: what
 * changed, what the checks found, what Ari could not do, and the three ways
 * on (Undo this, Looks good, Ask the Mingla team).
 */
export function AriPanel({ run, disabledReason, draftText, onDraftText, onUndoRun, onKeepRun, onAskTeam, onSendTeam, teamSent, onOpenRequests, onOpenFullAri }: {
  run: AriRun;
  disabledReason: string | null;
  /** Words another control put in the box ("Rename the menu item…"). */
  draftText: string;
  onDraftText: (text: string) => void;
  onUndoRun: (turn: AriTurn) => Promise<boolean>;
  onKeepRun: (turn: AriTurn) => void;
  onAskTeam: (turn: AriTurn) => void;
  onSendTeam: (what: string) => Promise<string | null>;
  teamSent: boolean;
  onOpenRequests: () => void;
  onOpenFullAri: () => void;
}): React.ReactElement {
  const [note, setNote] = useState<string | null>(null);
  const scrollRef = useRef<{ scrollToEnd?: (options?: { animated?: boolean }) => void } | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const last = run.turns[run.turns.length - 1];
  const tail = `${run.turns.length}:${last?.phase ?? ""}:${last?.events.length ?? 0}:${run.teamDraft ? "t" : ""}:${teamSent ? "s" : ""}`;
  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: false }), 40);
    return () => clearTimeout(timer);
  }, [tail]);
  useEffect(() => {
    if (draftText) inputRef.current?.focus();
  }, [draftText]);

  const submit = (text: string) => {
    const refused = disabledReason ?? run.ask(text);
    setNote(refused);
    if (!refused) onDraftText("");
  };
  const idle = run.turns.length === 0 && !run.teamDraft && !teamSent;
  return (
    <View style={styles.panel} testID="ari-panel">
      <ScrollView ref={scrollRef as never} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {idle ? (
          <View style={styles.intro} testID="ari-intro">
            <Text style={styles.introTitle} role="heading" aria-level={2}>{ARI_INTRO.title}</Text>
            <Text style={parts.body}>{ARI_INTRO.body}</Text>
            <Text style={styles.tryLabel}>Try</Text>
            {ARI_SUGGESTIONS.map((suggestion, index) => (
              <SuggestionChip key={suggestion} label={suggestion} onPress={() => submit(suggestion)} testID={`ari-suggestion-${index}`} />
            ))}
          </View>
        ) : null}
        {run.turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            run={run}
            disabledReason={disabledReason}
            onUndoRun={onUndoRun}
            onKeepRun={onKeepRun}
            onAskTeam={onAskTeam}
            onOpenFullAri={onOpenFullAri}
            onNote={setNote}
          />
        ))}
        {run.teamDraft ? (
          <TeamRequestCard
            draft={run.teamDraft.draft}
            disabledReason={disabledReason}
            onSend={onSendTeam}
            onCancel={run.teamDraft.pendingActionId ? run.dropTeamDraft : run.closeTeamDraft}
          />
        ) : null}
        {teamSent ? <TeamRequestSent onDone={onOpenRequests} /> : null}
      </ScrollView>
      <View style={styles.composer}>
        {note ? <Text style={styles.note} role="alert" testID="ari-note">{note}</Text> : null}
        <View style={styles.composerRow}>
          <TextInput
            ref={inputRef}
            value={draftText}
            onChangeText={(value) => { onDraftText(value); if (note) setNote(null); }}
            placeholder="Ask Ari to change anything on your site…"
            placeholderTextColor={ui.t4}
            accessibilityLabel="Message Ari"
            multiline
            maxLength={2000}
            editable={!disabledReason}
            testID="ari-input"
            style={styles.input}
          />
          <IconButton
            icon="send"
            label="Send to Ari"
            onPress={() => submit(draftText)}
            disabledReason={disabledReason ?? (run.working ? "Ari is still working on your last request." : !draftText.trim() ? "Say what you’d like changed." : null)}
            onDisabledPress={setNote}
            testID="ari-send"
          />
        </View>
      </View>
    </View>
  );
}

function TurnView({ turn, run, disabledReason, onUndoRun, onKeepRun, onAskTeam, onOpenFullAri, onNote }: {
  turn: AriTurn;
  run: AriRun;
  disabledReason: string | null;
  onUndoRun: (turn: AriTurn) => Promise<boolean>;
  onKeepRun: (turn: AriTurn) => void;
  onAskTeam: (turn: AriTurn) => void;
  onOpenFullAri: () => void;
  onNote: (note: string | null) => void;
}): React.ReactElement {
  const [undoing, setUndoing] = useState(false);
  const outcome = turn.phase === "done" ? "done" : turn.phase === "failed" ? "failed" : "running";
  const failedIndex = turn.result && !turn.result.ok ? turn.result.failedIndex : null;
  const statuses = turn.plan ? stepStatuses(turn.plan.steps.length, turn.events, outcome, failedIndex) : [];
  const couldnt = turn.result?.ok ? (turn.result.couldnt.length ? turn.result.couldnt : turn.plan?.couldnt ?? []) : turn.plan?.couldnt ?? [];
  return (
    <View style={styles.turn} testID={`ari-turn-${turn.phase}`}>
      <View style={styles.request}>
        {turn.focus ? <Text style={styles.about} testID="ari-about">{`About: ${turn.focus.section_label}`}</Text> : null}
        <Text style={styles.requestText}>{turn.request}</Text>
      </View>
      {turn.phase === "thinking" ? (
        <View style={[parts.box, parts.row]} role="status" accessibilityLiveRegion="polite" testID="ari-thinking">
          <Spinner label="Ari is reading your website" />
          <Text style={parts.body}>Reading your website and planning…</Text>
        </View>
      ) : null}
      {turn.plan ? (
        <View style={parts.box} testID="ari-plan">
          <View style={parts.row}>
            <WebsiteIcon name="spark" size={15} color={ui.t1} />
            <Text style={parts.title} role="heading" aria-level={3}>Ari’s plan</Text>
          </View>
          <Text style={parts.body} role="status" accessibilityLiveRegion="polite">{planIntro(outcome, turn.focus?.section_label ?? null)}</Text>
          {turn.plan.steps.map((step, index) => (
            <StepRow key={`${index}-${step.label}`} index={index} label={step.label} why={step.why} status={statuses[index] ?? "waiting"} />
          ))}
        </View>
      ) : null}
      {turn.phase === "asking" && (turn.question || turn.choices) ? (
        <View style={[parts.box, styles.question]} testID="ari-question" role="group" accessibilityLabel={turn.question?.prompt ?? turn.reply ?? turn.choices?.prompt}>
          {turn.question && turn.reply && turn.reply !== turn.question.prompt ? <Text style={parts.body}>{turn.reply}</Text> : null}
          <Text style={parts.title}>{turn.question?.prompt ?? (turn.reply || turn.choices?.prompt)}</Text>
          <Text style={parts.small}>I won’t guess facts about your venue.</Text>
          <View style={parts.wrap}>
            {(turn.question ? turn.question.options.map((label) => ({ id: label, label })) : turn.choices!.options).map((option, index) => (
              <SuggestionChip key={option.id} label={option.label} disabled={run.working} onPress={() => onNote(disabledReason ?? run.answer(turn.id, option.id))} testID={`ari-answer-${index}`} />
            ))}
          </View>
        </View>
      ) : null}
      {(turn.phase === "reply" || turn.phase === "other") && turn.reply ? (
        <View style={parts.box} testID="ari-reply">
          <Text style={parts.body}>{turn.reply}</Text>
          {turn.phase === "other" ? <WButton label="Open the full Ari chat" size="sm" icon="ext" onPress={onOpenFullAri} style={styles.start} testID="ari-open-full" /> : null}
        </View>
      ) : null}
      {turn.phase === "error" ? (
        <View style={[parts.box, styles.failed]} role="alert" testID="ari-error">
          <Text style={parts.body}>{turn.error}</Text>
          <WButton label="Try again" size="sm" onPress={() => run.retry(turn.id)} disabled={run.working} style={styles.start} testID="ari-retry" />
        </View>
      ) : null}
      {turn.phase === "failed" && turn.result && !turn.result.ok ? (
        <View style={[parts.box, styles.failed]} role="alert" testID="ari-failed">
          <Text style={parts.body}>{turn.settled === "undone" ? "Undone. Your draft is back to how it was." : failedLine(turn.result)}</Text>
          <View style={parts.wrap}>
            {turn.result.partly && turn.settled === null ? (
              <WButton label="Undo this" size="sm" variant="primary" loading={undoing} disabled={Boolean(disabledReason)} onPress={() => { setUndoing(true); void onUndoRun(turn).finally(() => setUndoing(false)); }} testID="ari-undo-partly" />
            ) : null}
            <WButton label="Try again" size="sm" onPress={() => run.retry(turn.id)} disabled={run.working} testID="ari-retry" />
            <WButton label="Ask the Mingla team to build it" size="sm" icon="team" onPress={() => onAskTeam(turn)} testID="ari-failed-team" />
          </View>
        </View>
      ) : null}
      {turn.phase === "done" && turn.result?.ok ? (
        <View style={[parts.box, styles.done]} testID="ari-result" role="status" accessibilityLiveRegion="polite">
          <Text style={parts.title}>{turn.settled === "undone" ? "Undone. Your draft is back to how it was." : turn.result.alreadyDone ? "That was already done. Your page is up to date." : doneLine(turn.result.applied, couldnt.length)}</Text>
          {turn.settled !== "undone" && turn.result.applied > 0 ? (
            <Text style={parts.small} testID="ari-checks">
              {turn.result.checksNote
                ?? (turn.result.warnings.length === 0
                  ? "Checked: claims backed by Mingla, text readable, links work, fits phones."
                  : `Checked. ${turn.result.warnings.length} to look at: ${turn.result.warnings.slice(0, 3).join(" · ")}`)}
            </Text>
          ) : null}
          {turn.settled !== "undone" && adjustedColoursLine(turn.result.adjustedColours) ? <Text style={parts.small} testID="ari-adjusted">{adjustedColoursLine(turn.result.adjustedColours)}</Text> : null}
          {couldnt.map((entry, index) => <Text key={`${index}-${entry.what}`} style={styles.couldnt} testID="ari-couldnt">{couldntLine(entry)}</Text>)}
          {couldnt.length > 0 && !run.teamDraft ? (
            <WButton label="Ask the Mingla team to build it" icon="team" size="sm" onPress={() => onAskTeam(turn)} style={styles.start} testID="ari-ask-team" />
          ) : null}
          {turn.settled === null && turn.result.applied > 0 ? (
            <View style={styles.actions}>
              <WButton
                label="Undo this"
                size="sm"
                loading={undoing}
                disabled={Boolean(disabledReason)}
                onPress={() => {
                  setUndoing(true);
                  void onUndoRun(turn).finally(() => setUndoing(false));
                }}
                grow
                testID="ari-undo-run"
              />
              <WButton label="Looks good" variant="primary" size="sm" onPress={() => onKeepRun(turn)} disabled={Boolean(disabledReason)} grow testID="ari-keep-run" />
            </View>
          ) : null}
          {turn.settled === "kept" ? <Text style={parts.small}>Marked as read. Publish when you’re ready.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function StepRow({ index, label, why, status }: { index: number; label: string; why: string; status: StepStatus }): React.ReactElement {
  const shown = status !== "waiting";
  return (
    <View style={styles.step} accessibilityLabel={`Step ${index + 1}: ${label}. ${STEP_STATUS_WORDS[status]}`} testID={`ari-step-${index}-${status}`}>
      <View style={[styles.dot, status === "done" ? styles.dotDone : status === "active" ? styles.dotActive : status === "failed" ? styles.dotFailed : null]}>
        {status === "done" ? <WebsiteIcon name="check" size={12} color={color.ink} />
          : status === "failed" ? <WebsiteIcon name="x" size={12} color={color.ink} />
            : status === "putback" ? <WebsiteIcon name="undo" size={12} color={ui.t2} />
              : <Text style={[styles.dotText, status === "active" ? styles.dotTextOn : null]}>{index + 1}</Text>}
      </View>
      <View style={parts.grow}>
        <Text style={[styles.stepText, shown ? styles.stepTextOn : null]}>{label}</Text>
        {shown && why ? <Text style={parts.small}>{why}</Text> : null}
        {status === "active" || status === "failed" || status === "putback" ? <Text style={styles.stepStatus}>{STEP_STATUS_WORDS[status]}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  content: { padding: space[4], gap: space[3] },
  intro: { gap: space[2] },
  introTitle: { fontSize: 20, lineHeight: 28, fontWeight: "700", color: ui.t1 },
  tryLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: ui.t3, marginTop: space[2] },
  turn: { gap: space[2] },
  request: { alignSelf: "flex-end", maxWidth: "92%", gap: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: color.fill.railOn },
  requestText: { fontSize: 15, lineHeight: 22, color: ui.t1 },
  about: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: color.infoText },
  question: { gap: space[2] },
  step: { flexDirection: "row", gap: space[2], alignItems: "flex-start", paddingVertical: 4 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.railOn, marginTop: 1 },
  dotDone: { backgroundColor: color.success },
  dotActive: { backgroundColor: color.infoText },
  dotFailed: { backgroundColor: color.errorText },
  dotText: { fontSize: 12, fontWeight: "700", color: ui.t3 },
  dotTextOn: { color: color.ink },
  stepText: { fontSize: 14, lineHeight: 20, color: ui.t3 },
  stepTextOn: { color: ui.t1 },
  stepStatus: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: ui.t2 },
  done: { gap: space[2] },
  failed: { gap: space[2], borderColor: color.errorText },
  couldnt: { fontSize: 13, lineHeight: 18, color: ui.t2 },
  actions: { flexDirection: "row", gap: space[2] },
  start: { alignSelf: "flex-start" },
  composer: { padding: space[3], gap: space[2], borderTopWidth: 1, borderTopColor: ui.cardBorder },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: space[2] },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: radius.sm, borderWidth: 1, borderColor: ui.border2, backgroundColor: ui.card, color: ui.t1, fontSize: 16, lineHeight: 22, paddingHorizontal: 12, paddingVertical: 10 },
  note: { fontSize: 13, lineHeight: 18, color: color.warningText },
});
