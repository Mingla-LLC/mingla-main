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

  // issue #3526 P1-R1 — the $10 escalation threshold was the LAST dollar amount
  // the admin still owned, and it survived round 2 precisely because it has no
  // server counterpart. A client-owned dollar figure governing a spend
  // confirmation is the same defect as a client-owned rate: when the rate moved
  // 2.2x, "$10" stopped meaning what it meant. It is published on the server's
  // cost_model now. The fixed phrase is NOT money and stays here.
  it("holds no dollar threshold of its own, and keeps the fixed phrase 'RUN ALL'", () => {
    assert.ok(
      !/COST_REVIEW_THRESHOLD_USD/.test(src),
      "the escalation threshold must come from the server, not a client constant",
    );
    assert.ok(
      src.includes("costModel?.costReviewThresholdUsd"),
      "the modal must read the threshold off the server's cost model",
    );
    assert.ok(
      /TYPED_CONFIRM_PHRASE\s*=\s*"RUN ALL"/.test(src),
      "typed phrase must be literally 'RUN ALL' (SPEC §7-D6)",
    );
  });

  it("renders the typed-input gate only when a KNOWN totalCost exceeds the server threshold", () => {
    assert.ok(
      src.includes(
        "requiresTypedConfirm = !costUnknown && reviewThreshold !== null &&",
      ),
      // issue #3526 — neither an unknown cost nor an unknown threshold may
      // satisfy a `>` comparison by accident: `null > 10` and `5 > null` both
      // evaluate false and would wave the run through without the escalation.
      "requiresTypedConfirm must require BOTH a known cost and a known threshold",
    );
    assert.ok(
      src.includes("totalCost > reviewThreshold"),
      "the comparison must use the server-supplied threshold",
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
      src.includes("remaining_count") && src.includes("estimateCostUsd(c.remaining_count, costModel)"),
      // issue #3526 P0-1 — per-city cost is priced from the SERVER's model, not
      // a `perPlaceCostUsd` prop defaulted to a stale client constant.
      "each row must show remaining_count and a server-priced per-city cost",
    );
  });

  it("footer line discloses the 3-concurrent dispatcher behaviour", () => {
    assert.ok(
      src.includes("Up to 3 cities will run at a time"),
      "footer disclosure must mention the 3-concurrent cap",
    );
  });

  it("cites the pricing URL the SERVER supplies (COMMS-0003)", () => {
    // issue #3526 — COMMS-0003 wants the provider doc cited; it does not want
    // it frozen in the client. The URL used to be a hardcoded
    // `ai.google.dev/pricing/gemini-2-5-flash`, a third spelling of the retired
    // model that survived every sweep, rendered on the spend screen.
    assert.ok(
      /href=\{costModel\?\.pricingReferenceUrl/.test(src),
      "the pricing href must come from the server's cost model",
    );
    assert.ok(
      !/gemini-\d+[-.]\d+-flash/i.test(src),
      "no model-version spelling may be hardcoded in this modal",
    );
  });

  // issue #3526 P3-R4 — the dead affordance.
  //
  // When the server has not published a cost the run can never start, so the
  // acknowledgement checkbox invited a tick that could not lead anywhere
  // (Constitution #1, no dead taps) beside a disabled button that gave no
  // reason (Constitution #3, no silent failures). Restoring either — rendering
  // the checkbox unconditionally, or dropping the title — must fail here.
  it("offers no acknowledgement it cannot honour, and says why the CTA is off", () => {
    assert.ok(
      /\{costUnknown \? \(/.test(src),
      "the cost-unknown branch must replace the checkbox, not merely reword it",
    );
    assert.ok(
      src.includes("Cost unavailable"),
      "an unpriceable run must say so in the body, not only by a disabled button",
    );
    // The checkbox must live on the OTHER side of that branch.
    const unknownBranch = src.slice(
      src.indexOf("{costUnknown ? ("),
      src.indexOf(") : ("),
    );
    assert.ok(
      !unknownBranch.includes('type="checkbox"'),
      "no checkbox may render while the run is unstartable",
    );
    assert.ok(
      /disabled=\{!canConfirm\}[\s\S]{0,400}?title=\{/.test(src),
      "the disabled CTA must carry a title explaining which gate is unmet",
    );
    // One stated reason per gate that can hold the button off.
    for (
      const reason of [
        "did not return a per-place cost",   // unpriceable
        "No city has un-evaluated places",   // nothing to queue
        "Tick the acknowledgement",          // unticked
        "to confirm a run above",            // typed-confirm outstanding
      ]
    ) {
      assert.ok(
        src.includes(reason),
        `the CTA title must name the unmet gate — missing "${reason}"`,
      );
    }
  });

  it("primary CTA disabled until canConfirm", () => {
    assert.ok(
      src.includes("disabled={!canConfirm}"),
      "primary CTA must reflect canConfirm gate",
    );
  });
});
