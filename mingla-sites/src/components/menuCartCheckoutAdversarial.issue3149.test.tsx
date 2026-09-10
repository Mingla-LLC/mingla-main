// @vitest-environment jsdom
/*
 * #3149 — the checkout, ATTACKED from a different angle.
 *
 * The happy-path file proves the drawer can place an order. This one assumes
 * it can and goes looking for the ways that ends badly: two orders from one
 * basket, a request fired before the guest has given a usable name, a price
 * smuggled out of the browser, a redirect to somewhere that is not Paystack,
 * and a failure that quietly eats the basket so the guest has to rebuild it
 * from memory.
 *
 * Every one of these runs the component. None of them reads its source.
 *
 * fails-on-revert verified at b8050c655 — with `MenuCart.tsx`, `RestaurantV1.tsx`
 * and `api/order/route.ts` restored to origin/main, all 16 tests here fail.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CartScope } from "./CartScope";
import { MenuCart, navigation, type CartItem } from "./MenuCart";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SITE = "11111111-2222-4333-8444-555555555555";
const CART_KEY = `mingla_site_cart_v1:${SITE}`;
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

type Call = { url: string; body: Record<string, unknown> | null };

let calls: Call[] = [];
let createReply: { ok: boolean; status: number; body: unknown };
let went: string[] = [];
let realGo: (url: string) => void;
let realFetch: typeof globalThis.fetch;
let host: HTMLDivElement;
let root: Root;

const reply = (input: { ok: boolean; status: number; body: unknown }) => ({
  ok: input.ok,
  status: input.status,
  json: async () => {
    if (input.body === "MALFORMED") throw new SyntaxError("Unexpected token <");
    return input.body;
  },
});

beforeEach(() => {
  calls = [];
  went = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
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
      return reply({ ok: true, status: 200, body: { ok: true, data: { token: "T".repeat(43) } } });
    }
    if (body?.mode === "create") return reply(createReply);
    return reply({
      ok: true,
      status: 200,
      body: { kind: "preview", currency: "NGN", feesAndTaxCents: 0, totalCents: 850000, lines: [] },
    });
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

const type = async (name: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error(`no field named ${name}`);
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

const openDrawer = async (item = "Coconut rice") => {
  await mount();
  await press(button(`Add ${item} to your order`));
  await press(button("Your order"));
};

const fillBuyer = async (over: Partial<Record<"name" | "email" | "phone", string>> = {}) => {
  await type("name", over.name ?? "Ada Nwosu");
  await type("email", over.email ?? "ada@example.com");
  await type("phone", over.phone ?? "+2348012345678");
};

const created = () => calls.filter((call) => call.url === "/api/order" && call.body?.mode === "create");
const network = () => calls.length;
const text = () => host.textContent ?? "";
const storedCart = () => window.localStorage.getItem(CART_KEY);

describe("#3149 the checkout, under attack", () => {
  it("a double submit sends the SAME idempotency key, so one basket is one order", async () => {
    // The realistic double-tap: the first attempt comes back a failure, the
    // guest presses again. Both requests reach Mingla, and Mingla replays the
    // first order only if the key is identical.
    createReply = { ok: false, status: 503, body: { ok: false, error: "ordering_unavailable" } };
    await openDrawer();
    await fillBuyer();
    await submit();
    await submit();
    expect(created()).toHaveLength(2);
    expect(created()[0].body!.idempotencyKey).toBe(created()[1].body!.idempotencyKey);
  });

  it("a DIFFERENT basket is a different order and gets a different key", async () => {
    createReply = { ok: false, status: 503, body: { ok: false, error: "ordering_unavailable" } };
    await openDrawer();
    await fillBuyer();
    await submit();
    const first = created()[0].body!.idempotencyKey;
    await press(button("Add Jollof to your order"));
    await submit();
    expect(created()[1].body!.idempotencyKey).not.toBe(first);
  });

  it("a name under two characters is refused BEFORE any network call", async () => {
    await openDrawer();
    const before = network();
    await fillBuyer({ name: "A" });
    await submit();
    expect(created()).toHaveLength(0);
    expect(calls.slice(before).filter((call) => call.url !== "/api/order")).toHaveLength(0);
    expect(text()).toContain("Please tell us who the order is for.");
    const input = host.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("a missing email is refused BEFORE any network call", async () => {
    await openDrawer();
    const before = network();
    await fillBuyer({ email: "" });
    await submit();
    expect(created()).toHaveLength(0);
    expect(calls.slice(before)).toHaveLength(0);
    expect(text()).toContain("Please give an email address for the receipt.");
  });

  it("an email that is not an address is refused BEFORE any network call", async () => {
    await openDrawer();
    const before = network();
    await fillBuyer({ email: "ada@example" });
    await submit();
    expect(created()).toHaveLength(0);
    expect(calls.slice(before)).toHaveLength(0);
  });

  it("a phone the rail could not normalise is refused BEFORE any network call", async () => {
    await openDrawer();
    const before = network();
    await fillBuyer({ phone: "08012345678" });
    await submit();
    expect(created()).toHaveLength(0);
    expect(calls.slice(before)).toHaveLength(0);
    expect(text()).toContain("country code");
  });

  it("puts the guest ON the field that needs fixing, so it is read out", async () => {
    /*
     * Without this a screen-reader user presses the button and hears nothing:
     * the error is rendered and correctly associated, and focus never goes
     * near it. Asserted through document.activeElement, not through markup.
     */
    await openDrawer();
    await fillBuyer({ name: "A" });
    await submit();
    const name = host.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute("aria-describedby")).toBe(
      host.querySelector(".checkout-error")!.id,
    );

    // Fix the name, and the next refusal moves on to the next field.
    await type("name", "Ada Nwosu");
    await type("email", "not-an-address");
    await submit();
    expect(document.activeElement).toBe(
      host.querySelector<HTMLInputElement>('input[name="email"]'),
    );
  });

  it("the browser NEVER names a price, a total or a currency", async () => {
    await openDrawer();
    await press(button("Add Jollof to your order"));
    await fillBuyer();
    await submit();
    expect(created()).toHaveLength(1);
    const forbidden = /price|total|currency|amount|cents|subtotal|fee|tax|tip/i;
    const walk = (value: unknown, path: string): string[] => {
      if (Array.isArray(value)) return value.flatMap((entry, index) => walk(entry, `${path}[${index}]`));
      if (value !== null && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
          forbidden.test(key) ? [`${path}.${key}`] : walk(entry, `${path}.${key}`)
        );
      }
      return [];
    };
    for (const call of calls.filter((entry) => entry.url === "/api/order")) {
      expect(walk(call.body, call.body?.mode === "create" ? "create" : "preview")).toEqual([]);
    }
    // And the lines carry exactly two keys each, which is the whole contract.
    for (const line of created()[0].body!.lines as Record<string, unknown>[]) {
      expect(Object.keys(line).sort()).toEqual(["menuItemId", "quantity"]);
    }
  });

  it("a refusal keeps the basket and says nothing was charged", async () => {
    createReply = { ok: false, status: 503, body: { ok: false, error: "ordering_unavailable" } };
    await openDrawer();
    await fillBuyer();
    await submit();
    expect(went).toEqual([]);
    expect(text()).toContain("Nothing has been charged");
    expect(storedCart()).toBe(JSON.stringify({ [ITEM_A]: 1 }));
    expect(text()).toContain("Coconut rice");
  });

  it("a malformed body keeps the basket rather than pretending it worked", async () => {
    createReply = { ok: true, status: 200, body: "MALFORMED" };
    await openDrawer();
    await fillBuyer();
    await submit();
    expect(went).toEqual([]);
    expect(text()).toContain("Nothing has been charged");
    expect(storedCart()).toBe(JSON.stringify({ [ITEM_A]: 1 }));
  });

  it("a 200 with an unknown kind is a failure, not a silent success", async () => {
    createReply = { ok: true, status: 200, body: { kind: "something_new", orderId: "x" } };
    await openDrawer();
    await fillBuyer();
    await submit();
    expect(went).toEqual([]);
    expect(text()).toContain("Nothing has been charged");
    expect(storedCart()).toBe(JSON.stringify({ [ITEM_A]: 1 }));
  });

  it("refuses to follow a redirect that is not Paystack's own checkout", async () => {
    createReply = {
      ok: true,
      status: 200,
      body: {
        kind: "requires_paystack_redirect",
        orderId: "99999999-8888-4777-8666-555555555555",
        authorizationUrl: "https://checkout.paystack.com.evil.example/steal",
      },
    };
    await openDrawer();
    await fillBuyer();
    await submit();
    expect(went).toEqual([]);
    expect(text()).toContain("Nothing has been charged");
  });

  it("refuses a plain-http redirect", async () => {
    createReply = {
      ok: true,
      status: 200,
      body: {
        kind: "requires_paystack_redirect",
        orderId: "99999999-8888-4777-8666-555555555555",
        authorizationUrl: "http://checkout.paystack.com/abcdef123456",
      },
    };
    await openDrawer();
    await fillBuyer();
    await submit();
    expect(went).toEqual([]);
  });

  it("an already-created order goes nowhere and says so, rather than charging twice", async () => {
    createReply = {
      ok: true,
      status: 200,
      body: {
        kind: "already_created",
        orderId: "99999999-8888-4777-8666-555555555555",
        totalCents: 850000,
        currency: "NGN",
        paymentStatus: "pending",
      },
    };
    await openDrawer();
    await fillBuyer();
    await submit();
    expect(went).toEqual([]);
    expect(text()).toContain("already with the kitchen");
    expect(text()).toContain("Nothing has been charged twice");
  });

  it("a rate-limited order is told to wait, civilly, and not that we are broken", async () => {
    // What /api/order forwards for the limiter: the machine code, no message.
    createReply = { ok: false, status: 503, body: { ok: false, error: "too_many_orders" } };
    await openDrawer();
    await fillBuyer();
    await submit();
    expect(text()).toContain("Give it a moment and try again");
    expect(text()).not.toContain("We could not place this order");
    expect(text()).toContain("Nothing has been charged");
    expect(storedCart()).toBe(JSON.stringify({ [ITEM_A]: 1 }));
    expect(went).toEqual([]);
  });

  it("an empty basket has no drawer to check out from", async () => {
    await mount();
    expect(host.querySelector("form.checkout-fields")).toBeNull();
    expect(host.querySelector("button.checkout-btn")).toBeNull();
  });
});
