/**
 * #4389 — brand setup interruptions (design v11 Interruptions lane):
 * F1 discard on Back, F1 session expired, F2 changed on another device and
 * the forbidden pre-check, F3 "Finishing on your other device…" (R-4) and the
 * owner's real name, Ari AR-12 skip card, Dynamic Type CTA rule.
 *
 * FAILS-ON-REVERT: removing the beforeRemove guard or the Back check fails
 * "F1 Back asks before discarding"; removing countryConflict's previous-value
 * check fails "first read is not a conflict"; dropping startedHere fails R-4.
 */
import { describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll(predicate: (node: TestInstance) => boolean, options?: { deep?: boolean }): TestInstance[];
}
interface RendererInstance {
  root: TestInstance;
  unmount(): void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Button: (p: { label: string; onPress: () => void; testID?: string }) =>
      R.createElement(RN.Pressable, { testID: p.testID, accessibilityLabel: p.label, onPress: p.onPress }),
  };
});
jest.mock("../../ui/Sheet", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Sheet: (p: { visible: boolean; children?: React.ReactNode }) =>
      p.visible ? R.createElement(RN.View, { testID: "sheet" }, p.children) : null,
  };
});

/* eslint-disable import/first */
import {
  CountryConflictBanner,
  NameDiscardSheet,
  OtherDeviceBanner,
  PAYMENTS_SETUP_HOLD_MS,
  SessionExpiredSheet,
  countryConflict,
  finishingOnOtherDevice,
  isSessionExpiredError,
  keepBrandNameForSignIn,
  ownerDisplayName,
  shouldConfirmNameDiscard,
  takeKeptBrandName,
} from "../BrandSetupInterruptions";
import { AriSkipPaymentsCard } from "../../ari/AriSetupCard";
import { wantsToSkipPayments } from "../../ari/ariRedaction";
import { BRAND_SETUP_COPY as C } from "../brandSetupCopy";
/* eslint-enable import/first */

const BIZ = path.join(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(BIZ, rel), "utf8");

function mount(el: React.ReactElement): RendererInstance {
  let r!: RendererInstance;
  TestRenderer.act(() => {
    r = TestRenderer.create(el);
  });
  return r;
}
function texts(r: RendererInstance): string[] {
  return r.root
    .findAll((n) => n.type === "Text" || (typeof n.type === "string" && /Text/.test(n.type)), { deep: true })
    .flatMap((n) => {
      const c = n.props.children;
      return typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((x): x is string => typeof x === "string") : [];
    });
}
function labels(r: RendererInstance): string[] {
  return r.root
    .findAll((n) => typeof n.props.accessibilityLabel === "string" && typeof n.type === "string", { deep: true })
    .map((n) => n.props.accessibilityLabel as string);
}
function press(r: RendererInstance, testID: string): void {
  const hit = r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function", { deep: true })[0];
  if (!hit) throw new Error(`no ${testID}`);
  TestRenderer.act(() => (hit.props.onPress as () => void)());
}

describe("#4389 F1 discard on Back", () => {
  test("rule: only a typed, unsaved name asks", () => {
    expect(shouldConfirmNameDiscard("", false)).toBe(false);
    expect(shouldConfirmNameDiscard("   ", false)).toBe(false);
    expect(shouldConfirmNameDiscard("Lantern Room", false)).toBe(true);
    expect(shouldConfirmNameDiscard("Lantern Room", true)).toBe(false);
  });
  test("sheet words and buttons; Keep editing / Discard call back", () => {
    const keep = jest.fn();
    const discard = jest.fn();
    const r = mount(<NameDiscardSheet visible onKeepEditing={keep} onDiscard={discard} />);
    expect(texts(r)).toEqual(["Discard this brand name?", "It hasn't been saved yet."]);
    expect(labels(r)).toEqual(["Keep editing", "Discard"]);
    press(r, "brand-setup-f1-keep-editing");
    press(r, "brand-setup-f1-discard-confirm");
    expect(keep).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
    r.unmount();
  });
  test("F1 Back asks before discarding (button, swipe-back and Android back)", () => {
    const flow = read("src/components/brand/BrandCreationFlow.tsx");
    expect(flow).toContain('navigation.addListener("beforeRemove" as never');
    expect(flow).toContain('if (step === "name" && shouldConfirmNameDiscard(typedNameRef.current, nameSavingRef.current))');
    // A created brand or a draft redirect is a sanctioned leave, not a discard.
    expect(flow).toMatch(/onCreated=\{\(id\) => \{\s*typedNameRef\.current = "";/);
    expect(flow).toMatch(/onDraft=\{\(draftId, draftName\) => \{\s*typedNameRef\.current = "";/);
  });
});

describe("#4389 F1 session expired (R-12)", () => {
  test("auth failures are this state; network and server errors are not", () => {
    expect(isSessionExpiredError({ message: "JWT expired" })).toBe(true);
    expect(isSessionExpiredError({ code: "PGRST301", message: "x" })).toBe(true);
    expect(isSessionExpiredError({ status: 401 })).toBe(true);
    expect(isSessionExpiredError({ message: "Auth session missing!" })).toBe(true);
    expect(isSessionExpiredError({ message: "Failed to fetch" })).toBe(false);
    expect(isSessionExpiredError({ message: "draft_exists" })).toBe(false);
    expect(isSessionExpiredError(null)).toBe(false);
  });
  test("the typed name is kept once across sign-in", () => {
    keepBrandNameForSignIn("  Lantern Room ");
    expect(takeKeptBrandName()).toBe("Lantern Room");
    expect(takeKeptBrandName()).toBe("");
  });
  test("sheet words", () => {
    const onSignIn = jest.fn();
    const r = mount(<SessionExpiredSheet visible busy={false} onSignIn={onSignIn} onClose={() => undefined} />);
    expect(texts(r)).toEqual(["Sign in again to keep going", "Your brand name is kept."]);
    press(r, "brand-setup-sign-in");
    expect(onSignIn).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

describe("#4389 F2 conflict and forbidden", () => {
  test("first read is not a conflict; a change elsewhere against a different pick is", () => {
    expect(countryConflict({ previousServer: null, server: "GB", selected: "US" })).toBeNull();
    expect(countryConflict({ previousServer: "US", server: "US", selected: "CA" })).toBeNull();
    expect(countryConflict({ previousServer: "US", server: "GB", selected: "GB" })).toBeNull();
    expect(countryConflict({ previousServer: "US", server: "GB", selected: "CA" })).toBe("GB");
    expect(countryConflict({ previousServer: "US", server: null, selected: "CA" })).toBeNull();
  });
  test("banner words; Keep and Change", () => {
    const keep = jest.fn();
    const change = jest.fn();
    const r = mount(<CountryConflictBanner countryName="United Kingdom" onKeep={keep} onChange={change} />);
    expect(texts(r)).toEqual(["This was changed on another device to United Kingdom."]);
    expect(labels(r)).toEqual(["Keep", "Change"]);
    press(r, "brand-setup-conflict-keep");
    press(r, "brand-setup-conflict-change");
    expect(keep).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
    r.unmount();
  });
  test("a member below brand admin sees the forbidden words before tapping", () => {
    const flow = read("src/components/brand/BrandCreationFlow.tsx");
    const country = flow.slice(flow.indexOf("const CountryStep"), flow.indexOf("const PayStep"));
    expect(country).toContain("role.rank < BRAND_ROLE_RANK.brand_admin");
    expect(country).toContain("<ForbiddenBanner message={C.f2.forbidden} />");
    expect(country).toContain("disabled={selected === null || offline || forbidden ||");
    expect(country).not.toMatch(/<Sheet|<Modal/);
  });
});

describe("#4389 F3 other device (R-4) and owner name", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
  test("started elsewhere in the last 15 minutes with no account yet", () => {
    expect(finishingOnOtherDevice({ startedAt: iso(60_000), stripeState: "none", startedHere: false, now })).toBe(true);
    expect(finishingOnOtherDevice({ startedAt: iso(60_000), stripeState: "none", startedHere: true, now })).toBe(false);
    expect(finishingOnOtherDevice({ startedAt: iso(60_000), stripeState: "started", startedHere: false, now })).toBe(false);
    expect(finishingOnOtherDevice({ startedAt: iso(PAYMENTS_SETUP_HOLD_MS + 1), stripeState: "none", startedHere: false, now })).toBe(false);
    expect(finishingOnOtherDevice({ startedAt: null, stripeState: "none", startedHere: false, now })).toBe(false);
  });
  test("banner words with Refresh", () => {
    const refresh = jest.fn();
    const r = mount(<OtherDeviceBanner refreshing={false} onRefresh={refresh} />);
    expect(texts(r)).toEqual(["Finishing on your other device…"]);
    expect(labels(r)).toEqual(["Refresh"]);
    press(r, "brand-setup-other-device-refresh");
    expect(refresh).toHaveBeenCalledTimes(1);
    r.unmount();
  });
  test("not-owner copy names the owner", () => {
    const name = ownerDisplayName(
      [{ role: "brand_admin", displayName: "Ada" }, { role: "brand_owner", displayName: " Tunde " }],
      C.f3.ownerFallback,
    );
    expect(C.f3.notOwner(name)).toBe("Only Tunde can set up payments. We've added it to their Home.");
    expect(ownerDisplayName(undefined, C.f3.ownerFallback)).toBe("the owner");
    const flow = read("src/components/brand/BrandCreationFlow.tsx");
    expect(flow).not.toContain('C.f3.notOwner("the owner")');
    expect(flow).toContain("<ForbiddenBanner message={C.f3.notOwner(ownerName)} />");
    expect(flow).toContain("markPaymentsStartedHere(brandId);");
  });
});

describe("#4389 AR-12 Ari skip card", () => {
  test("skip intents", () => {
    expect(wantsToSkipPayments("skip the bank for now")).toBe(true);
    expect(wantsToSkipPayments("I'll do payments later")).toBe(true);
    expect(wantsToSkipPayments("free events only please")).toBe(true);
    expect(wantsToSkipPayments("I don't have a bank yet")).toBe(true);
    expect(wantsToSkipPayments("make an event later this week called Skip Day")).toBe(false);
    expect(wantsToSkipPayments("set up my bank")).toBe(false);
  });
  test("same words and buttons as K1, Set up bank now first", () => {
    const bank = jest.fn();
    const free = jest.fn();
    const r = mount(<AriSkipPaymentsCard platform="ios" state="ask" onBankNow={bank} onFreeOnly={free} />);
    expect(texts(r)).toEqual([C.k1.title, C.k1.body, C.k1.later, C.k1.bankNow, C.k1.freeOnly]);
    expect(labels(r)).toEqual([C.k1.bankNow, C.k1.freeOnly]);
    press(r, "ari-skip-bank-now");
    press(r, "ari-skip-free-only");
    expect(bank).toHaveBeenCalledTimes(1);
    expect(free).toHaveBeenCalledTimes(1);
    r.unmount();
    const saved = mount(<AriSkipPaymentsCard platform="ios" state="saved" onBankNow={bank} onFreeOnly={free} />);
    expect(texts(saved)).toEqual([C.k1.toast]);
    saved.unmount();
  });
  test("Ari shows it only for a brand still in setup that is not free-only", () => {
    const ari = read("src/screens/ari/AriChatScreen.tsx");
    expect(ari).toMatch(/!setupData\.facts\.complete &&\s*setupData\.facts\.freeOnlyAt === null &&\s*wantsToSkipPayments\(text\)/);
  });
});

describe("#4389 Dynamic Type at 200%: no clipped CTA", () => {
  test("the flow's CTAs are the shared Button (minHeight + capped scale), the page scrolls", () => {
    const button = read("src/components/ui/Button.tsx");
    expect(button).toContain("minHeight: containerHeight");
    expect(button).toContain("maxFontSizeMultiplier={BUTTON_MAX_FONT_SCALE}");
    const flow = read("src/components/brand/BrandCreationFlow.tsx");
    expect(flow).not.toMatch(/<Pressable[^>]*>\s*<Text[^>]*>\{C\.(f1|f2|f3)\.cta/);
    // Bodies scroll (the CTA stays reachable) and text boxes never use a fixed height.
    expect(flow).toContain('import { ScrollView } from "../../wrappers/SmartScrollView";');
    for (const name of ["input", "card", "banner", "footer", "helper", "cardText", "sub", "h1"]) {
      const rule = new RegExp(`\\n  ${name}: \\{([^}]*)\\}`).exec(flow)?.[1] ?? "";
      expect(rule).not.toMatch(/(^|[^a-zA-Z])height:/);
    }
    // The back glyph sits in a fixed 44pt box: its scale is capped.
    expect(flow).toContain('<Text style={styles.backGlyph} maxFontSizeMultiplier={1.4}>');
  });
});
