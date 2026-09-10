// @vitest-environment jsdom
/*
 * #3149 — THE CART CAN NOW BE CHECKED OUT, AND THIS DRIVES IT.
 *
 * The drawer used to end at the total. It counted, it priced, it showed a
 * number, and there was no control of any kind to place the order — the one
 * thing the whole block exists for. gogi's own site finishes with "message us
 * on WhatsApp and send proof of transfer"; this finishes on Mingla's
 * venue-order rail.
 *
 * Six defects on this issue shipped green because their tests read the source
 * as text. So nothing here greps a file. Every test mounts the real component
 * into a real document, clicks real buttons, types into real inputs, and reads
 * back the request body the component actually produced and the URL it
 * actually tried to send the guest to.
 *
 * The single seam is `navigation.go`, because jsdom cannot follow a real
 * top-level navigation. Its real body is `window.location.href = url`.
 *
 * fails-on-revert verified at b8050c655 — with `MenuCart.tsx`, `RestaurantV1.tsx`
 * and `api/order/route.ts` restored to origin/main, all 9 tests here fail:
 * there is no checkout form to find and no create request to inspect.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CartScope } from "./CartScope";
import { MenuCart, navigation, normalizePhone, type CartItem } from "./MenuCart";
import { CONSENT_KEY } from "../lib/consent";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SITE = "11111111-2222-4333-8444-555555555555";
const CONTEXT = {
  siteId: SITE,
  brandId: "22222222-3333-4444-8555-666666666666",
  publicationId: "33333333-4444-4555-8666-777777777777",
};
const ITEM_A = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const ITEM_B = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";
const ITEMS: CartItem[] = [
  { id: ITEM_A, name: "Coconut rice", price_minor: 850000, currency: "NGN", section: "Rice" },
  { id: ITEM_B, name: "Jollof", price_minor: 700000, currency: "NGN", section: "Rice" },
];
const TOKEN = "T".repeat(43);

type Call = { url: string; body: Record<string, unknown> | null };

let calls: Call[] = [];
let createReply: { ok: boolean; status: number; body: unknown };
let previewReply: { ok: boolean; status: number; body: unknown };
let went: string[] = [];
let realGo: (url: string) => void;
let host: HTMLDivElement;
let root: Root;
let realFetch: typeof globalThis.fetch;

const reply = (input: { ok: boolean; status: number; body: unknown }) => ({
  ok: input.ok,
  status: input.status,
  json: async () => input.body,
});

beforeEach(() => {
  calls = [];
  went = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  previewReply = {
    ok: true,
    status: 200,
    body: { kind: "preview", currency: "NGN", feesAndTaxCents: 0, totalCents: 850000, lines: [] },
  };
  createReply = {
    ok: true,
    status: 200,
    body: {
      kind: "requires_paystack_redirect",
      orderId: "99999999-8888-4777-8666-555555555555",
      authorizationUrl: "https://checkout.paystack.com/abcdef123456",
    },
  };
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    let body: Record<string, unknown> | null = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    calls.push({ url, body });
    if (url === "/api/events") return reply({ ok: true, status: 202, body: null });
    if (url === "/api/attribution") {
      return reply({ ok: true, status: 200, body: { ok: true, data: { token: TOKEN } } });
    }
    if (body?.mode === "create") return reply(createReply);
    return reply(previewReply);
  }) as unknown as typeof globalThis.fetch;
  realGo = navigation.go;
  navigation.go = (url: string) => { went.push(url); };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.fetch = realFetch;
  navigation.go = realGo;
});

const mount = async () => {
  await act(async () => {
    root.render(
      <CartScope siteId={SITE}>
        <MenuCart items={ITEMS} context={CONTEXT} />
      </CartScope>,
    );
  });
};

const button = (label: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll("button")].find((candidate) =>
    (candidate.getAttribute("aria-label") ?? candidate.textContent ?? "").includes(label)
  );
  if (!found) throw new Error(`no button matching ${label}`);
  return found as HTMLButtonElement;
};

const press = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

const field = (name: string): HTMLInputElement => {
  const found = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!found) throw new Error(`no field named ${name}`);
  return found;
};

/* React tracks the previous value on the node, so a plain `.value =` is
   swallowed. This is the setter React itself uses. */
const type = async (name: string, value: string) => {
  const input = field(name);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const submit = async () => {
  const form = host.querySelector("form.checkout-fields");
  if (!form) throw new Error("no checkout form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

/** Add one Coconut rice, open the drawer. */
const openDrawerWithOneItem = async () => {
  await mount();
  await press(button("Add Coconut rice to your order"));
  await press(button("Your order"));
};

const fillBuyer = async (over: Partial<Record<"name" | "email" | "phone", string>> = {}) => {
  await type("name", over.name ?? "Ada Nwosu");
  await type("email", over.email ?? "ada@example.com");
  await type("phone", over.phone ?? "+2348012345678");
};

const created = () => calls.filter((call) => call.url === "/api/order" && call.body?.mode === "create");
const text = () => host.textContent ?? "";

describe("#3149 the drawer can place the order", () => {
  it("renders a checkout control at all, which is the defect", async () => {
    await openDrawerWithOneItem();
    const control = host.querySelector<HTMLButtonElement>("button.checkout-btn");
    expect(control).not.toBeNull();
    expect(control!.textContent).toContain("Check out with Mingla");
    expect(host.querySelector('input[name="name"]')).not.toBeNull();
    expect(host.querySelector('input[name="email"]')).not.toBeNull();
  });

  it("sends mode:create with the buyer and a stable idempotency key", async () => {
    await openDrawerWithOneItem();
    await fillBuyer();
    await submit();

    expect(created()).toHaveLength(1);
    const body = created()[0].body!;
    expect(body.mode).toBe("create");
    expect(body.buyer).toEqual({
      name: "Ada Nwosu",
      email: "ada@example.com",
      phone: "+2348012345678",
    });
    expect(body.lines).toEqual([{ menuItemId: ITEM_A, quantity: 1 }]);
    expect(typeof body.idempotencyKey).toBe("string");
    expect(String(body.idempotencyKey).length).toBeGreaterThan(8);
  });

  it("branches requires_paystack_redirect to a top-level navigation", async () => {
    await openDrawerWithOneItem();
    await fillBuyer();
    await submit();
    expect(went).toEqual(["https://checkout.paystack.com/abcdef123456"]);
  });

  it("branches free_completed to the order's own status page", async () => {
    createReply = {
      ok: true,
      status: 200,
      body: {
        kind: "free_completed",
        orderId: "99999999-8888-4777-8666-555555555555",
        buyerStatusToken: "bst-token-value",
        totalCents: 0,
        currency: "NGN",
      },
    };
    await openDrawerWithOneItem();
    await fillBuyer();
    await submit();
    expect(went).toEqual([
      "https://host.usemingla.com/o/venue/99999999-8888-4777-8666-555555555555?bst=bst-token-value",
    ]);
  });

  it("branches requires_web_redirect to hosted Stripe checkout", async () => {
    createReply = {
      ok: true,
      status: 200,
      body: {
        kind: "requires_web_redirect",
        orderId: "99999999-8888-4777-8666-555555555555",
        url: "https://checkout.stripe.com/c/pay/cs_live_abc",
      },
    };
    await openDrawerWithOneItem();
    await fillBuyer();
    await submit();
    expect(went).toEqual(["https://checkout.stripe.com/c/pay/cs_live_abc"]);
  });

  it("shows a pending state and refuses a second press while in flight", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const beforeGate = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.mode === "create") await gate;
      return await (beforeGate as (a: unknown, b?: RequestInit) => Promise<unknown>)(input, init);
    }) as unknown as typeof globalThis.fetch;

    await openDrawerWithOneItem();
    await fillBuyer();
    const control = host.querySelector<HTMLButtonElement>("button.checkout-btn")!;
    await act(async () => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector<HTMLButtonElement>("button.checkout-btn")!.disabled).toBe(true);
    expect(text()).toContain("Placing your order");
    await press(host.querySelector<HTMLButtonElement>("button.checkout-btn")!);
    await act(async () => { release!(); await gate; });
    expect(created()).toHaveLength(1);
  });

  it("carries site attribution when the visitor consented", async () => {
    window.localStorage.setItem(CONSENT_KEY, "granted");
    await openDrawerWithOneItem();
    await fillBuyer();
    await submit();
    const attribution = calls.filter((call) => call.url === "/api/attribution");
    expect(attribution).toHaveLength(1);
    expect(attribution[0].body!.event_name).toBe("checkout_start");
    expect(attribution[0].body!.source_ref).toBe("menu_cart");
    // ...and the token it minted rides along with the order that is created.
    expect(created()[0].body!.siteAttributionToken).toBe(TOKEN);
    // The analytics event fires too, and it is the one the route allows.
    const events = calls.filter((call) => call.url === "/api/events");
    expect(events.map((event) => event.body!.event_name)).toContain("checkout_start");
  });

  it("asks for nothing and sends nothing when consent was never given", async () => {
    await openDrawerWithOneItem();
    await fillBuyer();
    await submit();
    expect(calls.filter((call) => call.url === "/api/attribution")).toHaveLength(0);
    expect(created()[0].body).not.toHaveProperty("siteAttributionToken");
  });

  it("normalizePhone matches the rail's own predicate", () => {
    expect(normalizePhone("+2348012345678")).toBe("+2348012345678");
    expect(normalizePhone("  +2348012345678 ")).toBe("+2348012345678");
    expect(normalizePhone("(415) 555-0132")).toBe("+14155550132");
    // A Lagos local number is NOT understood; the field says to add +234.
    expect(normalizePhone("08012345678")).toBeNull();
    expect(normalizePhone("nope")).toBeNull();
  });
});
