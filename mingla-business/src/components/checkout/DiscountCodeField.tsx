import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  codeLimitedNotices,
  saleLimitedCopy,
} from "@mingla/offering-rendering/saleLimitedCopy";
import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import {
  neutralControl,
  themeTextAccent,
  type ThemePalette,
} from "@mingla/offering-rendering/themePalette";

import { radius, color, space } from "../../constants/designSystem";
import { useCart, type TicketQuoteStatus } from "./CartContext";
import { captureDiscountEvent } from "../../analytics/discountAnalytics";

const DiscountReasonText = React.lazy(() =>
  import("@mingla/offering-rendering/DiscountReasonText").then((module) => ({
    default: module.DiscountReasonText,
  })),
);

export type BuyerDiscountSurface =
  "web_event" | "web_experience" | "web_trip" | "web_venue" | "web_deposit";

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
  surface?: BuyerDiscountSurface;
  saleNameByLineRef?: Readonly<Record<string, string | null | undefined>>;
  /**
   * #4624 item 6 — the buyer's own number per ticket type (null when picked
   * date by date), so a per-day notice can say what to lower to.
   */
  pickerQuantityByLineRef?: Readonly<Record<string, number | null | undefined>>;
  onApply: (code: string) => void;
  onRemove: () => void;
  /**
   * #4304 — narrow screens show one quiet "Have a code?" row that expands
   * into the field. Wide desktop keeps the field open in the order summary.
   */
  collapsible?: boolean;
  /**
   * issue #4420 wave 2 (D-C3) — the host's palette, COLOURS ONLY: the field
   * sits on the page's card, borders take the neutral control line and
   * Apply becomes a tonal button. Absent ⇒ byte-identical to before.
   */
  palette?: ThemePalette;
}

/** W-CODE from the binding #3872 design contract. */
export const DiscountCodeField: React.FC<DiscountCodeFieldProps> = ({
  value,
  quote,
  quoteStatus,
  quoteErrorCode = null,
  disabled = false,
  surface = "web_event",
  saleNameByLineRef = {},
  pickerQuantityByLineRef,
  onApply,
  onRemove,
  collapsible = false,
  palette,
}) => {
  const themed =
    palette === undefined
      ? null
      : {
          input: {
            backgroundColor: palette.card,
            borderColor: neutralControl(palette),
            color: palette.primaryText,
          },
          inputFocused: { borderColor: themeTextAccent(palette) },
          apply: { backgroundColor: palette.accentWash },
          applyText: { color: palette.primaryText },
          label: { color: palette.secondaryText },
          status: { color: palette.tertiaryText },
          placeholder: palette.tertiaryText,
        };
  const [draft, setDraft] = useState(value ?? "");
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const userExpandedRef = useRef(false);

  useEffect(() => setDraft(value ?? ""), [value]);
  useEffect(() => {
    if (!expanded || userExpandedRef.current) return;
    userExpandedRef.current = true;
    inputRef.current?.focus();
  }, [expanded]);

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
  const saleNotice =
    quote?.notices.find(
      (notice) =>
        notice.type === "sale_limited" && notice.discountKind !== "code",
    ) ?? null;
  // #4624 D1a: a ticket-capped code with fewer tickets left than a line holds
  // leaves that line at full price. The applied chip hides when the code
  // saved nothing (no code row in quote.discounts); one notice per line, in
  // quote line order, names the ticket type when the basket has two (item 6).
  const codeNotices = useMemo(
    () =>
      value === null || quote === null
        ? []
        : codeLimitedNotices(quote, pickerQuantityByLineRef),
    [pickerQuantityByLineRef, quote, value],
  );
  const saleName =
    saleNotice === null
      ? null
      : (saleNameByLineRef[saleNotice.lineRef] ?? "sale");
  const applying = value !== null && quoteStatus === "loading";
  const rateLimited =
    quoteStatus === "error" && quoteErrorCode === "rate_limited";
  const canApply =
    normalizedDraft.length > 0 &&
    normalizedDraft !== value &&
    !disabled &&
    // #4304 — only an in-flight CODE blocks Apply. A price refresh for a ticket
    // just added must not swallow the tap: the quote re-runs with the code.
    !applying;
  const capturedRef = useRef(new Set<string>());

  useEffect(() => {
    if (quote === null || quoteStatus !== "ready") return;
    const captureOnce = (
      event: string,
      suffix: string,
      properties: Readonly<Record<string, string | number>>,
    ): void => {
      const key = `${quote.quoteDigest}:${event}:${suffix}`;
      if (capturedRef.current.has(key)) return;
      capturedRef.current.add(key);
      captureDiscountEvent(event, properties);
    };
    if (value !== null && quote.codeOutcome.status === "applied") {
      captureOnce("discount_code_applied", "code", { surface });
    }
    if (
      value !== null &&
      quote.codeOutcome.status === "rejected" &&
      quote.codeOutcome.reason !== null
    ) {
      captureOnce("discount_code_rejected", quote.codeOutcome.reason, {
        reason: quote.codeOutcome.reason,
        surface,
      });
    }
    const automaticCount = quote.discounts.filter(
      (row) => row.kind === "automatic",
    ).length;
    if (automaticCount > 0) {
      captureOnce("discount_auto_applied", String(automaticCount), {
        count: automaticCount,
        surface,
      });
    }
    if (saleNotice !== null) {
      captureOnce("sale_limited_shown", saleNotice.discountId, { surface });
    }
    for (const notice of codeNotices) {
      captureOnce("discount_code_limited_shown", notice.key, { surface });
    }
  }, [codeNotices, quote, quoteStatus, saleNotice, surface, value]);

  const showField = !collapsible || expanded || value !== null;
  // #4304 — the field is ALWAYS typeable. Before, `disabled` (an empty cart)
  // made the input read-only with no visual cue, so a desktop buyer who
  // arrived from "Get tickets" with nothing selected clicked a live-looking
  // field and nothing typed. Only Apply waits for a selection now.
  const needsSelection = disabled && normalizedDraft.length > 0;

  if (!showField) {
    return (
      <View style={styles.collapsedRow} testID="discount-code-field">
        <Text style={styles.collapsedLabel}>Have a code?</Text>
        <Pressable
          testID="discount-code-toggle"
          accessibilityRole="button"
          accessibilityLabel="Add discount code"
          hitSlop={8}
          onPress={() => setExpanded(true)}
          style={({ pressed }) => [
            styles.addCodeButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.addCodeText}>Add code</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="discount-code-field">
      {value !== null &&
      outcome?.status === "applied" &&
      appliedDiscount !== null ? (
        <View
          style={styles.appliedChip}
          testID="discount-code-applied"
          accessibilityLiveRegion="polite"
        >
          <View style={styles.appliedCopy}>
            <Text style={styles.appliedTitle}>
              {value} · {appliedDiscount.name}
            </Text>
            <Text style={styles.appliedSaving}>
              Saving{" "}
              {money(appliedDiscount.amountMinor, quote?.currency ?? "USD")}
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
            hitSlop={8}
            onPress={onRemove}
          >
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={[styles.label, themed?.label]}>Discount code</Text>
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={(next) => setDraft(next.toUpperCase())}
              placeholder="Enter code"
              placeholderTextColor={themed?.placeholder ?? color.text4}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={32}
              editable={!applying}
              accessibilityLabel="Discount code"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={[
                styles.input,
                themed?.input,
                focused && styles.inputFocused,
                focused && themed?.inputFocused,
              ]}
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
                themed?.apply,
                !canApply && styles.buttonDisabled,
                pressed && canApply && styles.buttonPressed,
              ]}
            >
              {applying ? (
                <ActivityIndicator
                  color={themed?.applyText.color ?? color.textStrong}
                  size="small"
                />
              ) : (
                <Text style={[styles.applyText, themed?.applyText]}>Apply</Text>
              )}
            </Pressable>
          </View>
        </>
      )}

      {needsSelection ? (
        <Text style={styles.status} testID="discount-code-needs-selection">
          Choose what you&apos;re buying first, then apply your code.
        </Text>
      ) : null}

      {applying ? (
        <Text style={styles.status} accessibilityLiveRegion="polite">
          Applying {value}…
        </Text>
      ) : null}

      {value !== null &&
      outcome?.status === "rejected" &&
      outcome.reason !== null ? (
        <React.Suspense fallback={null}>
          <DiscountReasonText
            style={styles.errorText}
            input={{
              reason: outcome.reason,
              code: value,
              required:
                outcome.required === null
                  ? null
                  : money(outcome.required, quote?.currency ?? "USD"),
              withName: outcome.with,
            }}
          />
        </React.Suspense>
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
      {codeNotices.map((notice) => (
        <Text
          key={notice.key}
          style={styles.noticeText}
          accessibilityRole="alert"
          testID={`discount-code-limited-${notice.lineRef}`}
        >
          {notice.text}
        </Text>
      ))}
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
  /** issue #4420 wave 2 (D-C3) — see DiscountCodeFieldProps.palette. */
  palette?: ThemePalette;
  collapsible?: boolean;
  surface?: BuyerDiscountSurface;
  saleNameByLineRef?: Readonly<Record<string, string | null | undefined>>;
}

/** Cart-bound convenience wrapper used by the three buyer-web funnels. */
export const CheckoutDiscountCodeField: React.FC<
  CheckoutDiscountCodeFieldProps
> = (props) => {
  const cart = useCart();
  // #4624 item 6 — the buyer's own number per ticket type; a line picked date
  // by date has no single number to lower to.
  const pickerQuantityByLineRef = useMemo(
    () =>
      Object.fromEntries(
        cart.lines.map((line) => [
          line.ticketTypeId,
          line.byDate !== undefined ? null : line.quantity,
        ]),
      ),
    [cart.lines],
  );
  return (
    <DiscountCodeField
      {...props}
      pickerQuantityByLineRef={pickerQuantityByLineRef}
      value={cart.discountCode}
      quote={cart.quote}
      quoteStatus={cart.quoteStatus}
      quoteErrorCode={cart.quoteErrorCode}
      onApply={cart.setDiscountCode}
      onRemove={() => cart.setDiscountCode(null)}
    />
  );
};

// #4304 — dark field for the dark checkout bar / summary (no hard-coded
// white): raised surface, 10% white hairline, orange focus ring, green
// applied chip.
const SURFACE = color.card;
const HAIRLINE = color.lineStrong;

const styles = StyleSheet.create({
  wrap: {
    gap: space[2],
    paddingBottom: space[2] + space[1],
  },
  collapsedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginBottom: space[1],
  },
  collapsedLabel: { fontSize: 13, color: color.text3 },
  addCodeButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[1],
  },
  addCodeText: { fontSize: 14, fontWeight: "700", color: color.accent },
  label: { fontSize: 12, fontWeight: "600", color: color.text2 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: radius.sm + 2,
    paddingHorizontal: space[2] + space[1],
    color: color.text1,
    backgroundColor: SURFACE,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 1,
  },
  inputFocused: { borderColor: color.accent },
  applyButton: {
    minWidth: 76,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm + 2,
    backgroundColor: color.accent,
    paddingHorizontal: space[2] + space[1] + 2,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.82 },
  applyText: { color: color.textStrong, fontWeight: "700" },
  status: { color: color.text3, fontSize: 13 },
  appliedChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2] + space[1],
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    borderColor: color.success,
    paddingVertical: space[2] + 2,
    paddingHorizontal: space[2] + space[1],
    backgroundColor: color.successTint,
  },
  appliedCopy: { flex: 1, gap: 2 },
  appliedTitle: { color: color.successText, fontWeight: "700" },
  appliedSaving: { color: color.successText, fontSize: 13 },
  replacedText: { color: color.successText, fontSize: 13 },
  removeText: { color: color.text2, fontWeight: "700" },
  errorText: { color: color.errorText, fontSize: 13 },
  noticeText: { color: color.warning, fontSize: 13 },
});
