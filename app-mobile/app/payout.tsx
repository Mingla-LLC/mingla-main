import React from "react";
import { useRouter } from "expo-router";

import { ProgramScreen } from "../src/components/programs/ProgramUi";
import { PayoutConnect } from "../src/components/wallet/PayoutConnect";

/** #3872 — Payout account from Earnings and Local: country, then Connect bank. */
export default function PayoutRoute() {
  const router = useRouter();
  return <ProgramScreen title="Payout account">
    <PayoutConnect onConnected={() => { if (router.canGoBack()) router.back(); }} />
  </ProgramScreen>;
}
