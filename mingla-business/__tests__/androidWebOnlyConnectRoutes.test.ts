import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");

const read = (relPath: string): string =>
  fs.readFileSync(path.join(repoRoot, relPath), "utf8");

const androidStartupRoutes = [
  "mingla-business/app/connect-onboarding.tsx",
  "mingla-business/app/connect-account-management.tsx",
  "mingla-business/app/connect-tax-registrations/index.tsx",
] as const;

const webOnlyRoutes = [
  "mingla-business/app/connect-onboarding.web.tsx",
  "mingla-business/app/connect-account-management.web.tsx",
  "mingla-business/app/connect-tax-registrations/index.web.tsx",
] as const;

describe("META-ORCH-0972 Sub-B Android startup route guard", () => {
  it("aliases Stripe Connect web SDK packages to a native-safe stub in Metro", () => {
    const metro = read("mingla-business/metro.config.js");
    expect(metro).toMatch(/@stripe\/connect-js/);
    expect(metro).toMatch(/@stripe\/react-connect-js/);
    expect(metro).toMatch(/stripeConnectNativeStub\.js/);

    const stub = read("mingla-business/src/shims/stripeConnectNativeStub.js");
    expect(stub).toMatch(/loadConnectAndInitialize/);
    expect(stub).toMatch(/ConnectComponentsProvider/);
    expect(stub).not.toMatch(/document\b/);
    expect(stub).not.toMatch(/window\b/);
  });

  it("keeps Android startup routes free of Stripe's web-only SDK", () => {
    for (const route of androidStartupRoutes) {
      expect(fs.existsSync(path.join(repoRoot, route))).toBe(true);
      const source = read(route);
      expect(source).toMatch(/NativeConnectWebOnlyFallback/);
      expect(source).not.toMatch(/@stripe\/react-connect-js/);
      expect(source).not.toMatch(/@stripe\/connect-js/);
      expect(source).not.toMatch(/<div\b|<main\b|<section\b|<header\b/);
    }
  });

  it("leaves the Stripe web SDK imports only in .web hosted route files", () => {
    for (const route of webOnlyRoutes) {
      const source = read(route);
      expect(source).toMatch(/@stripe\/react-connect-js/);
      expect(source).toMatch(/@stripe\/connect-js/);
    }
  });

  it("does not leave .native duplicate route files for Expo Router to also register", () => {
    for (const route of androidStartupRoutes) {
      const nativePath = route.replace(/\.tsx$/, ".native.tsx");
      expect(fs.existsSync(path.join(repoRoot, nativePath))).toBe(false);
    }
  });
});
