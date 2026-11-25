/** #4490 Explorer W1 — a venue booking link caught by the app (see VenueLinkScreen). */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { VenueLinkScreen } from "../../src/components/venueLink/VenueLinkScreen";

export default function VisitLinkRoute(): React.ReactElement {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const id = typeof groupId === "string" ? groupId : null;
  return <VenueLinkScreen kind="visit" id={id} webPath={`/visit/${id ?? ""}`} />;
}
