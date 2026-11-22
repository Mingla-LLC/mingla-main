// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * /receipt/till/{paymentId} — #4490 spec 08 O1 (T20): a guest's receipt for
 * an in-person sale at a venue's Till.
 *
 * ANON ROUTE: `/receipt/` is in PUBLIC_BUYER_ROUTE_PREFIXES and out of the ad
 * pixel routes. Never useAuth: the receipt's own token (arriving once in the
 * `#t=` fragment of the text or email, then kept on this device) is the key.
 * The screen itself is `TillReceiptPage`.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TillReceiptPage } from "../../../src/components/venue/receipt/TillReceiptPage";
import { TILL_RECEIPT_PAGE_COPY } from "../../../src/components/venue/receipt/tillReceiptModel";
import { useWebDocumentTitle } from "../../../src/hooks/useWebDocumentTitle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : typeof value === "string" ? value : null;

export default function TillReceiptRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ paymentId?: string | string[] }>();
  const raw = one(params.paymentId);
  const paymentId = raw !== null && UUID.test(raw) ? raw.toLowerCase() : "00000000-0000-4000-8000-000000000000";
  useWebDocumentTitle(TILL_RECEIPT_PAGE_COPY.tabTitle);
  return (
    <>
      <Head>
        <title>{TILL_RECEIPT_PAGE_COPY.tabTitle}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <TillReceiptPage key={paymentId} paymentId={paymentId} safeTop={insets.top} safeBottom={insets.bottom} />
    </>
  );
}
