// Issue #3697 (answer 7) — misfit videos are blocked only inside the Campaign
// Builder. A library card shows fit tiles and stays usable.
// MINGLA-INVARIANT: I-ADS-MISFIT-BLOCKED-IN-BUILDER | issue #3697 | fit tiles never disable library reuse; a misfit video is blocked in the Builder and at the server fit gates
// Invariant I-ADS-FIT-BEFORE-FUNDING (declared in supabase/functions/ad-plan/__tests__/issue_3697_fit_gate.test.ts)
//
// FAILS ON REVERT: make useInCampaignState depend on fit, let builderVideoRow
// select a misfit, or drop the Builder's video Continue block.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  builderVideoRow,
  cardFitTiles,
  fitSentence,
  selectedVideoMisfitAlert,
  useInCampaignState,
} from "../../components/ad-engine/creativeLibraryModel.js";

const fit = (overrides = {}) => [
  { platform: "meta", fits: true, needs: [], warn: false },
  { platform: "tiktok", fits: true, needs: [], warn: false },
  { platform: "google", fits: true, needs: [], warn: false },
  { platform: "snapchat", fits: false, needs: ["1080×1920"], warn: false },
  { platform: "reddit", fits: true, needs: [], warn: false },
].map((tile) => ({ ...tile, ...(overrides[tile.platform] ?? {}) }));

const LANTERN = {
  id: "c1",
  name: "Lantern Room — Friday hero",
  kind: "video",
  status: "active",
  house_reuse_allowed: true,
  width: 720,
  height: 1280,
  aspect_ratio: 0.5625,
  duration_seconds: 15,
  fit: fit(),
};

test("#3697 a Snapchat misfit card keeps 'Use in campaign' enabled", () => {
  assert.deepEqual(useInCampaignState(LANTERN), { shown: true, disabled: false, reason: null });
  const tiles = cardFitTiles(LANTERN);
  assert.deepEqual(tiles.map((tile) => tile.platform), ["meta", "tiktok", "google", "snapchat"]);
  assert.equal(tiles[3].state, "misfit");
  assert.equal(tiles[3].reason, "Needs 1080×1920");
  assert.equal(fitSentence(tiles), "Fits Meta, TikTok and Google. Won't fit Snapchat: needs 1080 by 1920.");
});

test("#3697 only Host-only and archived cards disable 'Use in campaign'", () => {
  const hostOnly = useInCampaignState({ ...LANTERN, house_reuse_allowed: false, brand_name: "Gogi" });
  assert.equal(hostOnly.disabled, true);
  assert.equal(hostOnly.reason, "Only Gogi's own ads can use this until host-media Terms are approved.");
  assert.equal(useInCampaignState({ ...LANTERN, status: "archived" }).shown, false);
});

test("#3697 the Builder blocks a misfit row with the reason, and selects a fit", () => {
  const blocked = builderVideoRow(LANTERN, ["meta", "tiktok", "snapchat"]);
  assert.equal(blocked.selectable, false);
  assert.equal(blocked.reason, "Can't use with Snapchat: it needs 1080×1920, and this video is 720×1280.");
  assert.equal(builderVideoRow(LANTERN, ["meta", "tiktok"]).selectable, true);

  const short = builderVideoRow(
    { ...LANTERN, duration_seconds: 4, fit: fit({ meta: { fits: false, needs: ["at least 5 seconds"] }, tiktok: { fits: false, needs: ["at least 5 seconds"] }, snapchat: { fits: false, needs: ["9:16"] } }) },
    ["meta", "tiktok", "snapchat"],
  );
  assert.equal(short.reason, "Too short for Meta and TikTok (need at least 5 s), and Snapchat needs 9:16.");
  assert.equal(
    selectedVideoMisfitAlert(LANTERN, ["meta", "snapchat"]),
    "Your video doesn't fit Snapchat any more. Pick another video or remove Snapchat.",
  );
});

test("#3697 the card wires fit to nothing but the tiles; the Builder row and Continue block misfits", () => {
  const card = readFileSync(new URL("../../components/ad-engine/CreativeCard.jsx", import.meta.url), "utf8");
  // Use in campaign is disabled only by useInCampaignState (never by `fit`).
  assert.match(card, /aria-disabled=\{use\.disabled \|\| undefined\}/);
  assert.doesNotMatch(card, /use\.disabled\s*=|disabled=\{[^}]*fit/);
  // The Builder row is aria-disabled (still focusable) with a visible reason.
  assert.match(card, /role="radio"[\s\S]*aria-disabled=\{blocked \|\| undefined\}[\s\S]*aria-describedby=\{blocked \? reasonId : undefined\}/);

  const step = readFileSync(new URL("../../components/campaign-builder/StepCreative.jsx", import.meta.url), "utf8");
  assert.match(step, /builderVideoRow\(row, reportPlatforms\)/);
  assert.match(step, /selectedVideoMisfitAlert\(selectedLibraryRow, reportPlatforms\)/);

  const builder = readFileSync(new URL("../CampaignBuilderPage.jsx", import.meta.url), "utf8");
  assert.match(builder, /creative\.kind === "video" && creativePartition\.excluded\.length > 0\)\s*return false;/);
});
