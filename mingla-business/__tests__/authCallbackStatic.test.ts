import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "..");
const vercelPath = path.join(businessRoot, "vercel.json");
const callbackPath = path.join(businessRoot, "public/auth/callback.html");

describe("ORCH-1086 static web auth callback", () => {
  it("routes /auth/callback to the static handler before the SPA fallback", () => {
    const vercel = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };

    const callbackIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/auth/callback",
    );
    const fallbackIndex = vercel.rewrites.findIndex(
      (rewrite) => rewrite.source === "/(.*)",
    );

    expect(callbackIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBeGreaterThanOrEqual(0);
    expect(callbackIndex).toBeLessThan(fallbackIndex);
    expect(vercel.rewrites[callbackIndex]).toEqual({
      source: "/auth/callback",
      destination: "/auth/callback.html",
    });
  });

  it("keeps the callback handler independent of the Expo web bundle", () => {
    const html = fs.readFileSync(callbackPath, "utf8");

    expect(html).toContain("sb-gqnoajqerqhnvulmnyvv-auth-token");
    expect(html).toContain("/auth/v1/user");
    expect(html).toContain("normalized.padEnd");
    expect(html).toContain("window.localStorage.setItem");
    expect(html).toContain("JSON.stringify(session)");
    // [TEST-MOD-APPROVED ORCH-1098] callback is now device-gated: phones land on
    // the static /home safety page; desktop goes to "/" (the real Expo app).
    expect(html).toContain('window.location.replace(isPhoneClient ? "/home" : "/")');
    expect(html).not.toContain("__expo");
    expect(html).not.toContain("expo-router");
    expect(html).not.toContain("id=\"root\"");
  });

  it("handles OAuth error and missing-session branches without entering the SPA", () => {
    const html = fs.readFileSync(callbackPath, "utf8");

    expect(html).toContain("params.error");
    expect(html).toContain("No sign-in session was returned.");
    expect(html).toContain("Sign-in needs another try");
    expect(html).toContain('window.history.replaceState(null, "", "/auth/callback")');
  });
});
