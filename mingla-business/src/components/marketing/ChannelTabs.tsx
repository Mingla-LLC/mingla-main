/**
 * ChannelTabs — the composer's "Send by" row (#4273 wave B): one tick chip per
 * method, any mix, at least one always on. It replaces the old Email · SMS ·
 * Push tabs and the "Also send by" chips; the "Push · free" wording is kept.
 *
 * The dead "RCS" tab was removed in ORCH-1283 (it did nothing and no RCS
 * infrastructure ever shipped). This enforces I-PROPOSED-BS (literal `email` +
 * `sms` strings co-located in this file — checked by the ORCH-0815-B
 * strict-grep gate).
 *
 * Accessibility (I-39): every Pressable has accessibilityLabel +
 * accessibilityState.disabled.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type MarketingChannelKind = "email" | "sms" | "push";

export const CHANNEL_LABEL: Record<MarketingChannelKind, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push",
};

export interface ChannelTabsProps {
  selected: ReadonlySet<MarketingChannelKind>;
  onToggle: (kind: MarketingChannelKind) => void;
  /** Why a chip cannot be ticked right now (e.g. the audience has no accounts). */
  unavailable?: Partial<Record<MarketingChannelKind, string>>;
  /** A method the host ticked went away: said in a plain sentence. */
  fallbackSentence?: string | null;
}

interface TabSpec {
  kind: MarketingChannelKind;
  label: string;
}

const TABS: ReadonlyArray<TabSpec> = [
  { kind: "email", label: "Email" },
  // META-ORCH-1161 Sub-B — SMS enabled. The send still ships text-dark: the
  // per-market kill-switch (SMS_LIVE_ENABLED_US/_NG) defaults false server-side,
  // so composing/scheduling an SMS blast is live UI but no Twilio HTTP fires
  // until the operator flips the switch.
  { kind: "sms", label: "SMS" },
  // #3682 wave 2 — free Mingla push to followers and Book people with an account.
  { kind: "push", label: "Push · free" },
];

export const ChannelTabs: React.FC<ChannelTabsProps> = ({
  selected,
  onToggle,
  unavailable = {},
  fallbackSentence = null,
}) => {
  const onCount = TABS.filter(
    (tab) => selected.has(tab.kind) && unavailable[tab.kind] === undefined,
  ).length;
  const notes = TABS.flatMap((tab) =>
    unavailable[tab.kind] ? [`${CHANNEL_LABEL[tab.kind]}: ${unavailable[tab.kind]}`] : [],
  );
  return (
    <View style={styles.host} testID="composer-send-by">
      <Text style={styles.heading}>SEND BY</Text>
      <View style={styles.row}>
        {TABS.map((tab) => {
          const isOff = unavailable[tab.kind] !== undefined;
          const isOn = selected.has(tab.kind) && !isOff;
          // At least one method stays on: the last one ticked cannot be unticked.
          const isLast = isOn && onCount === 1;
          const disabled = isOff || isLast;
          return (
            <Pressable
              key={tab.kind}
              onPress={() => {
                if (!disabled) onToggle(tab.kind);
              }}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityLabel={
                isLast
                  ? `Send by ${CHANNEL_LABEL[tab.kind]}. At least one method stays on.`
                  : `Send by ${CHANNEL_LABEL[tab.kind]}`
              }
              accessibilityState={{ checked: isOn, disabled }}
              style={({ pressed }) => [
                styles.chip,
                isOn ? styles.chipOn : null,
                isOff ? styles.chipDisabled : null,
                pressed && !disabled ? styles.chipPressed : null,
              ]}
            >
              <Text style={[styles.chipText, isOn ? styles.chipTextOn : null]}>
                {`${isOn ? "✓ " : ""}${tab.label}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {fallbackSentence !== null ? (
        <Text accessibilityRole="alert" style={styles.fallback} testID="composer-send-by-fallback">
          {fallbackSentence}
        </Text>
      ) : null}
      {notes.map((note) => <Text key={note} style={styles.note}>{note}</Text>)}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { gap: spacing.xs },
  heading: { ...typography.labelCap, color: textTokens.tertiary },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  chipOn: { borderColor: accent.warm, backgroundColor: accent.tint },
  chipDisabled: { opacity: 0.45 },
  chipPressed: { opacity: 0.8 },
  chipText: { color: textTokens.secondary, fontSize: 13, fontWeight: "700" },
  chipTextOn: { color: textTokens.primary },
  note: { color: textTokens.tertiary, fontSize: 12 },
  fallback: { color: textTokens.primary, fontSize: 13, fontWeight: "600" },
});
