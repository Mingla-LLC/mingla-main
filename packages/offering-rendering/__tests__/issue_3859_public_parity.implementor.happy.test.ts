import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  createPublicAuthReturnIntent,
  createPublicInstallmentCapability,
  createPublicParityContract,
  PUBLIC_PARITY_ANALYTICS_EVENTS,
  PUBLIC_PARITY_LIFECYCLE_STATES,
  PUBLIC_PARITY_PAGE_KINDS,
  type PublicParityContract,
} from "../publicParityContract.ts";
import { TRIP_INSTALLMENT_CAPABILITY_UNAVAILABLE } from "../tripInstallmentCapability.ts";

const enabled = (kind: string) => ({
  kind,
  enabled: true,
  disabledReason: null,
});

const selfAction = (
  id: string,
  kind: string,
  options: {
    auth?: "none" | "required";
    terminal?: string;
    selection?: { kind: string; id: string } | null;
    requiresRevalidation?: boolean;
  } = {},
) => ({
  id,
  kind,
  target: { kind: "self" },
  auth: options.auth ?? "none",
  terminal: options.terminal ?? "server-terminal",
  requiresRevalidation: options.requiresRevalidation ?? true,
  selection: options.selection ?? null,
});

const identity = {
  brand: {
    kind: "brand",
    entityId: "brand_01",
    route: { kind: "brand", entityId: "brand_01", brandSlug: "slow-burn" },
  },
  venue: {
    kind: "venue",
    entityId: "venue_01",
    route: {
      kind: "venue",
      entityId: "venue_01",
      brandSlug: "slow-burn",
      venueSlug: "lantern-room",
    },
  },
  event: {
    kind: "event",
    entityId: "event_01",
    route: {
      kind: "event",
      entityKind: "event",
      entityId: "event_01",
      brandSlug: "slow-burn",
      eventSlug: "late-night-jazz",
    },
  },
  rsvp: {
    kind: "rsvp",
    entityId: "rsvp_01",
    route: {
      kind: "event",
      entityKind: "rsvp",
      entityId: "rsvp_01",
      brandSlug: "slow-burn",
      eventSlug: "guest-list-night",
    },
  },
  trip: {
    kind: "trip",
    entityId: "trip_01",
    route: {
      kind: "trip",
      entityId: "trip_01",
      brandSlug: "slow-burn",
      tripSlug: "cape-town-weekend",
    },
  },
  experience: {
    kind: "experience",
    entityId: "experience_01",
    route: {
      kind: "experience",
      entityId: "experience_01",
      brandSlug: "slow-burn",
      experienceSlug: "chef-table",
    },
  },
  stay: {
    kind: "stay",
    entityId: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
    route: {
      kind: "stay",
      entityId: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
      groupId: "a0b1c2d3-e4f5-6789-abcd-ef0123456789",
    },
  },
  opaqueShare: {
    kind: "opaque-share",
    entityId: "0f1e2d3c-4b5a-6789-abcd-0123456789ab",
    route: {
      kind: "opaque-share",
      entityId: "0f1e2d3c-4b5a-6789-abcd-0123456789ab",
      shareId: "0f1e2d3c-4b5a-6789-abcd-0123456789ab",
      cardKind: "curated",
    },
  },
  contentShare: {
    kind: "content-share",
    entityId: "Aa0Bb1Cc2Dd3Ee4F",
    route: {
      kind: "content-share",
      entityId: "Aa0Bb1Cc2Dd3Ee4F",
      code: "Aa0Bb1Cc2Dd3Ee4F",
      contentKind: "trip",
      destination: {
        kind: "trip",
        entityId: "trip_01",
        route: {
          kind: "trip",
          entityId: "trip_01",
          brandSlug: "slow-burn",
          tripSlug: "cape-town-weekend",
        },
      },
    },
  },
} as const;

const base = (
  canonicalIdentity: unknown,
  visibility: "public" | "exact-link" | "protected",
  capabilities: unknown[],
  actions: unknown[],
  surface = "buyer-web",
) => ({
  schemaVersion: 1,
  identity: canonicalIdentity,
  visibility,
  state: "populated",
  capabilities,
  actions,
  analytics: { surface, authState: "anonymous" },
});

const fixtures = [
  base(identity.brand, "public", [enabled("open-content")], [{
    id: "open-event",
    kind: "open-content",
    target: { kind: "page", identity: identity.event },
    auth: "none",
    terminal: "canonical-view",
    requiresRevalidation: false,
    selection: null,
  }]),
  base(identity.venue, "public", [enabled("reservation")], [
    selfAction("reserve", "reservation", { auth: "required" }),
  ]),
  base(
    identity.event,
    "public",
    [enabled("select-tier"), enabled("checkout")],
    [
      selfAction("select-tier", "select-tier", {
        terminal: "selection",
        selection: { kind: "tier", id: "tier_01" },
        requiresRevalidation: false,
      }),
      selfAction("checkout", "checkout", {
        auth: "required",
        selection: { kind: "tier", id: "tier_01" },
      }),
    ],
  ),
  base(identity.rsvp, "exact-link", [enabled("rsvp")], [
    selfAction("going", "rsvp", {
      auth: "required",
      selection: { kind: "rsvp-response", id: "going" },
    }),
  ]),
  base(
    identity.trip,
    "public",
    [
      enabled("select-package"),
      createPublicInstallmentCapability(false),
      enabled("checkout"),
    ],
    [
      selfAction("select-package", "select-package", {
        terminal: "selection",
        selection: { kind: "package", id: "tier_02" },
        requiresRevalidation: false,
      }),
      selfAction("checkout", "checkout", {
        auth: "required",
        selection: { kind: "package", id: "tier_02" },
      }),
    ],
  ),
  base(identity.experience, "public", [enabled("checkout")], [
    selfAction("checkout", "checkout", { auth: "required" }),
  ]),
  base(identity.stay, "protected", [enabled("pay-balance")], [
    selfAction("pay-balance", "pay-balance", { auth: "required" }),
  ]),
  base(identity.opaqueShare, "exact-link", [enabled("view-share")], [
    selfAction("view-share", "view-share", {
      terminal: "canonical-view",
      requiresRevalidation: false,
    }),
  ]),
  base(identity.contentShare, "exact-link", [enabled("open-content")], [{
    id: "continue-trip",
    kind: "open-content",
    target: { kind: "page", identity: identity.trip },
    auth: "none",
    terminal: "canonical-view",
    requiresRevalidation: false,
    selection: null,
  }]),
];

Deno.test("issue #3859 maps every existing public family into one pure semantic contract", () => {
  const models = fixtures.map((fixture) => createPublicParityContract(fixture));
  assert(models.every((result) => result.ok));
  assertEquals(
    models.map((result) => result.ok ? result.model.identity.kind : null),
    [...PUBLIC_PARITY_PAGE_KINDS],
  );
  assertEquals(
    models.map((result) =>
      result.ok ? result.model.analyticsContext.page_family : null
    ),
    [...PUBLIC_PARITY_PAGE_KINDS],
  );
  assertEquals(PUBLIC_PARITY_ANALYTICS_EVENTS.length, 12);
});

Deno.test("issue #3859 web, iOS, and Android receive equivalent semantics", () => {
  const results = ["buyer-web", "explorer-ios", "explorer-android"].map(
    (surface) =>
      createPublicParityContract({
        ...fixtures[4],
        analytics: {
          surface,
          authState: "signed-in",
        },
      }),
  );
  assert(results.every((result) => result.ok));
  const models = results.map((result) =>
    (result as { ok: true; model: PublicParityContract }).model
  );
  const semantic = (model: PublicParityContract) => ({
    identity: model.identity,
    visibility: model.visibility,
    state: model.state,
    capabilities: model.capabilities,
    actions: model.actions,
    accessibility: model.accessibility,
  });
  assertEquals(semantic(models[0]), semantic(models[1]));
  assertEquals(semantic(models[1]), semantic(models[2]));
});

Deno.test("issue #3859 keeps all common lifecycle states distinct and bounded", () => {
  const states = PUBLIC_PARITY_LIFECYCLE_STATES.map((state) => {
    const result = createPublicParityContract({
      ...base(identity.brand, "public", [], []),
      state,
    });
    assert(result.ok);
    return result.model.state;
  });
  assertEquals(states, [...PUBLIC_PARITY_LIFECYCLE_STATES]);
});

Deno.test("issue #3859 preserves safe auth return identity, action, and selection", () => {
  const result = createPublicParityContract(fixtures[3]);
  assert(result.ok);
  const intent = createPublicAuthReturnIntent(result.model, "going");
  assert(intent !== null);
  assertEquals(intent.identity, identity.rsvp);
  assertEquals(intent.action.selection, { kind: "rsvp-response", id: "going" });
  assertEquals(intent.revalidateBeforeResume, true);
  assertEquals(
    createPublicAuthReturnIntent(result.model, "https://evil.example"),
    null,
  );
  const tampered = {
    ...result.model,
    actions: [{
      ...result.model.actions[0],
      target: { kind: "external", owner: "https://evil.example" },
    }],
  };
  assertEquals(createPublicAuthReturnIntent(tampered, "going"), null);
});

Deno.test("issue #3859 installment capability is provider-neutral and unknown fails closed", () => {
  assertEquals(createPublicInstallmentCapability(true), {
    kind: "installments",
    enabled: true,
    disabledReason: null,
  });
  assertEquals(createPublicInstallmentCapability(false), {
    kind: "installments",
    enabled: false,
    disabledReason: TRIP_INSTALLMENT_CAPABILITY_UNAVAILABLE,
  });
  assertEquals(createPublicInstallmentCapability("unknown").enabled, false);
  assertEquals(createPublicInstallmentCapability(undefined).enabled, false);
});

Deno.test("issue #3859 malformed identity, state, capability, action, and kind/path fail closed", () => {
  const mutations = [
    { ...fixtures[0], identity: { ...identity.brand, kind: "creator" } },
    {
      ...fixtures[0],
      identity: {
        ...identity.brand,
        route: { ...identity.brand.route, entityId: "different_id" },
      },
    },
    {
      ...fixtures[0],
      identity: {
        ...identity.brand,
        route: { ...identity.brand.route, brandSlug: "Not Normalized" },
      },
    },
    { ...fixtures[0], state: "mystery" },
    { ...fixtures[0], capabilities: [enabled("teleport")] },
    {
      ...fixtures[0],
      actions: [{
        ...(fixtures[0].actions[0] as Record<string, unknown>),
        target: { kind: "external", owner: "https://evil.example" },
      }],
    },
    {
      ...fixtures[8],
      identity: {
        ...identity.contentShare,
        route: {
          ...identity.contentShare.route,
          contentKind: "event",
          destination: identity.event,
        },
      },
    },
    {
      ...fixtures[7],
      identity: {
        ...identity.opaqueShare,
        entityId: "ffffffffffffffffffffffffffffffffffff",
        route: {
          ...identity.opaqueShare.route,
          entityId: "ffffffffffffffffffffffffffffffffffff",
          shareId: "ffffffffffffffffffffffffffffffffffff",
        },
      },
    },
  ];
  for (const mutation of mutations) {
    assertEquals(createPublicParityContract(mutation).ok, false);
  }
});

Deno.test("issue #3859 analytics context is derived and rejects PII, URLs, secrets, and unbounded fields", () => {
  const result = createPublicParityContract(fixtures[2]);
  assert(result.ok);
  assertEquals(result.model.analyticsContext, {
    surface: "buyer-web",
    page_family: "event",
    entity_id: "event_01",
    entity_kind: "event",
    route_kind: "event",
    initial_state: "populated",
    auth_state: "anonymous",
  });

  for (
    const forbidden of [
      "name",
      "email",
      "phone",
      "free_text",
      "intake_answer",
      "filename",
      "url",
      "token",
      "provider_reference",
      "raw_error",
      "nested_payload",
    ]
  ) {
    const unsafe = {
      ...fixtures[2],
      analytics: {
        ...fixtures[2].analytics,
        [forbidden]: forbidden === "nested_payload"
          ? { any: "value" }
          : "secret",
      },
    };
    assertEquals(createPublicParityContract(unsafe), {
      ok: false,
      state: "error",
      reason: "invalid-analytics-context",
    });
  }
});

Deno.test("issue #3859 stale privileged actions require revalidation and offline mutation is refused", () => {
  const stale = {
    ...fixtures[5],
    state: "stale",
    actions: [{
      ...(fixtures[5].actions[0] as Record<string, unknown>),
      requiresRevalidation: false,
    }],
  };
  assertEquals(createPublicParityContract(stale).ok, false);

  const offline = {
    ...fixtures[5],
    state: "offline",
    capabilities: [enabled("checkout")],
    actions: fixtures[5].actions,
  };
  assertEquals(createPublicParityContract(offline).ok, false);
});

Deno.test("issue #3859 unresolved share identity is valid while loading but cannot masquerade as populated", () => {
  const loading = {
    ...base(
      {
        ...identity.contentShare,
        route: {
          ...identity.contentShare.route,
          contentKind: "unresolved",
          destination: null,
        },
      },
      "exact-link",
      [],
      [],
    ),
    state: "loading",
  };
  assertEquals(createPublicParityContract(loading).ok, true);
  assertEquals(
    createPublicParityContract({ ...loading, state: "populated" }).ok,
    false,
  );
});

Deno.test("issue #3859 shared contract imports no host, auth, analytics, Supabase, or provider SDK", async () => {
  const source = await Deno.readTextFile(
    new URL("../publicParityContract.ts", import.meta.url),
  );
  const barrel = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  assertEquals(specifiers, []);
  for (
    const forbidden of [
      "@supabase",
      "expo-router",
      "react-router",
      "mixpanel",
      "appsflyer",
      "stripe-react-native",
      "paystack-webview",
    ]
  ) {
    assert(!source.includes(forbidden));
  }
  assert(source.includes("export function createPublicParityContract"));
  // The contract is an explicit subpath API. Re-exporting it from the broad
  // rendering barrel makes Metro hoist checkout-only validation into the
  // business-web startup payload.
  assert(!barrel.includes('from "./publicParityContract"'));
});
