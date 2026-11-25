// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/** /visit/list/{token} — #4490 07-I signed-out promoter guest-list page. */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LazyVisitGuestList } from "../../../src/components/venue/guest/LazyVenueGuestScreens";

const TOKEN = /^[a-f0-9]{64}$/i;
const one = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : typeof value === "string" ? value : null;

export default function VisitGuestListRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const raw = one(params.token);
  const token = raw !== null && TOKEN.test(raw) ? raw.toLowerCase() : null;
  return (
    <>
      <Head>
        <title>Guest list · Mingla</title>
        <meta name="robots" content="noindex" />
      </Head>
      <LazyVisitGuestList key={token ?? "none"} token={token} safeTop={insets.top} safeBottom={insets.bottom} />
    </>
  );
}
