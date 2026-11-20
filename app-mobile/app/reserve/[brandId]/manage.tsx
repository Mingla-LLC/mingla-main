/** #4490 Explorer W1 — a table booking's manage link: opens on the web in the in-app browser (see VenueLinkScreen). */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { VenueLinkScreen } from "../../../src/components/venueLink/VenueLinkScreen";

export default function ReserveManageLinkRoute(): React.ReactElement {
  const { brandId } = useLocalSearchParams<{ brandId?: string }>();
  const value = typeof brandId === "string" ? brandId : "";
  return <VenueLinkScreen kind="reserve_manage" id={null} webPath={`/reserve/${value}/manage`} />;
}
