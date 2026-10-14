/**
 * #3645 — lazy host for the "choose your payout country" card, for screens
 * that show it rarely (a venue's reservation fee, deposit rule and menu item
 * price on a brand that has no currency yet). A static import would add the
 * card to those screens' start-up code for a state most brands never reach.
 * The fallback is null: the card appears a moment after the field it replaces
 * is hidden, and never blocks the rest of the form.
 */

import React from "react";

import type { PayoutCountryInlinePromptProps } from "./PayoutCountryInlinePrompt";

const PayoutCountryInlinePromptImpl = React.lazy(async () => {
  const module = await import("./PayoutCountryInlinePrompt");
  return { default: module.PayoutCountryInlinePrompt };
});

export const LazyPayoutCountryInlinePrompt: React.FC<
  PayoutCountryInlinePromptProps
> = (props) => (
  <React.Suspense fallback={null}>
    <PayoutCountryInlinePromptImpl {...props} />
  </React.Suspense>
);
