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

import React, { useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ScrollView as RNScrollView } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import { answerStepUp, useTillStaffSession, useTillStepUp } from "../../../services/tillStaffSession";
import type { TillPinPerson } from "../../../services/venueTillService";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Pill";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { ScrollRevealContext } from "../../ui/SheetScrollLayout";
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

/**
 * #4490 08-O5 fix 6 (item 7): a sheet that hosts a step-up. While the PIN pad
 * shows, a swipe down, the Android back button, a scrim tap and the sheet's
 * own Close all do what Cancel does: the step-up is cancelled (the action
 * ends in "Nothing was changed") and the sheet springs back to its form. They
 * were dead before, because the waiting action keeps the sheet busy
 * (dismissDisabled). Spread `sheet` on the Sheet; use `close` / `closeDisabled`
 * for the sheet's Close button.
 */
export interface StepUpSheetControl {
  pending: boolean;
  sheet: {
    snapPoint: number;
    dismissDisabled: boolean;
    dismissGuard: () => boolean;
    onRequestClose: () => void;
  };
  close: () => void;
  closeDisabled: boolean;
}
export function stepUpSheetControl(pending: boolean, base: number, busy: boolean, onClose: () => void): StepUpSheetControl {
  const cancel = (): void => answerStepUp(null);
  return {
    pending,
    sheet: {
      snapPoint: stepUpSheetSnap(pending, base),
      dismissDisabled: busy && !pending,
      dismissGuard: () => pending,
      onRequestClose: pending ? cancel : onClose,
    },
    close: pending ? cancel : onClose,
    closeDisabled: busy && !pending,
  };
}
export function useStepUpSheet(venueId: string, base: number, busy: boolean, onClose: () => void): StepUpSheetControl {
  const request = useTillStepUp(venueId);
  const session = useTillStaffSession(venueId);
  return stepUpSheetControl(request !== null && session !== null, base, busy, onClose);
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
  // #4490 08-O5 fix 6 (item 6): OK and Cancel are in view when the pad opens.
  // In its own bounded scroll (a refund, void or reopen sheet) the pad scrolls
  // to its end when it is taller than the sheet (Android, where OK sat below
  // the fold); inside a sheet's scroll area (the sold-out list) it asks that
  // area to bring its bottom into view. The title and dots stay above OK.
  const scrollRef = useRef<RNScrollView | null>(null);
  const panelRef = useRef<View | null>(null);
  const viewport = useRef(0);
  const content = useRef(0);
  const revealed = useRef(false);
  const reveal = useContext(ScrollRevealContext);
  const fitPad = (): void => {
    const contentHeight = content.current;
    if (revealed.current || viewport.current <= 0 || contentHeight <= 0) return;
    revealed.current = true;
    if (contentHeight > viewport.current + 1) scrollRef.current?.scrollToEnd({ animated: false });
    else if (reveal !== null && panelRef.current !== null) reveal(panelRef.current);
  };
  return (
    // #4490 08-O5 fix 5: the pad scrolls if the sheet is shorter than it, so
    // OK can always be reached.
    <ScrollView ref={scrollRef} style={styles.fill} contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled"
      onLayout={(e) => {
        viewport.current = e.nativeEvent.layout.height;
        fitPad();
      }}
      onContentSizeChange={(_w, h) => {
        content.current = h;
        fitPad();
      }}
      testID="till-step-up">
      <View ref={panelRef} collapsable={false} style={styles.panel} testID="till-step-up-panel">
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
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingVertical: space[3], paddingHorizontal: space[1] },
  panel: { gap: space[3] },
  // Grows and shrinks inside a sheet; sizes to its content inside a scroll.
  fill: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
  hidden: { display: "none" },
  who: { gap: space[2] },
  label: { ...type.label, color: color.text3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  hint: { ...type.caption, color: color.text3 },
});
