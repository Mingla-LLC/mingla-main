// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * /visit/waitlist/{id} — #4490 P5-3: a guest's place on a venue's waitlist.
 *
 * ANON ROUTE under `/visit/` (PUBLIC_BUYER_ROUTE_PREFIXES). Never useAuth: the
 * entry's own token (arriving once in the `#t=` fragment, then kept on this
 * device) is the key. The screen itself is `VisitWaitlist`.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LazyVisitWaitlist } from "../../../src/components/venue/guest/LazyVenueGuestScreens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : typeof value === "string" ? value : null;

export default function VisitWaitlistRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const raw = one(params.id);
  const id = raw !== null && UUID.test(raw) ? raw.toLowerCase() : null;
  return (
    <>
      <Head>
        <title>Your waitlist place · Mingla</title>
        <meta name="robots" content="noindex" />
      </Head>
      <LazyVisitWaitlist key={id ?? "none"} waitlistId={id} safeTop={insets.top} safeBottom={insets.bottom} />
    </>
  );
}
