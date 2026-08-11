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
    // [TEST-MOD-APPROVED 1485] (CI token form: [TEST-MOD-APPROVED ORCH-1485])
    // Issue #1485 [web-missing-chunk-404]: the SPA fallback literal now excludes
    // /_expo/static/. The assertion below is unchanged — /auth/callback must
    // still be ordered BEFORE the fallback.
    // [TEST-MOD-APPROVED #922] The prior literal encoded superseded routing
    // truth. Locating the exact approved fallback preserves the callback owner
    // and ordering while accepting only #922's exact internal-entry exclusion.
    const fallbackIndex = vercel.rewrites.findIndex(
      (rewrite) =>
        rewrite.source ===
        "/((?!_expo/static/|accept-brand-invitation-entry$).*)",
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
    // [TEST-MOD-APPROVED ORCH-1098] Stage 3: the static /home is retired and the
    // real Expo app boots on every device, so the callback now sends EVERYONE to
    // "/" (no phone→/home device gate).
    expect(html).toContain('window.location.replace("/");');
    expect(html).not.toContain('isPhoneClient ? "/home" : "/"');
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
