/**
 * #4579 — the "Mingla" section on Team & permissions: ONE "Mingla Team" row
 * however many Mingla admins are on the brand (never a person, an email or how
 * many). Approved design: issue #4579 design contract (artifact
 * WB1Ue3D3LjiD91aFUEKbi1), Part 2.
 *
 *   On      the row ("Mingla Team" / "Mingla's team, here to help" / Brand admin)
 *           opens a detail sheet; brand admin and up can remove it.
 *   Off     "Off for this brand"; the owner gets "Add Mingla Team back", anyone
 *           else a caption.
 *   None    nothing is shown (no Mingla admin is on the brand).
 *
 * The remove confirm and its error toast render inside the Sheet subtree (iOS
 * presents nested modals from the sheet's own VC; see MemberDetailSheet #1369).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { color, radius, space } from "../../constants/designSystem";
import { useReduceMotion } from "../../hooks/useMotionPreferences";
import type { MinglaTeamState } from "../../services/minglaTeamService";
import { gateCaptionFor } from "../../utils/permissionGates";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";
import { MINGLA_TEAM_NAME, MinglaTeamMark } from "./MinglaTeamMark";

export const MINGLA_TEAM_COPY = {
  section: "Mingla",
  name: MINGLA_TEAM_NAME,
  line: "Mingla's team, here to help",
  role: "Brand admin",
  status: "Added by Mingla",
  statusActive: "Active",
  cardLabel: "What Mingla Team does",
  cardText:
    "Mingla adds its team to every brand as Brand admin, so we can help you set up and fix problems. We can't change payouts or bank details.",
  removalLine:
    "Removing Mingla Team takes away Mingla's access to this brand. You can add it back any time.",
  removeButton: "Remove Mingla Team",
  removeTitle: "Remove Mingla Team?",
  removeBody:
    "Mingla will lose access to this brand and won't be added back. You can add Mingla Team back from this screen.",
  removeConfirm: "Remove",
  removed: "Mingla Team removed",
  addedBack: "Mingla Team added back",
  removeFailed: "Couldn't remove Mingla Team. Try again.",
  addBackFailed: "Couldn't add Mingla Team back. Try again.",
  off: "Off for this brand",
  addBack: "Add Mingla Team back",
  ownerOnly: "Only the brand owner can add Mingla Team back.",
  addBackTitle: "Add Mingla Team back?",
  addBackBody: "Mingla's team becomes Brand admin on this brand again, so we can help you run it.",
  addBackConfirm: "Add back",
} as const;

export type MinglaTeamView = "on" | "off" | "hidden";

/** Pure: which form the section takes. Exported for tests. */
export function minglaTeamView(state: MinglaTeamState | null | undefined): MinglaTeamView {
  if (state === null || state === undefined) return "hidden";
  if (state.status === "active") return "on";
  if (state.status === "removed") return "off";
  return "hidden";
}

export interface MinglaTeamSectionProps {
  state: MinglaTeamState | null | undefined;
  isWideDesktop: boolean;
  removePending: boolean;
  restorePending: boolean;
  onRemove: () => Promise<void>;
  onRestore: () => Promise<void>;
  /** Success toast on the screen (after the sheet has closed). */
  onSuccess: (message: string) => void;
  /** Error toast on the screen for the add-back path (no sheet is open). */
  onError: (message: string) => void;
  /** Defers a callback past the sheet's unmount window (deferAfterDismiss). */
  defer: (fn: () => void) => void;
}

export const MinglaTeamSection: React.FC<MinglaTeamSectionProps> = ({
  state,
  isWideDesktop,
  removePending,
  restorePending,
  onRemove,
  onRestore,
  onSuccess,
  onError,
  defer,
}) => {
  const view = minglaTeamView(state);
  const reduceMotion = useReduceMotion();
  const fade = useRef(new Animated.Value(1)).current;
  const [sheetVisible, setSheetVisible] = useState(false);
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);
  const [addBackConfirmVisible, setAddBackConfirmVisible] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const previousView = useRef<MinglaTeamView>(view);

  // On/Off swap: a 180 ms cross-fade; instant with reduced motion.
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    if (reduceMotion) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [view, reduceMotion, fade]);

  const closeSheet = useCallback((): void => {
    if (removePending) return;
    setSheetVisible(false);
    setRemoveError(null);
  }, [removePending]);

  const handleRemoveConfirm = useCallback(async (): Promise<void> => {
    if (removePending) return;
    setRemoveError(null);
    try {
      await onRemove();
      setRemoveConfirmVisible(false);
      setSheetVisible(false);
      defer(() => onSuccess(MINGLA_TEAM_COPY.removed));
    } catch {
      setRemoveConfirmVisible(false);
      setRemoveError(MINGLA_TEAM_COPY.removeFailed);
    }
  }, [removePending, onRemove, defer, onSuccess]);

  const handleAddBackConfirm = useCallback(async (): Promise<void> => {
    if (restorePending) return;
    try {
      await onRestore();
      setAddBackConfirmVisible(false);
      onSuccess(MINGLA_TEAM_COPY.addedBack);
    } catch {
      setAddBackConfirmVisible(false);
      onError(MINGLA_TEAM_COPY.addBackFailed);
    }
  }, [restorePending, onRestore, onSuccess, onError]);

  if (view === "hidden" || state === null || state === undefined) return null;

  const onRow = (
    <Pressable
      onPress={() => setSheetVisible(true)}
      accessibilityRole="button"
      accessibilityLabel={`${MINGLA_TEAM_COPY.name}, ${MINGLA_TEAM_COPY.role}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID="team-mingla-team-row"
    >
      <MinglaTeamMark size={40} />
      <View style={styles.rowTextCol}>
        <Text style={styles.rowName} numberOfLines={1}>{MINGLA_TEAM_COPY.name}</Text>
        <Text style={styles.rowLine} numberOfLines={1}>{MINGLA_TEAM_COPY.line}</Text>
      </View>
      {isWideDesktop ? (
        <View style={styles.desktopMeta}>
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText} numberOfLines={1}>{MINGLA_TEAM_COPY.role}</Text>
          </View>
          <Text style={styles.desktopStatus}>{MINGLA_TEAM_COPY.statusActive}</Text>
        </View>
      ) : (
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText} numberOfLines={1}>{MINGLA_TEAM_COPY.role}</Text>
        </View>
      )}
    </Pressable>
  );

  const offCard = (
    <View style={styles.offCard} testID="team-mingla-team-off">
      <View style={styles.offHead}>
        <MinglaTeamMark size={40} dimmed />
        <View style={styles.rowTextCol}>
          <Text style={styles.rowName} numberOfLines={1}>{MINGLA_TEAM_COPY.name}</Text>
          <Text style={styles.offLine}>{MINGLA_TEAM_COPY.off}</Text>
        </View>
      </View>
      {state.canRestore ? (
        <View style={isWideDesktop ? styles.offButtonDesktop : undefined}>
          <Button
            label={MINGLA_TEAM_COPY.addBack}
            onPress={() => setAddBackConfirmVisible(true)}
            variant="secondary"
            size="sm"
            fullWidth={!isWideDesktop}
            loading={restorePending}
            disabled={restorePending}
            accessibilityLabel={MINGLA_TEAM_COPY.addBack}
            testID="team-mingla-team-add-back"
          />
        </View>
      ) : (
        <Text style={styles.caption}>{MINGLA_TEAM_COPY.ownerOnly}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{MINGLA_TEAM_COPY.section}</Text>
      <Animated.View style={{ opacity: fade }}>
        <GlassCard variant="base" padding={0}>
          {view === "on" ? onRow : offCard}
        </GlassCard>
      </Animated.View>

      <Sheet visible={sheetVisible} onClose={closeSheet} snapPoint="half" dismissDisabled={removePending}>
        <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
          <View style={styles.sheetTitleRow}>
            <MinglaTeamMark size={36} />
            <View style={styles.rowTextCol}>
              <Text style={styles.sheetTitle}>{MINGLA_TEAM_COPY.name}</Text>
              <Text style={styles.sheetSubtitle}>{MINGLA_TEAM_COPY.line}</Text>
            </View>
          </View>
          <View style={styles.sheetPillRow}>
            <View style={styles.sheetRolePill}>
              <Text style={styles.sheetRolePillText}>{MINGLA_TEAM_COPY.role}</Text>
            </View>
          </View>
          <Text style={styles.sheetStatus}>{MINGLA_TEAM_COPY.status}</Text>
          <View style={styles.descriptionCard}>
            <Text style={styles.descriptionLabel}>{MINGLA_TEAM_COPY.cardLabel}</Text>
            <Text style={styles.descriptionText}>{MINGLA_TEAM_COPY.cardText}</Text>
          </View>
          {state.canRemove ? (
            <Text style={styles.removalLine}>{MINGLA_TEAM_COPY.removalLine}</Text>
          ) : null}
          <View style={styles.actions}>
            {state.canRemove ? (
              <>
                <Button
                  label={MINGLA_TEAM_COPY.removeButton}
                  onPress={() => setRemoveConfirmVisible(true)}
                  variant="destructive"
                  size="md"
                  fullWidth
                  disabled={removePending}
                  accessibilityLabel={MINGLA_TEAM_COPY.removeButton}
                  testID="team-mingla-team-remove"
                />
                <View style={styles.actionSpacer} />
                <Button
                  label="Cancel"
                  onPress={closeSheet}
                  variant="ghost"
                  size="md"
                  fullWidth
                  disabled={removePending}
                  accessibilityLabel="Close Mingla Team"
                />
              </>
            ) : (
              <>
                <Text style={styles.gateCaption}>{gateCaptionFor("REMOVE_TEAM_MEMBER")}</Text>
                <View style={styles.actionSpacer} />
                <Button
                  label="Close"
                  onPress={closeSheet}
                  variant="ghost"
                  size="md"
                  fullWidth
                  accessibilityLabel="Close Mingla Team"
                />
              </>
            )}
          </View>
        </ScrollView>

        <ConfirmDialog
          visible={removeConfirmVisible}
          onClose={() => {
            if (removePending) return;
            setRemoveConfirmVisible(false);
          }}
          onConfirm={handleRemoveConfirm}
          title={MINGLA_TEAM_COPY.removeTitle}
          description={MINGLA_TEAM_COPY.removeBody}
          confirmLabel={MINGLA_TEAM_COPY.removeConfirm}
          destructive
          confirmLoading={removePending}
          closeDisabled={removePending}
          confirmTestID="team-mingla-team-remove-confirm"
        />

        {removeError !== null ? (
          <Toast visible kind="error" message={removeError} onDismiss={() => setRemoveError(null)} />
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={addBackConfirmVisible}
        onClose={() => {
          if (restorePending) return;
          setAddBackConfirmVisible(false);
        }}
        onConfirm={handleAddBackConfirm}
        title={MINGLA_TEAM_COPY.addBackTitle}
        description={MINGLA_TEAM_COPY.addBackBody}
        confirmLabel={MINGLA_TEAM_COPY.addBackConfirm}
        confirmLoading={restorePending}
        closeDisabled={restorePending}
        confirmTestID="team-mingla-team-add-back-confirm"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: space[5], gap: space[2] },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: color.text3,
    textTransform: "uppercase",
    paddingHorizontal: space[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 64,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  rowPressed: { backgroundColor: color.fill.rowHover },
  rowTextCol: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: "600", color: color.text1 },
  rowLine: { fontSize: 12, color: color.text3, marginTop: 2 },
  rolePill: {
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  rolePillText: { fontSize: 11, fontWeight: "600", color: color.text1 },
  desktopMeta: { flexDirection: "row", alignItems: "center", gap: space[4] },
  desktopStatus: { fontSize: 12, color: color.text2 },
  offCard: { padding: space[4], gap: space[3] },
  offHead: { flexDirection: "row", alignItems: "center", gap: space[3] },
  offLine: { fontSize: 12, color: color.text3, marginTop: 2 },
  offButtonDesktop: { alignSelf: "flex-start" },
  caption: { fontSize: 12, color: color.text3, textAlign: "center" },
  sheetBody: { paddingTop: space[4], paddingBottom: space[7] },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: color.text1, letterSpacing: -0.2 },
  sheetSubtitle: { fontSize: 14, color: color.text2, marginTop: 2 },
  sheetPillRow: { flexDirection: "row", alignItems: "center", marginTop: space[2] + 2 },
  sheetRolePill: {
    paddingHorizontal: space[2] + 2,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  sheetRolePillText: { fontSize: 12, fontWeight: "600", color: color.text1 },
  sheetStatus: { fontSize: 13, color: color.text3, marginTop: space[2] },
  descriptionCard: {
    marginTop: space[4],
    padding: space[4],
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  descriptionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: color.text2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  descriptionText: { fontSize: 14, color: color.text1, lineHeight: 20 },
  removalLine: { fontSize: 14, lineHeight: 20, color: color.text2, marginTop: space[3] + 2 },
  actions: { paddingTop: space[6] },
  actionSpacer: { height: space[2] },
  gateCaption: { fontSize: 12, color: color.text3, textAlign: "center" },
});

export default MinglaTeamSection;
