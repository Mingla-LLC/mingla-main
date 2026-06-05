/**
 * ORCH-1076 Stream B — shared StripeBlockedCard primitive (SPEC §9 T-13/T-14).
 *
 * Repo test harness note: mingla-business runs Jest in a Node environment
 * without react-test-renderer / @testing-library/react-native and CANNOT import
 * RN components (their transitive native imports don't transform) — see
 * jest.config.cjs + the existing event/__tests__ source-assertion tests. These
 * tests therefore pin the card via source assertions: the default (event) copy,
 * the custom-copy props plumbing, the CTA → onConnectStripe wiring, and the
 * unchanged token set. Any drift in copy, props, or tokens breaks an assertion.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const cardSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/offering/StripeBlockedCard.tsx"),
    "utf8",
  );

describe("ORCH-1076 — StripeBlockedCard default (event) copy (T-13)", () => {
  test("default props reproduce the event copy byte-for-byte", () => {
    const src = cardSource();
    expect(src).toContain('title = "Stripe required for paid tickets"');
    expect(src).toContain(
      'body = "Connect Stripe to publish. Free tickets can be published any time."',
    );
    expect(src).toContain('ctaLabel = "Connect Stripe"');
  });

  test("title / body / CTA label all render from props", () => {
    const src = cardSource();
    expect(src).toContain("<Text style={styles.statusTitle}>{title}</Text>");
    expect(src).toContain("<Text style={styles.statusSub}>{body}</Text>");
    expect(src).toContain(
      "<Text style={styles.connectStripeLabel}>{ctaLabel}</Text>",
    );
  });
});

describe("ORCH-1076 — StripeBlockedCard custom-copy + CTA wiring (T-14)", () => {
  test("props accept overridable title/body/ctaLabel + required onConnectStripe", () => {
    const src = cardSource();
    expect(src).toContain("title?: string;");
    expect(src).toContain("body?: string;");
    expect(src).toContain("ctaLabel?: string;");
    expect(src).toContain("onConnectStripe: () => void;");
  });

  test("the CTA Pressable fires onConnectStripe and labels itself with ctaLabel", () => {
    const src = cardSource();
    expect(src).toContain("onPress={onConnectStripe}");
    expect(src).toContain("accessibilityLabel={ctaLabel}");
    expect(src).toContain('accessibilityRole="button"');
  });
});

describe("ORCH-1076 — StripeBlockedCard structure (tokens unchanged)", () => {
  test("uses GlassCard base + flag/chevR icons + accent CTA tokens", () => {
    const src = cardSource();
    expect(src).toContain("<GlassCard");
    expect(src).toContain('variant="base"');
    expect(src).toContain('name="flag"');
    expect(src).toContain('name="chevR"');
    expect(src).toContain("backgroundColor: accent.tint");
    expect(src).toContain("color: accent.warm");
    expect(src).toContain("borderColor: accent.border");
  });
});
