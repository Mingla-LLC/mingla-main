import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1103 — Ari smart brand CRUD + in-chat media (UI surfaces).
 * Implementor happy-path regression test.
 *
 * Follows the established mingla-business ARI CI pattern (ts-jest, node env,
 * SOURCE-assertion not React render — same as orch_1101_ari_* / orch_1057_*).
 * The Ari card surfaces are static enough that source structure is the truth.
 * The behavioural delete-guard regression lives Deno-side
 * (supabase/functions/_shared/__tests__/orch_1103_ari_brand_crud.test.ts).
 *
 * Locks:
 *   - Surface 1: cover band on create/update brand (Add cover, 5 states).
 *   - Surface 2: delete-variant card — live cascade (useBrandCascadePreview) +
 *     type-to-confirm field gating Delete (canDelete name match) + Delete uses
 *     semantic.error (destructive), the one departure from userBubble.
 *   - Surface 4: brand receipt via ResponseCard for executed create/update.
 *   - The ONE additive token ariThread.coverBandH = 132.
 *   - The flagged CoverPickerSheet "Use this cover" contrast fix
 *     (accent.warm → ariPalette.userBubble).
 *
 * fails-on-revert: each assertion targets a string that ONLY exists after the
 * ORCH-1103 fix. Reverting any touched file flips its assertions red.
 */

const ROOT = path.resolve(__dirname, "../../../..");
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const proposalCard = read("src/components/ari/ToolProposalCard.tsx");
const messageList = read("src/components/ari/MessageList.tsx");
const coverSheet = read("src/components/ui/CoverPickerSheet.tsx");
const designSystem = read("src/constants/designSystem.ts");

describe("ORCH-1103 token", () => {
  it("adds the single additive coverBandH token = 132", () => {
    expect(designSystem).toMatch(/coverBandH:\s*132/);
  });
});

describe("ORCH-1103 Surface 1 — cover band (create + update brand)", () => {
  it("ToolProposalCard imports the existing CoverPickerSheet (no new sheet)", () => {
    expect(proposalCard).toMatch(/import\s*\{\s*CoverPickerSheet\s*\}\s*from\s*"\.\.\/ui\/CoverPickerSheet"/);
  });

  it("renders an Add-cover affordance with the empty / busy / error states", () => {
    expect(proposalCard).toContain("Add cover");
    expect(proposalCard).toContain("Optional — image or video");
    expect(proposalCard).toContain("Uploading cover…");
    expect(proposalCard).toContain("Processing video…");
    expect(proposalCard).toContain("Try again");
  });

  it("uses the coverBandH token for the band height (no magic number)", () => {
    expect(proposalCard).toMatch(/height:\s*ariThread\.coverBandH/);
  });

  it("brand verbs are humanized for the new tools", () => {
    expect(proposalCard).toContain('case "update_brand": return "Update brand"');
    expect(proposalCard).toContain('case "delete_brand": return "Delete brand"');
  });

  it("disables Confirm while a cover upload is in flight", () => {
    expect(proposalCard).toMatch(/coverUploadState\s*!==\s*"idle"/);
  });
});

describe("ORCH-1103 Surface 2 — delete-variant card", () => {
  it("uses live cascade counts via useBrandCascadePreview (Q6 = live)", () => {
    expect(proposalCard).toMatch(/import\s*\{\s*useBrandCascadePreview\s*\}/);
    expect(proposalCard).toContain("useBrandCascadePreview(");
  });

  it("gates Delete behind a case-insensitive type-the-name match", () => {
    // canDelete = typed name === brand display name (case-insensitive trim)
    expect(proposalCard).toMatch(/typedName\.trim\(\)\.toLowerCase\(\)\s*===\s*deleteName\.trim\(\)\.toLowerCase\(\)/);
    // Delete button disabled until the match lands
    expect(proposalCard).toMatch(/disabled=\{isExecuting\s*\|\|\s*!canDelete\}/);
  });

  it("shows the type-to-confirm helper + assurance + recovery window", () => {
    expect(proposalCard).toContain("to confirm");
    expect(proposalCard).toContain("Recoverable for 30 days");
  });

  it("Delete button wears semantic.error (destructive), NOT userBubble", () => {
    expect(proposalCard).toMatch(/deleteBtn:\s*\{[^}]*backgroundColor:\s*semantic\.error/s);
  });

  it("Delete label stays >=14/600 to clear the 3:1 large-text contrast bar", () => {
    expect(proposalCard).toMatch(/deleteText:\s*\{[^}]*fontSize:\s*14[^}]*fontWeight:\s*"600"/s);
  });
});

describe("ORCH-1103 Surface 4 — brand receipt", () => {
  it("MessageList renders a ResponseCard receipt for executed brand create/update", () => {
    expect(messageList).toMatch(/import\s*\{\s*ResponseCard\s*\}/);
    expect(messageList).toContain('tr?.tool_name === "create_brand" || tr?.tool_name === "update_brand"');
    expect(messageList).toContain("ResponseCard");
  });

  it("omits the thumbnail for video covers + when no cover (anti-slop, real URI only)", () => {
    expect(messageList).toMatch(/cover_media_type\s*!==\s*"video"/);
  });

  it("receipt action seeds a composer message and NEVER auto-creates an event", () => {
    expect(messageList).toContain("onSeedMessage");
    expect(messageList).toContain("Create an event for");
    // No tool-call from the receipt action.
    expect(messageList).not.toMatch(/onAction[\s\S]{0,200}executor\(/);
  });
});

describe("ORCH-1103 — CoverPickerSheet contrast fix (flagged 1-liner)", () => {
  it('"Use this cover" button fill switched from accent.warm to ariPalette.userBubble', () => {
    expect(coverSheet).toMatch(/confirmButton:\s*\{[^}]*backgroundColor:\s*ariPalette\.userBubble/s);
    // accent.warm must no longer be the confirm fill (it failed even the 3:1 bar)
    expect(coverSheet).not.toMatch(/backgroundColor:\s*accent\.warm/);
  });
});
