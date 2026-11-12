// #4402 — Admin creator review: honest flag words, a locked Verify with its
// reason, one name, per-handle approve and reject, and the full-page record.
// The PostgreSQL suite (issue_4402_creator_review) proves the server gates;
// these checks keep Admin on those contracts and its words honest.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CREATOR_COLUMNS,
  STEP_WORDS,
  audienceCompare,
  bandForCount,
  creatorCardLine,
  creatorColumnFor,
  creatorFlagGroups,
  creatorStepRows,
  flagLines,
  handleRejectNote,
  handleState,
  historyLine,
  programErrorMessage,
  verifyLockedLine,
  verifyResultMessage,
} from "../../lib/creatorPrograms.js";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("pages/ProgramCreatorsPage.jsx");
const service = read("services/creatorProgramsService.js");
const panel = read("components/programs/ProgramConversationPanel.jsx");
const player = read("components/programs/CreatorShowcasePlayer.jsx");

test("#4402 A1: missing steps read as missing, never as achievements", () => {
  const flags = ["verified_handle", "age_18_plus", "active_payout", "processed_showcase", "signed_agreement", "active_package"];
  const lines = flagLines(flags);
  assert.deepEqual(lines, [
    "No verified social account",
    "Age 18+ not confirmed",
    "No payout account",
    "No showcase video",
    "Creator agreement not signed",
    "No rates set",
  ]);
  for (const line of lines) assert.doesNotMatch(line, /^(Verified handle|Age 18 plus|Active payout|Processed showcase|Signed agreement)$/);
  const groups = creatorFlagGroups(["verified_handle", "handle_review:instagram"]);
  assert.deepEqual(groups.missing, ["No verified social account"]);
  assert.deepEqual(groups.needsPerson, ["Instagram couldn't be checked automatically"]);
});

test("#4402 the card line puts a person first, then what is missing", () => {
  const checks = [
    { key: "profile", done: true }, { key: "rates", done: true }, { key: "showcase", done: true },
    { key: "socials", done: false }, { key: "payout", done: false }, { key: "agreement", done: false },
  ];
  assert.equal(creatorCardLine({ verification: "incomplete", checks, flags: ["verified_handle"] }), "Missing: social account, payout, agreement");
  assert.equal(creatorCardLine({ verification: "review", checks, flags: ["handle_review:instagram"] }), "Instagram couldn't be checked automatically");
  assert.equal(creatorCardLine({ verification: "verified", checks, flags: [] }), "All six steps pass");
});

test("#4402 A4: admin step labels, not the creator's 'Your profile'", () => {
  assert.deepEqual(STEP_WORDS, {
    profile: "Profile",
    rates: "Rates",
    showcase: "Showcase video",
    socials: "Verified social account",
    payout: "Payout account",
    agreement: "Creator agreement (18+)",
  });
  assert.doesNotMatch(page, /check\.label/, "the record must not print the shared creator-facing SQL labels");
});

test("#4402 A5: Verify is locked with the reason until all six pass; the server is the gate", () => {
  assert.equal(
    verifyLockedLine("incomplete", ["socials", "payout", "agreement"]),
    "Verify unlocks when all six checks pass. Missing: verified social account, payout account, creator agreement (18+).",
  );
  assert.equal(
    verifyLockedLine("review", ["socials", "payout", "handle_review"]),
    "Verify unlocks when all six checks pass. Missing: payout account, a social account waiting for your review.",
  );
  assert.match(verifyLockedLine("suspended", ["handle_review"]), /^Lift suspension unlocks when all six checks pass\. Missing: a social account waiting for your review\.$/);
  assert.match(page, /const canVerify = detail\.can_verify === true;/);
  assert.match(page, /aria-disabled=\{canVerify \? undefined : "true"\}/);
  assert.match(page, /aria-describedby="creator-verify-why"/);
  assert.match(page, /if \(!canVerify\) \{\s*addToast\(\{ variant: "warning", title: lockedLine \}\);\s*return;\s*\}/, "a locked Verify press reads the reason and calls nothing");
  assert.equal(
    programErrorMessage({ error: "checks_incomplete", result: { missing: ["socials", "payout"] } }),
    "This creator still has steps missing: social account, payout.",
  );
  assert.equal(verifyResultMessage("verified"), "Creator verified. Hosts can now see them.");
  assert.doesNotMatch(verifyResultMessage("incomplete"), /Hosts can now see them/);
});

test("#4402 A3: one name — the creator display name everywhere, the panel prefers it", () => {
  assert.match(page, /const name = detail\.display_name \|\| "Creator";/);
  assert.match(page, /programKind="creator" targetUserId=\{detail\.creator_id\} recipientName=\{name\}/);
  assert.match(panel, /\(programKind === "creator" && recipientName\)\s*\|\| thread\?\.recipient_name/);
  assert.match(page, /\["Account name", detail\.account_name\]/, "the account name shows only as a labelled fact");
});

test("#4402 A7: Review holds the decision material; the conversation is its own tab", () => {
  const review = page.slice(page.indexOf('{tab === "review" ? ('), page.indexOf('{tab === "conversation" ? ('));
  const order = ["<SetupSteps", "<SocialAccounts", "<Rates", "<About", "<LocalAndPerson"].map((tag) => review.indexOf(tag));
  for (const at of order) assert.ok(at > 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Setup steps, Social accounts, Rates, About, then Local and person");
  assert.doesNotMatch(review, /ProgramConversationPanel/);
  assert.match(page, /\{ id: "review", label: "Review" \},\s*\{ id: "conversation", label: "Conversation" \},\s*\{ id: "history", label: "History" \}/);
  assert.match(page, /#\/program-creators/);
  assert.match(page, /params\.get\("creatorId"\)/, "the record is a full page with its own address");
});

test("#4402 handle decisions: one handle at a time, reject needs a reason, approve records a band", () => {
  assert.match(service, /write\("admin_creator_handle_decide", \{\s*p_handle_id: handleId,\s*p_decision: decision,\s*p_note:[^,]+,\s*p_band: band \|\| null,/);
  assert.match(service, /read\("admin_creator_detail", \{ p_creator_id: creatorId \}\)/);
  assert.deepEqual(handleRejectNote("", ""), { error: "Choose a reason." });
  assert.deepEqual(handleRejectNote("Something else", "  "), { error: "Say why, in a few words the creator will see." });
  assert.deepEqual(handleRejectNote("Not their account", ""), { note: "Not their account" });
  assert.deepEqual(handleRejectNote("Code not in the bio", "Add it again"), { note: "Code not in the bio. Add it again" });
  assert.match(page, /disabled=\{!seen\}/, "Approve needs the reviewer to confirm they saw the code");
  assert.equal(bandForCount(2337), "1k_10k");
  assert.equal(historyLine({ action: "handle_approve", platform: "instagram", follower_band: "1k_10k" }), "Approved handle · Instagram · band 1k–10k");
});

test("#4402 handle states and audience comparison are words, from server fields", () => {
  assert.equal(handleState({ platform: "instagram", review_required: true, review_reason: "provider_unreadable" }).text,
    "Needs a person: Instagram couldn't read the profile from our server");
  assert.equal(handleState({ platform: "instagram", last_check_status: "rejected", rejected_note: "Not their account" }).text, "Rejected: Not their account");
  assert.equal(handleState({ platform: "instagram", verified_at: "x", follower_source: "admin" }).text, "Approved by Mingla");
  const compare = audienceCompare({ platform: "instagram", follower_band: "1k_10k", follower_source: "provider", self_reported_band: "lt1k", provider_follower_count: 2337 });
  assert.equal(compare.mismatch, true);
  assert.equal(compare.count, 2337);
});

test("#4402 setup steps say who acts next", () => {
  const rows = creatorStepRows({
    display_name: "TEST Creator",
    checks: [{ key: "profile", done: true }, { key: "rates", done: true }, { key: "showcase", done: false }, { key: "socials", done: false }, { key: "payout", done: false }, { key: "agreement", done: false }],
    packages: [{ active: true, format_label: "Night out in 30 seconds" }],
    showcase: [{ status: "processing" }],
    handles: [{ platform: "instagram", handle: "uncledelena", review_required: true }],
    payout: { provider: null, status: "none" },
    agreement: { signed: false },
  });
  assert.deepEqual(rows.map((r) => r.key), ["profile", "rates", "showcase", "socials", "payout", "agreement"]);
  assert.deepEqual(rows.map((r) => r.tone), ["done", "done", "creator", "you", "creator", "creator"]);
  assert.equal(rows[2].tag, "Processing");
  assert.equal(rows[3].tag, "Needs you");
});

test("#4402 the board has five columns and Asked for more is not Setting up", () => {
  assert.deepEqual(CREATOR_COLUMNS.map((c) => c.id), ["needs_person", "setting_up", "waiting", "verified", "stopped"]);
  assert.equal(creatorColumnFor("needs_more"), "waiting");
  assert.match(page, /listCreatorQueue\("all"\)/);
});

test("#4402 the showcase player uses admin-signed playback, no download, no autoplay, every state", () => {
  assert.match(player, /getCreatorMediaPlayback\(jobId\)/);
  assert.doesNotMatch(player, /autoplay;/);
  assert.doesNotMatch(player, /\/render\/image/);
  for (const words of ["No showcase video yet", "Processing", "Couldn't process this video", "Try again"]) assert.ok(player.includes(words), words);
});
