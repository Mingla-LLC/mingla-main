/**
 * phMask.ts — session-replay masking prop helpers (NATIVE no-op stub).
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (§4.H).
 *
 * Metro resolves phMask.web.ts on web and this on native. Native checkout uses
 * the Stripe PaymentSheet (a native modal outside the RN view tree, not captured
 * by RN screenshot replay), so these tags are web-only. Returning {} keeps the
 * call sites shared + type-clean.
 */

type WebMaskProps = Record<string, unknown>;

export function phMaskProps(): WebMaskProps {
  return {};
}

export function phNoCaptureProps(): WebMaskProps {
  return {};
}
