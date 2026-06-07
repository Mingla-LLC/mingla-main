import fs from "node:fs";
import path from "node:path";

// [TEST-MOD-APPROVED ORCH-1098] Stage 3 supersedes Stage 1's device-gate.
//
// Stage 1 shipped a PHONE-ONLY static /home safety page (desktop bounced to the
// real app, phones kept the stripped page) because the real Expo app OOM-crashed
// on phone browsers. Stage 3 fixed that root cause (BottomNav reanimated loop)
// and DELETED the static /home — so the assertions below now guard the OPPOSITE
// end state: there is no static /home, and the auth callback sends EVERY device
// to the real app ("/").

const businessRoot = path.resolve(__dirname, "..");
const callbackPath = path.join(businessRoot, "public/auth/callback.html");
const homePath = path.join(businessRoot, "public/home.html");

describe("ORCH-1098 the real Expo app boots on every device (static /home retired)", () => {
  it("auth callback sends ALL devices straight to the real app", () => {
    const html = fs.readFileSync(callbackPath, "utf8");

    // every device → "/" (the real app); no phone→/home detour
    expect(html).toContain('window.location.replace("/");');
    expect(html).not.toContain('isPhoneClient ? "/home" : "/"');
    expect(html).not.toContain('window.location.replace("/home");');
  });

  it("deletes the static /home stand-in entirely", () => {
    expect(fs.existsSync(homePath)).toBe(false);
  });
});
