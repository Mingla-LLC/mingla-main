/**
 * ORCH-1150 — /rsvp/[id]/guests — host RSVP approve/deny/remove console route.
 *
 * LOGGED-IN business-app route (host only). NOT a public buyer route — must NOT
 * be added to the anon allowlist (SPEC §5.3 / §11). Mounts RsvpGuestConsole.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { RsvpGuestConsole } from "../../../src/components/rsvp/RsvpGuestConsole";
import { useLiveEventStore } from "../../../src/store/liveEventStore";

export default function RsvpGuestsRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const liveEvent = useLiveEventStore((s) => {
    if (typeof idParam !== "string" || idParam.length === 0) return null;
    return s.events.find((e) => e.id === idParam || e.serverEventId === idParam) ?? null;
  });

  if (typeof idParam !== "string" || idParam.length === 0) return null;
  const resolvedId = liveEvent?.serverEventId ?? idParam;

  return <RsvpGuestConsole eventId={resolvedId} eventTitle={liveEvent?.title ?? null} />;
}
