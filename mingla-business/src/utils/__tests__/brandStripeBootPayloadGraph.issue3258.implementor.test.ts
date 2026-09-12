/**
 * Issue #3258, third pass — the two CI reds the second pass introduced, both
 * caused by the SAME thing: a new import edge out of `brandStripeUiState.ts`,
 * which is in the eager boot payload.
 *
 * RED 1 — `#1486 — dormant render suites (batched)`.
 *   `BrandPaymentsView.tsx` imported `constants/publicUrls`, which imports
 *   `constants/platformUrl`, which calls `expo-constants` at module scope.
 *   `issue_1863_payments_permission_gate.render.test.tsx` mounts the real
 *   payments routes and does not mock `expo-constants`, so the entire suite
 *   died at require time on
 *   `TypeError: Cannot read properties of undefined (reading 'EventEmitter')`.
 *
 * RED 2 — `mingla-business: web build (expo export)` boot-payload budget.
 *   `brandStripeUiState.ts` imported the pending-verification sentence from
 *   `constants/stripeKycRemediationMessages.ts`. That file is a ~245-entry KYC
 *   remediation table whose only renderer, `BrandStripeKycRemediationCard`, is
 *   a leaf of the lazily-chunked Payments route. One import edge from the boot
 *   path hoisted the whole table into `__common`:
 *
 *     __common raw   2,446,440 B (main) -> 2,458,356 B (+11,916), of which
 *     `src/constants/stripeKycRemediationMessages.ts` accounted for 9,718 B by
 *     source-map attribution, while the Payments route chunk shrank 7,510 B.
 *     Budget: 12,000 B per PR. After the fix: 2,451,451 B (+5,425), PASS.
 *
 * WHY THESE ASSERTIONS AND NOT A SOURCE GREP. Both reds are properties of the
 * MODULE GRAPH at require time, and a grep for an import line is exactly the
 * brittle pin I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN exists to keep out — it
 * would miss a re-export, a barrel, or a transitive edge three files away,
 * which is precisely how both reds arrived. So the graph is OBSERVED: each
 * module that must stay out of the boot path is replaced by a counting factory
 * and `brandStripeUiState` is really loaded in an isolated registry. If any
 * edge to it exists, directly or transitively, the counter moves.
 *
 * Each negative assertion is paired with a positive control that loads the
 * module deliberately, so a probe that silently stopped working cannot read as
 * a pass (`feedback_absence_of_signal_read_as_confirmation`).
 */

const mockKycTable = { loads: 0 };
const mockExpoConstants = { loads: 0 };

jest.mock("../../constants/stripeKycRemediationMessages", () => {
  mockKycTable.loads += 1;
  return jest.requireActual("../../constants/stripeKycRemediationMessages");
});

jest.mock("expo-constants", () => {
  mockExpoConstants.loads += 1;
  return {
    __esModule: true,
    default: {
      expoConfig: {
        extra: {
          EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com",
        },
      },
    },
  };
});

beforeEach(() => {
  mockKycTable.loads = 0;
  mockExpoConstants.loads = 0;
  jest.resetModules();
});

describe("#3258 — the Stripe banner's boot-path module graph", () => {
  it("loading brandStripeUiState does NOT load the KYC remediation table (RED 2)", () => {
    jest.isolateModules(() => {
      const mod = require("../brandStripeUiState");
      // Really loaded, not a no-op require of an empty module.
      expect(typeof mod.resolveBrandStripeBannerConfig).toBe("function");
      expect(typeof mod.deriveBrandStripePresentation).toBe("function");
    });

    expect(mockKycTable.loads).toBe(0);
  });

  it("loading brandStripeUiState does NOT load expo-constants (RED 1's mechanism)", () => {
    jest.isolateModules(() => {
      const mod = require("../brandStripeUiState");
      expect(typeof mod.resolveBrandStripeBannerConfig).toBe("function");
    });

    // `expo-constants` is only ever reached from here via
    // constants/publicUrls -> constants/platformUrl. That chain is what killed
    // the #1863 render suite when the Payments view guessed the brand page.
    expect(mockExpoConstants.loads).toBe(0);
  });

  it("and it still produces the pending-verification sentence without either", () => {
    jest.isolateModules(() => {
      const { resolveBrandStripeBannerConfig } = require("../brandStripeUiState");
      const banner = resolveBrandStripeBannerConfig({
        status: "restricted",
        requirements: {
          disabled_reason: "requirements.pending_verification",
          currently_due: [],
          past_due: [],
          pending_verification: ["business_profile.url"],
        },
        accountBusinessUrl: "https://www.rambleawaypod.com",
      });
      expect(banner?.sub).toBe(
        "Stripe is checking your website (www.rambleawaypod.com). Nothing to do — we'll email you when it's verified.",
      );
      expect(banner?.ctaLabel).toBeNull();
      expect(banner?.destructive).toBe(false);
    });

    expect(mockKycTable.loads).toBe(0);
    expect(mockExpoConstants.loads).toBe(0);
  });

  it("with no URL from the account it names the field and invents nothing", () => {
    jest.isolateModules(() => {
      const { resolveBrandStripeBannerConfig } = require("../brandStripeUiState");
      const banner = resolveBrandStripeBannerConfig({
        status: "restricted",
        requirements: {
          disabled_reason: "requirements.pending_verification",
          currently_due: [],
          past_due: [],
          pending_verification: ["business_profile.url"],
        },
        accountBusinessUrl: null,
      });
      // The brand page is NOT guessed back in: no host.usemingla.com, no
      // parenthetical at all.
      expect(banner?.sub).toBe(
        "Stripe is checking your website. Nothing to do — we'll email you when it's verified.",
      );
      expect(banner?.sub).not.toContain("usemingla.com");
      expect(banner?.sub).not.toContain("(");
    });

    expect(mockExpoConstants.loads).toBe(0);
  });
});

describe("#3258 — positive controls, so an inert probe cannot read as a pass", () => {
  it("the KYC-table probe DOES fire when something imports the table", () => {
    jest.isolateModules(() => {
      const table = require("../../constants/stripeKycRemediationMessages");
      expect(typeof table.getKycRemediationMessage).toBe("function");
    });

    expect(mockKycTable.loads).toBeGreaterThan(0);
  });

  it("the expo-constants probe DOES fire when something imports publicUrls", () => {
    jest.isolateModules(() => {
      const { brandPublicUrl } = require("../../constants/publicUrls");
      expect(brandPublicUrl("lanternroom")).toBe(
        "https://host.usemingla.com/b/lanternroom",
      );
    });

    expect(mockExpoConstants.loads).toBeGreaterThan(0);
  });

  it("the remediation table is still reachable through its original path", () => {
    // The sentence builder MOVED to constants/stripePendingVerificationCopy.ts
    // and is re-exported from the table's module, so every pre-existing
    // importer of it from that path keeps working.
    jest.isolateModules(() => {
      const viaTable = require("../../constants/stripeKycRemediationMessages");
      const viaCopy = require("../../constants/stripePendingVerificationCopy");
      expect(viaTable.describeStripePendingVerification).toBe(
        viaCopy.describeStripePendingVerification,
      );
      expect(viaTable.getPendingVerificationSubject).toBe(
        viaCopy.getPendingVerificationSubject,
      );
    });
  });
});
