import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUSINESS_ROOT = join(__dirname, "..", "..", "..", "..");
const REPO_ROOT = join(BUSINESS_ROOT, "..");
const readBusiness = (path: string): string =>
  readFileSync(join(BUSINESS_ROOT, path), "utf8");
const readRepo = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), "utf8");

describe("issue #1380 accessibility and clean-install rework", () => {
  test("web tabs expose standards-based selected state without replacing native accessibility state", () => {
    const tabs = readRepo("packages/brand-rendering/PublicVenueTabs.tsx");

    expect(tabs).toContain('Platform.OS === "web"');
    expect(tabs).toContain('{ "aria-selected": active }');
    expect(tabs).toContain("accessibilityState={{ selected: active }}");
    expect(tabs).toContain("{...webAriaSelected}");
  });

  test("focus returns only after the maximum Sheet unmount window and next frame", () => {
    // [TEST-MOD-APPROVED #1559] — the buyer-web venue BODY moved to
// `packages/brand-rendering/PublicVenueScreen.tsx` (a pure move: render parity
// proven by publicVenueRenderParity.issue1559.happy.test.tsx). These assertions
// follow the code; the contract each one pins is unchanged.
    const page = readRepo("packages/brand-rendering/PublicVenueScreen.tsx");
    const wrapper = readBusiness(
      "src/components/venue/PublicVenueReservationSheet.tsx",
    );
    const delayMatch = /const FOCUS_RETURN_DELAY_MS = (\d+);/.exec(wrapper);

    expect(Number(delayMatch?.[1])).toBeGreaterThan(280);
    expect(wrapper).toContain("}, FOCUS_RETURN_DELAY_MS);");
    expect(wrapper).toContain("requestAnimationFrame(() => onDismissed?.())");
    expect(wrapper).toContain("cancelAnimationFrame(frame)");
    // The sheet is now an injected host slot, so the screen names the same
    // callback on the slot context instead of as a JSX prop. Same wiring.
    expect(page).toContain("onDismissed: handleReservationSheetDismissed");
    expect(page).not.toContain(
      'setTimeout(() => {\n      publicVenueTabsRef.current?.focusTab("reservations");',
    );
  });

  test("clean installs declare the exact React-compatible test renderer", () => {
    const manifest = JSON.parse(
      readBusiness("package.json"),
    ) as {
      devDependencies?: Record<string, string>;
    };
    const lock = readBusiness("package-lock.json");

    expect(manifest.devDependencies?.["react-test-renderer"]).toBe("19.1.0");
    expect(lock).toContain('"react-test-renderer": "19.1.0"');
    expect(lock).toContain('"node_modules/react-test-renderer"');
  });
});
