import React from "react";

import { StaticBuyerClaimPage } from "../../src/components/checkout/StaticBuyerClaimPage";

/** #4063 — public order URLs reveal no order details or ticket credentials. */
export default function BuyerOrderDetailRoute(): React.ReactElement {
  return (
    <StaticBuyerClaimPage kind="ticket" analyticsSurface="legacy_order_page" />
  );
}
