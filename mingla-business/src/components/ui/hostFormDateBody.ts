/**
 * #4523 / #4541 — the forms date question's calendar body, loaded on first use
 * from the shared Host calendar chunk. It lives here (a ui leaf), not in the
 * forms owner graph's own folders, so those modules hold no import() of their
 * own (I-4541-FORMS-ONE-LAZY-HOP); only businessFormPrimitives imports it, and
 * that module is itself reached only through the forms lazy owner, so none of
 * this reaches the Host boot payload.
 */
import React from "react";

export const LazyFormDateBody = React.lazy(() =>
  import("./HostCalendarBody").then((m) => ({ default: m.FormDateBody })),
);
