import type {
  BusinessRecentEntityType,
  BusinessRecentPointer,
} from "../store/businessRecentStore";

export type BusinessRecentPresentationMutation =
  | { kind: "upsert"; scope: string; pointer: BusinessRecentPointer }
  | {
      kind: "remove";
      scope: string;
      entityType: BusinessRecentEntityType;
      entityId: string;
    }
  | {
      kind: "promote";
      scope: string;
      entityType: BusinessRecentEntityType;
      localId: string;
      serverId: string;
      operationId: string;
    }
  | { kind: "clear"; scope: string };

type Listener = (mutation: BusinessRecentPresentationMutation) => void;
const listeners = new Set<Listener>();

export function subscribeBusinessRecentPresentation(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitBusinessRecentPresentation(
  mutation: BusinessRecentPresentationMutation,
): void {
  for (const listener of listeners) listener(mutation);
}
