/**
 * #3355 bug 16 — hold a value steady while a sheet is open.
 *
 * Home chooses between two whole trees (the venue-staff surface and the
 * regular Home) from the current brand's role. Each tree mounts its OWN
 * BrandSwitcherSheet. Creating a brand switches the current brand at step 1,
 * the new brand's role starts loading, and Home swapped trees underneath the
 * open sheet: the sheet (and the brand creation flow inside it) unmounted, so
 * creating a brand stopped after step 1.
 *
 * While `open` is true this returns the value it had when `open` turned true;
 * when `open` is false it returns the live value. It uses the
 * "adjust state during render" pattern, so the first open render already
 * returns the latched value (no one-frame swap).
 */
import { useState } from "react";

export function useLatchedWhileOpen<T>(live: T, open: boolean): T {
  const [latch, setLatch] = useState<{ open: boolean; value: T }>({
    open,
    value: live,
  });
  if (latch.open !== open) {
    setLatch({ open, value: live });
    return live;
  }
  return open ? latch.value : live;
}
