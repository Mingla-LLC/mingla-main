/**
 * #4490 spec 08 O5 part A — "Till PIN" in Team › member (§2 screen 13).
 *
 * - On your own membership: set or change your PIN (twice, 4 to 6 digits,
 *   weak PINs refused). A hard-locked PIN can't be changed here ("Ask a
 *   manager to unlock your PIN").
 * - On someone else's, when you may reset it (brand admin and up, or money
 *   rights at a venue they are granted): their PIN state and "Reset {name}'s
 *   PIN". Only from your own sign-in: the server refuses a Till device login
 *   and any request carrying a PIN session.
 *
 * Inline inside MemberDetailSheet (no second sheet). Shown only while the Till
 * is released (VENUE_TILL). Server state through react-query (one key
 * factory); nothing persisted; the PIN itself only in PinPad's state.
 */

import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { color, radius, space, type } from "../../constants/designSystem";
import { useTillReleased } from "../../hooks/useTillReleased";
import {
  fetchMyTillPin,
  fetchTeamTillPins,
  resetTillPin,
  setMyTillPin,
  TillError,
} from "../../services/tillPinService";
import { Button } from "../ui/Button";
import { PinPad } from "../venue/till/PinPad";
import { PIN_COPY, pinIsWeak } from "../venue/till/pinModel";
import { tillErrorCopy } from "../venue/till/tillErrorCopy";

export const tillPinTeamKeys = {
  mine: (brandId: string) => ["tillPin", brandId, "mine"] as const,
  team: (brandId: string) => ["tillPin", brandId, "team"] as const,
};

export interface TillPinSectionProps {
  brandId: string;
  /** The membership shown in the sheet (brand_team_members.id). */
  memberId: string;
  memberName: string;
  /**
   * #4490 08-O5 fix 2 (O5-B1): the sheet is showing YOUR OWN row (the Team
   * screen's synthesized "You" row has no membership id to compare), so this
   * is the set-or-change-my-PIN control whatever the id says.
   */
  own?: boolean;
  /** Your own PIN was saved: the screen closes the sheet and shows a toast. */
  onOwnPinSaved?: (message: string) => void;
  /**
   * #4490 08-O5 fix 4: told when the PIN pad opens (true) and closes (false),
   * so the sheet can give the keypad its full height.
   */
  onPinPadChange?: (open: boolean) => void;
}

type Step = { kind: "idle" } | { kind: "choose"; error: string | null } | { kind: "confirm"; first: string };

function dayOf(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export function TillPinSection(props: TillPinSectionProps): React.ReactElement | null {
  const released = useTillReleased();
  if (!released) return null;
  return <TillPinSectionBody {...props} />;
}

function TillPinSectionBody({ brandId, memberId, memberName, own: ownRow = false, onOwnPinSaved, onPinPadChange }: TillPinSectionProps): React.ReactElement | null {
  const queryClient = useQueryClient();
  const mine = useQuery({
    queryKey: tillPinTeamKeys.mine(brandId),
    queryFn: () => fetchMyTillPin(brandId),
    staleTime: 0,
    retry: false,
  });
  const team = useQuery({
    queryKey: tillPinTeamKeys.team(brandId),
    queryFn: () => fetchTeamTillPins(brandId),
    enabled: !ownRow,
    staleTime: 0,
    retry: false,
  });
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const padOpen = step.kind !== "idle";
  useEffect(() => {
    onPinPadChange?.(padOpen);
  }, [onPinPadChange, padOpen]);
  useEffect(() => () => onPinPadChange?.(false), [onPinPadChange]);

  const setPin = useMutation({
    mutationFn: (pin: string) => setMyTillPin({ brandId, pin }),
    onSuccess: () => {
      setStep({ kind: "idle" });
      setMessage({ tone: "ok", text: PIN_COPY.saved });
      void queryClient.invalidateQueries({ queryKey: tillPinTeamKeys.mine(brandId) });
      onOwnPinSaved?.(PIN_COPY.saved);
    },
    onError: (err: unknown) => {
      const code = err instanceof TillError ? err.code : "till_failed";
      setStep(code === "pin_weak" || code === "pin_invalid" ? { kind: "choose", error: tillErrorCopy(code) } : { kind: "idle" });
      if (code !== "pin_weak" && code !== "pin_invalid") setMessage({ tone: "error", text: tillErrorCopy(code) });
    },
  });
  const reset = useMutation({
    mutationFn: () => resetTillPin(memberId),
    onSuccess: () => {
      setMessage({ tone: "ok", text: PIN_COPY.resetDone });
      void queryClient.invalidateQueries({ queryKey: tillPinTeamKeys.team(brandId) });
    },
    onError: (err: unknown) => setMessage({ tone: "error", text: tillErrorCopy(err instanceof TillError ? err.code : "till_failed") }),
  });

  const own = ownRow || (mine.data !== undefined && mine.data.memberId === memberId);
  const other = team.data?.find((m) => m.memberId === memberId) ?? null;
  if (mine.isLoading || (!ownRow && team.isLoading)) return null;
  // Your own row with no answer: say so and offer another try (never an empty sheet).
  if (ownRow && mine.data === undefined) {
    return (
      <View style={styles.card} testID="till-pin-own-error">
        <Text style={styles.label}>{PIN_COPY.tillPin}</Text>
        <Text style={[styles.note, styles.noteError]} accessibilityRole="alert">
          {tillErrorCopy(mine.error instanceof TillError ? mine.error.code : "till_failed")}
        </Text>
        <Button label={PIN_COPY.retry} variant="secondary" size="md" fullWidth onPress={() => void mine.refetch()} testID="till-pin-own-retry" />
      </View>
    );
  }
  if (own && mine.data?.tillDevice) {
    // A Till device login never has a PIN: say what it is, never an empty sheet on your own row.
    return ownRow ? (
      <View style={styles.card} testID="till-pin-own-device">
        <Text style={styles.label}>{PIN_COPY.tillPin}</Text>
        <Text style={styles.hint}>{PIN_COPY.tillDeviceExplainer}</Text>
      </View>
    ) : null;
  }
  if (!own && other === null) return null;

  const note = message !== null ? (
    <Text style={[styles.note, message.tone === "error" && styles.noteError]} accessibilityLiveRegion="polite"
      testID="till-pin-message">{message.text}</Text>
  ) : null;

  if (own && mine.data !== undefined) {
    const status = mine.data;
    if (step.kind === "choose") {
      return (
        <View style={styles.block} testID="till-pin-setup">
          <PinPad title={PIN_COPY.choosePin} subtitle={step.error ?? PIN_COPY.choosePinHint} error={step.error !== null}
            onSubmit={(pin) => {
              if (pinIsWeak(pin)) setStep({ kind: "choose", error: PIN_COPY.weak });
              else setStep({ kind: "confirm", first: pin });
            }} testID="till-pin-choose" />
          <Button label={PIN_COPY.cancel} variant="ghost" fullWidth onPress={() => setStep({ kind: "idle" })} />
        </View>
      );
    }
    if (step.kind === "confirm") {
      return (
        <View style={styles.block} testID="till-pin-setup">
          <PinPad title={PIN_COPY.enterItAgain} busy={setPin.isPending}
            onSubmit={(pin) => {
              if (pin !== step.first) setStep({ kind: "choose", error: PIN_COPY.mismatch });
              else setPin.mutate(pin);
            }} testID="till-pin-confirm" />
          <Button label={PIN_COPY.cancel} variant="ghost" fullWidth disabled={setPin.isPending} onPress={() => setStep({ kind: "idle" })} />
        </View>
      );
    }
    return (
      <View style={styles.card} testID="till-pin-own">
        <Text style={styles.label}>{PIN_COPY.tillPin}</Text>
        <Text style={styles.value}>
          {status.hardLocked ? PIN_COPY.pinHardLockedRow : status.hasPin ? PIN_COPY.pinSetOn(dayOf(status.setAt)) : PIN_COPY.noPinYet}
        </Text>
        {status.hardLocked ? (
          <Text style={styles.hint}>{PIN_COPY.hardLocked}</Text>
        ) : (
          <Button label={status.hasPin ? PIN_COPY.changePin : PIN_COPY.setPin} variant="secondary" size="md" fullWidth
            onPress={() => { setMessage(null); setStep({ kind: "choose", error: null }); }} testID="till-pin-set" />
        )}
        {note}
      </View>
    );
  }

  if (other === null) return null;
  return (
    <View style={styles.card} testID="till-pin-member">
      <Text style={styles.label}>{PIN_COPY.tillPin}</Text>
      <Text style={styles.value}>
        {other.hardLocked ? PIN_COPY.pinHardLockedRow : other.hasPin ? PIN_COPY.pinSetOn(dayOf(other.setAt)) : PIN_COPY.noPinYet}
      </Text>
      {other.hasPin ? (
        <Button label={PIN_COPY.resetPin(memberName)} variant="destructive" size="md" fullWidth loading={reset.isPending}
          onPress={() => { setMessage(null); reset.mutate(); }} testID="till-pin-reset" />
      ) : null}
      <Text style={styles.hint}>{PIN_COPY.resetHint}</Text>
      {note}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[3], marginTop: space[3] },
  card: {
    gap: space[2],
    marginTop: space[3],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.card,
  },
  label: { ...type.label, color: color.text3 },
  value: { ...type.row, color: color.text1 },
  hint: { ...type.caption, color: color.text3 },
  note: { ...type.small, color: color.successText },
  noteError: { color: color.errorText },
});
