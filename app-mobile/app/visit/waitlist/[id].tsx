/** #4490 Explorer W1 — a venue waitlist link caught by the app (see VenueLinkScreen). */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { VenueLinkScreen } from "../../../src/components/venueLink/VenueLinkScreen";

export default function WaitlistLinkRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const value = typeof id === "string" ? id : null;
  return <VenueLinkScreen kind="waitlist" id={value} webPath={`/visit/waitlist/${value ?? ""}`} />;
}
