// @vitest-environment jsdom
// MINGLA-INVARIANT: I-4238-SITES-HANDOFF-CONSENTED | issue #4238 | a Mingla Site never forwards its click id unless the visitor granted Sites consent; with consent, only links to host.usemingla.com gain mc_click=<the Site's first-party click id>.
/*
 * #4238 W3-6 (D21). Sites ad clicks never reached checkout: the host web
 * checkout had no way to know the Site's touch. The Site now hands its stored
 * first-party click id to host web (which adopts it, W3-2), consent-gated.
 * Also W2-6 for Sites: gbraid / wbraid are captured with their type.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_KEY } from "../../lib/consent";
import { captureSiteAdClickIds, siteHandoffHref } from "../../lib/clientAnalytics";
import { TrackedLink } from "../TrackedLink";

const CLICK = "0d1e2f30-4238-4a00-8b00-000000000077";
const live = { siteId: "s", brandId: "b", publicationId: "11111111-2222-4333-8444-555555555555" };
const assign = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.setItem("mingla_ad_click_v1", JSON.stringify({ clickId: CLICK }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, pathname: "/", search: "", assign },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  assign.mockClear();
  vi.unstubAllGlobals();
});

describe("#4238 W3-6 siteHandoffHref", () => {
  it("granted: a host.usemingla.com link gains mc_click", () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    const out = new URL(siteHandoffHref("https://host.usemingla.com/e/brand/night?x=1"));
    expect(out.searchParams.get("mc_click")).toBe(CLICK);
    expect(out.searchParams.get("x")).toBe("1");
  });
  it("pending or necessary-only: unchanged", () => {
    const href = "https://host.usemingla.com/e/brand/night";
    expect(siteHandoffHref(href)).toBe(href);
    localStorage.setItem(CONSENT_KEY, "necessary");
    expect(siteHandoffHref(href)).toBe(href);
  });
  it("granted but an external or non-host Mingla link: unchanged", () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    for (const href of ["https://example.com/book", "https://usemingla.com/host", "http://host.usemingla.com/e/a/b"]) {
      expect(siteHandoffHref(href)).toBe(href);
    }
  });
});

describe("#4238 W3-6 TrackedLink", () => {
  it("a granted click navigates to host web with mc_click", async () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    act(() => root.render(
      <TrackedLink href="https://host.usemingla.com/e/brand/night" context={live} ctaKind="offering" offeringId="o1">Book</TrackedLink>,
    ));
    const link = container.querySelector("a") as HTMLAnchorElement;
    await act(async () => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(new URL(assign.mock.calls[0][0] as string).searchParams.get("mc_click")).toBe(CLICK);
  });
  it("without consent the link is a plain link (no handler navigation, href unchanged)", () => {
    act(() => root.render(
      <TrackedLink href="https://host.usemingla.com/e/brand/night" context={live} ctaKind="offering">Book</TrackedLink>,
    ));
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://host.usemingla.com/e/brand/night");
  });
});

describe("#4238 W2-6 Sites capture is typed", () => {
  it.each([
    ["?gbraid=b1", "google", "b1", "gbraid"],
    ["?wbraid=w1", "google", "w1", "wbraid"],
    ["?gclid=g1&rdt_cid=r1", "reddit", "r1", "rdt_cid"],
  ])("%s → %s %s typed %s", (search, network, id, type) => {
    sessionStorage.clear();
    localStorage.setItem(CONSENT_KEY, "granted");
    (window.location as { search: string }).search = search;
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    captureSiteAdClickIds("brand");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ kind: "touch", network, external_click_id: id, external_click_id_type: type });
  });
});
