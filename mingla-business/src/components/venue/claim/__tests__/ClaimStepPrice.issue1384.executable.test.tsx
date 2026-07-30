import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  BrandCurrencyReconciliationPreview,
  BrandDiscoveryCurrencyState,
} from "../../../../services/businessPlaceAuthoringService";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const invokeBodies: Record<string, unknown>[] = [];
let resolveErrorCode: string | null = null;
let currentState: BrandDiscoveryCurrencyState;
let reconciliationRows: Array<Record<string, unknown>> = [];

const preview: BrandCurrencyReconciliationPreview = {
  reconciliationId: "rec-1",
  fromCurrencyCode: "USD",
  toCurrencyCode: "NGN",
  snapshot: {
    id: "snapshot-s1",
    provider: "open-exchange",
    providerUpdatedAt: "2027-01-29T10:00:00.000Z",
    freshness: "fresh",
  },
  ranges: [
    {
      placePoolId: "place-a",
      venueId: "venue-a",
      expectedVersion: 4,
      sourceMinMinor: 2_000,
      sourceMaxMinor: 5_000,
      sourceCurrencyCode: "USD",
      proposedMinMinor: 3_200_000,
      proposedMaxMinor: 8_000_000,
    },
    {
      placePoolId: "place-b",
      venueId: "venue-b",
      expectedVersion: 8,
      sourceMinMinor: 10_000,
      sourceMaxMinor: null,
      sourceCurrencyCode: "USD",
      proposedMinMinor: 16_000_000,
      proposedMaxMinor: null,
    },
  ],
};

const pendingState = (): BrandDiscoveryCurrencyState => ({
  brandId: "brand-1",
  stateVersion: 6,
  authority: "settlement",
  currencyCode: "NGN",
  canAuthorRange: false,
  canAcceptPaidReservations: false,
  supportedCurrencies: [
    { code: "USD", minorUnitExponent: 2, railSource: "stripe" },
    { code: "NGN", minorUnitExponent: 2, railSource: "paystack" },
  ],
  reconciliation: {
    id: "rec-1",
    from_currency_code: "USD",
    to_currency_code: "NGN",
    status: "pending",
    initiated_at: "2027-01-29T10:00:00.000Z",
  },
});

const resolvedState = (): BrandDiscoveryCurrencyState => ({
  ...pendingState(),
  stateVersion: 7,
  canAuthorRange: true,
  canAcceptPaidReservations: true,
  reconciliation: null,
});

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const mockInvoke = jest.fn(
  async (_name: string, options: { body: Record<string, unknown> }) => {
    invokeBodies.push(options.body);
    if (options.body.action === "get_state") {
      return {
        data: { kind: "ok", data: currentState, requestId: "request-state" },
        error: null,
      };
    }
    if (options.body.action === "preview_reconciliation") {
      return {
        data: { kind: "ok", data: preview, requestId: "request-preview" },
        error: null,
      };
    }
    if (options.body.action === "resolve_reconciliation") {
      if (resolveErrorCode !== null) {
        const code = resolveErrorCode;
        return {
          data: null,
          error: {
            message: "Edge Function returned a non-2xx status code",
            context: {
              json: async () => ({
                kind: "error",
                code,
                message: code.replaceAll("_", " "),
              }),
            },
          },
        };
      }
      currentState = resolvedState();
      return {
        data: {
          kind: "ok",
          data: currentState,
          requestId: "request-resolve",
        },
        error: null,
      };
    }
    throw new Error(`Unexpected action ${String(options.body.action)}`);
  },
);

jest.mock("../../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: jest.fn(() => {
      type Builder = {
        select: jest.Mock<Builder, []>;
        eq: jest.Mock<Builder, []>;
        order: jest.Mock<
          Promise<{ data: Array<Record<string, unknown>>; error: null }>,
          []
        >;
      };
      const builder = {} as Builder;
      builder.select = jest.fn(() => builder);
      builder.eq = jest.fn(() => builder);
      builder.order = jest.fn(async () => ({
        data: reconciliationRows,
        error: null,
      }));
      return builder;
    }),
  },
}));

jest.mock("../../../../context/AuthContext", () => ({
  useAuth: () => ({
    isAuthReady: true,
    authStatus: "signed_in_ready",
    user: { id: "user-1" },
  }),
}));

import { useDraftVenueStore } from "../../../../store/draftVenueStore";
import { ClaimStepPrice } from "../ClaimStepPrice";

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: {
      findByProps: (props: Record<string, unknown>) => {
        props: Record<string, unknown>;
        children: unknown[];
      };
      findAllByProps: (props: Record<string, unknown>) => Array<{
        props: Record<string, unknown>;
        children: unknown[];
      }>;
    };
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => Promise<void>;
};

const { act } = TestRenderer;
const mountedRenderers: Array<ReturnType<typeof TestRenderer.create>> = [];
const mountedQueryClients: QueryClient[] = [];

function renderedText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (
    node !== null &&
    typeof node === "object" &&
    Array.isArray((node as { children?: unknown[] }).children)
  ) {
    return (node as { children: unknown[] }).children
      .map(renderedText)
      .join(" ");
  }
  return "";
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function mount() {
  currentState = pendingState();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
  mountedQueryClients.push(queryClient);
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <ClaimStepPrice showErrors={false} />
      </QueryClientProvider>,
    );
  });
  mountedRenderers.push(renderer);
  await flush();
  return { renderer, queryClient, invalidateSpy };
}

async function press(
  renderer: Awaited<ReturnType<typeof mount>>["renderer"],
  testID: string,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (renderer.root.findAllByProps({ testID }).length > 0) break;
    await flush();
  }
  if (renderer.root.findAllByProps({ testID }).length === 0) {
    throw new Error(
      `Missing ${testID}; brand=${String(
        useDraftVenueStore.getState().activeBrandId,
      )}; server=${String(currentState.reconciliation?.id ?? "resolved")}; tree=${
        renderedText(renderer.root)
      }; bodies=${JSON.stringify(invokeBodies)}`,
    );
  }
  await act(async () => {
    const node = renderer.root.findByProps({ testID });
    const onPress = node.props.onPress as (() => void) | undefined;
    onPress?.();
    await Promise.resolve();
  });
  await flush();
}

async function changeText(
  renderer: Awaited<ReturnType<typeof mount>>["renderer"],
  testID: string,
  value: string,
): Promise<void> {
  await act(async () => {
    const node = renderer.root.findByProps({ testID });
    const onChangeText = node.props.onChangeText as (next: string) => void;
    onChangeText(value);
  });
}

beforeAll(async () => {
  await useDraftVenueStore.persist.rehydrate();
});

beforeEach(() => {
  currentState = pendingState();
  resolveErrorCode = null;
  invokeBodies.length = 0;
  mockInvoke.mockClear();
  reconciliationRows = [
    {
      place_pool_id: "place-b",
      brand_id: "brand-1",
      venue_id: "venue-b",
      status: "reconciliation_required",
      source_min_minor: 10_000,
      source_max_minor: null,
      source_currency_code: "USD",
      source_type: "business_authored",
      version: 8,
      updated_at: "2027-01-29T10:00:00.000Z",
    },
    {
      place_pool_id: "place-a",
      brand_id: "brand-1",
      venue_id: "venue-a",
      status: "reconciliation_required",
      source_min_minor: 2_000,
      source_max_minor: 5_000,
      source_currency_code: "USD",
      source_type: "business_authored",
      version: 4,
      updated_at: "2027-01-29T10:00:00.000Z",
    },
  ];
  useDraftVenueStore.setState({ activeBrandId: "brand-1" });
});

afterEach(async () => {
  await act(async () => {
    for (const renderer of mountedRenderers.splice(0)) {
      renderer.unmount();
    }
  });
  for (const queryClient of mountedQueryClients.splice(0)) {
    queryClient.clear();
  }
});

describe("issue #1384 ClaimStepPrice executable reconciliation", () => {
  it("renders and executes a real S1 conversion preview with every affected value", async () => {
    const { renderer } = await mount();
    await press(renderer, "issue1384-review-convert");

    expect(invokeBodies).toContainEqual({
      action: "preview_reconciliation",
      brandId: "brand-1",
      reconciliationId: "rec-1",
      decision: "convert",
    });
    expect(
      renderer.root.findByProps({ testID: "issue1384-conversion-preview" }),
    ).toBeTruthy();
    const rendered = renderedText(renderer.root);
    expect(rendered).toContain("snapshot-s1");
    expect(rendered).toContain("open-exchange");
    expect(rendered).toContain("place-a");
    expect(rendered).toContain("Version  4");
    expect(rendered).toContain("$20.00");
    expect(rendered).toContain("32,000.00");
    expect(rendered).toContain("place-b");
    expect(rendered).toContain("Version  8");
    expect(rendered).toContain("$100.00");
    expect(rendered).toContain("160,000.00");
  });

  it("applies exactly the previewed sorted set and invalidates only after success", async () => {
    const { renderer, queryClient, invalidateSpy } = await mount();
    await press(renderer, "issue1384-review-convert");
    expect(invalidateSpy).toHaveBeenCalledTimes(0);

    await press(renderer, "issue1384-apply-conversion");

    expect(
      invokeBodies
        .filter((body) => body.action === "resolve_reconciliation")
        .at(-1),
    ).toEqual({
      action: "resolve_reconciliation",
      brandId: "brand-1",
      reconciliationId: "rec-1",
      decision: "convert",
      fxSnapshotId: "snapshot-s1",
      ranges: [
        { placePoolId: "place-a", expectedVersion: 4 },
        { placePoolId: "place-b", expectedVersion: 8 },
      ],
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(7);
    expect(
      queryClient.getQueryData([
        "brand-discovery-currency",
        "detail",
        "brand-1",
      ]),
    ).toEqual(resolvedState());
    expect(
      renderer.root.findAllByProps({
        testID: "issue1384-conversion-preview",
      }),
    ).toHaveLength(0);
  });

  it("blocks an incomplete re-entry then submits the full sorted RLS set without FX", async () => {
    const { renderer } = await mount();
    await press(renderer, "issue1384-review-reenter");
    await changeText(renderer, "issue1384-reentry-min-place-a", "200.00");
    await changeText(renderer, "issue1384-reentry-max-place-a", "500.00");

    const blocked = renderer.root.findByProps({
      testID: "issue1384-apply-reentry",
    });
    expect(blocked.props.disabled).toBe(true);
    expect(
      invokeBodies.filter((body) => body.action === "resolve_reconciliation"),
    ).toHaveLength(0);

    await changeText(renderer, "issue1384-reentry-min-place-b", "1000");
    await changeText(renderer, "issue1384-reentry-max-place-b", "2500.50");
    await press(renderer, "issue1384-apply-reentry");

    expect(
      invokeBodies
        .filter((body) => body.action === "resolve_reconciliation")
        .at(-1),
    ).toEqual({
      action: "resolve_reconciliation",
      brandId: "brand-1",
      reconciliationId: "rec-1",
      decision: "reenter",
      fxSnapshotId: null,
      ranges: [
        {
          placePoolId: "place-a",
          expectedVersion: 4,
          currencyCode: "NGN",
          sourceMinMinor: 20_000,
          sourceMaxMinor: 50_000,
        },
        {
          placePoolId: "place-b",
          expectedVersion: 8,
          currencyCode: "NGN",
          sourceMinMinor: 100_000,
          sourceMaxMinor: 250_050,
        },
      ],
    });
  });

  it.each([
    [
      "range_version_conflict",
      "Prices changed while you were reviewing them.",
    ],
    ["range_set_changed", "Prices changed while you were reviewing them."],
    [
      "fx_snapshot_stale",
      "The conversion rate expired or is unavailable.",
    ],
  ])(
    "keeps conversion open and safely blocks on %s",
    async (code, copy) => {
      resolveErrorCode = code;
      const { renderer, invalidateSpy } = await mount();
      await press(renderer, "issue1384-review-convert");
      await press(renderer, "issue1384-apply-conversion");

      expect(invalidateSpy).toHaveBeenCalledTimes(0);
      expect(
        renderer.root.findByProps({
          testID: "issue1384-conversion-preview",
        }),
      ).toBeTruthy();
      expect(
        renderedText(
          renderer.root.findByProps({
            testID: "issue1384-reconciliation-error",
          }),
        ),
      ).toContain(copy);
    },
  );

  it("keeps full re-entry open with blocking copy on server incomplete_reentry", async () => {
    resolveErrorCode = "incomplete_reentry";
    const { renderer, invalidateSpy } = await mount();
    await press(renderer, "issue1384-review-reenter");
    for (const id of ["place-a", "place-b"]) {
      await changeText(renderer, `issue1384-reentry-min-${id}`, "25");
    }
    await press(renderer, "issue1384-apply-reentry");

    expect(invalidateSpy).toHaveBeenCalledTimes(0);
    expect(
      renderer.root.findByProps({ testID: "issue1384-reentry-form" }),
    ).toBeTruthy();
    expect(
      renderedText(
        renderer.root.findByProps({
          testID: "issue1384-reconciliation-error",
        }),
      ),
    ).toContain("Enter a valid range for every affected place");
  });
});
