/**
 * #3660 — every BusinessTodoAction kind has a consumer on Home and Hub, and
 * the shared dispatcher is exhaustive. A producer without a consumer is how
 * pending invites rendered but opened the wrong surface.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BUSINESS_TODO_ACTION_KINDS,
  dispatchBusinessTodoAction,
  pendingBrandInviteRoute,
} from "../businessTodoDispatch";
import type { BusinessTodo, BusinessTodoAction } from "../businessTodos";

const homeSrc = readFileSync(
  join(__dirname, "../../../app/(tabs)/home.tsx"),
  "utf8",
);
const hubSrc = readFileSync(
  join(__dirname, "../../../app/(tabs)/hub/_layout.tsx"),
  "utf8",
);
const todosSrc = readFileSync(
  join(__dirname, "../businessTodos.ts"),
  "utf8",
);

describe("businessTodoDispatch #3660", () => {
  test("BUSINESS_TODO_ACTION_KINDS matches every kind in the BusinessTodoAction union source", () => {
    for (const kind of BUSINESS_TODO_ACTION_KINDS) {
      expect(todosSrc).toContain(`kind: "${kind}"`);
    }
    const kindLiterals = [...todosSrc.matchAll(/kind: "([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    const uniqueInUnion = [...new Set(kindLiterals)].filter((k) =>
      [
        "open_brand_switcher",
        "open_universal_creator",
        "route",
        "open_pending_invite",
      ].includes(k),
    );
    expect(uniqueInUnion.sort()).toEqual([...BUSINESS_TODO_ACTION_KINDS].sort());
  });

  test("Home and Hub both call dispatchBusinessTodoAction (single consumer path)", () => {
    expect(homeSrc).toContain("dispatchBusinessTodoAction");
    expect(hubSrc).toContain("dispatchBusinessTodoAction");
    expect(homeSrc).toContain("pendingBrandInviteRoute");
    expect(hubSrc).toContain("pendingBrandInviteRoute");
    expect(homeSrc).toContain("openPendingInvite");
    expect(hubSrc).toContain("openPendingInvite");
  });

  test("open_pending_invite dispatches to the dedicated accept route, not Account", () => {
    const todo: BusinessTodo = {
      id: "pending_invite_x",
      label: "You've been invited to Demo",
      action: {
        kind: "open_pending_invite",
        invitationId: "inv-1",
        brandName: "Demo",
      },
    };
    const calls: string[] = [];
    dispatchBusinessTodoAction(todo, {
      openBrandSwitcher: () => calls.push("switcher"),
      openUniversalCreator: () => calls.push("creator"),
      route: (path) => calls.push(`route:${path}`),
      openPendingInvite: (id, name) =>
        calls.push(pendingBrandInviteRoute(id, name)),
    });
    expect(calls).toEqual([
      pendingBrandInviteRoute("inv-1", "Demo"),
    ]);
    expect(calls[0]).toContain("/pending-brand-invite?");
    expect(calls[0]).toContain("invitationId=inv-1");
    expect(calls[0]).not.toContain("/account");
    expect(calls[0]).not.toContain("/(tabs)/account");
  });

  test("every action kind is handled without throwing", () => {
    const actions: BusinessTodoAction[] = [
      { kind: "open_brand_switcher" },
      { kind: "open_universal_creator" },
      { kind: "route", route: "/venue/create" },
      {
        kind: "open_pending_invite",
        invitationId: "i",
        brandName: "B",
      },
    ];
    for (const action of actions) {
      expect(() =>
        dispatchBusinessTodoAction(
          { id: "t", label: "t", action },
          {
            openBrandSwitcher: () => undefined,
            openUniversalCreator: () => undefined,
            route: () => undefined,
            openPendingInvite: () => undefined,
          },
        ),
      ).not.toThrow();
    }
  });
});
