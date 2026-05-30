// ORCH-1013 Finding B regression — <RunRemainderOnAllConfirmModal /> contract:
//   - <$10 totals: checkbox-only confirm
//   - >$10 totals: requires typed "RUN ALL" phrase + checkbox
//   - Body lists each candidate city with name + remaining_count + per-city cost
//   - Footer disclosure: "Up to 3 cities will run at a time"
//   - Cites Gemini pricing URL (COMMS-0003)
//
// node:test + source-string assertions (mingla-admin pattern).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const MODAL = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "RunRemainderOnAllConfirmModal.jsx",
);

describe("ORCH-1013 Finding B — RunRemainderOnAllConfirmModal contract", () => {
  const src = fs.readFileSync(MODAL, "utf8");

  it("declares the >$10 typed-confirm threshold + fixed phrase 'RUN ALL'", () => {
    assert.ok(
      /COST_REVIEW_THRESHOLD_USD\s*=\s*10\b/.test(src),
      "high-cost threshold constant must be $10",
    );
    assert.ok(
      /TYPED_CONFIRM_PHRASE\s*=\s*"RUN ALL"/.test(src),
      "typed phrase must be literally 'RUN ALL' (SPEC §7-D6)",
    );
  });

  it("renders the typed-input gate only when totalCost > threshold", () => {
    assert.ok(
      src.includes("requiresTypedConfirm = totalCost > COST_REVIEW_THRESHOLD_USD"),
      "must derive requiresTypedConfirm from totalCost > $10",
    );
  });

  it("canConfirm requires checkbox AND (no typed gate OR typed matches)", () => {
    assert.ok(
      src.includes("acknowledged") &&
        src.includes("typedMatches") &&
        src.includes("requiresTypedConfirm"),
      "canConfirm must require acknowledged + (no typed gate OR typedMatches)",
    );
  });

  it("checkbox label discloses the total Gemini charge", () => {
    assert.ok(
      src.includes("I understand this will charge"),
      "checkbox label must disclose the dollar charge",
    );
  });

  it("body lists candidate cities with name + remaining_count + per-city cost", () => {
    assert.ok(
      src.includes("safeCities.map"),
      "body must render one row per candidate city",
    );
    assert.ok(
      src.includes("remaining_count") && src.includes("perPlaceCostUsd"),
      "each row must show remaining_count and per-city cost",
    );
  });

  it("footer line discloses the 3-concurrent dispatcher behaviour", () => {
    assert.ok(
      src.includes("Up to 3 cities will run at a time"),
      "footer disclosure must mention the 3-concurrent cap",
    );
  });

  it("cites Gemini pricing URL (COMMS-0003)", () => {
    assert.ok(
      src.includes("ai.google.dev/pricing/gemini-2-5-flash"),
      "Gemini pricing URL must be linked inline per COMMS-0003",
    );
  });

  it("primary CTA disabled until canConfirm", () => {
    assert.ok(
      src.includes("disabled={!canConfirm}"),
      "primary CTA must reflect canConfirm gate",
    );
  });
});
