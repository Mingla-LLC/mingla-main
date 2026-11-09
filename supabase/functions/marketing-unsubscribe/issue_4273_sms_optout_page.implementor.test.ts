// #4273 tester retest 3 P1 — the SMS opt-out page is a mingla-marketing page.
//
// Supabase serves an edge function's GET response as text/plain, so a confirm
// page rendered by marketing-unsubscribe showed raw HTML and nobody could opt
// out. The page now lives at usemingla.com/unsubscribe/sms/<token>:
//   W-1 the page exists and is never indexed (the /unsubscribe contract).
//   W-2 opening it changes nothing: the only request is the button's POST
//       (no effect hook, no form auto-submit), to /unsubscribe/<token>.
//   W-3 the text's link goes there: marketing-send builds /unsubscribe/sms/,
//       and a GET on the function redirects there (old or typed links).
//   W-4 the email one-click route is untouched: /unsubscribe/:token is still
//       proxied to marketing-unsubscribe, and a two-segment /unsubscribe/sms/x
//       path can never match that one-segment rewrite.
// The runtime proof (page renders with a button, POST writes the host-account
// row) is on the issue with screenshots; this suite keeps the shape in CI.
// MINGLA-INVARIANT: I-4273-SMS-OPT-OUT-PAGE-IS-WEB | issue #4273 | The SMS opt-out link opens a mingla-marketing page whose only opt-out request is a person's button POST; GET never opts out.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleSmsOptOut, SMS_OPT_OUT_PAGE } from "./smsOptOut.ts";

const repo = (path: string) =>
  Deno.readTextFile(new URL(`../../../${path}`, import.meta.url));

const PAGE = "mingla-marketing/app/unsubscribe/sms/[token]/page.tsx";
const BUTTON = "mingla-marketing/app/unsubscribe/sms/[token]/SmsOptOutButton.tsx";

Deno.test("#4273 W-1 the page exists and is noindex", async () => {
  const page = await repo(PAGE);
  assert(page.includes("publicNoindexMetadata('/unsubscribe'"), "noindex");
  assert(page.includes("<SmsOptOutButton"), "renders the one button");
  const registry = await repo("mingla-marketing/lib/search/route-registry.ts");
  assert(registry.includes("['/unsubscribe', 'unsubscribe']"), "the opt-out contract is noindex");
});

Deno.test("#4273 W-2 opening the page sends nothing; only the button POSTs", async () => {
  const button = await repo(BUTTON);
  assert(button.startsWith("'use client'"));
  assert(!/useEffect|useLayoutEffect/.test(button), "no request on load");
  assert(!/<form/.test(button), "no form that could auto-submit");
  const fetches = button.match(/fetch\(/g) ?? [];
  assertEquals(fetches.length, 1, "exactly one request");
  const handler = button.slice(
    button.indexOf("async function optOut()"),
    button.indexOf("if (status === 'done')"),
  );
  assert(handler.includes("fetch(`/unsubscribe/${encodeURIComponent(token)}`"));
  assert(handler.includes("method: 'POST'"));
  assert(button.includes("onClick={optOut}"), "the request is the click");
  const page = await repo(PAGE);
  assert(!/fetch\(|action=/.test(page), "the server page makes no opt-out call");
});

Deno.test("#4273 W-3 the text's link and an old function link both land on the page", async () => {
  const send = await Deno.readTextFile(
    new URL("../marketing-send/index.ts", import.meta.url),
  );
  assert(send.includes("destination_url: `${getUnsubscribeOrigin()}/sms/${await signSmsUnsubscribeToken("));
  assert(send.includes('const BRANDED_UNSUBSCRIBE_LINK_ORIGIN = "https://usemingla.com/unsubscribe";'));
  assertEquals(SMS_OPT_OUT_PAGE, "https://usemingla.com/unsubscribe/sms");
  const writes: unknown[] = [];
  const admin = { from: () => { writes.push(1); return {}; } };
  const response = await handleSmsOptOut(
    new Request("https://usemingla.com/unsubscribe/abc.def"),
    { campaign_id: "c", brand_id: "b", message_id: "m" },
    admin,
    "abc.def",
  );
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), `${SMS_OPT_OUT_PAGE}/abc.def`);
  assertEquals(writes, []);
});

Deno.test("#4273 W-4 the email one-click route is untouched", async () => {
  const config = await repo("mingla-marketing/next.config.ts");
  assert(config.includes("{ source: '/unsubscribe/:token', destination: `${functions}/marketing-unsubscribe/:token` },"));
  // `:token` is one path segment: /unsubscribe/sms/<token> is two, so it is
  // served by the page, never proxied to the function.
  assert(!config.includes("/unsubscribe/:path*"));
  const form = await repo("mingla-marketing/app/unsubscribe/page.tsx");
  assert(form.includes("<UnsubscribeForm />"), "the manual form still renders");
});

Deno.test("#4273 W-5 (retest 4) the opt-out page is never measured; no sink sees its token", async () => {
  const lib = await import(
    "../../../mingla-marketing/lib/analytics-private-routes.ts"
  );
  const token = "eyJhIjoxfQ.c2ln";
  assertEquals(lib.isAnalyticsPrivatePathname(`/unsubscribe/sms/${token}`), true);
  assertEquals(lib.isAnalyticsPrivatePathname("/unsubscribe"), false);
  assertEquals(lib.isAnalyticsPrivatePathname("/unsubscribe/abc"), false);
  assertEquals(lib.isAnalyticsPrivatePathname("/cities/lagos"), false);
  assertEquals(lib.analyticsSafePathname(`/unsubscribe/sms/${token}`), "/unsubscribe/sms");
  assertEquals(lib.analyticsSafePathname("/host"), "/host");
  assertEquals(
    lib.isAnalyticsPrivateUrl(`https://usemingla.com/unsubscribe/sms/${token}?x=1`),
    true,
  );
  assertEquals(lib.isAnalyticsPrivateUrl("not a url"), false);
  // Every sink in the provider is wired to it.
  const provider = await repo("mingla-marketing/components/marketing/posthog-provider.tsx");
  const section = (start: string, end: string) =>
    provider.slice(provider.indexOf(start), provider.indexOf(end, provider.indexOf(start)));
  assert(
    section("function routeAwarePostHogBeforeSend", "function cityHubPostHogConfig")
      .includes("isAnalyticsPrivateUrl(event?.properties?.$current_url)"),
    "PostHog drops any event from a private URL",
  );
  // #4339: captureMarketing and captureSearchMeasurement moved out of the
  // provider into components/marketing/marketing-capture.ts (so pages that
  // only send events do not load the analytics SDK); the provider re-exports
  // them. The same private-page stops are asserted there, and the provider
  // must not define a second copy that skips them.
  const capture = await repo("mingla-marketing/components/marketing/marketing-capture.ts");
  const captureSection = (start: string, end: string) =>
    capture.slice(capture.indexOf(start), capture.indexOf(end, capture.indexOf(start)));
  assert(!provider.includes("export function captureMarketing"), "one captureMarketing, in marketing-capture.ts");
  assert(!provider.includes("export function captureSearchMeasurement"), "one captureSearchMeasurement, in marketing-capture.ts");
  assert(
    /export \{[^}]*\bcaptureMarketing\b[^}]*\bcaptureSearchMeasurement\b[^}]*\} from '@\/components\/marketing\/marketing-capture'/.test(provider),
    "the provider re-exports the capture entry points",
  );
  assert(
    captureSection("export function captureMarketing", "export function captureSearchMeasurement")
      .includes("if (isAnalyticsPrivatePathname(window.location.pathname)) return"),
    "custom events stop on a private page",
  );
  assert(
    captureSection("export function captureSearchMeasurement", "\n}\n")
      .includes("isAnalyticsPrivatePathname(window.location.pathname)) return"),
    "search measurement (GA + PostHog) stops on a private page",
  );
  assert(
    section("function ManualGoogleAnalytics", "export function PostHogProvider")
      .includes("analyticsSafePathname(pathname || '/')"),
    "GA's page_location is the token-free path",
  );
  assert(
    section("export function PostHogProvider", "/* #2771")
      .includes("if (isAnalyticsPrivatePathname(pathname)) return"),
    "no page_view on a private page",
  );
});
