/**
 * ORCH-1289 — marketing SMS/MMS composer: blank-preview fix + multi-select
 * (≤10) + STOP-footer-on-its-own-line + hidden SMS cost.
 *
 * MIX: one EXECUTABLE unit test (bodyWithFooter — real fails-on-revert for the
 * STOP-newline change) plus SOURCE-CONTRACT reads (compose.tsx pulls in
 * expo-router / TenTap / reanimated which this node/ts-jest config cannot mount,
 * per feedback_biz_web_authed_runtime_unreachable_cap_claims — source-contract
 * is the honest ceiling; the tester drives the real runtime). The contracts are
 * the fails-on-revert guards for the render + multi-select-cap fixes.
 */

import { readFileSync } from "fs";
import path from "path";

import { bodyWithFooter } from "../../../utils/smsCost";

const read = (rel: string): string =>
  readFileSync(path.join(__dirname, rel), "utf8");

const COMPOSE = read("../../../../app/(tabs)/marketing/campaigns/compose.tsx");
const CARD = read("../SmsComposeCard.tsx");
const PANE = read("../SmsPreviewPane.tsx");
const ADAPTER = read(
  "../../../../../supabase/functions/_shared/adapters/smsAdapter.ts",
);
const SEND = read("../../../../../supabase/functions/marketing-send/index.ts");

describe("ORCH-1289 fix #3 — STOP footer on its own line (executable)", () => {
  it("puts the STOP footer on its own line (blank line, then the STOP line)", () => {
    const out = bodyWithFooter("hey get this");
    // FAILS-ON-REVERT: reverting bodyWithFooter to `${body} ${STOP_FOOTER}`
    // (single space) makes this exact-equality assertion FAIL.
    expect(out).toBe("hey get this\n\nReply STOP to opt out.");
    expect(out).toContain("\n\nReply STOP to opt out.");
    expect(out).not.toContain("get this Reply STOP");
  });

  it("is still idempotent (never double-appends)", () => {
    const out = bodyWithFooter("Come to our show");
    expect(bodyWithFooter(out)).toBe(out);
  });

  it("adapter composes the marketing footer on its own line; transactional keeps the space", () => {
    // The wire body (composeSmsBody) matches the preview only when the
    // marketing route asks for the own-line footer.
    expect(ADAPTER).toContain('stopFooterOwnLine');
    expect(ADAPTER).toContain('stopFooterOwnLine ? "\\n\\n" : " "');
    // marketing-send opts INTO the own-line footer (wire body change → redeploy).
    expect(SEND).toMatch(/stopFooterOwnLine:\s*true/);
  });
});

describe("ORCH-1289 fix #1 — blank image preview root-cause fix", () => {
  it("preview pane is fed the resolved public/remote uris, NOT the raw local uri", () => {
    // FAILS-ON-REVERT: restoring `mediaUri={mmsLocalUri}` (the dead-blob path)
    // fails both assertions.
    expect(COMPOSE).toMatch(/mediaUris=\{mmsPreviewUris\}/);
    expect(COMPOSE).not.toMatch(/mediaUri=\{mmsLocalUri\}/);
  });

  it("display uris PREFER the verified remote URL over the local preview", () => {
    // The verified public URL is cross-platform-renderable and == what is sent;
    // the local blob/file uri is only the pre-upload optimistic preview.
    expect(COMPOSE).toMatch(/m\.remoteUrl\s*\?\?\s*m\.localUri/);
  });

  it("the compose card renders the resolved item uris (not a single dead local uri)", () => {
    expect(COMPOSE).toMatch(/media=\{mmsComposeItems\}/);
    expect(CARD).toMatch(/media\.map\(/);
  });

  it("SmsPreviewPane renders ALL attached photos", () => {
    expect(PANE).toMatch(/mediaUris\.map\(/);
    // Still uses the shared wire-body helper (preview == sent).
    expect(PANE).toMatch(/bodyWithFooter\(body\)/);
  });

  it("web blob URLs are revoked on removal / channel-change / unmount, NOT right after upload", () => {
    // The old bug revoked the picked blob in a `finally` immediately after
    // upload, killing the still-referenced <Image> source. The fix keeps the
    // blob alive for the optimistic preview and revokes only on teardown.
    expect(COMPOSE).toMatch(/revokeBrowserPickedFiles/);
    // Removal by key + the unmount cleanup effect both revoke.
    expect(COMPOSE).toMatch(/removed\?\.objectUrl/);
    expect(COMPOSE).toMatch(/mmsMediaRef\.current/);
  });
});

describe("ORCH-1289 fix #2 — multi-select up to the safe MMS limit (10)", () => {
  it("caps at 10 (Twilio MMS limit) in both the parent and the card", () => {
    expect(COMPOSE).toMatch(/const MMS_MAX_MEDIA = 10/);
    expect(CARD).toMatch(/export const MMS_MAX_MEDIA = 10/);
  });

  it("enables multi-select on native + web (no more single-select)", () => {
    // FAILS-ON-REVERT: restoring allowsMultipleSelection:false / selectionLimit:1
    // fails these assertions.
    expect(COMPOSE).toMatch(/allowsMultipleSelection:\s*true/);
    expect(COMPOSE).not.toMatch(/allowsMultipleSelection:\s*false/);
    expect(COMPOSE).not.toMatch(/selectionLimit:\s*1\b/);
    expect(COMPOSE).toMatch(/multiple:\s*true/); // web file input
  });

  it("clamps the pick to the remaining slots and warns when the cap is hit", () => {
    expect(COMPOSE).toMatch(/const remaining = MMS_MAX_MEDIA - mmsMedia\.length/);
    expect(COMPOSE).toMatch(/selectionLimit:\s*remaining/);
    expect(COMPOSE).toMatch(/maxFiles:\s*remaining/);
    expect(COMPOSE).toMatch(/can carry up to \$\{MMS_MAX_MEDIA\} photos/);
  });

  it("the card disables adding once the cap is reached", () => {
    expect(CARD).toMatch(/const canAddMore = media\.length < maxMedia/);
  });

  it("the send path threads ALL media urls (not just the first) to the adapter", () => {
    // twilioSend appends every MediaUrl; marketing-send passes the whole array.
    expect(ADAPTER).toMatch(/for \(const u of mediaUrls\)/);
    expect(ADAPTER).toMatch(/params\.append\(\s*["']MediaUrl["']/);
    expect(SEND).toMatch(/mediaUrls,/);
  });

  it("never fires a send while a photo is still uploading", () => {
    expect(COMPOSE).toMatch(/channel === "sms" && mmsUploading/);
  });
});

describe("ORCH-1289 fix #4 — SMS cost hidden behind a restorable flag", () => {
  it("hides the $ estimate behind SHOW_SMS_COST = false", () => {
    expect(CARD).toMatch(/const SHOW_SMS_COST = false/);
    // The $ figure only renders inside the SHOW_SMS_COST branch.
    expect(CARD).toMatch(/SHOW_SMS_COST \? \(/);
    const flagIdx = CARD.indexOf("SHOW_SMS_COST ? (");
    const costIdx = CARD.indexOf("~{formatCurrency(");
    expect(flagIdx).toBeGreaterThan(-1);
    expect(costIdx).toBeGreaterThan(flagIdx); // cost figure sits inside the flag gate
  });

  it("keeps the cost-computation logic intact (trivially restorable)", () => {
    // estimateSmsCost is still imported + called — only the display is gated.
    expect(CARD).toMatch(/estimateSmsCost\(/);
  });
});
