/**
 * #3660 — single dispatcher for BusinessTodoAction kinds.
 *
 * Home and Hub must consume EVERY kind. A dead arm (producer without consumer)
 * is how pending invites rendered as to-dos but opened the wrong surface.
 */

import type { BusinessTodo, BusinessTodoAction } from "./businessTodos";

export const BUSINESS_TODO_ACTION_KINDS = [
  "open_brand_switcher",
  "open_universal_creator",
  "route",
  "open_pending_invite",
] as const satisfies ReadonlyArray<BusinessTodoAction["kind"]>;

export type BusinessTodoActionKind = (typeof BUSINESS_TODO_ACTION_KINDS)[number];

export interface BusinessTodoDispatchHandlers {
  openBrandSwitcher: () => void;
  openUniversalCreator: () => void;
  route: (route: string) => void;
  openPendingInvite: (invitationId: string, brandName: string) => void;
}

/**
 * Dispatch one to-do action. Exhaustive on BusinessTodoAction — adding a kind
 * without a handler is a TypeScript error here and a CI fail in the
 * consumer-coverage suite.
 */
export function dispatchBusinessTodoAction(
  todo: BusinessTodo,
  handlers: BusinessTodoDispatchHandlers,
): void {
  const action = todo.action;
  switch (action.kind) {
    case "open_brand_switcher":
      handlers.openBrandSwitcher();
      return;
    case "open_universal_creator":
      handlers.openUniversalCreator();
      return;
    case "route":
      handlers.route(action.route);
      return;
    case "open_pending_invite":
      handlers.openPendingInvite(action.invitationId, action.brandName);
      return;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** Path for the in-app Accept/Decline surface (tokenless invitationId). */
export function pendingBrandInviteRoute(
  invitationId: string,
  brandName: string,
): string {
  const params = new URLSearchParams({
    invitationId,
    brandName,
  });
  return `/pending-brand-invite?${params.toString()}`;
}
