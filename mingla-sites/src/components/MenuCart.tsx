"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { menuSectionSlug, sectionForHash } from "../lib/menuSections";
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
 * The group a section belongs to: the part before an em/en dash, or the whole
 * name when there is no separator ("DESSERT" is its own group).
 */
function groupOf(name: string): string {
  return name.split(/\s+[\u2014\u2013-]\s+/)[0]?.trim() || name;
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

export function MenuCart({ items }: { items: CartItem[] }) {
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
  const groups = useMemo(() => Array.from(new Set(names.map(groupOf))), [names]);
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
    : (fromHash ? (grouped && fromHash !== "all" ? groupOf(fromHash) : fromHash) : "all");
  const setSection = useCallback(
    (value: string) => setOverride({ hash, value }),
    [hash],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) =>
      (section === "all" || (grouped ? groupOf(item.section) === section : item.section === section)) &&
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
