/**
 * GateQr (WEB) — ORCH-1342 [web-see-whos-going-funnel] (SPEC §4.3).
 *
 * The desktop guest-gate QR (DESIGN §3.2-4): `react-qr-code` renders a PURE
 * inline <svg> with NO network calls — the exact library + props the marketing
 * /download page uses (mingla-marketing/components/marketing/download-qr.tsx:
 * fgColor #0E0E10 on solid #FFFFFF, level "M"). Near-black-on-white is a
 * SCANNER hardware requirement, matching /download's white QR card exactly —
 * the ONE sanctioned non-palette fill in the gate.
 *
 * PLATFORM SPLIT (the postHogService.web.ts house mechanism): Metro resolves
 * THIS `.web.tsx` on the web export and the sibling `GateQr.tsx` null-stub on
 * native, so `react-qr-code` NEVER enters the business native bundles.
 *
 * BUNDLE BUDGET (ORCH-1083 / T-13): the library is loaded via a DYNAMIC
 * `import("react-qr-code")` (React.lazy) — the webAnalytics posthog-js
 * precedent — so its bulk never enters the eager `__common` boot chunk
 * (a static import pushed __common ~31KB over the 2.25MB cap, measured).
 * It fetches only when the desktop QR dialog actually renders.
 */

import React, { Suspense } from "react";

const QRCode = React.lazy(() => import("react-qr-code"));

export interface GateQrProps {
  /** The encoded target — ALWAYS resolveGuestFunnelTarget(...).qrUrl (T-A7). */
  value: string;
  /** Rendered edge length in px. DESIGN §3.2-4 binds 180. */
  size?: number;
}

export const GateQr: React.FC<GateQrProps> = ({ value, size = 180 }) => (
  <div
    role="img"
    aria-label="QR code — scan to get the Mingla app"
    style={{ width: size, height: size }}
  >
    {/* The white QR card behind this (SeeWhosGoingGate styles.qrCard) IS the
        visual while the chunk loads (milliseconds, local) — no spinner needed. */}
    <Suspense fallback={null}>
      {/* Near-black on solid white — high contrast is mandatory for scanners. */}
      <QRCode
        value={value}
        size={size}
        fgColor="#0E0E10"
        bgColor="#FFFFFF"
        level="M"
        style={{ height: "100%", width: "100%", display: "block" }}
      />
    </Suspense>
  </div>
);

export default GateQr;
