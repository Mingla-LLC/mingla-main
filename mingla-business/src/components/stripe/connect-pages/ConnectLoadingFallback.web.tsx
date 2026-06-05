/**
 * ConnectLoadingFallback — Suspense fallback for the lazily-loaded connect-* page
 * bodies (ORCH-1083 §C-1).
 *
 * The /connect-* pages are full-bleed and render inside an iOS WKWebView. A null
 * fallback would show a blank white screen while the Stripe chunk downloads, so
 * this renders a non-blank "Loading…" card reusing the page's own loading style
 * for visual consistency. Plain DOM (<div>/<p>) like the connect bodies — these
 * pages never render in the native RN stack.
 */

import React from "react";

import { connectEmbeddedPageStyles } from "../../../components/stripe/connectEmbeddedPageHelpers";

export default function ConnectLoadingFallback(): React.ReactElement {
  return (
    <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
      <div style={connectEmbeddedPageStyles.loadingCardStyle}>
        <p>Loading…</p>
      </div>
    </div>
  );
}
