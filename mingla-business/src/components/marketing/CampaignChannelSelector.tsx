/**
 * CampaignChannelSelector — #3682 wave 2. "Also send by" chips: the other
 * channels this campaign goes out on together with the message being written.
 * Push is free; email and SMS show their remaining monthly allowance in the
 * review sheet.
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
import type { CampaignChannel } from "../../services/marketing/campaignChannelGroupService";

export const CHANNEL_LABEL: Record<CampaignChannel, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push",
};

export interface CampaignChannelSelectorProps {
  lead: CampaignChannel;
  selected: ReadonlySet<CampaignChannel>;
  onToggle: (channel: CampaignChannel) => void;
  /** Per-channel reason a chip cannot be ticked (e.g. audience has no accounts). */
  unavailable?: Partial<Record<CampaignChannel, string>>;
}

export const CampaignChannelSelector: React.FC<CampaignChannelSelectorProps> = ({
  lead,
  selected,
  onToggle,
  unavailable = {},
}) => {
  const others = (["email", "sms", "push"] as const).filter((channel) => channel !== lead);
  const notes = others.flatMap((channel) =>
    unavailable[channel] ? [`${CHANNEL_LABEL[channel]}: ${unavailable[channel]}`] : []
  );
  return (
    <View style={styles.host} testID="campaign-channel-selector">
      <Text style={styles.label}>ALSO SEND BY</Text>
      <View style={styles.row}>
        {others.map((channel) => {
          const disabled = unavailable[channel] !== undefined;
          const isOn = selected.has(channel) && !disabled;
          return (
            <Pressable
              key={channel}
              onPress={() => { if (!disabled) onToggle(channel); }}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityLabel={`Also send by ${CHANNEL_LABEL[channel]}`}
              accessibilityState={{ checked: isOn, disabled }}
              style={({ pressed }) => [
                styles.chip,
                isOn ? styles.chipOn : null,
                disabled ? styles.chipDisabled : null,
                pressed && !disabled ? styles.chipPressed : null,
              ]}
            >
              <Text style={[styles.chipText, isOn ? styles.chipTextOn : null]}>
                {`${isOn ? "✓ " : ""}${CHANNEL_LABEL[channel]}${channel === "push" ? " · free" : ""}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {notes.map((note) => <Text key={note} style={styles.note}>{note}</Text>)}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { marginHorizontal: spacing.md, marginTop: spacing.sm, gap: spacing.xs },
  label: { ...typography.labelCap, color: textTokens.tertiary },
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
});
