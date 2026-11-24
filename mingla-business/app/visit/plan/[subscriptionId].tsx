// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * /visit/plan/{subscriptionId} — #4490 P6: a member's page (pass, status,
 * this month's payment, leave / stay on, pause / resume).
 *
 * ANON ROUTE: `/visit/` is in PUBLIC_BUYER_ROUTE_PREFIXES. Never useAuth: the
 * member token (kept on this device, or arriving once in the `#t=` fragment
 * of a member email) is the key. `?paid=1` marks a return from the secure
 * payment page. The screen itself is `VisitMembership`.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LazyVisitMembership } from "../../../src/components/venue/guest/LazyVenueGuestScreens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : typeof value === "string" ? value : null;

export default function VisitMembershipRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ subscriptionId?: string | string[]; paid?: string | string[] }>();
  const raw = one(params.subscriptionId);
  const subscriptionId = raw !== null && UUID.test(raw) ? raw.toLowerCase() : "00000000-0000-4000-8000-000000000000";
  return (
    <>
      <Head>
        <title>Your membership · Mingla</title>
        <meta name="robots" content="noindex" />
      </Head>
      <LazyVisitMembership
        key={subscriptionId}
        subscriptionId={subscriptionId}
        paidReturn={one(params.paid) === "1"}
        safeTop={insets.top}
        safeBottom={insets.bottom}
      />
    </>
  );
}
