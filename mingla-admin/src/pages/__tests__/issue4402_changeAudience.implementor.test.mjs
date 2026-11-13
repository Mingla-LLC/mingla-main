// #4402 — Seth's live pass (12 Nov 2026): "Once you choose what you saw no way
// to change if you made a mistake." An approved handle offers Change audience,
// which opens the same band picker prefilled with the recorded band and needs
// a reason; History shows the old and the new band. Also L2: a showcase
// playback error renders inside the video frame.
//
// The server gate is supabase/migrations/__tests__/issue_4402_admin_change_handle_band.implementor.pg17.test.sql.
// Fails on 0f4e29393c: no Change audience action, no handle_band_change words,
// and the playback error rendered below the frame.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adminRoot, withVite } from "../../__tests__/issue4238_ssr.helper.mjs";

const approved = {
  id: "h1", platform: "instagram", handle: "band.creator", verify_code: "MINGLA-3367",
  verified_at: "2026-11-12T10:00:00Z", review_required: false, last_check_status: "verified",
  follower_band: "1k_10k", follower_source: "admin", self_reported_band: "lt1k",
};
const noop = () => {};

test("#4402 an approved handle offers Change audience; a waiting or rejected one does not", async () => {
  await withVite(async (vite) => {
    const { HandleRow } = await vite.ssrLoadModule("/src/pages/ProgramCreatorsPage.jsx");
    const row = (handle) => renderToStaticMarkup(React.createElement(HandleRow, {
      handle, canAct: true, onApprove: noop, onReject: noop, onReopen: noop, onChangeBand: noop,
    }));
    assert.match(row(approved), />Change audience</);
    assert.match(row(approved), /Revoke handle/);
    assert.doesNotMatch(row({ ...approved, verified_at: null, review_required: true, last_check_status: "code_seen" }), /Change audience/);
    assert.doesNotMatch(row({ ...approved, verified_at: null, last_check_status: "rejected", rejected_note: "x" }), /Change audience/);
    const locked = renderToStaticMarkup(React.createElement(HandleRow, {
      handle: approved, canAct: false, onApprove: noop, onReject: noop, onReopen: noop, onChangeBand: noop,
    }));
    assert.doesNotMatch(locked, /Change audience/);
  });
});

test("#4402 the picker is prefilled with the recorded band and needs a reason", async () => {
  await withVite(async (vite) => {
    const { ChangeAudienceDialog } = await vite.ssrLoadModule("/src/pages/ProgramCreatorsPage.jsx");
    const html = renderToStaticMarkup(React.createElement(ChangeAudienceDialog, { handle: approved, onClose: noop, onConfirm: noop }));
    assert.match(html, /Change audience for @band\.creator\?/);
    assert.match(html, /<option value="1k_10k" selected="">/, "prefilled with the band on record");
    for (const band of ["lt1k", "1k_10k", "10k_50k", "50k_250k", "250k_1m", "gt1m"]) assert.match(html, new RegExp(`<option value="${band}"`));
    assert.match(html, /Reason \(required\)/);
    assert.match(html, /The handle stays approved/);
    // Unchanged band and no reason: the action is disabled.
    assert.match(html, /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Change audience/s);
  });
});

test("#4402 the change goes to the admin-only RPC and History shows old → new", async () => {
  await withVite(async (vite) => {
    const { historyLine, programErrorMessage } = await vite.ssrLoadModule("/src/lib/creatorPrograms.js");
    assert.equal(
      historyLine({ action: "handle_band_change", platform: "instagram", follower_band: "lt1k", previous_follower_band: "1k_10k" }),
      "Changed audience band · Instagram · 1k–10k → Under 1k",
    );
    assert.match(programErrorMessage({ error: "band_unchanged" }), /already the recorded band/);
  });
  const service = fs.readFileSync(path.join(adminRoot, "src/services/creatorProgramsService.js"), "utf8");
  assert.match(service, /write\("admin_creator_handle_band_change", \{\s*p_handle_id: handleId,\s*p_band: band \|\| null,\s*p_note:/);
  const page = fs.readFileSync(path.join(adminRoot, "src/pages/ProgramCreatorsPage.jsx"), "utf8");
  assert.match(page, /await changeCreatorHandleBand\(changingBand\.id, band, note\)/);
});

test("#4402 L2: a playback error shows inside the video frame", async () => {
  const player = fs.readFileSync(path.join(adminRoot, "src/components/programs/CreatorShowcasePlayer.jsx"), "utf8");
  const frame = player.slice(player.indexOf("<div className={FRAME} aria-busy={loading}>"), player.indexOf("{error && grant?.url ?"));
  assert.match(frame, /role="alert"/);
  assert.match(frame, /Couldn't play this video/);
  assert.match(frame, /\{error\}/);
});
