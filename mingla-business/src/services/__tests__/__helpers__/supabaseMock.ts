/**
 * supabaseMock.ts — shared chainable Supabase mock (issue #1047 [business-jest-suite-audit], Part 2.3)
 *
 * The mingla-business service tests each hand-rolled `jest.mock("../supabase", …)`
 * with a bespoke query-builder. As the services grew new chained calls
 * (`auth.getSession`, a select following an update-then-eq chain, `.is`, `.order`,
 * `.maybeSingle`), those inline mocks drifted out of date and threw
 * "…is not a function" / "Cannot read properties of undefined (reading 'getSession')".
 * This is the ONE place that chain is defined, so it cannot drift per-file again.
 *
 * It is PLUMBING ONLY — it changes how the mock resolves the chain, never what a
 * test asserts. Each terminal value stays configurable so a migrated test keeps
 * asserting exactly what it asserted before.
 *
 * jest.mock() factories are hoisted above imports and may not close over
 * module-scope variables, so consume this via `require()` INSIDE the factory:
 *
 *   jest.mock("../supabase", () => ({
 *     supabase: {
 *       from: (...a) => mockFrom(...a),
 *       auth: require("./__helpers__/supabaseMock").createSupabaseAuthMock(),
 *     },
 *   }));
 */

export type SupabaseTerminal<T = unknown> = { data?: T; error?: unknown };

export type SupabaseSession = { user?: { id?: string } | null } | null;

/**
 * A PostgREST-style chainable query builder. Every builder method returns the
 * same chain (so any depth of `.select().eq().is().order()…` resolves), and the
 * chain is thenable/awaitable — plus `.single()`/`.maybeSingle()`/`.csv()` — all
 * resolving to the SAME configurable terminal `{ data, error }`.
 */
export function createChainableQuery<T = unknown>(
  terminal?: SupabaseTerminal<T>,
): Record<string, (...args: unknown[]) => unknown> {
  const resolved = {
    data: (terminal?.data ?? null) as T,
    error: terminal?.error ?? null,
  };
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const CHAIN_METHODS = [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "gt", "gte", "lt", "lte",
    "is", "in", "or", "not", "filter", "match",
    "contains", "containedBy", "overlaps",
    "like", "ilike", "textSearch",
    "order", "limit", "range", "returns", "abortSignal",
  ];
  for (const m of CHAIN_METHODS) chain[m] = () => chain;
  chain.single = () => Promise.resolve(resolved);
  chain.maybeSingle = () => Promise.resolve(resolved);
  chain.csv = () => Promise.resolve(resolved);
  // Thenable: `await supabase.from(...).select()...` yields the terminal value.
  chain.then = (...args: unknown[]) =>
    Promise.resolve(resolved).then(args[0] as (value: typeof resolved) => unknown);
  return chain;
}

/**
 * A `supabase.auth` mock. Defaults to a signed-in session with a user so the
 * common `getSession() → session.user` guard passes; pass `session: null` to
 * exercise the signed-out branch, or a specific `user`.
 */
export function createSupabaseAuthMock(opts?: {
  session?: SupabaseSession;
  user?: { id?: string } | null;
}): {
  getSession: () => Promise<{ data: { session: SupabaseSession }; error: null }>;
  getUser: () => Promise<{ data: { user: { id?: string } | null }; error: null }>;
} {
  const session: SupabaseSession =
    opts?.session !== undefined
      ? opts.session
      : { user: opts?.user ?? { id: "test-user-1047" } };
  return {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user: session?.user ?? null }, error: null }),
  };
}
