/**
 * Issue #3801 — TESTER ADVERSARIAL (retest 2): the trip edit route's
 * "Loading trip…" gate when the fresh read FAILS.
 *
 * The rework made `/trip/[id]/edit` re-read the trip on every mount
 * (`refetchOnMount: "always"`) and mount the editor only once a read finished
 * after it opened (`isFetchedAfterMount`), so an editing session never seeds
 * its revision from a cached copy the server has moved past. The implementor
 * proved the happy path (the read succeeds). This file attacks the error path:
 *
 *  (a) a cached trip exists, the server moved on, and the reopen read fails
 *      (offline / 5xx): the editor must NOT fall back to the cached copy (its
 *      first save would be a false "changed somewhere else"), and the route
 *      must not spin on "Loading trip…" — it ends on "Couldn't load trip".
 *  (b) the reopen read fails once and the retry succeeds: exactly one editor
 *      is mounted, seeded from the fresh revision, never the cached one.
 *  (c) no cached trip and the read fails: an error, not an endless spinner.
 *
 * Fails on revert: drop `refetchOnMount: "always"` + the `isFetchedAfterMount`
 * gate from `app/trip/[id]/edit.tsx` -> (a) and (b) red (the editor mounts at
 * once from the cached revision).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// the server, as the services see it
// ---------------------------------------------------------------------------

const EVENT_ID = "38010000-0000-4000-8000-0000000000e1";
const BRAND_ID = "brand-3801-route";
const REV_LOADED = "2027-03-01T10:00:00.000001+00:00";
const REV_AFTER_INTAKE = "2027-03-01T10:01:00.000001+00:00";
const REV_AFTER_VIDEO = "2027-03-01T10:02:00.000001+00:00";

const server = {
  revision: REV_LOADED,
  tripReads: 0,
  /** How the next reads answer: "ok", "fail" (offline / 5xx), queued in order. */
  answers: [] as Array<"ok" | "fail">,
};

const tripRow = (): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: BRAND_ID,
  brandSlug: "issue-3801",
  status: "draft",
  updatedAt: server.revision,
  title: "Lisbon long weekend",
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  days: [{ ordinal: 1 }],
  inclusions: [],
  pricingTiers: [],
});

jest.mock("../../../services/tripsService", () => ({
  getTrip: jest.fn(async () => {
    server.tripReads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const answer = server.answers.shift() ?? "ok";
    if (answer === "fail") throw new TypeError("Network request failed");
    return tripRow();
  }),
  TRIP_DRAFT_PLACEHOLDER_TITLE: "Untitled trip",
}));
jest.mock("../../../services/intakeSchemaService", () => ({
  getTripIntakeSchemasByEvent: jest.fn(async () => new Map()),
  // A draft intake save moves `events.updated_at` (the graph command bumps
  // it) and the editor's held revision adopts the new one.
  upsertTripIntakeSchema: jest.fn(
    async (input: { revision?: { current: string | null } }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      server.revision = REV_AFTER_INTAKE;
      if (input.revision !== undefined) input.revision.current = server.revision;
    },
  ),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "user-3801" } }),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../../analytics/searchOutcome", () => ({
  captureHostSearchOutcome: jest.fn(),
}));
jest.mock("../../../services/draftCurrencySync", () => ({
  publishWithDraftCurrencySync: jest.fn(),
}));
jest.mock("../../../hooks/upcomingKeys", () => ({
  upcomingKeys: { all: ["upcoming"] },
}));

// Imported AFTER the mocks are registered.
// eslint-disable-next-line import/first
import * as useTripsModule from "../../../hooks/useTrips";
// eslint-disable-next-line import/first
import { useUpsertTripIntakeSchema } from "../../../hooks/useIntakeSchema";
// eslint-disable-next-line import/first
import { tripKeys } from "../../../hooks/tripKeys";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------
// module boundary for the route
// ---------------------------------------------------------------------------

/** The revision every editing session was mounted with, in order. */
const sessions: string[] = [];
const WizardProbe = (props: { trip: { updatedAt: string } }): null => {
  const seeded = React.useRef<string | null>(null);
  if (seeded.current === null) {
    seeded.current = props.trip.updatedAt;
    sessions.push(props.trip.updatedAt);
  }
  return null;
};
const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};

const BOUNDARY: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => ({
    ActivityIndicator: leaf("ActivityIndicator"),
    ScrollView: leaf("ScrollView"),
    Text: leaf("Text"),
    View: leaf("View"),
    StyleSheet: { create: <T,>(styles: T): T => styles },
  }),
  "expo-router": () => ({
    useLocalSearchParams: () => ({ id: EVENT_ID }),
    useRouter: () => ({
      push: jest.fn(),
      back: jest.fn(),
      replace: jest.fn(),
      canGoBack: () => true,
    }),
  }),
  designSystem: () => ({
    spacing: { xl: 24, md: 12 },
    text: { primary: "#fff", secondary: "#ccc" },
    typography: {
      h3: { fontSize: 20, lineHeight: 24, fontWeight: "600" },
      body: { fontSize: 14, lineHeight: 20 },
    },
  }),
  useCurrentBrand: () => ({
    useCurrentBrand: () => ({
      id: BRAND_ID,
      displayName: "Issue 3801",
      paymentProvider: "stripe",
    }),
  }),
  AuthContext: () => ({ useAuth: () => ({ user: { id: "user-3801" } }) }),
  useBusinessRecent: () => ({
    discardBusinessRecentDraft: jest.fn(),
    promoteBusinessRecentDraft: jest.fn(),
    useSuccessfulBusinessRecentOpen: (): void => undefined,
  }),
  useTrips: () => useTripsModule,
  TripCreatorWizard: () => ({ TripCreatorWizard: WizardProbe }),
  EditPublishedTripScreen: () => ({ EditPublishedTripScreen: leaf("EditPublishedTripScreen") }),
  Button: () => ({ Button: leaf("Button") }),
  tripsService: () => ({ TRIP_DRAFT_PLACEHOLDER_TITLE: "Untitled trip" }),
  justPublishedSignal: () => ({ markJustPublished: jest.fn() }),
};

const ROUTE_FILE = path.resolve(__dirname, "..", "..", "..", "..", "app", "trip", "[id]", "edit.tsx");

function loadRoute(): React.ComponentType {
  const output = ts.transpileModule(fs.readFileSync(ROUTE_FILE, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const boundaryRequire = (specifier: string): unknown => {
    const key = specifier.split("/").pop() as string;
    const supply = BOUNDARY[specifier] ?? BOUNDARY[key];
    if (supply === undefined) {
      throw new Error(`Unclassified trip edit route boundary: ${specifier}`);
    }
    return supply();
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", output)(
    boundaryRequire,
    module,
    module.exports,
  );
  return module.exports.default as React.ComponentType;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let queryClient: QueryClient;
const mounted: Renderer[] = [];
const settle = async (ms = 40): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
const openEditor = async (): Promise<Renderer> => {
  const Route = loadRoute();
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <Route />
      </QueryClientProvider>,
    );
  });
  mounted.push(tree);
  await settle();
  return tree;
};
const closeEditor = async (tree: Renderer): Promise<void> => {
  await act(async () => {
    tree.unmount();
  });
  mounted.splice(mounted.indexOf(tree), 1);
};

/** The Step 6 save, through the REAL intake mutation hook. */
let saveIntake: ((revision: { current: string | null }) => Promise<void>) | null = null;
const IntakeSaver = (): null => {
  const mutation = useUpsertTripIntakeSchema();
  saveIntake = (revision) =>
    mutation.mutateAsync({
      eventId: EVENT_ID,
      ticketTypeId: "tt-a",
      schema: null,
      skipStatusProbe: true,
      revision,
    });
  return null;
};

/** The server's compare-and-swap, as in biz_apply_trip_draft_graph. */
const firstSaveIsRefused = (seededRevision: string): boolean =>
  seededRevision !== server.revision;

let retries = 0;
beforeEach(() => {
  server.revision = REV_LOADED;
  server.tripReads = 0;
  server.answers = [];
  retries = 0;
  sessions.length = 0;
  saveIntake = null;
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: () => retries > 0 && retries-- > 0, retryDelay: 0, gcTime: Infinity },
    },
  });
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
  queryClient.clear();
});

// ---------------------------------------------------------------------------

const screenText = (tree: Renderer): string =>
  tree.root
    .findAll((node) => node.type === "Text")
    .map((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join("") : String(children ?? "");
    })
    .join(" | ");

describe("issue #3801 tester — the edit route when the fresh read fails", () => {
  test("(a) cached trip, server moved on, reopen read fails: no editor from the cache, and an error, not a spinner", async () => {
    const first = await openEditor();
    expect(sessions).toEqual([REV_LOADED]);
    await closeEditor(first);

    // The server moved on (a cover video applied) and this device is offline.
    server.revision = REV_AFTER_VIDEO;
    server.answers = ["fail"];
    const reopened = await openEditor();
    await settle(60);

    // The cached copy (REV_LOADED) never seeded a second editing session.
    expect(sessions).toEqual([REV_LOADED]);
    const text = screenText(reopened);
    expect(text).toContain("Couldn\u2019t load trip");
    expect(text).not.toContain("Loading trip…");
  });

  test("(b) reopen read fails once, the retry succeeds: one editor, seeded from the fresh revision", async () => {
    const first = await openEditor();
    await closeEditor(first);

    server.revision = REV_AFTER_VIDEO;
    server.answers = ["fail", "ok"];
    retries = 1;
    await openEditor();
    await settle(60);

    expect(sessions).toEqual([REV_LOADED, REV_AFTER_VIDEO]);
    expect(server.answers).toEqual([]);
  });

  test("(c) nothing cached and the read fails: an error, not an endless spinner", async () => {
    server.answers = ["fail"];
    const tree = await openEditor();
    await settle(60);
    expect(sessions).toEqual([]);
    expect(screenText(tree)).toContain("Couldn\u2019t load trip");
  });
});
