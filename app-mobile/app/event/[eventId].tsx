// orch-strict-grep-allow safearea-on-fullscreen-routes — ProgramScreen applies insets
/**
 * issue #4508 2.3 — /event/{eventId}: the friend-is-going push
 * (`mingla://event/<eventId>`) names an event by id. Look up its public slugs
 * and open the event page, where RSVP is one tap away. Not found and offline
 * each have a designed state with a way forward.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  ProgramButton,
  ProgramEmpty,
  ProgramLoadError,
  ProgramLoading,
  ProgramScreen,
} from "../../src/components/programs/ProgramUi";
import { fetchPublicEventPathById } from "../../src/services/publicEventSeedService";
import { openShellDestination } from "../../src/services/deepLinkService";

export default function EventByIdRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  const [state, setState] = useState<"loading" | "missing" | "error">("loading");

  const goHome = useCallback((): void => {
    if (!openShellDestination({ kind: "page", page: "home" })) router.replace("/" as never);
  }, [router]);

  const load = useCallback(async (): Promise<void> => {
    setState("loading");
    try {
      const path = typeof eventId === "string" ? await fetchPublicEventPathById(eventId) : null;
      if (path === null) {
        setState("missing");
        return;
      }
      router.replace(path as never);
    } catch {
      setState("error");
    }
  }, [eventId, router]);

  useEffect(() => { void load(); }, [load]);

  return (
    <ProgramScreen title="Event" onBack={goHome}>
      {state === "loading" ? (
        <ProgramLoading label="Opening the event…" />
      ) : state === "error" ? (
        <ProgramLoadError text="Check your connection and try again." onRetry={() => void load()} />
      ) : (
        <ProgramEmpty
          title="This event isn't available"
          text="It may have ended, or the host made it private."
          action={<ProgramButton label="Go to Mingla" onPress={goHome} />}
        />
      )}
    </ProgramScreen>
  );
}
