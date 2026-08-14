import { describe, expect, jest, test, beforeEach } from "@jest/globals";

const rpcMock = jest.fn<
  (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>
>();

jest.mock("../supabase", () => ({
  supabase: { rpc: rpcMock },
}));

import type { TicketStub } from "../../store/draftEventStore";
import { persistEventTicketTiers } from "../eventTicketTiersService";
import {
  setBrandPricingDefaults,
  setEventPricingSwitches,
} from "../pricingSwitchesService";

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "draft-tier-1",
  name: "Lagos early bird",
  priceGbp: 2500,
  capacity: 80,
  isFree: false,
  isUnlimited: false,
  visibility: "hidden",
  displayOrder: 2,
  approvalRequired: true,
  passwordProtected: true,
  passwordConfigured: true,
  password: "must-never-cross-the-service",
  waitlistEnabled: true,
  minPurchaseQty: 2,
  maxPurchaseQty: 6,
  allowTransfers: false,
  description: "All modifiers",
  saleStartAt: "2027-01-01T10:00:00.000Z",
  saleEndAt: "2027-02-01T10:00:00.000Z",
  availableAt: "door",
  ...patch,
});

beforeEach(() => {
  rpcMock.mockReset();
});

describe("#1974 canonical shared Business ticket/pricing service", () => {
  test("draft web/iOS/Android call serializes the complete tier without password or currency", async () => {
    rpcMock.mockImplementation(async (_name, args) => ({
      data: {
        event_id: args.p_event_id,
        representation: "draft",
        effective_currency: "NGN",
        tiers: args.p_tiers,
        client_revision: 8,
        updated_at: "2027-01-01T00:01:00.000Z",
      },
      error: null,
    }));
    await persistEventTicketTiers({
      eventId: "00000000-0000-4000-8000-000000001974",
      tickets: [ticket()],
      lifecycle: "draft",
      expectedUpdatedAt: "2027-01-01T00:00:00.000Z",
      expectedClientRevision: 7,
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0];
    expect(name).toBe("business_patch_event_ticket_tiers");
    expect(args).toMatchObject({
      p_expected_client_revision: 7,
      p_operation_id: null,
      p_reason: null,
    });
    const tierArg = (args.p_tiers as Array<Record<string, unknown>>)[0];
    expect(tierArg).toMatchObject({
      id: "draft-tier-1",
      name: "Lagos early bird",
      priceGbp: 2500,
      capacity: 80,
      visibility: "hidden",
      approvalRequired: true,
      passwordProtected: true,
      passwordConfigured: true,
      availableAt: "door",
    });
    expect(tierArg).not.toHaveProperty("password");
    expect(tierArg).not.toHaveProperty("password_hash");
    expect(tierArg).not.toHaveProperty("currency");
  });

  test("published temporary IDs become durable UUIDs before the canonical RPC", async () => {
    rpcMock.mockImplementation(async (_name, args) => ({
      data: {
        event_id: args.p_event_id,
        representation: "live",
        effective_currency: "NGN",
        tiers: args.p_tiers,
        client_revision: null,
        updated_at: "2027-01-01T00:01:00.000Z",
      },
      error: null,
    }));
    await persistEventTicketTiers({
      eventId: "00000000-0000-4000-8000-000000001974",
      tickets: [ticket({ id: "new-live-tier" })],
      lifecycle: "live",
      expectedUpdatedAt: "2027-01-01T00:00:00.000Z",
      reason: "Added a new release tier.",
    });
    const args = rpcMock.mock.calls[0][1];
    const id = ((args.p_tiers as Array<Record<string, unknown>>)[0].id) as string;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(args.p_reason).toBe("Added a new release tier.");
  });

  test("event pricing patch preserves omitted keys and can write inherit", async () => {
    rpcMock.mockResolvedValue({
      data: {
        overrides: { pass_tax: null, pass_mingla_fee: false, pass_service_fee: true },
        resolved: { pass_tax: true, pass_mingla_fee: false, pass_service_fee: true },
      },
      error: null,
    });
    const result = await setEventPricingSwitches("event-1", { passTax: null });
    expect(rpcMock).toHaveBeenCalledWith("business_patch_pricing_switches", {
      p_event_id: "event-1",
      p_patch: { pass_tax: null },
    });
    expect(result.overrides.passTax).toBeNull();
  });

  test("brand default patch is sparse and returns concrete readback", async () => {
    rpcMock.mockResolvedValue({
      data: { defaults: { pass_tax: true, pass_mingla_fee: false, pass_service_fee: true } },
      error: null,
    });
    const result = await setBrandPricingDefaults("brand-1", { passTax: true });
    expect(rpcMock).toHaveBeenCalledWith("business_patch_brand_pricing_defaults", {
      p_brand_id: "brand-1",
      p_patch: { default_pass_tax: true },
    });
    expect(result).toEqual({ passTax: true, passMinglaFee: false, passServiceFee: true });
  });
});
