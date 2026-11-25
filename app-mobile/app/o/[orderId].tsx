/** #4490 Explorer W1 — /o/<id> opens the order in Purchases (see VenueLinkScreen). */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { VenueLinkScreen } from "../../src/components/venueLink/VenueLinkScreen";

export default function OrderLinkRoute(): React.ReactElement {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const id = typeof orderId === "string" ? orderId : null;
  return <VenueLinkScreen kind="order" id={id} webPath={`/o/${id ?? ""}`} />;
}
