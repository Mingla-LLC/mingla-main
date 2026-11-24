/**
 * #4490 spec 08 O5 part A — the step-up prompt ("Enter your PIN again to
 * confirm"): a refund or a sent void on a Till device needs a fresh PIN with
 * money rights, from the person selling or a manager on the spot (§11.4 item
 * 1: the seller stays switched in; the approval is recorded under the
 * approver).
 *
 * It renders INSIDE the sheet that asked (VoidSheet, RefundSheet,
 * LineRefundSheet), in place of that sheet's body, so it is never a second
 * native sheet over a presenting screen (08-O3 fix 3). When no step-up is
 * pending for this venue the sheet's own content shows.
 */

import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import { answerStepUp, useTillStaffSession, useTillStepUp } from "../../../services/tillStaffSession";
import type { TillPinPerson } from "../../../services/venueTillService";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Pill";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { PinPad } from "./PinPad";
import { PIN_COPY } from "./pinModel";

export interface TillStepUpHostProps {
  venueId: string;
  /** People with money rights who may approve on the spot (from Who's selling). */
  approvers: readonly TillPinPerson[];
  children: React.ReactNode;
}

/**
 * #4490 08-O5 fix 5: the height a sheet takes while its PIN pad shows: the
 * tallest sheet, as the Team "Set your PIN" sheet (MEMBER_SHEET_PIN_SNAP),
 * so the dots, the whole keypad, OK and Cancel fit on a small phone.
 */
export const STEP_UP_SHEET_SNAP = 0.95;
export function stepUpSheetSnap(stepUpOpen: boolean, base: number): number {
  return stepUpOpen ? Math.max(base, STEP_UP_SHEET_SNAP) : base;
}
/** The snap point of a sheet that hosts a step-up for this venue. */
export function useStepUpSheetSnap(venueId: string, base: number): number {
  const request = useTillStepUp(venueId);
  const session = useTillStaffSession(venueId);
  return stepUpSheetSnap(request !== null && session !== null, base);
}

export function TillStepUpHost({ venueId, approvers, children }: TillStepUpHostProps): React.ReactElement {
  const request = useTillStepUp(venueId);
  const session = useTillStaffSession(venueId);
  const showing = request !== null && session !== null;
  // #4490 08-O5 fix 5 (item 10): this sheet closing while its PIN pad shows
  // (Close, a swipe, a key that reached another control) cancels the step-up,
  // so the action waiting on it ends in words instead of hanging unsent.
  const showingRef = useRef(showing);
  showingRef.current = showing;
  useEffect(() => () => {
    if (showingRef.current) answerStepUp(null);
  }, []);
  return (
    <>
      {/* The sheet's own content stays mounted (hidden) under the PIN pad, so
          whatever asked for the PIN is still there to show the answer: a
          refusal after the PIN is shown in words, never lost (item 10). */}
      <View style={showing ? styles.hidden : styles.fill} testID="till-step-up-content">{children}</View>
      {showing && request !== null && session !== null ? (
        <StepUpPanel key={request.id} sessionMemberId={session.memberId} sessionName={session.name}
          sessionCanApprove={session.canApprove} approvers={approvers} error={request.error} />
      ) : null}
    </>
  );
}

function StepUpPanel({
  sessionMemberId,
  sessionName,
  sessionCanApprove,
  approvers,
  error,
}: {
  sessionMemberId: string;
  sessionName: string;
  sessionCanApprove: boolean;
  approvers: readonly TillPinPerson[];
  error: string | null;
}): React.ReactElement {
  const others = approvers.filter((a) => a.memberId !== sessionMemberId);
  const [who, setWho] = useState<string>(sessionCanApprove || others.length === 0 ? sessionMemberId : others[0].memberId);
  const name = who === sessionMemberId ? sessionName : others.find((a) => a.memberId === who)?.name ?? "";
  return (
    // #4490 08-O5 fix 5: the pad scrolls if the sheet is shorter than it, so
    // OK can always be reached.
    <ScrollView style={styles.fill} contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled" testID="till-step-up">
      {others.length > 0 ? (
        <View style={styles.who}>
          <Text style={styles.label}>{PIN_COPY.whoApproves}</Text>
          <View style={styles.chips}>
            {sessionCanApprove ? (
              <Chip label={sessionName} selected={who === sessionMemberId} onPress={() => setWho(sessionMemberId)}
                testID="till-step-up-self" />
            ) : null}
            {others.map((a) => (
              <Chip key={a.memberId} label={a.name} selected={who === a.memberId} onPress={() => setWho(a.memberId)}
                testID={`till-step-up-${a.memberId}`} />
            ))}
          </View>
          <Text style={styles.hint}>{PIN_COPY.approveHint}</Text>
        </View>
      ) : null}
      <PinPad
        title={PIN_COPY.enterAgainToConfirm}
        subtitle={error ?? name}
        error={error !== null}
        onSubmit={(pin) => answerStepUp({ pin, memberId: who === sessionMemberId ? null : who })}
        testID="till-step-up-pad"
      />
      <Button label={PIN_COPY.cancel} variant="ghost" fullWidth onPress={() => answerStepUp(null)} testID="till-step-up-cancel" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, gap: space[3], paddingVertical: space[3], paddingHorizontal: space[1] },
  // Grows and shrinks inside a sheet; sizes to its content inside a scroll.
  fill: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
  hidden: { display: "none" },
  who: { gap: space[2] },
  label: { ...type.label, color: color.text3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  hint: { ...type.caption, color: color.text3 },
});
