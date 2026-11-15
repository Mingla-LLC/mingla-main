/**
 * #4420 — every Stripe Connect embedded component init passes the shared
 * Graphite appearance, so the payouts / onboarding / tax pages stop drawing
 * Stripe's default white surface. Client appearance only.
 *
 * FAILS-ON-REVERT: an init that goes back to `{ variables: { colorPrimary } }`
 * fails I-4420-HOST-WIRING; a light background or a translucent colour fails block 1.
 *
 * [TEST-MOD-APPROVED #4420] — the source-text half moved to the I-4420-HOST-WIRING
 * strict-grep gate (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN); this file keeps the behaviour.
 */
import { color } from "../../../constants/designSystem";
import { MINGLA_CONNECT_APPEARANCE } from "../connectAppearance";

describe("#4420 Connect Graphite appearance", () => {
  test("1. dark surfaces from our tokens, opaque colours only", () => {
    const v = MINGLA_CONNECT_APPEARANCE.variables;
    expect(v.colorBackground).toBe(color.canvas);
    expect(v.colorText).toBe(color.text1);
    expect(v.buttonPrimaryColorBackground).toBe(color.paper);
    expect(v.buttonPrimaryColorText).toBe(color.ink);
    for (const [key, value] of Object.entries(v)) {
      if (!/color/i.test(key)) continue;
      expect([key, /^#[0-9a-f]{6}$/i.test(String(value))]).toEqual([key, true]);
    }
  });

});
