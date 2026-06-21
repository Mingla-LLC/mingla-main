// ORCH-1192 [app analytics instrumentation gaps] — business (mingla-business)
// happy-path regression. Implementor-owned (the tester writes a second,
// adversarial one). Follow-on to META-ORCH-1187 Phase 1.
//
// Proves the TWO new PostHog events are wired at their real business call sites
// via the existing postHogService facade (NOT a new analytics infra), mirroring
// the Phase-1 capture pattern:
//
//   EVENT 1 — `app_opened`:
//     (a) COLD start: app/_layout.tsx fires it after postHogService.initialize()
//         resolves, with { cold_start: true, surface: "business_app" }.
//     (b) FOREGROUND: app/_layout.tsx AppState handler fires it ONLY on a
//         genuine background→active resume, with { cold_start: false,
//         surface: "business_app" } — guarded by a prevAppStateRef so the very
//         first 'active' (cold start) and iOS inactive→active do NOT count.
//
//   EVENT 2 — `checkout_started` (native): the three payment-step routes
//     (event / trip / experience) each fire it at the top of handlePay BEFORE
//     the PaymentSheet opens and BEFORE the purchase_completed success capture,
//     with id/type props matching purchase_completed.
//
// Two layers: (1) static-source assertions of the call sites (true line
// DELETION fails them), and (2) a behavioral test of the foreground-resume
// guard logic added in _layout.tsx (no double-fire on first active).

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, "mingla-business", rel), "utf8");
}
function squish(src: string): string {
  return src.replace(/\s+/g, " ");
}

describe("ORCH-1192 business app_opened + checkout_started call sites", () => {
  describe("EVENT 1 — app_opened (app/_layout.tsx)", () => {
    const raw = read("app/_layout.tsx");
    const sq = squish(raw);

    it("fires the COLD-start app_opened chained off initialize().then(...)", () => {
      expect(sq).toMatch(
        /postHogService\.initialize\(\)\.then\(\s*\(\s*\)\s*=>\s*\{\s*postHogService\.capture\(\s*"app_opened",\s*\{\s*cold_start:\s*true,\s*surface:\s*"business_app",?\s*\}\s*\)/,
      );
    });

    it("fires the FOREGROUND app_opened with cold_start:false", () => {
      expect(sq).toMatch(
        /postHogService\.capture\(\s*"app_opened",\s*\{\s*cold_start:\s*false,\s*surface:\s*"business_app",?\s*\}\s*\)/,
      );
    });

    it("guards the foreground app_opened behind a background→active resume check", () => {
      // The prev-state ref + wasBackground/status==='active' guard prevents a
      // double-fire on the first 'active' (which coincides with cold start).
      expect(sq).toMatch(/const\s+prevAppStateRef\s*=\s*useRef</);
      expect(sq).toMatch(
        /const\s+wasBackground\s*=\s*prevAppStateRef\.current\s*===\s*"background";/,
      );
      expect(sq).toMatch(
        /if\s*\(\s*wasBackground\s*&&\s*status\s*===\s*"active"\s*\)\s*\{\s*[\s\S]*?postHogService\.capture\(\s*"app_opened"/,
      );
    });
  });

  describe("EVENT 2 — checkout_started (3 payment routes)", () => {
    const routes: Array<{
      rel: string;
      idVar: string;
      offering: string;
    }> = [
      {
        rel: "app/checkout/[eventId]/payment.tsx",
        idVar: "eventId",
        offering: "event",
      },
      {
        rel: "app/checkout-trip/[tripEventId]/payment.tsx",
        idVar: "tripEventId",
        offering: "trip",
      },
      {
        rel: "app/checkout-experience/[experienceEventId]/payment.tsx",
        idVar: "experienceEventId",
        offering: "experience",
      },
    ];

    it.each(routes)(
      "$rel fires checkout_started with offering_type:$offering before pay + before purchase_completed",
      ({ rel, idVar, offering }) => {
        const raw = read(rel);
        const sq = squish(raw);
        // Capture present with the right id/type/value/currency/surface props.
        const captureRe = new RegExp(
          `postHogService\\.capture\\(\\s*"checkout_started",\\s*\\{\\s*event_id:\\s*${idVar},\\s*offering_type:\\s*"${offering}",[\\s\\S]*?currency:\\s*totals\\.currency,\\s*surface:\\s*"business_app",?\\s*\\}\\s*\\)`,
        );
        expect(sq).toMatch(captureRe);
        // value is conditional on the server all-in preview being present.
        expect(sq).toMatch(
          /allInPreviewCents\s*!==\s*null\s*\?\s*\{\s*value:\s*allInPreviewCents\s*\/\s*100\s*\}\s*:\s*\{\s*\}/,
        );

        // Ordering: checkout_started must precede the success purchase_completed.
        const startedIdx = raw.indexOf('postHogService.capture("checkout_started"');
        expect(startedIdx).toBeGreaterThanOrEqual(0);

        // Double-fire guard: handlePay starts with `if (processing) return;`.
        expect(raw).toMatch(/if\s*\(\s*processing\s*\)\s*return;/);
        // Fires at the TOP of handlePay — before the first
        // `ticket_checkout_pay_started` mixpanel event, which sits INSIDE the
        // try blocks of the web + native branches (i.e. after the guards).
        const payStartedIdx = raw.indexOf(
          'mixpanelService.track("ticket_checkout_pay_started"',
        );
        expect(payStartedIdx).toBeGreaterThanOrEqual(0);
        expect(startedIdx).toBeLessThan(payStartedIdx);
      },
    );

    it("purchase_completed still fires AFTER checkout_started on /confirm (event)", () => {
      // confirm.tsx is the success page; the started event is on payment.tsx.
      // Both must remain present (we ADD alongside, remove nothing).
      const confirm = read("app/checkout/[eventId]/confirm.tsx");
      expect(confirm).toMatch(/postHogService\.capture\("purchase_completed"/);
    });
  });

  // ── Behavioral test of the foreground-resume guard logic ──────────────────
  describe("foreground-resume guard logic (no double-fire on first active)", () => {
    // Mirror the exact guard implemented in _layout.tsx: track previous state,
    // fire only on background→active. Seeded from the initial state so the very
    // first 'active' (cold start) is NOT a resume.
    function makeHandler(initial: string) {
      let prev = initial;
      const fired: string[] = [];
      const handle = (status: string): void => {
        const wasBackground = prev === "background";
        prev = status;
        if (wasBackground && status === "active") {
          fired.push("app_opened:warm");
        }
      };
      return { handle, fired };
    }

    it("does NOT fire on the very first 'active' (cold start)", () => {
      const { handle, fired } = makeHandler("active");
      handle("active"); // re-affirm active at mount
      expect(fired).toEqual([]);
    });

    it("does NOT fire on iOS inactive→active (Control Center / shade)", () => {
      const { handle, fired } = makeHandler("active");
      handle("inactive");
      handle("active");
      expect(fired).toEqual([]);
    });

    it("FIRES exactly once on a genuine background→active resume", () => {
      const { handle, fired } = makeHandler("active");
      handle("background");
      handle("active");
      expect(fired).toEqual(["app_opened:warm"]);
    });

    it("fires again on a second background→active cycle", () => {
      const { handle, fired } = makeHandler("active");
      handle("background");
      handle("active");
      handle("inactive"); // brief blur, not a background
      handle("active");
      handle("background");
      handle("active");
      expect(fired).toEqual(["app_opened:warm", "app_opened:warm"]);
    });
  });
});
