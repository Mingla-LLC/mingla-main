// @vitest-environment jsdom
/*
 * #2830 — a preview is never counted. Even in a browser that allowed analytics
 * on the live site (same origin, same localStorage), and with ad-click
 * parameters in the address, opening or clicking in a preview sends nothing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_KEY } from "../lib/consent";
import { SiteRuntimeClient } from "./SiteRuntimeClient";
import { TrackedLink } from "./TrackedLink";

const preview = { siteId: "s", brandId: "b", publicationId: `preview-${"c".repeat(32)}` };
const live = { ...preview, publicationId: "11111111-2222-4333-8444-555555555555" };
let container: HTMLDivElement;
let root: Root;
const sent = vi.fn(async () => new Response("{}"));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", sent);
  localStorage.setItem(CONSENT_KEY, "granted");
  window.history.replaceState(null, "", "/preview?k=x&fbclid=abc");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  sent.mockClear();
  vi.unstubAllGlobals();
});

describe("#2830 nothing fires from a preview", () => {
  it("no visit, no ad touch", () => {
    act(() => root.render(<SiteRuntimeClient context={preview} />));
    expect(sent).not.toHaveBeenCalled();
  });

  it("the same page on a real publication does fire (this test can see it)", () => {
    act(() => root.render(<SiteRuntimeClient context={live} />));
    expect(sent).toHaveBeenCalled();
  });

  it("a Book link starts no attribution and opens normally", () => {
    act(() => root.render(<TrackedLink href="https://host.usemingla.com/t/a" context={preview} ctaKind="offering">Book</TrackedLink>));
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    // jsdom has no navigation: stop it after React's handler has had its say.
    document.addEventListener("click", (e) => e.preventDefault(), { once: true });
    const reactHandlerLetItThrough = () => !event.defaultPrevented;
    container.querySelector("a")!.addEventListener("click", () => expect(reactHandlerLetItThrough()).toBe(true), { once: true });
    act(() => { container.querySelector("a")!.dispatchEvent(event); });
    expect(sent).not.toHaveBeenCalled();
  });
});
