// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * #4541 R2.1 — /form/{formId}?event=&as=&sid=&campaign=&from=&t=
 *
 * Thin: reads the params and renders the form screen. A personal link's `#t=`
 * reaches here as `?t=` (app/+native-intent.tsx R-5b) and is never logged.
 */
import React, { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";

import { BrandFormScreen } from "../../src/components/forms/BrandFormScreen";
import { formRoutePath, parseFormRouteParams } from "../../src/components/forms/formRoute";

export default function FormRoute(): React.ReactElement {
  const raw = useLocalSearchParams<{
    formId?: string | string[];
    event?: string | string[];
    as?: string | string[];
    sid?: string | string[];
    campaign?: string | string[];
    from?: string | string[];
    t?: string | string[];
  }>();
  const params = useMemo(
    () => parseFormRouteParams(raw),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the params' values, not the object identity
    [raw.formId, raw.event, raw.as, raw.sid, raw.campaign, raw.from, raw.t],
  );
  // The route held for sign-in never carries the token (formsStartup.ts).
  const routePath = params === null
    ? "/"
    : formRoutePath({
      formId: params.formId,
      eventId: params.eventId,
      as: params.as,
      sid: params.sid,
      campaignId: params.campaignId,
      from: params.from,
    });
  return <BrandFormScreen params={params} routePath={routePath} />;
}
