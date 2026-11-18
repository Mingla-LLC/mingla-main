/**
 * #4238 — Finance and owner are the brand owner's to give. The server refuses
 * anyone else (invite-brand-member and the team role grants migration); the
 * invite sheet shows those two roles as owner-only instead of letting an
 * admin pick one and hit a refusal.
 *
 * FAILS-ON-REVERT: dropping `lockedRoles` from the picker or the invite sheet.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

const picker = readFileSync(join(__dirname, "../RolePickerSheet.tsx"), "utf8");
const invite = readFileSync(join(__dirname, "../InviteBrandMemberSheet.tsx"), "utf8");

describe("#4238 owner-only roles in the invite picker", () => {
  test("a locked role is shown, cannot be picked, and says why", () => {
    expect(picker).toContain("lockedRoles?: readonly BrandRole[]");
    expect(picker).toContain("if (readOnly || locked) return;");
    expect(picker).toContain("disabled={locked}");
    expect(picker).toContain("locked ? OWNER_ONLY_ROLE_NOTE : roleDescription(role)");
  });

  test("only the brand owner sees Finance and owner as pickable", () => {
    expect(invite).toMatch(/OWNER_ONLY_ROLES: readonly BrandRole\[\] = \["brand_owner", "finance_manager"\]/);
    expect(invite).toContain('useCurrentBrandRole(brandId).role === "brand_owner"');
    expect(invite).toContain("lockedRoles={viewerIsOwner ? [] : OWNER_ONLY_ROLES}");
  });
});
