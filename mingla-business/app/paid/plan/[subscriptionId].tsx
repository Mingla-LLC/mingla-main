/** #4490 Explorer W1 — the app's payment return page (see AppPaymentReturn). */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";

import { AppPaymentReturn } from "../../../src/components/venue/paid/AppPaymentReturn";

export default function PaidRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ subscriptionId?: string | string[] }>();
  const raw = params.subscriptionId;
  const id = Array.isArray(raw) ? (raw[0] ?? null) : typeof raw === "string" ? raw : null;
  return (
    <>
      <Head>
        <title>Payment received · Mingla</title>
        <meta name="robots" content="noindex" />
      </Head>
      <AppPaymentReturn kind="plan" id={id} />
    </>
  );
}
