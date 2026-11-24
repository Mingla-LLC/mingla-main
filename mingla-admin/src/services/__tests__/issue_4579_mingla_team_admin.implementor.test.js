// #4579 — the admin console's brand detail marks Mingla admins added
// automatically ("Auto (Mingla Team)") and shows whether the brand removed
// Mingla Team, when and by whom. Read-only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const service = fs.readFileSync(path.resolve(here, "../identityReadService.js"), "utf8");
const page = fs.readFileSync(path.resolve(here, "../../pages/BrandsConsolePage.jsx"), "utf8");
const start = service.indexOf("/** #4579: why an automatic Mingla admin row ended.");
const end = service.indexOf("// ── Resolve helpers", start);
assert.ok(start >= 0 && end > start, "#4579 helpers are present");
const { minglaRemovalLabel, minglaTeamSummary } = await import(
  `data:text/javascript;base64,${Buffer.from(service.slice(start, end)).toString("base64")}`
);

const auto = (id, extra = {}) => ({ id, user_id: `u-${id}`, granted_via: "mingla_admin", accepted_at: "2026-11-23", removed_at: null, ...extra });

describe("#4579 Mingla Team in the admin brand detail", () => {
  it("reads granted_via, removal_reason and the brand opt-out", () => {
    assert.match(service, /granted_via,removal_reason/);
    assert.match(service, /from\("brand_mingla_team_optouts"\)/);
    assert.match(service, /minglaTeam: minglaTeamSummary\(/);
  });

  it("on: active automatic rows; none: no automatic rows", () => {
    assert.deepEqual(minglaTeamSummary([auto("a"), auto("b"), { id: "h", granted_via: "invite", accepted_at: "x", removed_at: null }], null), {
      status: "active", removedAt: null, removedBy: null, removedByName: null, activeCount: 2,
    });
    assert.equal(minglaTeamSummary([{ id: "h", granted_via: "invite", accepted_at: "x", removed_at: null }], null).status, "none");
    assert.equal(minglaTeamSummary([auto("a", { removed_at: "2026-11-23" })], null).status, "none");
  });

  it("removed: when and by whom (a profile name, else the account name, else the id)", () => {
    const optout = { brand_id: "b", removed_at: "2026-11-23T10:00:00Z", removed_by: "owner-1" };
    assert.deepEqual(minglaTeamSummary([], optout, { "owner-1": { display_name: "Hana Host" } }), {
      status: "removed", removedAt: "2026-11-23T10:00:00Z", removedBy: "owner-1", removedByName: "Hana Host", activeCount: 0,
    });
    assert.equal(minglaTeamSummary([], optout, {}, { "owner-1": "Hana's Kitchen" }).removedByName, "Hana's Kitchen");
    assert.equal(minglaTeamSummary([], { ...optout, removed_by: null }).removedByName, null);
  });

  it("labels why an automatic row ended", () => {
    assert.equal(minglaRemovalLabel("mingla_team_removed"), "brand removed Mingla Team");
    assert.equal(minglaRemovalLabel("mingla_admin_revoked"), "admin access revoked");
    assert.equal(minglaRemovalLabel(null), "");
  });

  it("the page badges automatic rows and shows the Mingla Team section", () => {
    assert.match(page, /mem\.granted_via === "mingla_admin" && <Badge variant="info">Auto \(Mingla Team\)<\/Badge>/);
    assert.match(page, /label: "Mingla Team"/);
    assert.match(page, /Removed by the brand/);
  });
});
