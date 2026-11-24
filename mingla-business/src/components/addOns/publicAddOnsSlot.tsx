/**
 * issue #3281 S2 — the `addOns` slot a Host web / buyer web page shell (and
 * the host previews) hands its shared offering body: "Add at checkout:" under
 * each ticket, package or option. Null while EXPO_PUBLIC_FF_EXTRAS_ENABLED is
 * off (the default), so every page renders exactly as before.
 *
 * The block and its pure half load on use (PublicAddOnsBlock): the shared
 * bodies sit in the Host web boot payload, so only this slot is eager. A chunk
 * that fails to load is logged and shows nothing (the add-ons are also offered
 * at checkout); it never takes the page down. No UI-kit import here, so the
 * render suites that mount the previews are unaffected.
 */

import React, { Suspense } from "react";
import type { OfferingAddOnsSlot } from "@mingla/offering-rendering/OfferingAddOnsBlock";

import { featureFlags } from "../../config/featureFlags";
import type { PublicAddOnsBlockProps } from "./PublicAddOnsBlock";

type BlockModule = { default: React.ComponentType<PublicAddOnsBlockProps> };

const PublicAddOnsBlock = React.lazy(
  (): Promise<BlockModule> =>
    import("./PublicAddOnsBlock").catch((error: unknown): BlockModule => {
      console.warn("[publicAddOnsSlot] add-ons list did not load", error);
      return { default: (): null => null };
    }),
);

export const publicAddOnsSlot: OfferingAddOnsSlot | null = featureFlags.extras
  ? (id, addOns, currency, palette) => (
      <Suspense fallback={null}>
        <PublicAddOnsBlock id={id} addOns={addOns} currency={currency} palette={palette} />
      </Suspense>
    )
  : null;
