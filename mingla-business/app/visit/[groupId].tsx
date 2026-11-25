// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * /visit/{groupId} — #4490 P2: a guest's venue booking and pass.
 *
 * ANON ROUTE: `/visit/` is in PUBLIC_BUYER_ROUTE_PREFIXES. Never useAuth: the
 * booking's own token (kept on this device, or arriving once in the `#t=`
 * fragment of an email or pay-code link) is the key. `?paid=1` marks a return
 * from the secure payment page. The screen itself is `VisitBooking`.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LazyVisitBooking } from "../../src/components/venue/guest/LazyVenueGuestScreens";
import { useWebDocumentTitle } from "../../src/hooks/useWebDocumentTitle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : typeof value === "string" ? value : null;

export default function VisitBookingRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ groupId?: string | string[]; paid?: string | string[] }>();
  const raw = one(params.groupId);
  const groupId = raw !== null && UUID.test(raw) ? raw.toLowerCase() : "00000000-0000-4000-8000-000000000000";
  // #4490 fix 3 (N109) — the tab said "Mingla Host" after a fresh load.
  useWebDocumentTitle("Your booking · Mingla");
  return (
    <>
      <Head>
        <title>Your booking · Mingla</title>
        <meta name="robots" content="noindex" />
      </Head>
      <LazyVisitBooking
        key={groupId}
        groupId={groupId}
        paidReturn={one(params.paid) === "1"}
        safeTop={insets.top}
        safeBottom={insets.bottom}
      />
    </>
  );
}
