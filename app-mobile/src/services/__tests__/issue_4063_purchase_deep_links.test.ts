import assert from "node:assert/strict";
import test from "node:test";

import { executeDeepLink, parseDeepLink } from "../deepLinkService.ts";
import { resolveOneLinkDestination } from "../oneLinkResolver.ts";

test("parses app, web, and OneLink claim codes without accepting malformed codes", () => {
  const expected = { kind: "claim", code: "AB12CD34EF" };
  assert.deepEqual(parseDeepLink("https://usemingla.com/c/ab12cd34ef"), expected);
  assert.deepEqual(parseDeepLink("com.mingla.app.v2://c/AB12CD34EF"), expected);
  assert.deepEqual(resolveOneLinkDestination({
    deep_link_value: "claim",
    deep_link_sub1: "ab12cd34ef",
  }), expected);
  assert.equal(parseDeepLink("https://usemingla.com/c/short"), null);
});

test("purchase deep links preserve door and ticket selectors through execution", () => {
  const destination = parseDeepLink(
    "com.mingla.app.v2://purchases/order/order-1?door=1&ticket=ticket-2",
  );
  assert.deepEqual(destination, {
    kind: "purchase",
    purchaseKind: "order",
    purchaseId: "order-1",
    door: true,
    ticketId: "ticket-2",
  });
  let opened = "";
  executeDeepLink(destination, {
    setCurrentPage: () => undefined,
    openRouterPath: (path) => { opened = path; },
  });
  assert.equal(opened, "/purchases/order/order-1?door=1&ticket=ticket-2");
});

test("claim destinations execute only through the claim handler", () => {
  let code = "";
  executeDeepLink({ kind: "claim", code: "AB12CD34EF" }, {
    setCurrentPage: () => undefined,
    handleClaimCode: (value) => { code = value; },
  });
  assert.equal(code, "AB12CD34EF");
});
