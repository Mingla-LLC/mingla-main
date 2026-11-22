/**
 * #4420 — the public-page parts that more than one route renders, each behind
 * ONE dynamic boundary.
 *
 * WHY. On web every route is its own async chunk, and Expo's serializer moves
 * any module that two async chunks reach into the eager `__common` chunk every
 * visitor (host or buyer) downloads at boot. These parts are only ever drawn
 * on a public or buyer page (or a host preview step), so each one is reached
 * only through its `import()` below: it becomes one on-demand chunk instead.
 *
 * A failed chunk fetch shows the shared retry state (RetryableLazyBoundary),
 * never a blank page. Native is unaffected in behaviour: Metro resolves the
 * same `import()` synchronously from the one bundle.
 */
import { createElement } from "react";
import type React from "react";
import type { OfferingAddOnsSlot } from "@mingla/offering-rendering/OfferingAddOnsBlock";

import { featureFlags } from "../../config/featureFlags";
import type { PublicAddOnsBlockProps } from "../addOns/PublicAddOnsBlock";
import type { BuyerClaimCardProps } from "../checkout/DownloadMinglaCta";
import type { SecurePaymentHandoffProps } from "../checkout/SecurePaymentHandoff";
import type { RefundPreviewBodyProps } from "../trip/RefundPreviewBody";
import type { TripPreviewProps } from "../trip/TripPreview";
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";

/** The "your ticket is waiting" claim card on every confirm page. */
export const BuyerClaimCard: React.ComponentType<BuyerClaimCardProps> =
  createRetryableLazyErrorBoundary(
    () =>
      import("../checkout/DownloadMinglaCta").then((m) => ({
        default: m.BuyerClaimCard,
      })),
    { loadingLabel: "Loading your ticket…" },
  );

/** The public trip page body and the trip creator's preview step. */
export const TripPreview: React.ComponentType<TripPreviewProps> =
  createRetryableLazyErrorBoundary(
    () =>
      import("../trip/TripPreview").then((m) => ({ default: m.TripPreview })),
    { loadingLabel: "Loading trip…" },
  );

/** The refund quote on the buyer cancel page and the host refund sheet. */
export const RefundPreviewBody: React.ComponentType<RefundPreviewBodyProps> =
  createRetryableLazyErrorBoundary(
    () =>
      import("../trip/RefundPreviewBody").then((m) => ({
        default: m.RefundPreviewBody,
      })),
    { loadingLabel: "Loading refund preview…" },
  );

/** The "Taking you to secure payment" step (venue, stay). */
export const SecurePaymentHandoff: React.ComponentType<SecurePaymentHandoffProps> =
  createRetryableLazyErrorBoundary(
    () =>
      import("../checkout/SecurePaymentHandoff").then((m) => ({
        default: m.SecurePaymentHandoff,
      })),
    { loadingLabel: "Opening secure payment…" },
  );

/**
 * #3281 S2 — "Add at checkout:" under each ticket, package or option on the
 * public pages and host previews. The `addOns` slot the shared offering bodies
 * take; null while EXPO_PUBLIC_FF_EXTRAS_ENABLED is off (the default), so the
 * pages render exactly as before.
 */
const PublicAddOnsBlock: React.ComponentType<PublicAddOnsBlockProps> =
  createRetryableLazyErrorBoundary(() => import("../addOns/PublicAddOnsBlock"), {
    loadingLabel: "Loading add-ons…",
  });

export const publicAddOnsSlot: OfferingAddOnsSlot | null = featureFlags.extras
  ? (id, addOns, currency, palette) =>
      createElement(PublicAddOnsBlock, { id, addOns, currency, palette })
  : null;
