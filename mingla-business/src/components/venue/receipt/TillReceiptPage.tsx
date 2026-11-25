/**
 * #4490 spec 08 O1 (T20) — `/receipt/till/<paymentId>#t=<token>`: the guest's
 * receipt for an in-person sale. ANONYMOUS (never useAuth): the receipt's own
 * token, arriving once in the link's fragment and then kept on this device,
 * is the key. A wrong or missing token reads "We couldn't find this receipt",
 * never a hint that the payment exists.
 *
 * States: loading, not found, error with Try again, the receipt (lines,
 * service charge, included tax, total, how it was paid, tip, change, what is
 * left, refunds since, footer, venue address).
 *
 * "Open in Mingla" is not shown here until spec 06's Till receipt claim is
 * live in both stores (T20); the email carries it when VENUE_APP_HANDOFF is on.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import { fetchTillReceipt, TillReceiptError } from "../../../services/tillReceiptGuestService";
import { adoptTillReceiptToken, readTillReceiptToken } from "../../../utils/tillReceiptTokens";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { Skeleton } from "../../ui/Skeleton";
import { TILL_RECEIPT_PAGE_COPY, tillReceiptView, type TillReceiptRow, type TillReceiptView } from "./tillReceiptModel";

type Load =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error" }
  | { status: "ready"; view: TillReceiptView };

export function TillReceiptPage({
  paymentId,
  safeTop,
  safeBottom,
}: {
  paymentId: string;
  safeTop: number;
  safeBottom: number;
}): React.ReactElement {
  // undefined = not read yet; null = no token on this device.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    setToken(adoptTillReceiptToken(paymentId) ?? readTillReceiptToken(paymentId));
  }, [paymentId]);

  const read = useCallback(async (): Promise<void> => {
    if (token === undefined) return;
    if (token === null) {
      setLoad({ status: "not_found" });
      return;
    }
    setLoad({ status: "loading" });
    try {
      const view = tillReceiptView(await fetchTillReceipt({ paymentId, token }));
      setLoad(view === null ? { status: "error" } : { status: "ready", view });
    } catch (caught) {
      const code = caught instanceof TillReceiptError ? caught.code : "till_failed";
      setLoad(code === "receipt_not_found" ? { status: "not_found" } : { status: "error" });
    }
  }, [paymentId, token]);

  useEffect(() => {
    void read();
  }, [read]);

  let body: React.ReactNode;
  if (load.status === "loading") {
    body = (
      <View style={styles.card} accessibilityLabel={TILL_RECEIPT_PAGE_COPY.loading} testID="till-receipt-loading">
        <Skeleton width="60%" height={28} radius="md" />
        <Skeleton width="40%" height={16} radius="md" />
        <Skeleton width="100%" height={120} radius="lg" />
        <Skeleton width="100%" height={72} radius="lg" />
      </View>
    );
  } else if (load.status === "not_found") {
    body = (
      <CenteredState title={TILL_RECEIPT_PAGE_COPY.notFoundTitle} body={TILL_RECEIPT_PAGE_COPY.notFoundBody} testID="till-receipt-not-found" />
    );
  } else if (load.status === "error") {
    body = (
      <CenteredState title={TILL_RECEIPT_PAGE_COPY.errorTitle} body={TILL_RECEIPT_PAGE_COPY.errorBody} tone="error" testID="till-receipt-error">
        <Button label={TILL_RECEIPT_PAGE_COPY.retry} variant="primary" size="md" onPress={() => void read()} testID="till-receipt-retry" />
      </CenteredState>
    );
  } else {
    const v = load.view;
    body = (
      <View style={styles.card} testID="till-receipt">
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">{v.heading}</Text>
          {v.meta ? <Text style={styles.muted}>{v.meta}</Text> : null}
          {v.when !== null ? <Text style={styles.muted}>{v.when}</Text> : null}
          {v.checkLabel !== null ? <Text style={styles.muted}>{v.checkLabel}</Text> : null}
        </View>
        <Rows rows={v.lines} />
        <View style={styles.rule} />
        <Rows rows={v.totals} />
        <View style={styles.rule} />
        <Rows rows={v.payment} />
        {v.paidLate ? <Text style={styles.muted}>{TILL_RECEIPT_PAGE_COPY.paidLate}</Text> : null}
        {v.footer !== null || v.address !== null ? (
          <View style={styles.foot}>
            {v.footer !== null ? <Text style={styles.footText}>{v.footer}</Text> : null}
            {v.address !== null ? <Text style={styles.muted}>{v.address}</Text> : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={[styles.content, { paddingTop: safeTop + space[6], paddingBottom: safeBottom + space[8] }]}
    >
      {body}
    </ScrollView>
  );
}

function Rows({ rows }: { rows: TillReceiptRow[] }): React.ReactElement {
  return (
    <View style={styles.rows}>
      {rows.map((row) => (
        <View key={row.key} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={row.strong ? styles.strong : styles.body}>{row.label}</Text>
            {row.detail !== null ? <Text style={styles.muted}>{row.detail}</Text> : null}
          </View>
          <Text style={row.strong ? styles.strong : styles.body}>{row.amount}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: color.canvas },
  content: { paddingHorizontal: space[4], alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: 520,
    gap: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
  },
  head: { gap: space[1] },
  title: { ...type.h1, color: color.text1 },
  rows: { gap: space[2] },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space[3] },
  rowText: { flexShrink: 1, gap: space[1] },
  body: { ...type.body, color: color.text1 },
  strong: { ...type.row, color: color.text1 },
  muted: { ...type.small, color: color.text2 },
  rule: { height: 1, backgroundColor: color.line },
  foot: { gap: space[2] },
  footText: { ...type.body, color: color.text2 },
});
