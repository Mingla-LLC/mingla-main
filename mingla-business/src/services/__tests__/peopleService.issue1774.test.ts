import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpc = jest.fn<(...args: unknown[]) => Promise<{ data: any; error: any }>>();
jest.mock("../supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

import { addBrandPerson, getBrandPerson, listBrandPeople, PeopleServiceError } from "../peopleService";

const person = {
  personId: "17740000-0000-4000-8000-000000000020",
  displayName: "Ada Lovelace",
  avatarUrl: null,
  updatedAt: "2026-08-13T12:00:00.000Z",
  contacts: [{ id: "17740000-0000-4000-8000-000000000030", channel: "email", value: "ada@example.test", isPrimary: true }],
  suppressions: [{ channel: "email", scope: "marketing" }],
};

beforeEach(() => { rpc.mockReset(); });

describe("issue #1774 People RPC boundary", () => {
  test("lists the server-owned total and forwards the exact brand/cursor", async () => {
    const nextCursor = { updatedAt: person.updatedAt, personId: person.personId };
    rpc.mockResolvedValue({ data: { rows: [person], nextCursor, bookTotal: 12, filteredTotal: 1 }, error: null });
    await expect(listBrandPeople({ brandId: "brand-1", search: "ada", cursor: null, limit: 50 })).resolves.toEqual({ rows: [person], nextCursor, bookTotal: 12, filteredTotal: 1 });
    expect(rpc).toHaveBeenCalledWith("biz_get_brand_people_book", { p_brand_id: "brand-1", p_search: "ada", p_cursor: null, p_limit: 50 });
  });

  test("reads one person only through the protected RPC", async () => {
    rpc.mockResolvedValue({ data: person, error: null });
    await expect(getBrandPerson({ brandId: "brand-1", personId: person.personId })).resolves.toEqual(person);
    expect(rpc).toHaveBeenCalledWith("biz_get_brand_person", { p_brand_id: "brand-1", p_person_id: person.personId });
  });

  test("manual add preserves one client request id and parses a successful result", async () => {
    rpc.mockResolvedValue({ data: { outcome: "created", person, conflictId: null }, error: null });
    const input = { brandId: "brand-1", displayName: "Ada Lovelace", email: "ada@example.test", phoneE164: null, phoneCountryIso: null, clientRequestId: "17740000-0000-4000-8000-000000000040" };
    await expect(addBrandPerson(input)).resolves.toEqual({ outcome: "created", person, conflictId: null });
    expect(rpc).toHaveBeenCalledWith("biz_add_brand_person", expect.objectContaining({ p_brand_id: "brand-1", p_client_request_id: input.clientRequestId }));
  });

  test("fails closed on malformed rows and exposes no backend message", async () => {
    rpc.mockResolvedValue({ data: { rows: [{ ...person, contacts: "leak" }], nextCursor: null, bookTotal: 1, filteredTotal: 1 }, error: null });
    await expect(listBrandPeople({ brandId: "brand-1", search: null, cursor: null, limit: 50 })).rejects.toMatchObject({ code: "people_unknown", retryable: false });
  });

  test("maps only allowlisted domain codes and makes unknown failures retryable", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "people_forbidden: hidden details" } });
    await expect(getBrandPerson({ brandId: "brand-1", personId: person.personId })).rejects.toEqual(expect.objectContaining({ code: "people_forbidden", retryable: false }));
    rpc.mockResolvedValueOnce({ data: null, error: { message: "database internals" } });
    const rejection = getBrandPerson({ brandId: "brand-1", personId: person.personId });
    await expect(rejection).rejects.toBeInstanceOf(PeopleServiceError);
    await expect(rejection).rejects.toEqual(expect.objectContaining({ code: "people_temporarily_unavailable", retryable: true }));
  });
});
