// orch-strict-grep-allow safearea-on-fullscreen-routes — renders AppPaymentReturn, which pads its root with useSafeAreaInsets (top and bottom)
/** #4490 Explorer W1 — the app's payment return page (see AppPaymentReturn). */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";

import { AppPaymentReturn } from "../../../src/components/venue/paid/AppPaymentReturn";

export default function PaidRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const raw = params.groupId;
  const id = Array.isArray(raw) ? (raw[0] ?? null) : typeof raw === "string" ? raw : null;
  return (
    <>
      <Head>
        <title>Payment received · Mingla</title>
        <meta name="robots" content="noindex" />
      </Head>
      <AppPaymentReturn kind="visit" id={id} />
    </>
  );
}
