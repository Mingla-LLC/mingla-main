/**
 * META-ORCH-1009 Sub-E (C2 / SPEC §11.4) — regression test for the expired-Hub
 * -proposal regenerate path.
 *
 * Load-bearing behaviour: fetchPendingExperiencesForBrand NO LONGER hides
 * expired rows — it returns `pending` rows past their expiry with isExpired:true
 * so the Hub can render a regenerate CTA instead of an empty list (the pre-Sub-E
 * `.gt("expires_at", now)` filter silently dropped them).
 *
 * fails-on-revert: if the service re-adds `.gt("expires_at", now)`, the mock
 * query builder records the `.gt` call and the final assertion fails; the stale
 * row would also (in production) be filtered out, so isExpired:true could never
 * be observed.
 *
 * jest.mock factory vars are `mock`-prefixed so jest's hoisting allows the
 * out-of-scope reference.
 */

type MockRow = Record<string, unknown>;

const mockState: { filters: Record<string, unknown>; rows: MockRow[] } = {
  filters: {},
  rows: [],
};

jest.mock('../supabase', () => {
  const makeBuilder = () => {
    mockState.filters = {};
    const builder: Record<string, unknown> = {};
    const track = (key: string) => (...args: unknown[]) => {
      mockState.filters[key] = args;
      return builder;
    };
    builder.select = track('select');
    builder.eq = track('eq');
    builder.gt = track('gt');
    builder.order = (..._a: unknown[]) => Promise.resolve({ data: mockState.rows, error: null });
    return builder;
  };
  return {
    supabase: {
      from: (_t: string) => makeBuilder(),
      functions: { invoke: jest.fn() },
    },
  };
});

import { fetchPendingExperiencesForBrand } from '../experienceGenerationService';

const NOW = Date.now();

describe('META-ORCH-1009 Sub-E — expired Hub proposal regenerate path', () => {
  beforeEach(() => {
    mockState.filters = {};
    mockState.rows = [];
  });

  it('returns expired pending rows with isExpired=true and does NOT filter them out', async () => {
    mockState.rows = [
      {
        id: 'fresh-1',
        tool_name: 'create_experience',
        tool_args: { parser_source: 'menu_snap' },
        status: 'pending',
        expires_at: new Date(NOW + 6 * 24 * 3600 * 1000).toISOString(),
        created_at: new Date(NOW - 1000).toISOString(),
      },
      {
        id: 'stale-1',
        tool_name: 'create_experience',
        tool_args: { parser_source: 'activities_snap' },
        status: 'pending',
        expires_at: new Date(NOW - 3600 * 1000).toISOString(),
        created_at: new Date(NOW - 2000).toISOString(),
      },
    ];

    const rows = await fetchPendingExperiencesForBrand('brand-1');

    expect(rows).toHaveLength(2);
    const fresh = rows.find((r) => r.id === 'fresh-1');
    const stale = rows.find((r) => r.id === 'stale-1');
    expect(fresh?.isExpired).toBe(false);
    expect(stale?.isExpired).toBe(true);
    expect((stale?.tool_args as Record<string, unknown>).parser_source).toBe('activities_snap');

    // fails-on-revert guard: no .gt("expires_at") filter (the hide-expired bug).
    expect(mockState.filters.gt).toBeUndefined();
  });
});
