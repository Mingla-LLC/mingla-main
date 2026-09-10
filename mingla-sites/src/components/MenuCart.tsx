"use client";

import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";

import { analyticsAllowed, sendSiteEvent, type SiteEventContext } from "../lib/clientAnalytics";
import { menuGroupOf, menuSectionSlug, sectionForHash } from "../lib/menuSections";
import { MINGLA_BUSINESS_ORIGIN } from "../lib/origins";
import { useCart } from "./CartScope";

/**
 * #2830 — the menu cart.
 *
 * Parity target is gogi's own menu page: filters, a search box, a plus per
 * item, a drawer, and a running total. What changes is where it ends. Theirs
 * finishes with "send it on WhatsApp, transfer, then send proof". This one
 * finishes inside Mingla, on the same venue-order rail their staff already
 * work in, so an order from the website lands where every other order does.
 *
 * THE TOTAL IS NOT COMPUTED HERE. The cart shows what Mingla says the order
 * costs, and asks Mingla again whenever the cart changes. A browser adding up
 * its own prices is a browser that can be edited to add them up differently,
 * and it is also a browser working from a published menu that may be older
 * than the kitchen. Both problems have the same answer: the server prices it.
 */
export type CartItem = {
  id: string;
  name: string;
  price_minor: number | null;
  currency: string | null;
  description?: string | null;
  section: string;
};

/*
 * #2830 — MINGLA'S OWN SHAPE, not one invented here.
 *
 * This used to expect `{ ok, total: { amount_minor, currency } }`. Mingla's
 * venue-order rail answers `{ totalCents, currency, lines: [...] }` and carries
 * no `ok` at all — so `!result?.ok` was ALWAYS true and every priced cart was
 * reported as a pricing failure. The cart could never show a total, on any
 * site, ever. Two shapes that were never introduced to each other.
 *
 * The route passes Mingla's answer through unchanged on purpose: Mingla is the
 * authority on price. So the reader is what had to move.
 */
type Priced = {
  currency?: string;
  subtotalCents?: number;
  feesAndTaxCents?: number;
  totalCents?: number;
  lines?: {
    menuItemId?: string;
    itemNameAtOrder?: string;
    lineTotalCents?: number;
    unavailable?: boolean;
  }[];
  error?: string;
};

/*
 * #3149 — WHAT MINGLA ANSWERS WHEN THE ORDER IS ACTUALLY PLACED.
 *
 * `mode: "create"` has more than one ending and they are not interchangeable:
 *
 *   requires_paystack_redirect  NG / Paystack. The guest leaves for Paystack.
 *   requires_web_redirect       Stripe hosted checkout, for a non-NG brand.
 *   free_completed              zero total. The order is already complete.
 *   already_created             this basket was ALREADY submitted. Mingla
 *                               returns the FIRST order rather than a second
 *                               one, and holds back the status token because a
 *                               replay legitimately cannot re-mint it.
 *
 * The website chooses none of this. It does not know which payment provider a
 * brand uses, what currency it settles in, or whether tax is passed on — those
 * are resolved from the brand row inside Mingla, and a browser that guessed at
 * any of them would eventually guess wrong in public.
 */
type Created = {
  kind?: string;
  orderId?: string;
  buyerStatusToken?: string;
  authorizationUrl?: string;
  url?: string;
  error?: string;
};

/*
 * The redirect goes through here so it can be PROVEN. A test cannot let jsdom
 * follow a real navigation, and asserting that the source contains the string
 * `location.href` is exactly the kind of test that has shipped six defects on
 * this issue. This is one line of indirection in exchange for a test that runs
 * the branch and reads back where the guest was actually sent.
 */
export const navigation = {
  go(url: string): void {
    window.location.href = url;
  },
};

/*
 * A redirect target is only followed when it is HTTPS and belongs to the place
 * that kind of response is allowed to send someone. Mingla composes these URLs,
 * but the browser is the thing that acts on them, and an unchecked
 * `location.href = <whatever came back>` is an open redirect waiting for the
 * day a response is not what we expected. `checkout.paystack.com` is the same
 * host Mingla's own continuation resolver pins.
 */
function safeRedirect(value: unknown, hosts: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && hosts.includes(parsed.hostname)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * The SAME predicate Mingla's rail applies (`normalizePhoneE164`), reproduced
 * so a guest is told what is wrong beside the field instead of being refused
 * after a round trip. It is deliberately not more permissive: anything this
 * accepts and the rail rejects would be a checkout that fails at the last step.
 *
 * Note the shape of it. A bare local number is only understood as a NORTH
 * AMERICAN one, so a Lagos guest typing 0801... is not recognised and must
 * include +234. The field says so rather than leaving them to guess.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\+[1-9][0-9]{1,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/*
 * #3149 — ONE order per basket, however many times the button is pressed.
 *
 * Mingla replays a create against the same idempotency key instead of writing
 * a second order, so the whole question is whether the browser sends the SAME
 * key twice. A key minted at press time would not: a double-tap, a flaky
 * network and a reload would each mint a new one and each could become its own
 * order and its own charge.
 *
 * So the key is minted once per basket-and-buyer and remembered. Changing the
 * basket, or the person ordering, is a different order and gets a different
 * key. It is remembered in sessionStorage so a reload mid-checkout continues
 * the same order rather than starting a second one; a browser refusing storage
 * falls back to memory, which still covers the double-tap.
 */
const KEY_STORE = "mingla_site_order_key_v1";
let memoKey: { signature: string; key: string } | null = null;

export function idempotencyKeyFor(signature: string): string {
  let held = memoKey;
  if (held === null || held.signature !== signature) {
    try {
      const raw = window.sessionStorage.getItem(KEY_STORE);
      const parsed = raw === null ? null : JSON.parse(raw) as { signature?: unknown; key?: unknown };
      if (
        parsed !== null && parsed.signature === signature &&
        typeof parsed.key === "string" && parsed.key.length > 0
      ) held = { signature, key: parsed.key };
    } catch {
      // Storage refused or held nonsense. A fresh key is the safe answer.
    }
  }
  if (held === null || held.signature !== signature) {
    held = { signature, key: `sites:${crypto.randomUUID()}` };
    try {
      window.sessionStorage.setItem(KEY_STORE, JSON.stringify(held));
    } catch {
      // Memory alone still stops a double-tap becoming two orders.
    }
  }
  memoKey = held;
  return held.key;
}

function money(minor: number | null | undefined, currency: string | null | undefined): string | null {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      /*
       * #2830 -- "narrowSymbol" so a naira price reads "₦8,500" and not
       * "NGN 8,500", which is what the brand's own menu shows. Inside the
       * existing try: an environment without the ICU data for it throws, and
       * the catch already falls back rather than showing nothing.
       */
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
  } catch {
    return null;
  }
}

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const readHash = () => window.location.hash;
// The server has no fragment; it renders the whole menu.
const readServerHash = () => "";

export function MenuCart({ items, context }: { items: CartItem[]; context: SiteEventContext }) {
  /*
   * The cart lives above this block now, so it survives walking to another page
   * and back. A page rendered without the provider still works: it falls back
   * to a cart that only exists while this block is mounted.
   */
  const shared = useCart();
  const [localQuantities, setLocalQuantities] = useState<Record<string, number>>({});
  const [localOpen, setLocalOpen] = useState(false);
  const quantities = shared ? shared.quantities : localQuantities;
  const open = shared ? shared.open : localOpen;
  const setOpen = shared ? shared.setOpen : setLocalOpen;
  const [query, setQuery] = useState("");
  /*
   * The chosen section is DERIVED, not stored, so /menu#rice-bowls lands on
   * that part of the menu without a render-time read of location (which tears
   * hydration) or an effect that sets state (which cascades renders). The
   * server sees no fragment, so its first paint is "Everything" and the client
   * corrects it.
   *
   * A click overrides the fragment, but only for the fragment it was made
   * against -- following a new deep link takes precedence again.
   */
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const [override, setOverride] = useState<{ hash: string; value: string } | null>(null);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [pricing, setPricing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /*
   * #3149 — the guest. THREE fields, because three is what Mingla's venue-order
   * rail requires of a counter-pickup order and it validates all three itself
   * before it will write a row: a name of at least two characters, an email
   * (Paystack cannot be initialised without one, and it is where the receipt
   * goes), and a phone number the kitchen can reach when the order is ready.
   * Nothing else is asked for, because nothing else is required.
   */
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    { name?: string; email?: string; phone?: string }
  >({});
  const [placing, setPlacing] = useState(false);
  const [placedNote, setPlacedNote] = useState<string | null>(null);
  const fieldId = useId();

  /*
   * #2830 -- gogi's menu offers four filters (Everything / Food / Drinks /
   * Dessert), not one per sub-section. Their section names carry the group as
   * a prefix: "FOOD - Flat Burgers". Where grouping actually collapses
   * something we filter by the group; where every name is already distinct it
   * changes nothing, so a brand with flat section names is unaffected.
   */
  const names = useMemo(
    () => Array.from(new Set(items.map((item) => item.section))),
    [items],
  );
  const groups = useMemo(() => Array.from(new Set(names.map(menuGroupOf))), [names]);
  const grouped = groups.length > 1 && groups.length < names.length;
  const sections = useMemo(
    () => ["all", ...(grouped ? groups : names)],
    [grouped, groups, names],
  );
  /*
   * A link to one sub-section still works: it resolves against the full names
   * and then selects that name's group. Without this, grouping would silently
   * turn every existing #flat-burgers link into "show everything".
   */
  const fromHash = sectionForHash(hash, grouped ? [...sections, ...names] : sections);
  const section = override?.hash === hash
    ? override.value
    : (fromHash ? (grouped && fromHash !== "all" ? menuGroupOf(fromHash) : fromHash) : "all");
  const setSection = useCallback(
    (value: string) => setOverride({ hash, value }),
    [hash],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) =>
      (section === "all" || (grouped ? menuGroupOf(item.section) === section : item.section === section)) &&
      (needle === "" ||
        item.name.toLowerCase().includes(needle) ||
        (item.description ?? "").toLowerCase().includes(needle))
    );
  }, [grouped, items, query, section]);

  /*
   * #2830 -- the reference lists items UNDER their section heading rather than
   * as one flat run, which is what makes a 48-item menu scannable. The groups
   * are derived from what is on screen, so they follow the filter and search.
   */
  const visibleSections = useMemo(() => {
    const order: string[] = [];
    const bySection = new Map<string, CartItem[]>();
    for (const item of visible) {
      if (!bySection.has(item.section)) { order.push(item.section); bySection.set(item.section, []); }
      bySection.get(item.section)!.push(item);
    }
    return order.map((name) => ({ name, rows: bySection.get(name)! }));
  }, [visible]);

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
    [quantities],
  );
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  /*
   * Price the cart whenever it changes, wherever the change came from: this
   * block, the header bag, or a cart restored from a previous visit. Deriving
   * the repricing from the cart rather than from the click is what lets a
   * restored cart show a real total instead of nothing.
   *
   * Cancellation matters here. Two quick taps start two requests, and without
   * the guard a slow FIRST response can land after the second and show a total
   * for a cart the person no longer has.
   *
   * The rule is disabled across this effect deliberately. This is the
   * data-fetching case its own guidance allows: the effect synchronises an
   * external system with React state and updates state from the response. The
   * pricing flag has to be set before the request, not after it, and clearing a
   * stale total when the cart empties has to happen immediately.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (lines.length === 0) {
      setPriced(null);
      setFailed(null);
      setPricing(false);
      return undefined;
    }
    const controller = new AbortController();
    let live = true;
    setPricing(true);
    setFailed(null);
    void (async () => {
      try {
        const response = await fetch("/api/order", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "preview", lines }),
          signal: controller.signal,
        });
        const result = (await response.json()) as Priced;
        if (!live) return;
        // Mingla carries no `ok`; a refusal is a non-2xx with an `error` code.
        if (!response.ok || typeof result?.totalCents !== "number") {
          setPriced(null);
          setFailed("We could not price this order just now. Nothing has been charged.");
          return;
        }
        setPriced(result);
      } catch {
        // An aborted request is a newer one taking over, not a failure.
        if (!live) return;
        setPriced(null);
        setFailed("We could not price this order just now. Nothing has been charged.");
      } finally {
        if (live) setPricing(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [lines]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const change = useCallback(
    (id: string, delta: number) => {
      if (shared) {
        shared.change(id, delta);
        return;
      }
      setLocalQuantities((current) => {
        const quantity = Math.max(0, (current[id] ?? 0) + delta);
        const next = { ...current, [id]: quantity };
        if (quantity === 0) delete next[id];
        return next;
      });
    },
    [shared],
  );

  // A published menu changes. Anything no longer on it leaves the cart.
  useEffect(() => {
    shared?.keepOnly(items.map((item) => item.id));
  }, [shared, items]);

  const total = money(priced?.totalCents, priced?.currency);
  /*
   * ONE combined fees-and-tax line, never split into separate rows
   * (feedback: cart shows a single "Fees & tax"). Hidden when it is zero
   * rather than showing a confusing zero.
   */
  const feesAndTax = typeof priced?.feesAndTaxCents === "number" &&
      priced.feesAndTaxCents > 0
    ? money(priced.feesAndTaxCents, priced?.currency)
    : null;
  const unavailable = (priced?.lines ?? []).filter((line) => line.unavailable);

  /*
   * #3149 — CHECKING OUT. The drawer used to end at the total, which meant the
   * cart could count, price and display an order that no one could ever place:
   * gogi's own page finishes with "message us on WhatsApp and send proof of
   * transfer". This is the ending the component's own header promised — the
   * order goes onto the venue-order rail their staff already work in, and is
   * paid for through whichever provider Mingla routes that brand to.
   *
   * WHAT THIS FUNCTION DOES NOT DO, on purpose: it does not price anything, it
   * does not name a currency, and it does not choose a payment provider. It
   * sends menu item ids, quantities and the guest; every question about money
   * is answered inside Mingla, from the brand's own row.
   */
  const checkout = useCallback(async () => {
    if (placing || lines.length === 0) return;
    const name = buyerName.trim();
    const email = buyerEmail.trim();
    const phone = normalizePhone(buyerPhone);

    /*
     * Validated HERE, before anything is sent. Each of these is a refusal the
     * rail would make anyway, and a guest should hear it beside the field they
     * typed rather than as a failed checkout half a second later.
     */
    const next: { name?: string; email?: string; phone?: string } = {};
    if (name.length < 2) next.name = "Please tell us who the order is for.";
    if (!EMAIL.test(email)) next.email = "Please give an email address for the receipt.";
    if (phone === null) {
      next.phone = "Please give a phone number with its country code, like +234 801 234 5678.";
    }
    setFieldErrors(next);
    if (Object.keys(next).length > 0) {
      /*
       * Move focus to the first field that needs fixing. Without this a screen
       * reader user presses "Check out with Mingla" and hears NOTHING: the
       * error appears in the page, correctly associated with its input by
       * aria-describedby, and nothing ever reads it out because focus never
       * goes near it. Landing on the field announces the label and the reason
       * together, which is the whole point of having written the reason.
       */
      const first = next.name ? "name" : next.email ? "email" : "phone";
      document.getElementById(`${fieldId}-${first}`)?.focus();
      return;
    }

    setPlacing(true);
    setFailed(null);
    setPlacedNote(null);

    /*
     * ATTRIBUTION, and it is worth being plain about why it is here rather
     * than at the end: the touch has to exist BEFORE the order it will be
     * bound to, and it is what earns the website credit for a sale that
     * settles inside Mingla. It follows the same shape `TrackedLink` uses when
     * a visitor leaves for Mingla — ask `/api/attribution` for a token, carry
     * the token to whatever creates the order. Consent gates it, it never
     * blocks the order, and a failure here is silent by design.
     */
    let siteAttributionToken: string | null = null;
    if (analyticsAllowed()) {
      await sendSiteEvent(context, "checkout_start", { cta_kind: "checkout" });
      try {
        const issued = await fetch("/api/attribution", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...context,
            event_name: "checkout_start",
            source_kind: "site",
            source_ref: "menu_cart",
          }),
        });
        const token = (await issued.json()) as { data?: { token?: unknown } };
        if (issued.ok && typeof token?.data?.token === "string") {
          siteAttributionToken = token.data.token;
        }
      } catch {
        // Attribution is additive. It may never stop somebody buying dinner.
      }
    }

    try {
      const response = await fetch("/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "create",
          lines,
          buyer: { name, email, phone },
          idempotencyKey: idempotencyKeyFor(
            `${email}|${phone}|${lines.map((line) => `${line.menuItemId}x${line.quantity}`).sort().join(",")}`,
          ),
          ...(siteAttributionToken === null ? {} : { siteAttributionToken }),
        }),
      });
      const created = (await response.json().catch(() => null)) as Created | null;
      if (!response.ok || created === null) {
        /*
         * The limiter deserves its own sentence. "We could not place this
         * order" for somebody who is simply ordering quickly is both wrong and
         * alarming — nothing is broken and nothing has failed.
         */
        setFailed(
          created?.error === "too_many_orders"
            ? "That is a lot of orders in a row. Give it a moment and try again. Nothing has been charged."
            : "We could not place this order just now. Nothing has been charged.",
        );
        return;
      }

      const paystack = safeRedirect(created.authorizationUrl, ["checkout.paystack.com"]);
      if (created.kind === "requires_paystack_redirect" && paystack !== null) {
        shared?.clear();
        navigation.go(paystack);
        return;
      }
      const hosted = safeRedirect(created.url, ["checkout.stripe.com"]);
      if (created.kind === "requires_web_redirect" && hosted !== null) {
        shared?.clear();
        navigation.go(hosted);
        return;
      }
      if (
        created.kind === "free_completed" && typeof created.orderId === "string" &&
        typeof created.buyerStatusToken === "string"
      ) {
        shared?.clear();
        // The same landing surface a paid order returns to, so a free round and
        // a paid one end on one page rather than two.
        navigation.go(
          `${MINGLA_BUSINESS_ORIGIN}/o/venue/${encodeURIComponent(created.orderId)}?bst=${
            encodeURIComponent(created.buyerStatusToken)
          }`,
        );
        return;
      }
      if (created.kind === "already_created") {
        /*
         * This basket was already sent. Mingla answered with the FIRST order
         * rather than writing a second, and holds back the status token that
         * only the first response carried. So there is nowhere to send the
         * guest, and pressing again must not look like it did nothing.
         */
        setPlacedNote(
          "This order is already with the kitchen. Nothing has been charged twice.",
        );
        return;
      }
      setFailed("We could not place this order just now. Nothing has been charged.");
    } catch {
      setFailed("We could not place this order just now. Nothing has been charged.");
    } finally {
      setPlacing(false);
    }
  }, [buyerEmail, buyerName, buyerPhone, context, fieldId, lines, placing, shared]);

  return (
    <div className="menu-order">
      <div className="menu-toolbar">
        <div className="filters" role="group" aria-label="Filter the menu">
          {sections.map((value) => (
            <button
              key={value}
              type="button"
              className="filter"
              aria-pressed={section === value}
              onClick={() => setSection(value)}
            >
              {value === "all" ? "Everything" : value}
            </button>
          ))}
        </div>
        <div className="menu-search">
          <label className="sr-only" htmlFor="menu-search">Search the menu</label>
          <input
            id="menu-search"
            type="search"
            placeholder="Search the menu"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {visibleSections.map(({ name, rows }) => (
      <div className="menu-section" key={name}>
      <h3 id={menuSectionSlug(name)}>{name}</h3>
      <ul className="menu-list">
        {rows.map((item) => {
          const price = money(item.price_minor, item.currency);
          const quantity = quantities[item.id] ?? 0;
          return (
            <li className="menu-row" key={item.id}>
              <div className="menu-row-head">
                <span className="menu-item-name">{item.name}</span>
                <span className="menu-leader" aria-hidden="true" />
                {price ? <span className="menu-price">{price}</span> : null}
                <span className="menu-qty">
                  {quantity > 0 ? (
                    <>
                      <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => change(item.id, -1)}>−</button>
                      <output aria-label={`${item.name} quantity`}>{quantity}</output>
                    </>
                  ) : null}
                  <button type="button" aria-label={`Add ${item.name} to your order`} onClick={() => change(item.id, 1)}>+</button>
                </span>
              </div>
              {item.description ? <p className="menu-item-note">{item.description}</p> : null}
            </li>
          );
        })}
      </ul>
      </div>
      ))}
      {visible.length === 0 ? <p className="menu-empty">Nothing matches that.</p> : null}

      {count > 0 ? (
        <button type="button" className="cart-btn" onClick={() => setOpen(true)}>
          Your order<span className="cart-count">{count}</span>
        </button>
      ) : null}

      {open ? (
        <div className="cart-drawer" role="dialog" aria-label="Your order" aria-modal="true">
          <div className="drawer-head">
            <strong>Your order</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close your order">Close</button>
          </div>
          <div className="drawer-body">
            {lines.map((line) => {
              const item = items.find((candidate) => candidate.id === line.menuItemId);
              if (!item) return null;
              return (
                <div className="drawer-line" key={line.menuItemId}>
                  <span>{line.quantity} × {item.name}</span>
                  <button type="button" onClick={() => change(line.menuItemId, -1)} aria-label={`Remove one ${item.name}`}>−</button>
                </div>
              );
            })}
            {unavailable.length > 0 ? (
              <p className="drawer-warn" role="status">
                {unavailable.map((line) => line.itemNameAtOrder).filter(Boolean).join(", ") || "An item"}
                {" "}is no longer available. Remove it to continue.
              </p>
            ) : null}
            {failed ? <p className="drawer-warn" role="status">{failed}</p> : null}
          </div>
          <div className="drawer-foot">
            {feesAndTax ? (
              <div className="totals subtotal-row">
                <span>Fees &amp; tax</span>
                <span>{feesAndTax}</span>
              </div>
            ) : null}
            <div className="totals">
              <span>Total</span>
              <span>{pricing ? "Checking…" : total ?? "—"}</span>
            </div>
            <p className="drawer-note">Priced by Mingla when you check out.</p>

            <form
              className="checkout-fields"
              noValidate
              onSubmit={(event) => { event.preventDefault(); void checkout(); }}
            >
              <div className="checkout-field">
                <label htmlFor={`${fieldId}-name`}>Name</label>
                <input
                  id={`${fieldId}-name`}
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={buyerName}
                  onChange={(event) => setBuyerName(event.target.value)}
                  aria-invalid={fieldErrors.name ? true : undefined}
                  aria-describedby={fieldErrors.name ? `${fieldId}-name-error` : undefined}
                />
                {fieldErrors.name
                  ? <p className="checkout-error" id={`${fieldId}-name-error`}>{fieldErrors.name}</p>
                  : null}
              </div>
              <div className="checkout-field">
                <label htmlFor={`${fieldId}-email`}>Email</label>
                <input
                  id={`${fieldId}-email`}
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={buyerEmail}
                  onChange={(event) => setBuyerEmail(event.target.value)}
                  aria-invalid={fieldErrors.email ? true : undefined}
                  aria-describedby={fieldErrors.email ? `${fieldId}-email-error` : undefined}
                />
                {fieldErrors.email
                  ? <p className="checkout-error" id={`${fieldId}-email-error`}>{fieldErrors.email}</p>
                  : null}
              </div>
              <div className="checkout-field">
                <label htmlFor={`${fieldId}-phone`}>Phone</label>
                <input
                  id={`${fieldId}-phone`}
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+234 801 234 5678"
                  value={buyerPhone}
                  onChange={(event) => setBuyerPhone(event.target.value)}
                  aria-invalid={fieldErrors.phone ? true : undefined}
                  aria-describedby={fieldErrors.phone ? `${fieldId}-phone-error` : undefined}
                />
                {fieldErrors.phone
                  ? <p className="checkout-error" id={`${fieldId}-phone-error`}>{fieldErrors.phone}</p>
                  : null}
              </div>
              <button
                type="submit"
                className="checkout-btn"
                disabled={placing || unavailable.length > 0}
              >
                {placing ? "Placing your order…" : "Check out with Mingla"}
              </button>
              {placedNote
                ? <p className="checkout-status" role="status">{placedNote}</p>
                : null}
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
