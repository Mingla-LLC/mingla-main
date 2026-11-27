/**
 * Issue #4624 item 1 — the Explorer cart's discount notices, one per quote
 * notice, lifted out of TicketCartSheet so they can be rendered and tested on
 * their own.
 *
 * - A sale or automatic notice (no discountKind) keeps its #3872 copy and
 *   buttons exactly: "Only N left at the {sale} price.", "Buy N at {sale}",
 *   "Keep N at list".
 * - A ticket-capped code notice (discountKind "code") never says "sale": it
 *   uses codeLimitedCopy (naming the ticket type in a basket with two or more
 *   types) with "Lower to N" (only when a whole number fits, the ticket row is
 *   known and the line is not picked date by date) and "Keep N at full price".
 * - Keep hides that one notice: the key is `${discountId}:${lineRef}`, so the
 *   same discount's notice on another line keeps showing.
 */
import React from "react";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  codeLimitedNotices,
  saleLimitedCopy,
} from "@mingla/offering-rendering/saleLimitedCopy";
import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";

export type CartNoticeKind = "code" | "sale";

export interface CartDiscountNoticeStyles {
  notice: StyleProp<ViewStyle>;
  text: StyleProp<TextStyle>;
  actions: StyleProp<ViewStyle>;
  button: StyleProp<ViewStyle>;
  buttonText: StyleProp<TextStyle>;
}

type Translate = (
  key: string,
  options: Record<string, string | number>,
) => string;

export interface CartDiscountNoticesProps {
  quote: Pick<TicketQuote, "lines" | "notices" | "discounts">;
  /** Keys `${discountId}:${lineRef}` the buyer chose to keep at full price. */
  dismissedKeys: readonly string[];
  /** Tickets are picked date by date: there is no single number to lower to. */
  perDateActive: boolean;
  /** The buyer's own number per ticket type (people, before per-day days). */
  pickerQuantityByLineRef: Readonly<Record<string, number | null | undefined>>;
  /** The cart row for a ticket type, when the sheet knows it. */
  hasTicket: (lineRef: string) => boolean;
  /** The ticket row's own sale name, used when the quote has none. */
  ticketSaleName: (lineRef: string) => string | null | undefined;
  onLower: (lineRef: string, quantity: number, kind: CartNoticeKind) => void;
  onKeep: (key: string, kind: CartNoticeKind) => void;
  t: Translate;
  styles: CartDiscountNoticeStyles;
}

export const noticeKey = (notice: { discountId: string; lineRef: string }): string =>
  `${notice.discountId}:${notice.lineRef}`;

export function CartDiscountNotices({
  quote,
  dismissedKeys,
  perDateActive,
  pickerQuantityByLineRef,
  hasTicket,
  ticketSaleName,
  onLower,
  onKeep,
  t,
  styles,
}: CartDiscountNoticesProps): React.ReactElement {
  const codeModels = new Map(
    codeLimitedNotices(quote, pickerQuantityByLineRef).map((model) => [
      model.key,
      model,
    ]),
  );
  const visible = quote.notices.filter(
    (notice) => !dismissedKeys.includes(noticeKey(notice)),
  );
  return (
    <>
      {visible.map((notice) => {
        const key = noticeKey(notice);
        const quoteLine = quote.lines.find(
          (line) => line.ticketTypeId === notice.lineRef,
        );
        const code = notice.discountKind === "code" ? codeModels.get(key) : undefined;
        if (code !== undefined) {
          const picker = pickerQuantityByLineRef[notice.lineRef];
          const keepCount =
            typeof picker === "number" && picker > 0
              ? picker
              : (quoteLine?.quantity ?? 0);
          const canLower =
            code.lowerTo !== null &&
            code.lowerTo >= 1 &&
            hasTicket(notice.lineRef) &&
            !perDateActive;
          return (
            <View key={key} style={styles.notice} testID={`cart-code-notice-${notice.lineRef}`}>
              <Text style={styles.text} accessibilityRole="alert">
                {code.text}
              </Text>
              <View style={styles.actions}>
                {canLower && code.lowerTo !== null ? (
                  <Pressable
                    onPress={() => onLower(notice.lineRef, code.lowerTo ?? 0, "code")}
                    accessibilityRole="button"
                    style={styles.button}
                    testID={`cart-code-notice-lower-${notice.lineRef}`}
                  >
                    <Text style={styles.buttonText}>
                      {t("code_limited.lower", {
                        count: code.lowerTo,
                        defaultValue: `Lower to ${code.lowerTo}`,
                      })}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => onKeep(key, "code")}
                  accessibilityRole="button"
                  style={styles.button}
                  testID={`cart-code-notice-keep-${notice.lineRef}`}
                >
                  <Text style={styles.buttonText}>
                    {t("code_limited.keep", {
                      count: keepCount,
                      defaultValue: `Keep ${keepCount} at full price`,
                    })}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        }
        const sale = quote.discounts.find(
          (discount) => discount.discountId === notice.discountId,
        );
        const name = sale?.name ?? ticketSaleName(notice.lineRef) ?? "sale";
        const currentQuantity = quoteLine?.quantity ?? 0;
        return (
          <View key={key} style={styles.notice} testID={`cart-sale-notice-${notice.lineRef}`}>
            <Text style={styles.text}>
              {saleLimitedCopy(name, notice.remaining)}
            </Text>
            <View style={styles.actions}>
              {notice.remaining > 0 &&
              hasTicket(notice.lineRef) &&
              !perDateActive ? (
                <Pressable
                  onPress={() => onLower(notice.lineRef, notice.remaining, "sale")}
                  accessibilityRole="button"
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>
                    {t("sale_limited.buy", {
                      count: notice.remaining,
                      sale: name,
                      defaultValue: `Buy ${notice.remaining} at ${name}`,
                    })}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => onKeep(key, "sale")}
                accessibilityRole="button"
                style={styles.button}
              >
                <Text style={styles.buttonText}>
                  {t("sale_limited.keep", {
                    count: currentQuantity,
                    defaultValue: `Keep ${currentQuantity} at list`,
                  })}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </>
  );
}
