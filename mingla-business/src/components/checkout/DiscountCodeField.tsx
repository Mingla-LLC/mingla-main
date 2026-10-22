import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  discountReasonCopy,
  saleLimitedCopy,
  type TicketQuote,
} from "@mingla/offering-rendering/discountQuote";

import { useCart, type TicketQuoteStatus } from "./CartContext";

const money = (minor: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`.trim();
  }
};

export interface DiscountCodeFieldProps {
  value: string | null;
  quote: TicketQuote | null;
  quoteStatus: TicketQuoteStatus;
  quoteErrorCode?: string | null;
  disabled?: boolean;
  saleNameByLineRef?: Readonly<Record<string, string | null | undefined>>;
  onApply: (code: string) => void;
  onRemove: () => void;
}

/** W-CODE from the binding #3872 design contract. */
export const DiscountCodeField: React.FC<DiscountCodeFieldProps> = ({
  value,
  quote,
  quoteStatus,
  quoteErrorCode = null,
  disabled = false,
  saleNameByLineRef = {},
  onApply,
  onRemove,
}) => {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => setDraft(value ?? ""), [value]);

  const normalizedDraft = draft.replace(/[\s-]+/g, "").toUpperCase();
  const outcome = quote?.codeOutcome ?? null;
  const appliedDiscount = useMemo(
    () =>
      quote?.discounts.find(
        (discount) =>
          discount.kind === "code" &&
          (value === null || discount.code === value),
      ) ?? null,
    [quote, value],
  );
  const rejectedCopy =
    value !== null && outcome?.status === "rejected" && outcome.reason !== null
      ? discountReasonCopy({
        reason: outcome.reason,
        code: value,
        required:
          outcome.required === null
            ? null
            : money(outcome.required, quote?.currency ?? "USD"),
        withName: outcome.with,
      })
      : null;
  const saleNotice = quote?.notices.find(
    (notice) => notice.type === "sale_limited",
  ) ?? null;
  const saleName = saleNotice === null
    ? null
    : saleNameByLineRef[saleNotice.lineRef] ?? "sale";
  const applying = value !== null && quoteStatus === "loading";
  const rateLimited = quoteStatus === "error" && quoteErrorCode === "rate_limited";
  const canApply =
    normalizedDraft.length > 0 &&
    normalizedDraft !== value &&
    !disabled &&
    quoteStatus !== "loading";

  return (
    <View style={styles.wrap} testID="discount-code-field">
      <Text style={styles.label}>Discount code</Text>
      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={(next) => setDraft(next.toUpperCase())}
          placeholder="Enter code"
          placeholderTextColor="#7a8190"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={32}
          editable={!disabled && !applying}
          accessibilityLabel="Discount code"
          style={styles.input}
          onSubmitEditing={() => {
            if (canApply) onApply(normalizedDraft);
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply discount code"
          disabled={!canApply}
          onPress={() => onApply(normalizedDraft)}
          style={({ pressed }) => [
            styles.applyButton,
            !canApply && styles.buttonDisabled,
            pressed && canApply && styles.buttonPressed,
          ]}
        >
          {applying ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.applyText}>Apply</Text>
          )}
        </Pressable>
      </View>

      {applying ? (
        <Text style={styles.status} accessibilityLiveRegion="polite">
          Applying {value}…
        </Text>
      ) : null}

      {value !== null && outcome?.status === "applied" && appliedDiscount !== null ? (
        <View style={styles.appliedChip} accessibilityLiveRegion="polite">
          <View style={styles.appliedCopy}>
            <Text style={styles.appliedTitle}>
              {value} · {appliedDiscount.name}
            </Text>
            <Text style={styles.appliedSaving}>
              Saving {money(appliedDiscount.amountMinor, quote?.currency ?? "USD")}
            </Text>
            {outcome.replaced.length > 0 ? (
              <Text style={styles.replacedText}>
                {value} applied instead of {outcome.replaced.join(", ")}.
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${value}`}
            disabled={disabled}
            onPress={onRemove}
          >
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ) : null}

      {rejectedCopy !== null ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {rejectedCopy}
        </Text>
      ) : null}
      {rateLimited ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          Too many tries. Wait a few minutes.
        </Text>
      ) : null}
      {quoteStatus === "error" && !rateLimited ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          Couldn&apos;t get your price. Try again.
        </Text>
      ) : null}
      {saleNotice !== null && saleName !== null ? (
        <Text style={styles.noticeText} accessibilityRole="alert">
          {saleLimitedCopy(saleName, saleNotice.remaining)}
        </Text>
      ) : null}
    </View>
  );
};

export interface CheckoutDiscountCodeFieldProps {
  disabled?: boolean;
  saleNameByLineRef?: Readonly<Record<string, string | null | undefined>>;
}

/** Cart-bound convenience wrapper used by the three buyer-web funnels. */
export const CheckoutDiscountCodeField: React.FC<
  CheckoutDiscountCodeFieldProps
> = (props) => {
  const cart = useCart();
  return (
    <DiscountCodeField
      {...props}
      value={cart.discountCode}
      quote={cart.quote}
      quoteStatus={cart.quoteStatus}
      quoteErrorCode={cart.quoteErrorCode}
      onApply={cart.setDiscountCode}
      onRemove={() => cart.setDiscountCode(null)}
    />
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: "#ffffff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
  },
  label: { fontSize: 13, fontWeight: "700", color: "#252936" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#cfd3dc",
    borderRadius: 10,
    paddingHorizontal: 12,
    color: "#15181f",
    backgroundColor: "#ffffff",
  },
  applyButton: {
    minWidth: 76,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#eb7825",
    paddingHorizontal: 14,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.82 },
  applyText: { color: "#ffffff", fontWeight: "700" },
  status: { color: "#5f6572", fontSize: 13 },
  appliedChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#edf8f1",
  },
  appliedCopy: { flex: 1, gap: 2 },
  appliedTitle: { color: "#17623a", fontWeight: "700" },
  appliedSaving: { color: "#28724a", fontSize: 13 },
  replacedText: { color: "#28724a", fontSize: 13 },
  removeText: { color: "#9b3f13", fontWeight: "700" },
  errorText: { color: "#b42318", fontSize: 13 },
  noticeText: { color: "#8a4b08", fontSize: 13 },
});

