/**
 * GateQr (NATIVE stub) — ORCH-1342 [web-see-whos-going-funnel] (SPEC §4.3).
 *
 * Metro platform split (the postHogService.web.ts house mechanism): native
 * bundles resolve THIS null-stub, the web export resolves `GateQr.web.tsx`
 * (which imports `react-qr-code`). The QR dialog is a DESKTOP-WEB-ONLY
 * surface (DESIGN §3.2) — `react-qr-code` must NEVER enter the business
 * native bundles (bundle-budget / native-leakproof posture, T-13).
 */

import React from "react";

export interface GateQrProps {
  /** The encoded target — ALWAYS resolveGuestFunnelTarget(...).qrUrl (T-A7). */
  value: string;
  /** Rendered edge length in px. DESIGN §3.2-4 binds 180. */
  size?: number;
}

export const GateQr: React.FC<GateQrProps> = () => null;

export default GateQr;
