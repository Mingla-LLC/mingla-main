import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cwd } from "node:process";
import test from "node:test";
import { checkProgramDraft } from "../../lib/creatorPrograms.js";

const root = cwd();
const panelSource = fs.readFileSync(path.join(root, "src/pages/locals/LocalsPanel.jsx"), "utf8");
const serviceSource = fs.readFileSync(path.join(root, "src/services/creatorProgramsService.js"), "utf8");

// [TEST-MOD-APPROVED #3872] walkthrough W4: Locals moved to Programs › Mingla Locals;
// the structural checks live in programs.issue3872.test.js. This file now pins
// the per-city rate rules (decision 6).
test("#3872 a city's details: whole seats 0-10, never below seated Locals, a rate above 0 in the chosen currency", () => {
  assert.deepEqual(checkProgramDraft({ seats: "3", rate: "150", currency: "USD" }, 1), { values: { seats: 3, monthlyRateMinor: 15000, payoutCurrency: "USD" } });
  assert.deepEqual(checkProgramDraft({ seats: "2", rate: "60000", currency: "NGN" }, 0).values, { seats: 2, monthlyRateMinor: 6000000, payoutCurrency: "NGN" });
  assert.match(checkProgramDraft({ seats: "1", rate: "150", currency: "USD" }, 2).errors.seats, /2 active or reserved Local seats/);
  assert.match(checkProgramDraft({ seats: "11", rate: "150", currency: "USD" }, 0).errors.seats, /0 to 10/);
  assert.match(checkProgramDraft({ seats: "3", rate: "0", currency: "USD" }, 0).errors.rate, /above 0/);
  assert.match(checkProgramDraft({ seats: "3", rate: "150.5", currency: "USD" }, 0).errors.rate, /whole/);
  assert.match(checkProgramDraft({ seats: "3", rate: "150", currency: "XYZ" }, 0).errors.currency, /currency/);
});

test("#4182 Local approval requires private playback plus a human review attestation", () => {
  assert.match(serviceSource, /functions\.invoke\([\s\S]*"creator-media-status"/);
  assert.match(panelSource, /<iframe[\s\S]*src=\{grant\.url\}/);
  assert.match(panelSource, /I watched every submitted video/);
  assert.match(panelSource, /disabled=\{!allMediaLoaded \|\| !watchedAllMedia \|\| !socialReady\}/);
  assert.match(panelSource, /Check the public post/);
  assert.match(panelSource, /It uses the submitted review video/);
  assert.match(panelSource, /It is posted by the applicant's submitted account/);
  assert.match(panelSource, /It includes a clear paid partnership or ad disclosure/);
  assert.match(panelSource, /It tags or invites @usemingla as a collaborator/);
  assert.match(panelSource, /confirmLocalSocialPost/);
  assert.match(serviceSource, /local_social_check_admin_confirm/);
  assert.match(panelSource, /No submitted video is attached\.[\s\S]*This review cannot be\s+approved\./);
});

test("#4182 Admin invites the applicant to the server-owned agreement and never signs for them", () => {
  assert.match(panelSource, /Only the applicant can sign and activate the reserved seat/);
  assert.match(panelSource, /Invite to sign agreement/);
  assert.match(panelSource, /Signature window expired/);
  assert.match(panelSource, /Server-owned and read-only in Admin/);
  assert.match(panelSource, /there is no Admin signature field/);
  assert.match(serviceSource, /p_agreement_version:\s*null/);
  assert.doesNotMatch(panelSource, /Approved agreement version|Seat Local/);
});

test("#4182 Admin uses the approved operations workspace instead of stacked decision cards", () => {
  assert.match(panelSource, /Mingla Local program status/);
  assert.match(panelSource, /Application queue/);
  assert.match(panelSource, /Application detail/);
  assert.match(panelSource, /Review queue/);
  assert.match(panelSource, /local-review-detail/);
  assert.match(panelSource, /id: "city-programs"/);
  assert.match(panelSource, /tab === "city-programs"/);
  assert.match(panelSource, /Current picks/);
  assert.match(panelSource, /Local payouts/);
  assert.match(panelSource, /!item\.share_status && rowError\[key\]/);
  assert.match(panelSource, /Loading Mingla Locals/);
  assert.match(panelSource, /Try again/);
});

test("#4182 Admin review is private playback only and never offers a Local video download", () => {
  assert.match(panelSource, /Private Bunny video/);
  assert.match(panelSource, /Admin-only signed playback\. Download is unavailable\./);
  assert.match(panelSource, /expiring Admin-only grant/);
  assert.match(panelSource, /Approval unlocks after every submitted video is loaded and watched/);
  assert.doesNotMatch(panelSource, /downloadLocal|downloadReview|Download video/);
});
