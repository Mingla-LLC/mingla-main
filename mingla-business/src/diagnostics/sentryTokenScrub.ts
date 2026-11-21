/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #4514: a guest form link carries its personal token in the URL fragment
 * (`/form/{id}#t=...`, web only). The link page removes it after reading; this
 * keeps any copy out of error reports and navigation or request breadcrumbs.
 * Loaded lazily with the Sentry SDK by sentry.ts, so it costs the boot bundle
 * nothing.
 */
const T = /([#&]t=)[0-9a-f]{64}/g;
const s = (v: any): any => (typeof v === "string" ? v.replace(T, "$1[redacted]") : v);

const scrubBreadcrumb = (b: any): any => {
  if (b.message) b.message = s(b.message);
  for (const k in b.data) b.data[k] = s(b.data[k]);
  return b;
};

const scrubEvent = (e: any): any => {
  if (e.request) e.request.url = s(e.request.url);
  if (e.transaction) e.transaction = s(e.transaction);
  e.breadcrumbs?.forEach(scrubBreadcrumb);
  return e;
};

/** Called by sentry.ts right after init, in the same tick the SDK loads. */
export const install = (mod: typeof import("@sentry/browser")): void => {
  const client = mod.getClient();
  client?.on("beforeSendEvent", scrubEvent);
  client?.on("beforeAddBreadcrumb", scrubBreadcrumb);
};
