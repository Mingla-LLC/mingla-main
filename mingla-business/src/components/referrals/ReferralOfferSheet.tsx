import React from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import {
  accent,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import type {
  ReferralAudience,
  ReferralListing,
  ReferralListingOption,
  ReferralOffer,
  ReferralOfferDraft,
  ReferralRewardKind,
  ReferralTier,
} from "../../services/referralService";
import { Button } from "../ui/Button";

const AUDIENCES: {
  value: ReferralAudience;
  title: string;
  copy: string;
}[] = [
  {
    value: "buyers",
    title: "Every buyer",
    copy: "Give buyers a personal link after checkout.",
  },
  {
    value: "invited",
    title: "Invited promoters",
    copy: "Invite a private team by email.",
  },
  {
    value: "both",
    title: "Buyers + promoters",
    copy: "Run both groups under one offer.",
  },
];
const REWARDS: {
  value: ReferralRewardKind;
  title: string;
  copy: string;
}[] = [
  {
    value: "cash",
    title: "Cash share",
    copy: "Pay a percentage of eligible sales.",
  },
  {
    value: "voucher",
    title: "Voucher",
    copy: "Issue a host-funded discount for a future order.",
  },
  {
    value: "perk",
    title: "Perk",
    copy: "Unlock a host-fulfilled reward after enough sales.",
  },
];
const selectedListing = (
  rows: ReferralListing[],
  option: ReferralListingOption,
) =>
  rows.some(
    (row) =>
      row.listingKind === option.listingKind &&
      row.listingId === option.listingId,
  );

export interface ReferralOfferSheetProps {
  visible: boolean;
  brandId: string;
  rank: number;
  currency: string;
  offer?: ReferralOffer | null;
  listings: ReferralListingOption[];
  onClose: () => void;
  onSave: (draft: ReferralOfferDraft) => Promise<void>;
}

export const ReferralOfferSheet: React.FC<ReferralOfferSheetProps> = ({
  visible,
  brandId,
  rank,
  currency,
  offer,
  listings,
  onClose,
  onSave,
}) => {
  const { width } = useWindowDimensions();
  const [name, setName] = React.useState("");
  const [audience, setAudience] = React.useState<ReferralAudience>("buyers");
  const [rewardKind, setRewardKind] =
    React.useState<ReferralRewardKind>("cash");
  const [sharePercent, setSharePercent] = React.useState("10");
  const [voucherPercent, setVoucherPercent] = React.useState("10");
  const [voucherDays, setVoucherDays] = React.useState("30");
  const [perkText, setPerkText] = React.useState("");
  const [perkThreshold, setPerkThreshold] = React.useState("5");
  const [budget, setBudget] = React.useState("");
  const [scope, setScope] = React.useState<"brand" | "listings">("brand");
  const [targets, setTargets] = React.useState<ReferralListing[]>([]);
  const [tiers, setTiers] = React.useState<ReferralTier[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setName(offer?.name ?? "");
    setAudience(offer?.audience ?? "buyers");
    setRewardKind(offer?.rewardKind ?? "cash");
    setSharePercent(String((offer?.shareBps ?? 1000) / 100));
    const template = offer?.voucherTemplate;
    setVoucherPercent(String(Number(template?.value_bps ?? 1000) / 100));
    setVoucherDays(String(template?.expires_days ?? 30));
    setPerkText(offer?.perkText ?? "");
    setPerkThreshold(String(offer?.perkThreshold ?? 5));
    setBudget(
      offer?.budgetMinor == null ? "" : String(offer.budgetMinor / 100),
    );
    setScope(offer?.scopeKind ?? "brand");
    setTargets(offer?.listings ?? []);
    setTiers(offer?.tiers ?? []);
  }, [offer, visible]);

  const cashBps = Math.round(Number(sharePercent) * 100);
  const canCash = rank >= 30;
  const rewardPreview =
    rewardKind === "cash"
      ? `A promoter earns ${formatCurrency(Math.round((24000 * cashBps) / 10000), currency, true)} on an eligible ${formatCurrency(24000, currency, true)} order.`
      : rewardKind === "voucher"
        ? `A qualifying referral unlocks ${voucherPercent}% off a future order for ${voucherDays} days.`
        : `${perkText || "The perk"} unlocks after ${perkThreshold || "0"} qualifying sales.`;

  const toggleListing = (option: ReferralListingOption) =>
    setTargets((current) =>
      selectedListing(current, option)
        ? current.filter(
            (row) =>
              !(
                row.listingKind === option.listingKind &&
                row.listingId === option.listingId
              ),
          )
        : [
            ...current,
            { listingKind: option.listingKind, listingId: option.listingId },
          ],
    );

  const applyPreset = (
    preset: "buyer_cash" | "buyer_voucher" | "promoter_perk",
  ) => {
    setTargets([]);
    setScope("brand");
    setBudget("");
    setTiers([]);
    if (preset === "buyer_cash") {
      setName("Buyer street team");
      setAudience("buyers");
      setRewardKind("cash");
      setSharePercent("10");
      return;
    }
    if (preset === "buyer_voucher") {
      setName("Share & save");
      setAudience("buyers");
      setRewardKind("voucher");
      setVoucherPercent("10");
      setVoucherDays("30");
      return;
    }
    setName("Invited promoter perk");
    setAudience("invited");
    setRewardKind("perk");
    setPerkText("Host thank-you perk");
    setPerkThreshold("5");
  };

  const save = async () => {
    if (name.trim().length < 1)
      return Alert.alert(
        "Name this offer",
        "Use a short name your team will recognise.",
      );
    if (scope === "listings" && targets.length === 0)
      return Alert.alert("Choose a listing", "Select at least one listing.");
    if (
      rewardKind === "cash" &&
      (!canCash || !Number.isFinite(cashBps) || cashBps < 100 || cashBps > 5000)
    ) {
      return Alert.alert(
        "Check the cash share",
        canCash
          ? "Choose between 1% and 50%."
          : "A finance manager must create cash offers.",
      );
    }
    const voucherBps = Math.round(Number(voucherPercent) * 100);
    const days = Number(voucherDays);
    if (
      rewardKind === "voucher" &&
      (!Number.isFinite(voucherBps) ||
        !Number.isInteger(days) ||
        voucherBps < 1 ||
        voucherBps > 10000 ||
        days < 1 ||
        days > 365)
    ) {
      return Alert.alert(
        "Check the voucher",
        "Choose a valid percentage and an expiry from 1 to 365 days.",
      );
    }
    if (
      rewardKind === "perk" &&
      (!perkText.trim() ||
        !Number.isInteger(Number(perkThreshold)) ||
        Number(perkThreshold) < 1)
    ) {
      return Alert.alert(
        "Describe the perk",
        "Say what unlocks and after how many sales.",
      );
    }
    const budgetMinor = budget.trim() ? Math.round(Number(budget) * 100) : null;
    if (
      budgetMinor !== null &&
      (!Number.isFinite(budgetMinor) || budgetMinor < 1)
    ) {
      return Alert.alert(
        "Check the budget",
        "Enter a positive amount or leave it empty for no cap.",
      );
    }
    if (rewardKind === "cash") {
      const invalidTier = tiers.some(
        (tier, index) =>
          !Number.isInteger(tier.minSales) ||
          tier.minSales < 1 ||
          !Number.isInteger(tier.shareBps) ||
          tier.shareBps < 100 ||
          tier.shareBps > 5000 ||
          (index > 0 && tier.minSales <= tiers[index - 1].minSales),
      );
      if (invalidTier)
        return Alert.alert(
          "Check the tiers",
          "Sales thresholds must increase, and every share must be between 1% and 50%.",
        );
    }
    setSaving(true);
    try {
      await onSave({
        id: offer?.id,
        brandId,
        name: name.trim(),
        audience,
        scopeKind: scope,
        rewardKind,
        shareBps: rewardKind === "cash" ? cashBps : null,
        voucherTemplate:
          rewardKind === "voucher"
            ? {
                value_type: "percent",
                value_bps: voucherBps,
                scope: "brand",
                expires_days: days,
              }
            : null,
        perkText: rewardKind === "perk" ? perkText.trim() : null,
        perkThreshold: rewardKind === "perk" ? Number(perkThreshold) : null,
        buyerDiscountId: null,
        budgetMinor,
        currency,
        startsAt: offer?.startsAt ?? new Date().toISOString(),
        endsAt: offer?.endsAt ?? null,
        status: offer?.status === "draft" ? "draft" : "active",
        version: offer?.version,
        listings: scope === "brand" ? [] : targets,
        tiers:
          rewardKind === "cash"
            ? tiers.map(({ minSales, shareBps }) => ({ minSales, shareBps }))
            : [],
      });
      onClose();
    } catch (error) {
      Alert.alert(
        "Couldn’t save the offer",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={width >= 900}
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, width < 900 && styles.overlayMobile]}>
        <View style={[styles.sheet, width < 900 && styles.sheetMobile]}>
          <View style={styles.header}>
            <View style={styles.grow}>
              <Text style={styles.title}>
                {offer ? "Edit referral offer" : "Create referral offer"}
              </Text>
              <Text style={styles.help}>
                Decide who can share and exactly what they earn.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close offer editor"
            >
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.section}>
              <Text style={styles.label}>Start from a preset</Text>
              <Text style={styles.help}>
                Choose a common setup, then adjust every field before saving.
              </Text>
              <View style={styles.cards}>
                <ChoiceCard
                  title="Buyer cash share"
                  copy="10% of eligible sales for every buyer who shares."
                  selected={false}
                  disabled={!canCash}
                  onPress={() => applyPreset("buyer_cash")}
                />
                <ChoiceCard
                  title="Buyer voucher"
                  copy="10% off a future order, valid for 30 days."
                  selected={false}
                  onPress={() => applyPreset("buyer_voucher")}
                />
                <ChoiceCard
                  title="Invited promoter perk"
                  copy="A host-defined perk after five qualifying sales."
                  selected={false}
                  onPress={() => applyPreset("promoter_perk")}
                />
              </View>
            </View>
            <Field label="Offer name">
              <TextInput
                value={name}
                onChangeText={setName}
                style={styles.input}
                placeholder="Harmattan street team"
                placeholderTextColor={textTokens.tertiary}
                maxLength={60}
              />
            </Field>
            <ChoiceGroup
              label="Who can earn"
              rows={AUDIENCES}
              value={audience}
              onChange={(value) => setAudience(value as ReferralAudience)}
            />
            <ChoiceGroup
              label="Reward"
              rows={REWARDS}
              value={rewardKind}
              onChange={(value) => setRewardKind(value as ReferralRewardKind)}
              disabledValue={!canCash ? "cash" : undefined}
            />
            {rewardKind === "cash" ? (
              <>
                <Field label="Share of eligible sales">
                  <View style={styles.inline}>
                    <TextInput
                      value={sharePercent}
                      onChangeText={setSharePercent}
                      keyboardType="decimal-pad"
                      style={[styles.input, styles.smallInput]}
                    />
                    <Text style={styles.suffix}>%</Text>
                  </View>
                </Field>
                <Text style={styles.help}>
                  Provider transfer fees are deducted from the payee’s payout,
                  not added to the buyer’s total.
                </Text>
                <View style={styles.section}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.label}>Sales tiers</Text>
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Add tier"
                      onPress={() =>
                        setTiers((rows) =>
                          rows.length >= 5
                            ? rows
                            : [
                                ...rows,
                                {
                                  minSales: 10,
                                  shareBps: Math.min(5000, cashBps + 500),
                                },
                              ],
                        )
                      }
                    />
                  </View>
                  {tiers.map((tier, index) => (
                    <View key={index} style={styles.tierRow}>
                      <TextInput
                        accessibilityLabel={`Tier ${index + 1} sales`}
                        value={String(tier.minSales)}
                        onChangeText={(value) =>
                          setTiers((rows) =>
                            rows.map((row, i) =>
                              i === index
                                ? { ...row, minSales: Number(value) }
                                : row,
                            ),
                          )
                        }
                        keyboardType="number-pad"
                        style={[styles.input, styles.tierInput]}
                      />
                      <Text style={styles.help}>sales →</Text>
                      <TextInput
                        accessibilityLabel={`Tier ${index + 1} percent`}
                        value={String(tier.shareBps / 100)}
                        onChangeText={(value) =>
                          setTiers((rows) =>
                            rows.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    shareBps: Math.round(Number(value) * 100),
                                  }
                                : row,
                            ),
                          )
                        }
                        keyboardType="decimal-pad"
                        style={[styles.input, styles.tierInput]}
                      />
                      <Text style={styles.help}>%</Text>
                      <Pressable
                        onPress={() =>
                          setTiers((rows) => rows.filter((_, i) => i !== index))
                        }
                      >
                        <Text style={styles.remove}>Remove</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
            {rewardKind === "voucher" ? (
              <View style={styles.twoCols}>
                <Field label="Voucher value">
                  <View style={styles.inline}>
                    <TextInput
                      value={voucherPercent}
                      onChangeText={setVoucherPercent}
                      keyboardType="decimal-pad"
                      style={[styles.input, styles.smallInput]}
                    />
                    <Text style={styles.suffix}>%</Text>
                  </View>
                </Field>
                <Field label="Expires after">
                  <View style={styles.inline}>
                    <TextInput
                      value={voucherDays}
                      onChangeText={setVoucherDays}
                      keyboardType="number-pad"
                      style={[styles.input, styles.smallInput]}
                    />
                    <Text style={styles.suffix}>days</Text>
                  </View>
                </Field>
              </View>
            ) : null}
            {rewardKind === "perk" ? (
              <View style={styles.twoCols}>
                <Field label="Perk">
                  <TextInput
                    value={perkText}
                    onChangeText={setPerkText}
                    style={styles.input}
                    placeholder="Free drink"
                    placeholderTextColor={textTokens.tertiary}
                    maxLength={80}
                  />
                </Field>
                <Field label="Unlocks after">
                  <View style={styles.inline}>
                    <TextInput
                      value={perkThreshold}
                      onChangeText={setPerkThreshold}
                      keyboardType="number-pad"
                      style={[styles.input, styles.smallInput]}
                    />
                    <Text style={styles.suffix}>sales</Text>
                  </View>
                </Field>
              </View>
            ) : null}
            <Field label="Maximum reward budget (optional)">
              <View style={styles.inline}>
                <Text style={styles.suffix}>{currency}</Text>
                <TextInput
                  value={budget}
                  onChangeText={setBudget}
                  keyboardType="decimal-pad"
                  style={styles.input}
                  placeholder="No cap"
                  placeholderTextColor={textTokens.tertiary}
                />
              </View>
            </Field>
            <View style={styles.section}>
              <Text style={styles.label}>Where it works</Text>
              <View style={styles.cards}>
                {(
                  [
                    {
                      value: "brand",
                      title: "Every listing",
                      copy: "Apply this offer across the brand.",
                    },
                    {
                      value: "listings",
                      title: "Chosen listings",
                      copy: "Select the exact events or venues.",
                    },
                  ] as const
                ).map((row) => (
                  <ChoiceCard
                    key={row.value}
                    {...row}
                    selected={scope === row.value}
                    onPress={() => setScope(row.value)}
                  />
                ))}
              </View>
              {scope === "listings" ? (
                <View style={styles.listings}>
                  {listings.length === 0 ? (
                    <Text style={styles.help}>No eligible listings yet.</Text>
                  ) : (
                    listings.map((option) => {
                      const checked = selectedListing(targets, option);
                      return (
                        <Pressable
                          key={`${option.listingKind}:${option.listingId}`}
                          onPress={() => toggleListing(option)}
                          style={[styles.listing, checked && styles.selected]}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                        >
                          <Text style={styles.check}>{checked ? "✓" : ""}</Text>
                          <View style={styles.grow}>
                            <Text style={styles.cardTitle}>{option.label}</Text>
                            <Text style={styles.help}>{option.typeLabel}</Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              ) : null}
            </View>
            <View style={styles.preview}>
              <Text style={styles.previewLabel}>
                What people will understand
              </Text>
              <Text style={styles.previewText}>{rewardPreview}</Text>
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Button variant="secondary" label="Cancel" onPress={onClose} />
            <Button
              label={saving ? "Saving…" : "Save offer"}
              disabled={saving}
              onPress={() => void save()}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {children}
  </View>
);
const ChoiceCard: React.FC<{
  title: string;
  copy: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}> = ({ title, copy, selected, disabled, onPress }) => (
  <Pressable
    disabled={disabled}
    onPress={onPress}
    accessibilityRole="radio"
    accessibilityState={{ checked: selected, disabled }}
    style={[
      styles.card,
      selected && styles.selected,
      disabled && styles.disabled,
    ]}
  >
    <View style={[styles.radio, selected && styles.radioOn]}>
      {selected ? <View style={styles.dot} /> : null}
    </View>
    <View style={styles.grow}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.help}>{copy}</Text>
    </View>
  </Pressable>
);
const ChoiceGroup: React.FC<{
  label: string;
  rows: { value: string; title: string; copy: string }[];
  value: string;
  onChange: (value: string) => void;
  disabledValue?: string;
}> = ({ label, rows, value, onChange, disabledValue }) => (
  <View style={styles.section}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.cards}>
      {rows.map((row) => (
        <ChoiceCard
          key={row.value}
          title={row.title}
          copy={row.copy}
          selected={value === row.value}
          disabled={disabledValue === row.value}
          onPress={() => onChange(row.value)}
        />
      ))}
    </View>
  </View>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  overlayMobile: { backgroundColor: canvas.profile },
  sheet: {
    width: 760,
    maxWidth: "100%",
    maxHeight: "100%",
    backgroundColor: canvas.profile,
    borderLeftWidth: 1,
    borderColor: glass.border.control,
  },
  sheetMobile: { width: "100%", flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderColor: glass.border.control,
    gap: spacing.md,
  },
  title: { color: textTokens.primary, fontSize: 22, fontWeight: "800" },
  close: { color: accent.warm, fontWeight: "700", padding: spacing.xs },
  content: { padding: spacing.lg, gap: spacing.lg },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderColor: glass.border.control,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  field: { gap: spacing.xs },
  section: { gap: spacing.sm },
  label: { color: textTokens.primary, fontWeight: "700", fontSize: 14 },
  help: { color: textTokens.secondary, fontSize: 13, lineHeight: 18 },
  input: {
    minHeight: 44,
    flex: 1,
    color: textTokens.primary,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  smallInput: { flex: 0, width: 100 },
  inline: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  suffix: { color: textTokens.secondary, fontWeight: "600" },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: {
    minWidth: 190,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.control,
    backgroundColor: glass.tint.profileBase,
  },
  selected: {
    borderColor: accent.warm,
    backgroundColor: "rgba(249,115,22,0.10)",
  },
  disabled: { opacity: 0.45 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: accent.warm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: accent.warm },
  cardTitle: { color: textTokens.primary, fontWeight: "700" },
  grow: { flex: 1 },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tierInput: { flex: 0, width: 76 },
  remove: { color: "#ef4444", fontWeight: "700", padding: spacing.xs },
  twoCols: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  listings: { gap: spacing.xs },
  listing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.control,
  },
  check: { width: 20, color: accent.warm, fontWeight: "800" },
  preview: {
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: "rgba(249,115,22,0.12)",
    borderWidth: 1,
    borderColor: accent.warm,
  },
  previewLabel: {
    color: accent.warm,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  previewText: {
    color: textTokens.primary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
});
