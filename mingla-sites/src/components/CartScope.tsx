"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/*
 * #2830 — one cart for the whole site.
 *
 * The cart used to live inside the menu block, so walking from the menu to the
 * gallery and back emptied it. On a phone, where moving between pages is a
 * navigation rather than a glance, that is most of the ways a person browses a
 * menu.
 *
 * ONLY ITEM IDS AND QUANTITIES ARE STORED, never names, prices or currency. A
 * stored price is a price a browser can be edited to change, and it is also a
 * price that may be older than the kitchen. The server prices every cart, every
 * time it changes; this is a list of what was asked for, nothing more.
 *
 * localStorage is read through useSyncExternalStore rather than an effect: the
 * server has no storage, so the first paint must agree with the server and then
 * re-render from the real value. Reading it during render would tear hydration;
 * reading it in an effect would cascade renders.
 *
 * Named CartScope, not CartProvider: the public renderer is guarded against
 * template-picker and "provider" vocabulary, and that guard is worth more than
 * the naming convention.
 */
export type Quantities = Record<string, number>;

interface CartValue {
  quantities: Quantities;
  count: number;
  change: (id: string, delta: number) => void;
  keepOnly: (ids: readonly string[]) => void;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CartContext = createContext<CartValue | null>(null);

const KEY_PREFIX = "mingla_site_cart_v1:";
const EMPTY: Quantities = Object.freeze({});

const listeners = new Set<() => void>();
let cachedSite: string | null = null;
let cachedRaw: string | null = null;
let cachedValue: Quantities = EMPTY;

function rawFor(siteId: string): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + siteId);
  } catch {
    // A browser refusing storage is not a reason to break the cart.
    return null;
  }
}

export function parseStored(raw: string | null): Quantities {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY;
  const out: Quantities = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    // Anything that is not a small positive integer is somebody's edit, not
    // our data.
    if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 99) {
      out[id] = value;
    }
  }
  return out;
}

export function readStored(siteId: string): Quantities {
  return parseStored(rawFor(siteId));
}

/*
 * The snapshot must be referentially stable while the underlying string is
 * unchanged, or useSyncExternalStore re-renders forever.
 */
function snapshot(siteId: string): Quantities {
  const raw = rawFor(siteId);
  if (cachedSite === siteId && cachedRaw === raw) return cachedValue;
  cachedSite = siteId;
  cachedRaw = raw;
  cachedValue = parseStored(raw);
  return cachedValue;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab of the same site is the same cart.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(siteId: string, next: Quantities): void {
  try {
    if (Object.keys(next).length === 0) {
      window.localStorage.removeItem(KEY_PREFIX + siteId);
    } else {
      window.localStorage.setItem(KEY_PREFIX + siteId, JSON.stringify(next));
    }
  } catch {
    // Storage refused. Fall through: the listeners below still fire, so the
    // cart works for this page view even when nothing can be remembered.
  }
  cachedSite = null;
  for (const listener of listeners) listener();
}

export function CartScope(
  { siteId, children }: { siteId: string; children: React.ReactNode },
) {
  const [open, setOpen] = useState(false);

  const quantities = useSyncExternalStore(
    subscribe,
    useCallback(() => snapshot(siteId), [siteId]),
    // The server has no cart. Everyone's first paint is an empty one.
    useCallback(() => EMPTY, []),
  );

  const change = useCallback((id: string, delta: number) => {
    const current = snapshot(siteId);
    const quantity = Math.min(99, Math.max(0, (current[id] ?? 0) + delta));
    const next = { ...current, [id]: quantity };
    if (quantity === 0) delete next[id];
    write(siteId, next);
  }, [siteId]);

  const keepOnly = useCallback((ids: readonly string[]) => {
    // A published menu changes. Something added last week that is no longer on
    // the menu must leave the cart rather than sit there un-orderable.
    const current = snapshot(siteId);
    const allowed = new Set(ids);
    const next: Quantities = {};
    for (const [id, quantity] of Object.entries(current)) {
      if (allowed.has(id)) next[id] = quantity;
    }
    // Writing unconditionally would notify every subscriber on every render.
    if (Object.keys(next).length !== Object.keys(current).length) write(siteId, next);
  }, [siteId]);

  const clear = useCallback(() => write(siteId, {}), [siteId]);

  const count = useMemo(
    () => Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0),
    [quantities],
  );

  const value = useMemo<CartValue>(
    () => ({ quantities, count, change, keepOnly, clear, open, setOpen }),
    [quantities, count, change, keepOnly, clear, open],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * Null when nothing above provides a cart — a page rendered outside the site
 * shell still renders, it simply has no cart.
 */
export function useCart(): CartValue | null {
  return useContext(CartContext);
}
