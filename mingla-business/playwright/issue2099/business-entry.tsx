/**
 * #2099 §D6 — the Business browser-harness entry point.
 *
 * It mounts the REAL `PendingVenueIdentityCorrectionDialog.web.tsx` in a real
 * browser, through the REAL shared `Modal`, so the assertions in
 * `pending-identity-correction.spec.ts` are about GEOMETRY: what an operator
 * can actually reach at 1280x800 and at 390x844.
 *
 * This exists because Check H structurally cannot see this. It mounts under
 * `react-test-renderer`, which has no layout engine — no viewport, no scroll,
 * no bounding boxes. Every #2099 assertion before this one was about what
 * RENDERS; none was about what can be REACHED, and the independent tester found
 * the primary action sitting 1155 px below an 800 px fold on a page that does
 * not scroll. A presence gate cannot fail on that, however thorough it is.
 *
 * Only the two RPCs are stubbed, and they are stubbed with the shape the real
 * server returns — including the ~58 discovered dependency lanes, because the
 * lane count is part of what made the card 1646 px tall. Nothing about layout,
 * styling or component identity is faked.
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// `@types/react-dom` is not installed in this workspace and package manifests
// are do-not-touch, so an `import` of `react-dom/client` would add a TS7016 to
// the repo-wide diagnostic baseline that the delta ratchets watch. Declare the
// one API this harness uses instead; esbuild bundles the require normally.
interface ReactDomClient {
  createRoot: (container: Element) => { render: (node: React.ReactNode) => void };
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRoot } = require("react-dom/client") as ReactDomClient;

import { PendingVenueIdentityCorrectionDialog } from "../../src/components/venue/PendingVenueIdentityCorrectionDialog.web";
import type { PendingVenueIdentityPreview } from "../../src/services/pendingVenueIdentityCorrectionService.web";

// The lane set a genuinely unused venue really produces: four allowed baseline
// owners with counts, and the rest discovered-and-empty.
const DEPENDENCY_COUNTS: PendingVenueIdentityPreview["dependency_counts"] = [
  { safe_label: "required_hours", count: 7, classification: "allowed_baseline" },
  { safe_label: "required_pipeline", count: 1, classification: "allowed_baseline" },
  { safe_label: "required_availability", count: 1, classification: "allowed_baseline" },
  {
    safe_label: "required_reservation_settings",
    count: 1,
    classification: "allowed_baseline",
  },
  ...Array.from({ length: 54 }, () => ({
    safe_label: "dependency",
    count: 0,
    classification: "disallowed",
  })),
];

const PREVIEW: PendingVenueIdentityPreview = {
  ok: true,
  eligible: true,
  code: null,
  venue_id: "20990000-0000-0000-0000-000000000020",
  brand_id: "20990000-0000-0000-0000-000000000003",
  place_pool_id: "20990000-0000-0000-0000-000000000010",
  current: {
    name: "The Cluster Fuck",
    slug: "theclusterfuck",
    category: "play",
    updated_at: "2026-08-17T00:00:00.000Z",
  },
  schema_fingerprint: "harness-schema-fingerprint",
  state_fingerprint: "harness-state-fingerprint",
  dependency_counts: DEPENDENCY_COUNTS,
};

// The harness owns ONLY the network boundary. `window.__issue2099` lets the
// spec drive server outcomes without touching the component.
declare global {
  // eslint-disable-next-line no-var
  var __issue2099:
    | {
        previewCalls: number;
        correctCalls: number;
        preview?: PendingVenueIdentityPreview;
        correctResult?: { ok: boolean; code?: string; audit_id?: string };
        previewError?: boolean;
      }
    | undefined;
}
// Do NOT clobber: the spec injects its own state through `addInitScript`, which
// runs BEFORE this bundle. Overwriting it here would erase the preview the
// spec just installed and leave the dialog empty — which is how this harness
// first "passed" nothing at all.
globalThis.__issue2099 = globalThis.__issue2099 ?? {
  previewCalls: 0,
  correctCalls: 0,
  preview: PREVIEW,
};

function Harness(): React.ReactElement {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PendingVenueIdentityCorrectionDialog
        visible
        venueId={PREVIEW.venue_id}
        onClose={() => undefined}
        onSuccess={() => undefined}
      />
    </QueryClientProvider>
  );
}

const host = document.getElementById("root");
if (host !== null) createRoot(host).render(<Harness />);

export { PREVIEW };
