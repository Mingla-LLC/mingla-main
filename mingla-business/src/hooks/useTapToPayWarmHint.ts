/**
 * #4389 (screen HT) — the Tap to Pay "set up on this phone" answer for Home's
 * Tap to Pay card and its To do row: the existing warm hint (the same flag the
 * door reads before Apple has been asked). Native only; the web build
 * (useTapToPayWarmHint.web.ts) is always null, which is what this hook
 * answered there (callers pass null off iOS and Android).
 */
import { useEffect, useState } from "react";

import {
  readTapToPayWarmHint,
  subscribeTapToPayWarmHint,
} from "../services/terminal/tapToPaySetupStore";

/** null while unknown; true once Tap to Pay was set up for this brand on this phone. */
export function useTapToPayWarmHint(brandId: string | null): boolean | null {
  const [hint, setHint] = useState<boolean | null>(null);
  useEffect(() => {
    setHint(null);
    if (brandId === null) return undefined;
    let alive = true;
    readTapToPayWarmHint(brandId)
      .then((value) => {
        if (alive) setHint(value);
      })
      .catch((error: unknown) => {
        console.warn("[home-take-payment] could not read the Tap to Pay hint", error);
        if (alive) setHint(false);
      });
    const unsubscribe = subscribeTapToPayWarmHint((changed, value) => {
      if (alive && changed === brandId) setHint(value);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [brandId]);
  return hint;
}
