/**
 * #4541 R2.1 / R3.3 (T-29) — every way into the form names the form, the event
 * and who the answer is for.
 *
 *   - `mingla://form/{id}?…` opens the form route keeping only known params.
 *   - `mingla://purchases/{order|rsvp}/{id}?form=&event=` (the form request
 *     push 1.3.x already opens as the purchase page) opens the form on this
 *     build; without a form id it is the purchase page, as today.
 *   - `brand_form_request` with no link opens Purchases, never Home.
 *   - app/+native-intent.tsx serves `/form` (the route exists now) and, for
 *     that segment only, moves a `#t={token}` fragment into the query (R-5b).
 *   - The route params parse strictly; the route never puts the token in a
 *     card's path.
 *
 * Red on revert of the `form` case, the `params.form` branch in `purchases`,
 * the `brand_form_request` fallback, or R-5b. Runs under
 * app-mobile/jest.issue2774.render.cjs.
 */
import { parseDeepLink, typeFallbackDestination } from "../deepLinkService";
import { redirectSystemPath, __test__ as intent } from "../../../app/+native-intent";
import {
  formIdentityPath,
  formRoutePath,
  formScreenScope,
  parseFormRouteParams,
  readErrorState,
  submitErrorOutcome,
} from "../../components/forms/formRoute";

const FORM = "45410000-0000-4000-8000-000000000004";
const EVENT = "45410000-0000-4000-8000-0000000000e1";
const ORDER = "45410000-0000-4000-8000-0000000000a1";
const RSVP = "45410000-0000-4000-8000-0000000000b1";
const CAMPAIGN = "45410000-0000-4000-8000-0000000000c1";
const TOKEN = "ab".repeat(32);

describe("#4541 T-29 — deep links", () => {
  it("mingla://form/{id} opens the form route with only the known params", () => {
    expect(parseDeepLink(`mingla://form/${FORM}?event=${EVENT}&as=rsvp_guest&sid=${RSVP}&from=push&evil=1`)).toEqual({
      kind: "route",
      path: `/form/${FORM}?event=${EVENT}&as=rsvp_guest&sid=${RSVP}&from=push`,
    });
    expect(parseDeepLink(`mingla://form/${FORM}?campaign=${CAMPAIGN}&from=push`)).toEqual({
      kind: "route",
      path: `/form/${FORM}?campaign=${CAMPAIGN}&from=push`,
    });
  });

  it("drops malformed params and refuses a malformed form id", () => {
    expect(parseDeepLink(`mingla://form/${FORM}?event=nope&as=admin&sid=${RSVP}&from=web`)).toEqual({
      kind: "route",
      path: `/form/${FORM}?sid=${RSVP}`,
    });
    expect(parseDeepLink("mingla://form/not-a-uuid")).toBeNull();
    expect(parseDeepLink(`mingla://form/${FORM}/extra`)).toBeNull();
  });

  it("the form request push on a purchase link opens the form on this build (R3.3)", () => {
    expect(parseDeepLink(`mingla://purchases/order/${ORDER}?form=${FORM}&event=${EVENT}`)).toEqual({
      kind: "route",
      path: `/form/${FORM}?event=${EVENT}&as=order&sid=${ORDER}&from=push`,
    });
    expect(parseDeepLink(`mingla://purchases/rsvp/${RSVP}?form=${FORM}&event=${EVENT}`)).toEqual({
      kind: "route",
      path: `/form/${FORM}?event=${EVENT}&as=rsvp&sid=${RSVP}&from=push`,
    });
  });

  it("without a form id the purchase link is the purchase page, as on 1.3.x", () => {
    expect(parseDeepLink(`mingla://purchases/order/${ORDER}?event=${EVENT}`)).toEqual({
      kind: "purchase",
      purchaseKind: "order",
      purchaseId: ORDER,
      door: false,
    });
    expect(parseDeepLink(`mingla://purchases/order/${ORDER}?form=junk`)?.kind).toBe("purchase");
  });

  it("brand_form_request with no usable link opens Purchases, never Home", () => {
    expect(typeFallbackDestination("brand_form_request", {})).toEqual({ kind: "route", path: "/purchases" });
  });
});

describe("#4541 T-29 — app/+native-intent.tsx", () => {
  const cold = (path: string) => redirectSystemPath({ path, initial: true });

  it("serves /form now that the route exists (no staged set left)", () => {
    expect(intent.SERVED_ROUTE_SEGMENTS.has("form")).toBe(true);
    expect((intent as Record<string, unknown>).STAGED_NATIVE_INTENT_SEGMENTS).toBeUndefined();
  });

  it("R-5b moves #t={token} into the query, keeping the other params", () => {
    expect(cold(`https://go.usemingla.com/form/${FORM}?event=${EVENT}#t=${TOKEN}`))
      .toBe(`https://go.usemingla.com/form/${FORM}?event=${EVENT}&t=${TOKEN}`);
    expect(cold(`com.mingla.app.v2://form/${FORM}#t=${TOKEN}`))
      .toBe(`com.mingla.app.v2://form/${FORM}?t=${TOKEN}`);
  });

  it("R-5b touches nothing else: other fragments, other segments", () => {
    const answers = `https://go.usemingla.com/form/${FORM}?token=fixture#answers`;
    expect(cold(answers)).toBe(answers);
    const event = `https://go.usemingla.com/event/${EVENT}#t=${TOKEN}`;
    expect(cold(event)).toBe(event);
    expect(cold(`https://evil.example/form/${FORM}#t=${TOKEN}`)).toBe("/");
  });
});

describe("#4541 T-29 — the form route's params", () => {
  it("parses a held item, a Blast and a personal link", () => {
    expect(parseFormRouteParams({ formId: FORM, event: EVENT, as: "order", sid: ORDER, from: "ticket" })).toEqual({
      formId: FORM, eventId: EVENT, as: "order", sid: ORDER, campaignId: null, from: "ticket", token: null,
    });
    const blast = parseFormRouteParams({ formId: FORM, campaign: CAMPAIGN, from: "push" });
    expect(blast !== null && formIdentityPath(blast, false)).toBe("blast_unknown");
    expect(blast !== null && formIdentityPath(blast, true)).toBe("blast_user");
    const link = parseFormRouteParams({ formId: FORM, t: TOKEN });
    expect(link?.token).toBe(TOKEN);
    expect(link !== null && formIdentityPath(link, true)).toBe("link");
  });

  it("a page form opened signed out asks to sign in", () => {
    const p = parseFormRouteParams({ formId: FORM, event: EVENT });
    expect(p !== null && formIdentityPath(p, false)).toBe("sign_in");
  });

  it("never puts the token in a cache key or a card's route", () => {
    const link = parseFormRouteParams({ formId: FORM, t: TOKEN });
    expect(link !== null && formScreenScope(link)).toBe("link");
    expect(formRoutePath({ formId: FORM, eventId: EVENT, as: "rsvp", sid: RSVP, from: "pass" }))
      .toBe(`/form/${FORM}?event=${EVENT}&as=rsvp&sid=${RSVP}&from=pass`);
  });

  it("refuses a bad form id, and drops a subject without its id", () => {
    expect(parseFormRouteParams({ formId: "nope" })).toBeNull();
    expect(parseFormRouteParams({ formId: FORM, as: "order" })?.as).toBeNull();
  });
});

describe("#4541 §15 — every server code has a screen state", () => {
  it.each([
    ["forms_paused", "paused"],
    ["form_not_found", "notfound"],
    ["link_invalid", "notfound"],
    ["link_wrong_form", "notfound"],
    ["form_not_on_event", "notfound"],
    ["subject_unavailable", "notfound"],
    ["link_revoked", "replaced"],
    ["form_closed", "closed"],
    ["code_required", "signin"],
    ["sign_in_required", "signin"],
    ["not_holder", "notholder"],
    ["not_current", "notholder"],
    ["network", "loadfail"],
  ])("read %s → %s", (code, state) => {
    expect(readErrorState(code)).toBe(state);
  });

  it.each([
    ["form_answers_invalid", { kind: "screen", state: "err" }],
    ["form_changed", { kind: "screen", state: "changed" }],
    ["response_stale", { kind: "screen", state: "stale" }],
    ["rate_limited", { kind: "inline", line: "rate" }],
    ["open_reply_limit", { kind: "inline", line: "openLimit" }],
    ["bot_check_failed", { kind: "inline", line: "botCheck" }],
    ["too_large", { kind: "inline", line: "tooLarge" }],
    ["server_error", { kind: "inline", line: "offline" }],
    ["network", { kind: "inline", line: "offline" }],
    ["not_holder", { kind: "screen", state: "notholder" }],
    ["link_revoked", { kind: "screen", state: "replaced" }],
  ])("submit %s", (code, outcome) => {
    expect(submitErrorOutcome(code)).toEqual(outcome);
  });
});
