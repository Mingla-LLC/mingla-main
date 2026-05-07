import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  routeStripeEvent,
  STRIPE_ROUTED_EVENT_TYPES,
} from '../stripeWebhookRouter.ts';

class FakeBuilder {
  table: string;
  db: FakeDb;
  filters: Record<string, unknown> = {};
  payload: Record<string, unknown> | null = null;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }

  is(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }

  not() {
    return this;
  }

  in() {
    return this;
  }

  upsert(payload: Record<string, unknown>) {
    this.db.upserts.push({ table: this.table, payload });
    return Promise.resolve({ error: null });
  }

  update(payload: Record<string, unknown>) {
    this.payload = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.db.inserts.push({ table: this.table, payload });
    return Promise.resolve({ error: null });
  }

  delete() {
    this.db.deletes.push({ table: this.table, filters: this.filters });
    return this;
  }

  maybeSingle() {
    if (this.table === 'stripe_connect_accounts') {
      return Promise.resolve({
        data: {
          brand_id: 'brand_123',
          charges_enabled: false,
          payouts_enabled: false,
          requirements: {},
          detached_at: this.db.detachedAt,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  then(resolve: (value: { data: unknown[]; error: null }) => void) {
    if (this.table === 'brand_team_members') {
      resolve({ data: [{ user_id: 'user_123', role: 'finance_manager' }], error: null });
      return;
    }
    resolve({ data: [], error: null });
  }
}

class FakeDb {
  upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  deletes: Array<{ table: string; filters: Record<string, unknown> }> = [];
  detachedAt: string | null = null;

  from(table: string) {
    return new FakeBuilder(this, table);
  }
}

Deno.test('router exposes 16 subscribed events and excludes fake requirements event', () => {
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.length, 16);
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.includes('account.updated'), true);
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.includes('application_fee.refunded'), true);
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.includes('account.requirements.updated' as never), false);
});

Deno.test('account.updated updates connect row and clears KYC stall marker when enabled', async () => {
  const db = new FakeDb();
  const result = await routeStripeEvent(db as never, {} as never, {
    id: 'evt_account',
    type: 'account.updated',
    data: {
      object: {
        id: 'acct_123',
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [] },
        metadata: { mingla_brand_id: 'brand_123' },
      },
    },
  });
  assertEquals(result.brandId, 'brand_123');
  assertEquals(db.upserts[0].payload.kyc_stall_reminder_sent_at, null);
});

Deno.test('payout.failed upserts payout and dispatches remediation notification', async () => {
  const calls: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }) as typeof fetch;
  try {
    const db = new FakeDb();
    await routeStripeEvent(db as never, {} as never, {
      id: 'evt_payout',
      type: 'payout.failed',
      account: 'acct_123',
      data: {
        object: {
          id: 'po_123',
          amount: 1200,
          currency: 'gbp',
          status: 'failed',
          failure_code: 'invalid_account_number',
        },
      },
    });
    assertEquals(db.upserts.some((row) => row.table === 'payouts'), true);
    assertEquals((calls[0] as { type: string }).type, 'stripe.payout_failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
