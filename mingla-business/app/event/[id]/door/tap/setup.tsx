/**
 * /event/[id]/door/tap/setup — #4271 Tap to Pay setup, once per phone (design T1).
 * Optional ?draft=<base64 json> carries a waiting door sale through setup.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { TapToPaySetupScreen } from "../../../../../src/components/door/tap/TapToPaySetupScreen";

const first = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

export default function DoorTapSetupRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[]; draft?: string | string[] }>();
  return <TapToPaySetupScreen eventId={first(params.id) ?? ""} rawDraft={first(params.draft)} />;
}
