/**
 * phMask.web.ts — session-replay masking prop helpers (WEB).
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (§4.H).
 *
 * react-native-web forwards `dataSet` to `data-*` DOM attributes. PostHog
 * session replay then masks/blocks the element via its selectors:
 *   · maskTextSelector '[data-ph-mask]' → text masked,
 *   · the `ph-no-capture` class → element replaced with a same-size block.
 *
 * Returned as a loosely-typed prop bag so it spreads onto RN <View>/<Text>
 * without `@ts-ignore` (the props are web-only and inert on native, where the
 * .ts stub returns {}). Use these to tag any payment/checkout/PII element so a
 * replay can NEVER capture a card field, email, phone, or amount.
 */

type WebMaskProps = Record<string, unknown>;

/** Text-mask: replay renders the element's text as a masked block. */
export function phMaskProps(): WebMaskProps {
  return { dataSet: { phMask: "true" } };
}

/** Hard block: replay replaces the element with a same-size opaque block. */
export function phNoCaptureProps(): WebMaskProps {
  return { dataSet: { phMask: "true" }, className: "ph-no-capture" };
}
