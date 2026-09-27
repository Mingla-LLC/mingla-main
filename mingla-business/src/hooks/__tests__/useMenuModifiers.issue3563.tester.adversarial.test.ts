/* eslint-disable import/first */
/**
 * Issue #3563 independent tester proof.
 *
 * Different angle from the implementor's source-shape guard: this suite drives
 * the real mutation callbacks captured from React Query. It attacks malformed
 * canonical responses, transport failures, cache ordering, and the forbidden
 * direct-write fallback at the network boundary.
 */
import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

interface CapturedMutation {
  mutationFn: (input: ModifierInput) => Promise<unknown>;
  onError?: (error: Error, input: ModifierInput) => void;
  onSuccess?: (data: unknown, input: ModifierInput) => void;
}

interface ModifierInput {
  id: string;
  menuItemId: string;
  name: string;
  selectionMode: "single" | "multi";
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  modifiers: {
    id: string;
    name: string;
    priceDeltaCents: number;
    sortOrder: number;
  }[];
}

const mockMutations: CapturedMutation[] = [];
const mockEvents: string[] = [];
const mockRpc =
  jest.fn<
    (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>
  >();
const mockFrom = jest.fn();
const mockSetQueryData = jest.fn(
  (_key: readonly unknown[], updater: (current: unknown) => unknown) => {
    mockEvents.push("set");
    return updater([]);
  },
);
const mockInvalidateQueries = jest.fn(
  (_input: { queryKey: readonly unknown[] }) => {
    mockEvents.push("invalidate");
    return Promise.resolve();
  },
);

jest.mock("@tanstack/react-query", () => {
  const actual = jest.requireActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({
      setQueryData: mockSetQueryData,
      invalidateQueries: mockInvalidateQueries,
    }),
    useMutation: (config: CapturedMutation) => {
      mockMutations.push(config);
      return {
        mutate: jest.fn(),
        mutateAsync: config.mutationFn,
        isPending: false,
      };
    },
  };
});

jest.mock("../../services/supabase", () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "tester-3563" } }),
}));

import { useSaveModifierGroup } from "../useMenuModifiers";

const input: ModifierInput = {
  id: "3563b000-0000-4000-8000-000000000010",
  menuItemId: "3563b000-0000-4000-8000-000000000005",
  name: "Heat level",
  selectionMode: "single",
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 0,
  modifiers: [
    {
      id: "3563b000-0000-4000-8000-000000000011",
      name: "Mild",
      priceDeltaCents: 0,
      sortOrder: 0,
    },
    {
      id: "3563b000-0000-4000-8000-000000000012",
      name: "Hot",
      priceDeltaCents: 100,
      sortOrder: 1,
    },
  ],
};

const canonical = {
  id: input.id,
  menu_item_id: input.menuItemId,
  name: input.name,
  selection_mode: input.selectionMode,
  min_select: input.minSelect,
  max_select: input.maxSelect,
  is_active: true,
  sort_order: input.sortOrder,
  modifiers: input.modifiers.map((option) => ({
    id: option.id,
    group_id: input.id,
    name: option.name,
    price_delta_cents: option.priceDeltaCents,
    currency: "USD",
    is_available: true,
    sort_order: option.sortOrder,
  })),
};

function useCapturedMutation(): CapturedMutation {
  useSaveModifierGroup("3563b000-0000-4000-8000-000000000002");
  const captured = mockMutations.at(-1);
  if (captured === undefined) throw new Error("mutation_not_captured");
  return captured;
}

describe("#3563 tester adversarial — atomic Business modifier hook", () => {
  beforeEach(() => {
    mockMutations.length = 0;
    mockEvents.length = 0;
    mockRpc.mockReset();
    mockFrom.mockReset();
    mockSetQueryData.mockClear();
    mockInvalidateQueries.mockClear();
  });

  test("rejects an ambiguous or malformed canonical response without a direct-write fallback", async () => {
    mockRpc.mockResolvedValue({
      data: {
        ...canonical,
        modifiers: [canonical.modifiers[0], canonical.modifiers[0]],
      },
      error: null,
    });

    await expect(useCapturedMutation().mutationFn(input)).rejects.toThrow(
      "modifier_group_response_invalid",
    );
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      "biz_save_menu_modifier_group_v1",
      expect.objectContaining({
        p_group_id: input.id,
        p_menu_item_id: input.menuItemId,
        p_options: input.modifiers.map((option) => ({
          id: option.id,
          name: option.name,
          price_delta_cents: option.priceDeltaCents,
          sort_order: option.sortOrder,
        })),
      }),
    );
    expect(mockFrom).not.toHaveBeenCalled();

    const repoRoot = path.resolve(__dirname, "../../..");
    const source = fs.readFileSync(
      path.join(repoRoot, "src/hooks/useMenuModifiers.ts"),
      "utf8",
    );
    const save = source.slice(
      source.indexOf("export function useSaveModifierGroup"),
      source.indexOf("export function useDeleteModifierGroup"),
    );
    expect(save).not.toContain('.from("menu_modifier_groups")');
    expect(save).not.toContain('.from("menu_modifiers")');
    expect(save.match(/\.rpc\(/g)).toHaveLength(1);
  });

  test.each<
    ["permission" | "offline" | "generic", { code: string; message: string }]
  >([
    ["permission", { code: "42501", message: "secret option payload" }],
    ["offline", { code: "", message: "TypeError: Failed to fetch offline" }],
    ["generic", { code: "22023", message: "private database detail" }],
  ])(
    "maps %s failures to safe errors and never logs raw database detail",
    async (category, rawError) => {
      mockRpc.mockResolvedValue({ data: null, error: rawError });
      const errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        const config = useCapturedMutation();
        const thrown = await config
          .mutationFn(input)
          .catch((error: unknown) => error);
        expect(thrown).toMatchObject({
          message: `modifier_group_save_${category}`,
          category,
        });
        config.onError?.(thrown as Error, input);
        const logged = JSON.stringify(errorSpy.mock.calls);
        expect(logged).not.toContain(rawError.message);
        expect(logged).not.toContain("Mild");
        expect(logged).not.toContain("Hot");
        expect(mockFrom).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    },
  );

  test("installs the exact canonical group before every authoring, staff, and buyer refresh", () => {
    const config = useCapturedMutation();
    config.onSuccess?.(canonical, input);

    expect(mockEvents[0]).toBe("set");
    expect(mockEvents.slice(1)).toEqual([
      "invalidate",
      "invalidate",
      "invalidate",
    ]);
    expect(mockSetQueryData).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(3);

    const updater = mockSetQueryData.mock.calls[0]?.[1];
    if (updater === undefined) throw new Error("cache_updater_not_captured");
    const result = updater([
      {
        id: input.id,
        name: "stale",
        sortOrder: 99,
        modifiers: [],
      },
    ]) as Record<string, unknown>[];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: input.id,
      name: input.name,
      modifiers: [
        expect.objectContaining({ id: input.modifiers[0]?.id }),
        expect.objectContaining({ id: input.modifiers[1]?.id }),
      ],
    });
  });
});
