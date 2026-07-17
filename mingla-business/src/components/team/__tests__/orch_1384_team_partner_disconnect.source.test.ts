// ORCH-1384 — implementor regression: Team-screen partner identity + the
// owner-only disconnect (SC-9 / SC-10 client legs).
//
// Pins, source-side with COMMS-0106 count/segment companions:
//   1. `handleRemove` stays a NO-OP for every non-partner member (ORCH-1051
//      untouched — SC-9's "every OTHER member's remove remains inert").
//   2. The pending-invite revoke client path is UNCHANGED (SC-10 — the DB
//      invite-kill trigger owns the link stamp; zero client changes).
//   3. The "Mingla Partner" badge renders for EXACTLY the matched row
//      (accepted, non-cancelled link) and nowhere else.
//   4. MemberDetailSheet's disconnect verb is gated owner-only AND wired to
//      useDisconnectLink through its shipped ConfirmDialog pattern, with the
//      BINDING owner money-truth copy verbatim (DESIGN §9.2).
//
// (The team.tsx path contains `[id]` — a glob char-class in jest testMatch —
// so this test lives beside MemberDetailSheet and resolves team.tsx by path.)

/* eslint-disable import/first */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

const TEAM_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../../app/brand/[id]/team.tsx"),
  "utf8",
);
const SHEET_SRC = fs.readFileSync(
  path.resolve(__dirname, "../MemberDetailSheet.tsx"),
  "utf8",
);
const TEAM_FLAT = TEAM_SRC.replace(/\s+/g, " ");
const SHEET_FLAT = SHEET_SRC.replace(/\s+/g, " ");

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("SC-9 — general member removal stays inert (ORCH-1051 untouched)", () => {
  test("handleRemove is still the documented no-op: closes the sheet, mutates NOTHING", () => {
    const marker = "const handleRemove = useCallback(";
    expect(countOf(TEAM_SRC, marker)).toBe(1);
    const start = TEAM_SRC.indexOf(marker);
    // The callback ends at its dependency-array close.
    const end = TEAM_SRC.indexOf("[],\n  );", start);
    expect(end).toBeGreaterThan(start);
    const body = TEAM_SRC.slice(start, end);
    expect(body).toContain("setDetailEntry(null)");
    expect(body).toContain("ORCH-1051");
    // No mutation of any kind inside the no-op.
    expect(body).not.toContain("mutateAsync");
    expect(body).not.toContain("disconnect");
    expect(body).not.toContain("removed_at");
  });

  test("SC-10 — the pending-invite revoke path is byte-untouched client-side", () => {
    // Still the direct revokeAsync(entry.id) fire-and-forget: the ORCH-1384
    // invite-kill TRIGGER stamps the link server-side for this exact path.
    expect(countOf(TEAM_SRC, "revokeAsync(entry.id)")).toBe(1);
    expect(TEAM_SRC).toContain("useRevokeBrandInvitation(brandIdResolved)");
  });
});

describe("partner badge — exactly the matched member row", () => {
  test("badge testID renders exactly once, gated on partnerLinkId", () => {
    expect(countOf(TEAM_SRC, 'testID="team-partner-badge"')).toBe(1);
    const idx = TEAM_SRC.indexOf('testID="team-partner-badge"');
    const gate = TEAM_SRC.slice(Math.max(0, idx - 700), idx);
    expect(gate).toContain("row.partnerLinkId !== null ? (");
    // Badge copy.
    const after = TEAM_SRC.slice(idx, idx + 400);
    expect(after).toContain("Mingla Partner");
  });

  test("the matcher admits ONLY accepted, non-cancelled links", () => {
    expect(TEAM_SRC).toContain(
      "link.accepted_at !== null && link.cancelled_at === null",
    );
    expect(TEAM_SRC).toContain("useBrandPartnerLinks(brandIdResolved)");
    // Pending + self rows can never be the partner row.
    expect(countOf(TEAM_SRC, "partnerLinkId: null")).toBe(2);
  });

  test("MemberDetailSheet receives the owner gate + the matched link only", () => {
    expect(TEAM_FLAT).toContain(
      'viewerIsOwner={currentRole === "brand_owner"}',
    );
    expect(TEAM_FLAT).toContain(
      "detailEntry?.partnerLinkId != null && brandIdResolved !== null",
    );
  });
});

describe("MemberDetailSheet — owner-only Disconnect partner (shipped ConfirmDialog pattern)", () => {
  test("verb gate: matched partner row AND owner viewer", () => {
    expect(SHEET_SRC).toContain(
      'const isPartnerRow = isAccepted && partnerLink !== null;',
    );
    expect(SHEET_SRC).toContain(
      "const showPartnerDisconnect = isPartnerRow && viewerIsOwner === true;",
    );
  });

  test("registry testIDs exactly once; wired to useDisconnectLink", () => {
    expect(countOf(SHEET_SRC, 'testID="member-detail-disconnect-partner"')).toBe(1);
    expect(
      countOf(SHEET_SRC, 'confirmTestID="member-detail-disconnect-confirm"'),
    ).toBe(1);
    expect(SHEET_SRC).toContain("useDisconnectLink()");
    // The mutation call carries BOTH ids (team-list invalidation).
    expect(SHEET_FLAT).toContain(
      "linkId: partnerLink.linkId, brandId: partnerLink.brandId",
    );
  });

  test("owner money-truth copy — verbatim (DESIGN §9.2)", () => {
    expect(SHEET_FLAT).toContain(
      "They'll lose team access and stop earning from future sales for this brand. Money already earned still pays out.",
    );
    expect(SHEET_FLAT).toContain('title="Disconnect this partner?"');
    expect(SHEET_FLAT).toContain('confirmLabel="Disconnect"');
  });

  test("loading discipline: confirmLoading + closeDisabled ride the mutation (§5.5)", () => {
    expect(SHEET_SRC).toContain(
      "confirmLoading={disconnectMutation.isPending}",
    );
    expect(SHEET_SRC).toContain("closeDisabled={disconnectMutation.isPending}");
  });

  test("the ORIGINAL destructive slot survives for every other member", () => {
    // Non-partner rows keep the exact pre-1384 affordance: label + rank gate
    // + caption. (byte-level anchors)
    expect(SHEET_SRC).toContain("label={actionLabel}");
    expect(SHEET_SRC).toContain("disabled={!canAct}");
    expect(SHEET_SRC).toContain("gateCaptionFor(action)");
    expect(SHEET_FLAT).toContain(
      '"Revoke invitation" : "Remove from team"',
    );
  });

  test("badge in the sheet: appended to the role-pill row, wrap-safe", () => {
    // The RENDERED badge text appears exactly once (the header doc comment
    // may also name it — code is what's pinned).
    expect(
      countOf(
        SHEET_FLAT,
        "<Text style={styles.partnerBadgeText}>Mingla Partner</Text>",
      ),
    ).toBe(1);
    const pillRow = SHEET_SRC.indexOf("styles.rolePillRow");
    const badge = SHEET_SRC.indexOf("styles.partnerBadge");
    expect(pillRow).toBeGreaterThan(-1);
    expect(badge).toBeGreaterThan(pillRow);
    expect(SHEET_SRC).toContain('flexWrap: "wrap"');
  });

  test("no native Alert (custom confirms only — DESIGN §8.3)", () => {
    for (const src of [TEAM_SRC, SHEET_SRC]) {
      expect(src).not.toContain("Alert.alert");
      const rnImport = src.match(/import \{[^}]*\} from "react-native"/);
      expect(rnImport).not.toBeNull();
      expect(String(rnImport?.[0])).not.toMatch(/\bAlert\b/);
    }
  });
});
