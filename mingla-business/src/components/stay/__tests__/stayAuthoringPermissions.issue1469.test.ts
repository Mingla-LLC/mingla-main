import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "..", "..", "..", "..");
const repoRoot = path.resolve(businessRoot, "..");
const manager = fs.readFileSync(
  path.join(businessRoot, "src/components/stay/StayInventoryManager.tsx"),
  "utf8",
);
const types = fs.readFileSync(
  path.join(businessRoot, "src/types/stayInventory.ts"),
  "utf8",
);
const migration = fs.readFileSync(
  path.join(
    repoRoot,
    "supabase/migrations/20270209001469_issue_1469_stay_authoring_permissions.sql",
  ),
  "utf8",
);

describe("Issue #1469 Stay authoring permission parity", () => {
  it("projects inventory and finance capabilities from the private server snapshot", () => {
    expect(types).toContain("canManageInventory: boolean");
    expect(types).toContain("canManageFinance: boolean");
    expect(manager).toContain(
      "inventory.data?.permissions.canManageInventory ?? false",
    );
    expect(manager).toContain(
      "inventory.data?.permissions.canManageFinance ?? false",
    );
    expect(migration).toContain("'canManageInventory'");
    expect(migration).toContain("'canManageFinance'");
  });

  it("keeps inventory and money roles separate and lets overrides narrow only", () => {
    expect(migration).toMatch(
      /WHEN 'inventory' THEN v_role IN \(\s*'brand_owner', 'brand_admin', 'event_manager'/,
    );
    expect(migration).toMatch(
      /WHEN 'finance' THEN v_role IN \(\s*'brand_owner', 'brand_admin', 'finance_manager'/,
    );
    expect(migration).toContain("RETURN v_base AND");
    expect(migration).not.toMatch(/RETURN\s+\(v_overrides->>v_override_key\)/);
  });

  it("never bundles money into an inventory-only create", () => {
    expect(manager).toContain(
      "canManageFinance && Number(price) > 0 && currencyCode",
    );
    expect(manager).toMatch(
      /const fees:[\s\S]*?canManageFinance &&[\s\S]*?feeLabel\.trim\(\)/,
    );
    expect(manager).toContain("canManageFinance && policy.trim()");
    expect(manager).toContain(
      'if (!canManageInventory) throw new Error("forbidden")',
    );
    expect(manager).toContain('testID="stay-finance-permission-copy"');
    expect(manager).toContain(
      'maxAdults: kind === "room" ? asPositiveInteger(maxGuests) : undefined',
    );
    expect(manager).toContain('maxChildren: kind === "room" ? 0 : undefined');
  });

  it("lets finance-only staff save money without a forbidden metadata update", () => {
    expect(manager).toMatch(
      /if \(canManageInventory\) \{\s*inventory = \(\s*await updateStayOffering/,
    );
    expect(manager).toMatch(
      /if \(canManageFinance && priceInput\) \{\s*inventory = \(\s*await setStayOfferingPrice/,
    );
    expect(manager).toContain(
      'label={canManageInventory ? "Edit" : "Pricing"}',
    );
  });

  it("removes dead taps across add, availability, finance and status controls", () => {
    expect(manager).toContain('testID="stay-inventory-permission-copy"');
    expect(manager).toContain('testID="stay-availability-permission-copy"');
    expect(manager).toContain('testID="stay-availability-finance-copy"');
    expect(manager).toContain("canManageInventory && offering.status");
    expect(manager).toContain("disabled={!canManageInventory}");
  });
});
