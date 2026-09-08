"use client";

import Link from "next/link";

import { useCart } from "./CartScope";

/*
 * #2830 — the bag in the header.
 *
 * It only exists when the site actually has an orderable menu, and it only
 * shows a number when something is in it. An empty bag on a site you cannot
 * order from is furniture.
 *
 * On the menu page it opens the drawer. Anywhere else it goes to the menu,
 * because the drawer's contents only make sense next to the items.
 */
export function HeaderCart(
  { menuHref, onMenuPage }: { menuHref: string; onMenuPage: boolean },
) {
  const cart = useCart();
  if (!cart) return null;

  const label = cart.count === 0
    ? "Your order is empty"
    : `Your order, ${cart.count} item${cart.count === 1 ? "" : "s"}`;

  const badge = cart.count > 0
    ? <span className="cart-count" aria-hidden="true">{cart.count > 99 ? "99+" : cart.count}</span>
    : null;

  const bag = (
    <>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          d="M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {badge}
    </>
  );

  if (onMenuPage) {
    return (
      <button
        type="button"
        className="header-cart"
        aria-label={label}
        aria-expanded={cart.open}
        onClick={() => cart.setOpen(!cart.open)}
      >
        {bag}
      </button>
    );
  }

  return (
    <Link href={menuHref} className="header-cart" aria-label={label}>
      {bag}
    </Link>
  );
}
