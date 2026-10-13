/**
 * escapeLayerStack — issue #3645.
 *
 * WHAT WENT WRONG. Pressing Escape in the payout country list closed the whole
 * brand-creation sheet. Every overlay listened for Escape on `document` on its
 * own and closed itself unconditionally, so with two overlays open the key
 * closed BOTH: the list on top and the sheet underneath it.
 *
 * THE RULE. Escape belongs to the top-most open overlay only. Every overlay
 * registers here while it is open; an overlay's own Escape handler acts only
 * when it is the top layer.
 *
 * ORDER is "opened later = on top". It is taken when the overlay is first
 * RENDERED open, not in an effect: React runs effects child-first, so two
 * overlays opened in the same commit would otherwise register in the wrong
 * order. Renders run parent-first, and a parent is underneath its child.
 *
 * An overlay that never registered (a caller outside this module) is treated
 * as the top layer, so nothing that closed on Escape before stops closing.
 *
 * Web only in effect: native has no Escape key, and Android back is handled
 * per overlay through BackHandler, which already goes to the latest listener.
 */

import { useCallback, useEffect, useRef } from "react";

let nextOrder = 1;
const openLayers = new Set<number>();

/** Reserve the next position above every layer opened so far. */
export const reserveEscapeLayerOrder = (): number => {
  const order = nextOrder;
  nextOrder += 1;
  return order;
};

export const openEscapeLayer = (order: number): void => {
  openLayers.add(order);
};

export const closeEscapeLayer = (order: number): void => {
  openLayers.delete(order);
};

/** True when no open layer sits above `order`. */
export const isTopEscapeLayer = (order: number): boolean => {
  for (const other of openLayers) {
    if (other > order) return false;
  }
  return true;
};

/** Test seam: forget every layer. */
export const resetEscapeLayersForTest = (): void => {
  openLayers.clear();
  nextOrder = 1;
};

/**
 * Register this overlay as an Escape layer while `open` is true. Returns a
 * stable function that answers "is this overlay the one Escape belongs to?".
 */
export function useEscapeLayer(open: boolean): () => boolean {
  const orderRef = useRef<number | null>(null);
  // Taken during render so a parent opened in the same commit as its child
  // still sits underneath it. Idempotent: one position per opening.
  if (open && orderRef.current === null) {
    orderRef.current = reserveEscapeLayerOrder();
  }

  useEffect(() => {
    if (!open) return undefined;
    const order = orderRef.current;
    if (order === null) return undefined;
    openEscapeLayer(order);
    return (): void => {
      closeEscapeLayer(order);
      if (orderRef.current === order) orderRef.current = null;
    };
  }, [open]);

  return useCallback((): boolean => {
    const order = orderRef.current;
    return order === null ? true : isTopEscapeLayer(order);
  }, []);
}
