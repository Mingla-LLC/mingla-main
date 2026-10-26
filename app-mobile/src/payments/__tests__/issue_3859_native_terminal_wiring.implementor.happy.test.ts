// @ts-nocheck
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../..");
const read = (relative: string): string =>
  readFileSync(join(root, relative), "utf8");

describe("#3859 Explorer terminal and recovery wiring", () => {
  it("uses the approved terminal copy and only offers retry with authority", () => {
    const recovery = read("payments/nativeCheckoutRecovery.ts");
    const cart = read("components/expandedCard/TicketCartSheet.tsx");

    expect(recovery).toContain('NATIVE_CHECKOUT_PENDING_TITLE = "Confirming payment"');
    expect(recovery).toContain(
      "You can leave this screen. We’ll update the booking as soon as the payment provider confirms it.",
    );
    expect(recovery).toContain('NATIVE_CHECKOUT_SUCCESS_TITLE = "You’re booked"');
    expect(cart).toContain("terminalOutcome.retryable === true");
    expect(cart).toContain('terminalOutcome.outcome === "canceled"');
    expect(cart).toContain('? "Review and try again"');
    expect(cart).toContain(': "Close"');
  });

  it("routes event, trip, and experience through the same recovery hook", () => {
    for (const screen of [
      "screens/Event/ConsumerEventDetailScreen.tsx",
      "screens/Trip/ConsumerTripDetailScreen.tsx",
      "screens/Experience/ConsumerExperienceDetailScreen.tsx",
    ]) {
      const source = read(screen);
      expect(source).toContain("useNativeCheckoutRecovery");
      expect(source).toContain("terminalOutcome={checkoutTerminalOutcome}");
    }
  });

  it("shows immediate and restart-recovered success until explicit Close", () => {
    for (const screen of [
      "screens/Event/ConsumerEventDetailScreen.tsx",
      "screens/Trip/ConsumerTripDetailScreen.tsx",
      "screens/Experience/ConsumerExperienceDetailScreen.tsx",
    ]) {
      const source = read(screen);
      // [TEST-MOD-APPROVED #4063] Success now prepares the canonical Purchases
      // landing before exposing the terminal outcome. Keep the ordering guard,
      // with enough room for that reviewed route-selection block.
      expect(source).toMatch(
        /terminalSuccessCloseRef\.current = outcome\.outcome === "succeeded"[\s\S]{0,900}setCheckoutTerminalOutcome\(outcome\)/,
      );
      expect(source).toMatch(
        /result\.outcome === "succeeded"[\s\S]{0,900}terminalSuccessCloseRef\.current = [\s\S]{0,900}setCheckoutTerminalOutcome\(result\)/,
      );
      expect(source).toContain("deferredSuccessClose?.()");
    }
  });

  it("uses one shared claim for immediate and recovered purchase analytics", () => {
    const executableLocalCapture =
      /\n\s*postHogService\.capture\(\s*"purchase_completed"/g;
    const event = read("screens/Event/ConsumerEventDetailScreen.tsx");
    expect(event.match(executableLocalCapture) ?? []).toHaveLength(1);
    expect(event).toMatch(
      /result\.provider !== undefined[\s\S]{0,120}claimNativePurchaseCompleted\(result\.orderId\)[\s\S]{0,160}postHogService\.capture\([\s\S]{0,80}"purchase_completed"/,
    );
    expect(event).toContain("nativePurchaseAnalyticsProperties({");
    expect(event).toContain("totalCents: payload.totalCents");
    expect(event).toContain("currency: seed.currency");
    expect(event).not.toContain("retired local signature");

    for (const screen of [
      "screens/Trip/ConsumerTripDetailScreen.tsx",
      "screens/Experience/ConsumerExperienceDetailScreen.tsx",
    ]) {
      const source = read(screen);
      expect(source.match(executableLocalCapture) ?? []).toHaveLength(0);
      expect(source).toContain("captureNativePurchaseCompleted({");
      expect(source).toContain("totalCents: payload.totalCents");
      expect(source).toContain("provider: result.provider");
      expect(source).not.toContain(
        'provider: payload.totalCents === 0 ? "free" : "stripe"',
      );
      expect(source).toMatch(
        /currency: (detail\.currency \?\? undefined|seed\.currency)/,
      );
    }
    expect(read("screens/Trip/ConsumerTripDetailScreen.tsx")).not.toContain(
      'currency: detail.currency ?? "USD"',
    );
    expect(event).toContain("provider: result.provider");
    expect(event).not.toContain(
      'provider: payload.totalCents === 0 ? "free" : "stripe"',
    );
    const recovery = read("payments/nativeCheckoutRecovery.ts");
    expect(recovery).toMatch(
      /captureNativeCheckoutAnalytics\(\s*"purchase_completed"/,
    );
    expect(recovery).toMatch(
      /if \(recovered\) \{[\s\S]{0,100}capturePurchaseOnce\(/,
    );
  });

  it("purges the secure recovery pointer through the shared auth cleanup", () => {
    const cleanup = read("utils/authCleanup.ts");
    expect(cleanup).toContain("purgeNativeCheckoutRecovery");
    expect(cleanup).toContain("await purgeNativeCheckoutRecovery()");
  });
});
