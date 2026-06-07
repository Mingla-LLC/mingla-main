import fs from "node:fs";
import path from "node:path";

// ORCH-1098 Stage 1 — the static /home + /auth/callback safety pages are
// PHONE-ONLY. Desktop / large browsers must reach the real Expo app ("/"),
// never the stripped static text page. These assertions guard the device gate
// so a future edit can't silently re-leak the static page to desktop.

const businessRoot = path.resolve(__dirname, "..");
const callbackPath = path.join(businessRoot, "public/auth/callback.html");
const homePath = path.join(businessRoot, "public/home.html");

const PHONE_PREDICATE =
  '/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")';

describe("ORCH-1098 desktop reaches the real app, phone keeps the safety page", () => {
  it("auth callback sends desktop to '/' and phones to the static /home", () => {
    const html = fs.readFileSync(callbackPath, "utf8");

    // device gate present
    expect(html).toContain('matchMedia("(max-width: 767px), (pointer: coarse)")');
    expect(html).toContain(PHONE_PREDICATE);
    // phone → /home safety page; desktop → / real app
    expect(html).toContain('window.location.replace(isPhoneClient ? "/home" : "/")');
    // the old unconditional desktop leak is gone
    expect(html).not.toContain('window.location.replace("/home");');
  });

  it("static home bounces desktop into the real app before rendering", () => {
    const html = fs.readFileSync(homePath, "utf8");

    expect(html).toContain('id="orch1098-desktop-to-real-app"');
    expect(html).toContain('matchMedia("(max-width: 767px), (pointer: coarse)")');
    expect(html).toContain(PHONE_PREDICATE);
    expect(html).toContain('if (!isPhoneClient) {');
    expect(html).toContain('window.location.replace("/");');

    // the bounce must run BEFORE the page's visible markup so desktop never
    // flashes the stripped page — the guard script precedes the <style> block.
    const guardIndex = html.indexOf('id="orch1098-desktop-to-real-app"');
    const styleIndex = html.indexOf("<style>");
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(styleIndex).toBeGreaterThan(guardIndex);
  });
});
