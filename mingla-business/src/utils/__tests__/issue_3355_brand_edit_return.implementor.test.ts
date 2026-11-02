/**
 * #3355 bug 18 — saving Brand Edit sent the owner to the Account screen when
 * the page had no back history (Ari's handoff link opened it directly on web).
 * Now: back history, then the opener's returnTo (internal paths only), then
 * the brand's own page; never Account. Ari passes its own path as returnTo.
 * The route and Ari's setup pane are rendered in
 * issue_3355_brand_edit_return_route.implementor.test.tsx.
 */
import {
  ariReturnPath,
  brandEditReturnTarget,
  isBrandEditRoute,
  safeReturnTo,
  withReturnTo,
} from "../brandEditReturn";

describe("#3355 Brand Edit return target", () => {
  test("back history wins", () => {
    expect(
      brandEditReturnTarget({ canGoBack: true, returnTo: "/(tabs)/ari", brandId: "b1" }),
    ).toEqual({ kind: "back" });
  });

  test("no history: the opener's returnTo", () => {
    expect(
      brandEditReturnTarget({
        canGoBack: false,
        returnTo: "/(tabs)/ari?brandId=b1&sitesIntent=setup",
        brandId: "b1",
      }),
    ).toEqual({ kind: "replace", href: "/(tabs)/ari?brandId=b1&sitesIntent=setup" });
  });

  test("no history and no returnTo: the brand's own page, never Account", () => {
    const target = brandEditReturnTarget({ canGoBack: false, returnTo: undefined, brandId: "b1" });
    expect(target).toEqual({ kind: "replace", href: "/brand/b1" });
    expect(JSON.stringify(target)).not.toContain("account");
    expect(brandEditReturnTarget({ canGoBack: false, returnTo: null, brandId: null })).toEqual({
      kind: "replace",
      href: "/(tabs)/home",
    });
  });

  test("only internal paths are honoured", () => {
    for (const bad of [
      "https://evil.test/x",
      "//evil.test/x",
      "javascript:alert(1)",
      "/javascript:alert(1)",
      "/\\evil.test",
      "ari",
      "",
      42,
    ]) {
      expect(safeReturnTo(bad)).toBeNull();
      expect(
        brandEditReturnTarget({ canGoBack: false, returnTo: bad, brandId: "b1" }),
      ).toEqual({ kind: "replace", href: "/brand/b1" });
    }
  });

  test("Ari adds its own path to a Brand Edit handoff", () => {
    expect(isBrandEditRoute("/brand/b1/edit?section=photo")).toBe(true);
    expect(isBrandEditRoute("/brand/b1/edit")).toBe(true);
    expect(isBrandEditRoute("/brand/b1/website")).toBe(false);
    const back = ariReturnPath({ brandId: "b1", sitesIntent: "setup", setupPart: "brand" });
    expect(back).toBe("/(tabs)/ari?brandId=b1&sitesIntent=setup&setupPart=brand");
    const route = withReturnTo("/brand/b1/edit?section=photo", back);
    const query = new URLSearchParams(route.split("?")[1]);
    expect(query.get("section")).toBe("photo");
    expect(query.get("returnTo")).toBe(back);
    expect(ariReturnPath({ brandId: null, sitesIntent: undefined, setupPart: null })).toBe("/(tabs)/ari");
  });
});
