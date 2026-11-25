/**
 * #4490 spec 08 O5 part A — "Who's selling?" (§2 screen 1 `till-who`): what a
 * Till device login always opens on. Staff faces → PIN pad → the Till acts as
 * that person. States: faces, PIN entry, wrong PIN (tries left), locked 5
 * minutes, hard locked, nobody has a PIN, auto-locked, signing the device out
 * (a manager's PIN, or the device's own email code when no manager has one,
 * §12 item 5).
 *
 * Full-screen content of the Till route, never a sheet (08-O3 fix 3: nothing
 * here presents a native modal). A PIN never signs anyone in: this screen only
 * exists on a device that is already signed in.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, radius, size, space, type } from "../../../constants/designSystem";
import { useAuth } from "../../../context/AuthContext";
import {
  signOutTillDevice,
  TillError,
  unlockTillPin,
  type TillPinPerson,
  type TillPinStaff,
} from "../../../services/venueTillService";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Avatar } from "../../ui/Avatar";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Input } from "../../ui/Input";
import { PinPad } from "./PinPad";
import {
  PIN_COPY,
  personRole,
  pinClock,
  pinRetryMessage,
  sellerFaces,
  signOutManagers,
  splitMinglaMark,
  whoStateAfter,
  type WhoState,
} from "./pinModel";
import { tillErrorCopy } from "./tillCopy";

export interface WhoIsSellingProps {
  venueId: string;
  staff: TillPinStaff;
  /** Why the last session ended (banner), if it did. */
  ended: "auto_lock" | "server" | null;
  onClose: () => void;
  /**
   * #4490 O5 part B: opened from Account › Sign out on a Till device login —
   * start on "Who's signing this Till out?" (the one sign-out flow, both
   * entry points).
   */
  startSigningOut?: boolean;
}

type SignOutStep =
  | { kind: "none" }
  | { kind: "pick" }
  | { kind: "pin"; memberId: string; error: string | null }
  | { kind: "email"; sent: boolean; error: string | null };

export function WhoIsSelling({ venueId, staff, ended, onClose, startSigningOut = false }: WhoIsSellingProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 600;
  const auth = useAuth();
  const [state, setState] = useState<WhoState>({ kind: "faces" });
  const [signOut, setSignOut] = useState<SignOutStep>(() =>
    !startSigningOut ? { kind: "none" } : staff.managerHasPin ? { kind: "pick" } : { kind: "email", sent: false, error: null });
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const faces = sellerFaces(staff.people);
  const managers = signOutManagers(staff.people);
  const venueName = staff.venueName ?? "";
  const person = (id: string): TillPinPerson | undefined => staff.people.find((p) => p.memberId === id);

  const unlock = async (memberId: string, pin: string): Promise<void> => {
    setBusy(true);
    try {
      await unlockTillPin({ venueId, memberId, pin });
      // The Till takes over from here (the session is in memory).
    } catch (err) {
      const e = err instanceof TillError ? err : new TillError("till_failed");
      setState(e.code.startsWith("pin_")
        ? whoStateAfter(memberId, e)
        : { kind: "pin", memberId, error: tillErrorCopy(e.code) });
    } finally {
      setBusy(false);
    }
  };

  const finishSignOut = async (input: { memberId?: string; pin?: string }): Promise<void> => {
    setBusy(true);
    try {
      await signOutTillDevice({ venueId, ...input });
      await auth.signOut();
    } catch (err) {
      const e = err instanceof TillError ? err : new TillError("till_failed");
      const message = pinRetryMessage(e) ?? tillErrorCopy(e.code);
      setSignOut((s) => s.kind === "pin" ? { ...s, error: message } : s.kind === "email" ? { ...s, error: message } : s);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (): Promise<void> => {
    const email = auth.user?.email ?? "";
    setBusy(true);
    const { error } = await auth.signInWithEmail(email);
    setBusy(false);
    setSignOut({ kind: "email", sent: error === null, error: error?.message ?? null });
  };

  const confirmCode = async (): Promise<void> => {
    const email = auth.user?.email ?? "";
    setBusy(true);
    const { error } = await auth.verifyEmailOtp(email, code);
    setBusy(false);
    if (error) {
      setSignOut({ kind: "email", sent: true, error: PIN_COPY.codeWrong });
      return;
    }
    setCode("");
    await finishSignOut({});
  };

  const foot = (
    <View style={styles.foot}>
      <Text style={styles.footText}>{PIN_COPY.tillDeviceFooter(venueName)}</Text>
      <Button label={PIN_COPY.signOut} variant="ghost" size="sm"
        onPress={() => setSignOut(staff.managerHasPin ? { kind: "pick" } : { kind: "email", sent: false, error: null })}
        testID="who-sign-out" />
    </View>
  );

  let body: React.ReactElement;
  if (signOut.kind === "pick") {
    body = (
      <View style={styles.block}>
        <Text style={styles.heading}>{PIN_COPY.signOutWho}</Text>
        <Text style={styles.muted}>{PIN_COPY.signOutManagerHint}</Text>
        <View style={[styles.grid, wide && styles.gridWide]}>
          {managers.map((m) => (
            <Face key={m.memberId} person={m} onPress={() => setSignOut({ kind: "pin", memberId: m.memberId, error: null })} />
          ))}
        </View>
        <Button label={PIN_COPY.backToWho} variant="secondary" fullWidth onPress={() => setSignOut({ kind: "none" })} testID="who-sign-out-back" />
      </View>
    );
  } else if (signOut.kind === "pin") {
    const m = person(signOut.memberId);
    body = (
      <View style={styles.block}>
        <PinPad title={PIN_COPY.enterPin} subtitle={signOut.error ?? m?.name ?? null} error={signOut.error !== null} busy={busy}
          onSubmit={(pin) => { void finishSignOut({ memberId: signOut.memberId, pin }); }} testID="who-sign-out-pad" />
        <Button label={PIN_COPY.backToWho} variant="ghost" fullWidth onPress={() => setSignOut({ kind: "none" })} />
      </View>
    );
  } else if (signOut.kind === "email") {
    body = (
      <View style={styles.block}>
        <Text style={styles.heading}>{PIN_COPY.signOutEmailTitle}</Text>
        <Text style={styles.muted}>{PIN_COPY.signOutEmailBody}</Text>
        {signOut.error ? <Banner tone="danger" title={signOut.error} /> : null}
        {signOut.sent ? (
          <>
            <Text style={styles.muted}>{PIN_COPY.codeLabel}</Text>
            <Input variant="integer" placeholder={PIN_COPY.codeLabel} accessibilityLabel={PIN_COPY.codeLabel} value={code}
              onChangeText={(v: string) => setCode(v.replace(/[^0-9]/g, "").slice(0, 6))} testID="who-sign-out-code" />
            <Button label={PIN_COPY.confirmSignOut} variant="primary" size="lg" fullWidth loading={busy}
              disabled={code.length !== 6} onPress={() => { void confirmCode(); }} testID="who-sign-out-confirm" />
          </>
        ) : (
          <Button label={PIN_COPY.sendCode} variant="primary" size="lg" fullWidth loading={busy}
            onPress={() => { void sendCode(); }} testID="who-sign-out-send" />
        )}
        <Button label={PIN_COPY.backToWho} variant="ghost" fullWidth onPress={() => setSignOut({ kind: "none" })} />
      </View>
    );
  } else if (state.kind === "pin") {
    const m = person(state.memberId);
    body = (
      <View style={styles.block}>
        {m ? <Avatar name={m.name} size="hero" /> : null}
        <PinPad title={PIN_COPY.enterPin} subtitle={state.error ?? (m ? `${m.name} · ${personRole(m)}` : null)}
          error={state.error !== null} busy={busy}
          onSubmit={(pin) => { void unlock(state.memberId, pin); }} testID="who-pin" />
        <Button label={PIN_COPY.notYou(m?.name ?? "")} variant="ghost" fullWidth onPress={() => setState({ kind: "faces" })} testID="who-not-you" />
      </View>
    );
  } else if (state.kind === "locked" || state.kind === "hard") {
    const m = person(state.memberId);
    body = (
      <View style={[styles.block, styles.center]} testID={state.kind === "locked" ? "who-locked" : "who-hard-locked"}>
        {m ? <Avatar name={m.name} size="hero" /> : null}
        <Text style={styles.heading}>{state.kind === "locked" ? PIN_COPY.locked : PIN_COPY.hardLocked}</Text>
        <Text style={styles.muted}>
          {state.kind === "locked" ? PIN_COPY.lockedBody(pinClock(state.until)) : PIN_COPY.hardLockedBody}
        </Text>
        <Button label={PIN_COPY.backToWho} variant="secondary" fullWidth onPress={() => setState({ kind: "faces" })} testID="who-back" />
      </View>
    );
  } else if (faces.length === 0) {
    body = (
      <View style={styles.block}>
        <EmptyState illustration="users" title={PIN_COPY.nobody} description={PIN_COPY.nobodyBody} testID="who-nobody" />
      </View>
    );
  } else {
    body = (
      <View style={styles.block}>
        {ended === "auto_lock" ? (
          <Banner tone="info" title={PIN_COPY.idleTitle(staff.autoLockMinutes)} body={PIN_COPY.idleBody} testID="who-idle" />
        ) : ended === "server" ? (
          <Banner tone="info" title={PIN_COPY.lostTitle} body={PIN_COPY.lostBody} testID="who-lost" />
        ) : null}
        <Text style={styles.display} accessibilityRole="header">{PIN_COPY.whoSelling}</Text>
        <Text style={styles.muted}>{PIN_COPY.tapYourName}</Text>
        <View style={[styles.grid, wide && styles.gridWide]}>
          {faces.map((p) => (
            <Face key={p.memberId} person={p} onPress={() => setState({ kind: "pin", memberId: p.memberId, error: null })} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="till-who">
      <View style={styles.header}>
        <Button label="Close" variant="ghost" size="sm" onPress={onClose} testID="who-close" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.column, wide && styles.columnWide]}>
          {body}
          {signOut.kind === "none" ? foot : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Face({ person, onPress }: { person: TillPinPerson; onPress: () => void }): React.ReactElement {
  const shown = splitMinglaMark(person);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${person.name}, ${personRole(person)}`}
      style={({ pressed }) => [styles.face, pressed && styles.facePressed]}
      testID={`who-face-${person.memberId}`}
    >
      <Avatar name={person.name} size="md" />
      {/* #4490 08-O5 fix 5: the name may be shortened, the Mingla mark never is. */}
      <Text style={styles.faceName} numberOfLines={1} testID={`who-face-name-${person.memberId}`}>{shown.name}</Text>
      {shown.mark !== null ? (
        <Text style={styles.faceMark} numberOfLines={1} testID={`who-face-mark-${person.memberId}`}>{shown.mark}</Text>
      ) : null}
      <Text style={styles.faceRole} numberOfLines={1}>{personRole(person)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: "row", paddingHorizontal: space[4], paddingVertical: space[2] },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space[4], paddingBottom: space[8] },
  column: { width: "100%", maxWidth: size.dialog, alignSelf: "center", gap: space[5] },
  columnWide: { maxWidth: size.modal },
  block: { gap: space[3], alignItems: "stretch" },
  center: { alignItems: "center" },
  display: { ...type.title, color: color.text1, textAlign: "center" },
  heading: { ...type.h1, color: color.text1, textAlign: "center" },
  muted: { ...type.small, color: color.text2, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space[3] },
  gridWide: { justifyContent: "flex-start", columnGap: space[3] },
  face: {
    width: "48%",
    minHeight: size.btn.xl * 2,
    borderRadius: radius.lg,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    padding: space[3],
  },
  facePressed: { backgroundColor: color.card2 },
  faceName: { ...type.row, color: color.text1, maxWidth: "100%" },
  faceMark: { ...type.caption, color: color.text2 },
  faceRole: { ...type.caption, color: color.text3 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  footText: { ...type.caption, color: color.text3, flex: 1 },
});
