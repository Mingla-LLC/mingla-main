/**
 * #3583 [website workspace never fails silently] — ADVERSARIAL.
 *
 * A DIFFERENT ANGLE ON EACH DEFECT from the implementor suite. That one proves
 * the fixed paths work; this one attacks the specific mechanisms that made
 * each defect possible, and checks that each fix did not overcorrect into a
 * new lie.
 *
 * D1 Attacks the MECHANISM that ate the error: no Core answer — none of the
 *    twelve real codes, none of a fuzzed set — can be mistaken for a network
 *    state, and a surfaced failure survives the effect that used to clear it.
 * D2 Attacks the INSTALLS ALREADY STUCK: a poisoned pointer is dropped, and
 *    the negative — a transient receipt failure must NOT be read as proof the
 *    operation never existed.
 * D3 Attacks the ORDER: a website that disappears under an open section, and
 *    the one panel that must still work without a website.
 * D4 Attacks the OVERCORRECTION: telling a phone owner where they are must
 *    not push #2830's two-COLUMN split onto a 390pt screen.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const mockInvoke = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ id: "00000000-0000-4000-8000-00000000000b" }),
  Redirect: () => null,
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));

const viewProps: Record<string, unknown>[] = [];
jest.mock("../../components/sites/BrandWebsiteView", () => ({
  BrandWebsiteView: (props: Record<string, unknown>) => {
    viewProps.push(props);
    return null;
  },
}));
jest.mock("../../components/ui/SafeScreen", () => ({
  SafeScreen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../components/ui/TopBar", () => ({ TopBar: () => null }));
jest.mock("../../config/featureFlags", () => ({ isFeatureEnabled: () => true }));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "00000000-0000-4000-8000-00000000000a" },
    isAuthReady: true,
  }),
}));
jest.mock("../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { displayName: "Gogi" } }),
}));
jest.mock("../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    isLoading: false,
    isError: false,
    rank: 60,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => null }));
jest.mock("../websiteExternalOpen", () => ({ openWebsiteUrl: jest.fn() }));
jest.mock("../studioHandoff", () => ({
  openStudioHandoff: jest.fn(),
  studioReturnSurface: () => "native",
}));
jest.mock("../../components/ui/Button", () => ({
  Button: ({ label }: { label: string }) =>
    require("react").createElement("mock-button", null, label),
}));
jest.mock("../../components/ui/GlassCard", () => ({
  GlassCard: ({
    children,
    testID,
  }: {
    children: React.ReactNode;
    testID?: string;
  }) => require("react").createElement("mock-card", { testID }, children),
}));
jest.mock("../../components/ui/Icon", () => ({ Icon: () => null }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Route from "../../../app/brand/[id]/website";
const { BrandWebsiteView } = jest.requireActual(
  "../../components/sites/BrandWebsiteView",
) as typeof import("../../components/sites/BrandWebsiteView");
import {
  deriveBusinessWebsiteState,
  websiteFailureNotice,
} from "../websiteJourney";
import type {
  WebsiteWorkspacePanel,
  WorkspaceNoticeDetail,
} from "../websiteJourney";
import { isOrphanedPublicationOperation } from "../../services/brandSitesService";
import type { BrandSiteOverview } from "../contracts";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => Promise<void>;
  create: (node: React.ReactElement) => {
    toJSON: () => unknown;
    unmount: () => void;
  };
};

/*
 * Every mounted route is tracked and UNMOUNTED after its test. A tree left
 * mounted keeps re-rendering on its own React Query timers and keeps pushing
 * into `viewProps`, so the next test reads the previous test's props — which
 * is exactly the kind of cross-test bleed that makes a suite lie.
 */
const mounted: { unmount: () => void }[] = [];
const clients: QueryClient[] = [];

const ACCOUNT = "00000000-0000-4000-8000-00000000000a";
const BRAND = "00000000-0000-4000-8000-00000000000b";
const SITE_ID = "00000000-0000-4000-8000-00000000000c";
const STUCK_OPERATION = "00000000-0000-4000-8000-00000000000d";
const DIGEST = "b".repeat(64);
const PUBLICATION_KEY =
  `mingla:brand-site-publication:v1:${ACCOUNT}:${BRAND}:${SITE_ID}`;

/**
 * Every code `sitesFailure` can emit, plus the client-side ones. This is the
 * exhaustive set a Website failure can carry.
 */
const CORE_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_STATE",
  "VALIDATION_FAILED",
  "REVISION_CONFLICT",
  "SESSION_EXPIRED",
  "OPERATION_IN_PROGRESS",
  "PUBLISH_FAILED_LAST_GOOD_PRESERVED",
  "MEDIA_REJECTED",
  "MEDIA_PROCESSING",
  "SERVICE_TEMPORARILY_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "UNAUTHORIZED",
  "REPLAY_DETECTED",
  "SITE_UNAVAILABLE",
] as const;

const SITE: BrandSiteOverview = {
  id: SITE_ID,
  brand_id: BRAND,
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  status: "draft",
  active_publication_id: null,
  last_successful_publication_id: null,
  provisioning_error_code: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  brand_site_hosts: [],
  latest_provision_operation: null,
};

function refusal(code: string, message: string) {
  return {
    data: { ok: false, error: { code, message, retryable: false } },
    error: null,
  };
}

function ok(data: unknown) {
  return { data: { ok: true, data }, error: null };
}

interface Envelope {
  data: unknown;
  error: null;
}

function serve(extra: (route: string) => Envelope | null): void {
  mockInvoke.mockImplementation(
    (_fn: string, opts: { body: Record<string, unknown> }) => {
      const route = String(opts.body.route ?? "");
      const custom = extra(route);
      if (custom !== null) return Promise.resolve(custom);
      if (route.endsWith("/site-availability")) {
        return Promise.resolve(ok({ available: true, site: SITE }));
      }
      if (route.endsWith("/site")) return Promise.resolve(ok(SITE));
      return Promise.resolve(ok([]));
    },
  );
}

function latest(): Record<string, unknown> {
  return viewProps[viewProps.length - 1] ?? {};
}

function notice(): WorkspaceNoticeDetail | null {
  return (latest().notice ?? null) as WorkspaceNoticeDetail | null;
}

/**
 * Flush until the tree is quiet.
 *
 * A MACROTASK per pass, not just a microtask: React Query batches its
 * notifications through `setTimeout(…, 0)` (`notifyManager`), so awaiting
 * `Promise.resolve()` can return before a resolved query has told React
 * anything. A microtask-only flush happens to work for the first mount in a
 * file and then starts returning a tree that has rendered exactly once —
 * a false negative that looks like a broken fix.
 */
async function settle(passes = 12): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mountRoute(): Promise<void> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  await act(async () => {
    mounted.push(
      create(
        <QueryClientProvider client={client}>
          <Route />
        </QueryClientProvider>,
      ),
    );
  });
  await settle();
}

function testIds(node: React.ReactElement): string[] {
  let tree: { toJSON: () => unknown } | null = null;
  const renderer = require("react-test-renderer") as {
    act: (run: () => void) => void;
    create: (node: React.ReactElement) => { toJSON: () => unknown };
  };
  renderer.act(() => {
    tree = renderer.create(node);
  });
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as {
      props?: Record<string, unknown>;
      children?: unknown;
    };
    const id = record.props?.testID;
    if (typeof id === "string") found.push(id);
    if (record.children !== undefined) walk(record.children);
  };
  walk((tree as unknown as { toJSON: () => unknown }).toJSON());
  return found;
}

function renderedText(node: React.ReactElement): string {
  let tree: { toJSON: () => unknown } | null = null;
  const renderer = require("react-test-renderer") as {
    act: (run: () => void) => void;
    create: (node: React.ReactElement) => { toJSON: () => unknown };
  };
  renderer.act(() => {
    tree = renderer.create(node);
  });
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    walk((value as { children?: unknown }).children);
  };
  walk((tree as unknown as { toJSON: () => unknown }).toJSON());
  return parts.join(" ");
}

const VIEW_BASE = {
  brandName: "Gogi Lagos",
  site: SITE,
  rank: 60,
  isWideDesktop: false,
  journeyState: 5 as const,
  panel: "overview" as const,
  notice: null,
  isLoading: false,
  isError: false,
  isProvisioning: false,
  isOpeningStudio: false,
  isPreviewing: false,
  isPublishing: false,
  isRollingBack: false,
  isValidating: false,
  versions: [],
  analytics: null,
  validation: null,
  validationFailure: null,
  selectedVersion: null,
  provisionOperationId: null,
  provisionOperation: null,
  provisionPollingTimedOut: false,
  publicationOperationId: null,
  publicationOperation: null,
  publicationPollingTimedOut: false,
  isReconciling: false,
  onRetry: jest.fn(),
  onSetPanel: jest.fn(),
  onProvision: jest.fn(),
  onReconcileProvision: jest.fn(),
  onOpenStudio: jest.fn(),
  onPreview: jest.fn(),
  onViewLive: jest.fn(),
  onOpenAri: jest.fn(),
  onValidatePublish: jest.fn(),
  onPublish: jest.fn(),
  onSelectRollback: jest.fn(),
  onRollback: jest.fn(),
  onReconcilePublication: jest.fn(),
  onResetFailedPublication: jest.fn(),
};

beforeEach(async () => {
  viewProps.length = 0;
  mockInvoke.mockReset();
  await AsyncStorage.clear();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) {
    await act(async () => {
      tree.unmount();
    });
  }
  // A QueryClient left alive keeps its refetch intervals and cache-GC timers
  // running for the rest of the file, which is enough to starve a later
  // test's own flushes. Tear each one down with the tree that used it.
  for (const client of clients.splice(0)) {
    client.clear();
    client.unmount();
  }
  jest.restoreAllMocks();
});

describe("#3583 D1 adversarial — nothing a server says is a network state", () => {
  it("no Core code, and no code at all, can produce an offline notice", () => {
    const fuzz = [
      ...CORE_CODES,
      "OFFLINE",
      "offline",
      "NETWORK_OFFLINE",
      "",
      // Built, not literal: `src/**` must diff as text (#1735).
      String.fromCharCode(0),
      "A".repeat(500),
    ];
    for (const code of fuzz) {
      const built = websiteFailureNotice({ code, message: "anything" });
      expect(built.kind).not.toBe("offline");
      expect(built.body.trim().length).toBeGreaterThan(0);
      expect(built.title.trim().length).toBeGreaterThan(0);
    }
    const untyped = websiteFailureNotice({ code: null, message: null });
    expect(untyped.kind).toBe("failed");
    expect(untyped.body.trim().length).toBeGreaterThan(0);
  });

  // One test PER CODE, not a loop inside one test: each route tree then gets
  // its own clean mount, its own QueryClient and its own teardown.
  it.each([
    "INVALID_STATE",
    "SERVICE_TEMPORARILY_UNAVAILABLE",
    "VALIDATION_FAILED",
  ])("a %s refusal stays visible, and stays a failure", async (code) => {
    // The old path set "offline", and the effect below it cleared "offline"
    // whenever the device was not offline — which, with netinfo absent from
    // every shipped binary, is ALWAYS.
    serve((route) =>
      route.endsWith("/previews") || route.endsWith("/ari")
        ? refusal(code, `Core says ${code}.`)
        : null,
    );
    await mountRoute();
    await act(async () => {
      (latest().onPreview as () => void)();
    });
    await settle();

    expect(notice()?.kind).toBe("failed");
    expect(notice()?.body).toContain(`Core says ${code}.`);

    // And it survives a panel change, which re-runs the same effect.
    await act(async () => {
      (latest().onSetPanel as (p: string) => void)("versions");
    });
    await settle();
    expect(notice()?.kind).toBe("failed");
  });
});

describe("#3583 D2 adversarial — the installs already stuck", () => {
  async function seedStuckPointer(): Promise<void> {
    await AsyncStorage.setItem(
      PUBLICATION_KEY,
      JSON.stringify({
        accountId: ACCOUNT,
        brandId: BRAND,
        siteId: SITE_ID,
        operationId: STUCK_OPERATION,
        kind: "publish",
        startedAt: Date.now(),
        expectedRevision: "rev-1",
        sourceDigest: DIGEST,
        rollbackSourcePublicationId: null,
      }),
    );
  }

  it("a pointer Core has no receipt for is dropped, and the owner is told", async () => {
    await seedStuckPointer();
    serve((route) =>
      route.includes("/operations/")
        ? refusal("NOT_FOUND", "Website information is not available.")
        : null,
    );
    await mountRoute();
    await settle();

    expect(await AsyncStorage.getItem(PUBLICATION_KEY)).toBeNull();
    expect(latest().publicationOperationId).toBeNull();
    // 14 is the "Publishing your website" screen the owner could not leave.
    expect(latest().journeyState).not.toBe(14);
    expect(notice()?.kind).toBe("failed");
    expect(notice()?.reference).toBe(STUCK_OPERATION);
  });

  it("a TRANSIENT receipt failure is NOT read as proof the operation never existed", async () => {
    await seedStuckPointer();
    serve((route) =>
      route.includes("/operations/")
        ? refusal(
          "SERVICE_TEMPORARILY_UNAVAILABLE",
          "Website tools are temporarily unavailable. Please try again.",
        )
        : null,
    );
    await mountRoute();
    await settle();

    // Core being unreachable says NOTHING about whether the operation exists.
    // Dropping the pointer here would abandon a publish that is really running.
    expect(await AsyncStorage.getItem(PUBLICATION_KEY)).not.toBeNull();
    expect(latest().publicationOperationId).toBe(STUCK_OPERATION);
    expect(latest().journeyState).toBe(14);
  });

  it("the orphan predicate admits ONLY a missing receipt", () => {
    const operation = {
      accountId: ACCOUNT,
      brandId: BRAND,
      siteId: SITE_ID,
      operationId: STUCK_OPERATION,
      kind: "publish" as const,
      startedAt: 0,
      expectedRevision: "rev-1",
      sourceDigest: DIGEST,
      rollbackSourcePublicationId: null,
    };
    expect(isOrphanedPublicationOperation(operation, "NOT_FOUND")).toBe(true);
    for (const code of CORE_CODES.filter((c) => c !== "NOT_FOUND")) {
      expect(isOrphanedPublicationOperation(operation, code)).toBe(false);
    }
    expect(isOrphanedPublicationOperation(operation, null)).toBe(false);
    expect(isOrphanedPublicationOperation(null, "NOT_FOUND")).toBe(false);
  });
});

describe("#3583 D3 adversarial — a website that is not there", () => {
  const siteRequiring: WebsiteWorkspacePanel[] = [
    "publish_review",
    "versions",
    "analytics",
    "address",
    "rollback_review",
    "overview",
  ];

  it("a section open when the website disappears shows setup, not the section", () => {
    for (const panel of siteRequiring) {
      const state = deriveBusinessWebsiteState({
        site: null,
        panel,
        operation: null,
        operationPending: false,
        isOpeningStudio: false,
        isPreviewing: false,
        studioReturnResult: null,
      });
      expect(state).toBe(2);
      const ids = testIds(
        <BrandWebsiteView
          {...VIEW_BASE}
          site={null}
          panel={panel}
          journeyState={state}
        />,
      );
      expect(ids).toContain("website-not-setup");
      for (const dead of [
        "website-versions",
        "website-analytics",
        "website-address",
        "website-publish-review",
        "website-rollback-review",
      ]) {
        expect(ids).not.toContain(dead);
      }
    }
  });

  it("nothing rendered without a website claims a website is live", () => {
    for (const panel of siteRequiring) {
      const text = renderedText(
        <BrandWebsiteView
          {...VIEW_BASE}
          site={null}
          panel={panel}
          journeyState={2}
          isWideDesktop
        />,
      );
      expect(text).not.toMatch(/remains live/i);
      expect(text).not.toMatch(/is live/i);
    }
  });

  it("the fix did not overcorrect: setup review still works without a website", () => {
    expect(
      deriveBusinessWebsiteState({
        site: null,
        panel: "setup_review",
        operation: null,
        operationPending: false,
        isOpeningStudio: false,
        isPreviewing: false,
        studioReturnResult: null,
      }),
    ).toBe(3);
    expect(
      testIds(
        <BrandWebsiteView
          {...VIEW_BASE}
          site={null}
          panel="setup_review"
          journeyState={3}
        />,
      ),
    ).toContain("website-setup-review");
  });

  it("a website that DOES exist keeps every rail destination", () => {
    const ids = testIds(<BrandWebsiteView {...VIEW_BASE} isWideDesktop />);
    for (const key of ["overview", "publish", "versions", "analytics", "address"]) {
      expect(ids).toContain(`website-rail-${key}`);
    }
  });
});

describe("#3583 D4 adversarial — telling a phone owner where they are is not a split column", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../screens/ari/AriChatScreen.tsx"),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "AriChatScreen.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function conditionsFor(whenTrueText: string): string[] {
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isConditionalExpression(node) &&
        node.whenTrue.getText(ast).trim() === whenTrueText
      ) {
        found.push(node.condition.getText(ast).replace(/\s+/g, " ").trim());
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return found;
  }

  function styleKeys(): string[] {
    const keys: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "StyleSheet.create" &&
        node.arguments.length === 1 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        for (const property of node.arguments[0].properties) {
          if (property.name !== undefined) {
            keys.push(property.name.getText(ast));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return keys;
  }

  it("the two-COLUMN split is still wide-desktop only", () => {
    // #2830 measured this: at 390pt a split column gives neither half enough
    // room. Showing the owner WHERE THEY ARE must not smuggle that layout onto
    // a phone.
    const conditions = conditionsFor("styles.websiteSplitHost");
    expect(conditions.length).toBeGreaterThan(0);
    for (const condition of conditions) {
      expect(condition).toContain("websiteSplit");
      expect(condition).toContain("isWideDesktop");
      expect(condition).toContain("&&");
    }
  });

  it("the phone gets a banner variant, not the desktop column box", () => {
    expect(styleKeys()).toContain("websiteDraftBanner");
    const conditions = conditionsFor("null");
    // The pane style array reads `isWideDesktop ? null : styles.…Banner`, so
    // the banner is applied exactly when the split column is NOT.
    const paneGate = conditions.filter((condition) => condition === "isWideDesktop");
    expect(paneGate.length).toBeGreaterThan(0);
    expect(source).toContain("styles.websiteDraftBanner");
  });
});
