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

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import { answerStepUp, useTillStaffSession, useTillStepUp } from "../../../services/tillStaffSession";
import type { TillPinPerson } from "../../../services/venueTillService";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Pill";
import { PinPad } from "./PinPad";
import { PIN_COPY } from "./pinModel";

export interface TillStepUpHostProps {
  venueId: string;
  /** People with money rights who may approve on the spot (from Who's selling). */
  approvers: readonly TillPinPerson[];
  children: React.ReactNode;
}

export function TillStepUpHost({ venueId, approvers, children }: TillStepUpHostProps): React.ReactElement {
  const request = useTillStepUp(venueId);
  const session = useTillStaffSession(venueId);
  if (request === null || session === null) return <>{children}</>;
  return <StepUpPanel key={request.id} sessionMemberId={session.memberId} sessionName={session.name}
    sessionCanApprove={session.canApprove} approvers={approvers} error={request.error} />;
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
    <View style={styles.root} testID="till-step-up">
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: space[3], paddingVertical: space[3], paddingHorizontal: space[1] },
  who: { gap: space[2] },
  label: { ...type.label, color: color.text3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  hint: { ...type.caption, color: color.text3 },
});
