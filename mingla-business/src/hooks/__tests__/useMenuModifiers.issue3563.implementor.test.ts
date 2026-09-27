import fs from "node:fs";
import path from "node:path";

import { createMenuModifierDraftId } from "../../components/venue/menuModifierDraftId";

const repoRoot = path.resolve(__dirname, "../../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("#3563 atomic menu modifier save", () => {
  test("draft identities are secure UUID-v4 values and never change on reuse", () => {
    const original = globalThis.crypto;
    const randomUUID = jest.fn(() => "35630000-0000-4000-8000-000000000001");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID },
    });

    const id = createMenuModifierDraftId();
    expect(id).toBe("35630000-0000-4000-8000-000000000001");
    expect(randomUUID).toHaveBeenCalledTimes(1);

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  });

  test("the Business writer has one RPC owner and installs canonical cache before refresh", () => {
    const source = read("src/hooks/useMenuModifiers.ts");
    const saveStart = source.indexOf("export function useSaveModifierGroup");
    const deleteStart = source.indexOf("export function useDeleteModifierGroup");
    const save = source.slice(saveStart, deleteStart);

    expect(save).toContain('.rpc("biz_save_menu_modifier_group_v1"');
    expect(save).not.toContain('.from("menu_modifier_groups")');
    expect(save).not.toContain('.from("menu_modifiers")');
    expect(save).toContain("queryClient.setQueryData");
    expect(save.indexOf("queryClient.setQueryData")).toBeLessThan(
      save.indexOf("invalidateQueries"),
    );
    expect(save).toContain("orderPadKeys.forBrand");
    expect(save).toContain("venueOrderingQueryKeys.all");
  });

  test("authoring and staff reads exclude historical tombstones", () => {
    expect(read("src/hooks/useMenuModifiers.ts")).toContain(
      '.eq("is_available", true)',
    );
    expect(read("src/hooks/useVenueOrderPad.ts")).toContain(
      '.eq("is_available", true)',
    );
  });
});
