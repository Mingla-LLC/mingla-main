"use client";

import { useCallback, useMemo, useState } from "react";

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

type Priced = {
  ok: boolean;
  total?: { amount_minor?: number; currency?: string };
  lines?: { menuItemId: string; unavailable?: boolean; name?: string }[];
  error?: string;
};

function money(minor: number | null | undefined, currency: string | null | undefined): string | null {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
    }).format(minor / 100);
  } catch {
    return null;
  }
}

export function MenuCart({ items }: { items: CartItem[] }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [priced, setPriced] = useState<Priced | null>(null);
  const [pricing, setPricing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const sections = useMemo(
    () => ["all", ...Array.from(new Set(items.map((item) => item.section)))],
    [items],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) =>
      (section === "all" || item.section === section) &&
      (needle === "" ||
        item.name.toLowerCase().includes(needle) ||
        (item.description ?? "").toLowerCase().includes(needle))
    );
  }, [items, query, section]);

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([menuItemId, quantity]) => ({ menuItemId, quantity })),
    [quantities],
  );
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  const reprice = useCallback(async (next: typeof lines) => {
    if (next.length === 0) {
      setPriced(null);
      setFailed(null);
      return;
    }
    setPricing(true);
    setFailed(null);
    try {
      const response = await fetch("/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preview", lines: next }),
      });
      const result = (await response.json()) as Priced;
      if (!response.ok || !result?.ok) {
        setPriced(null);
        setFailed("We could not price this order just now. Nothing has been charged.");
        return;
      }
      setPriced(result);
    } catch {
      setPriced(null);
      setFailed("We could not price this order just now. Nothing has been charged.");
    } finally {
      setPricing(false);
    }
  }, []);

  const change = useCallback(
    (id: string, delta: number) => {
      setQuantities((current) => {
        const quantity = Math.max(0, (current[id] ?? 0) + delta);
        const next = { ...current, [id]: quantity };
        if (quantity === 0) delete next[id];
        void reprice(
          Object.entries(next)
            .filter(([, value]) => value > 0)
            .map(([menuItemId, value]) => ({ menuItemId, quantity: value })),
        );
        return next;
      });
    },
    [reprice],
  );

  const total = money(priced?.total?.amount_minor, priced?.total?.currency);
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

      <ul className="menu-list">
        {visible.map((item) => {
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
        {visible.length === 0 ? <li className="menu-empty">Nothing matches that.</li> : null}
      </ul>

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
                {unavailable.map((line) => line.name).filter(Boolean).join(", ") || "An item"}
                {" "}is no longer available. Remove it to continue.
              </p>
            ) : null}
            {failed ? <p className="drawer-warn" role="status">{failed}</p> : null}
          </div>
          <div className="drawer-foot">
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
