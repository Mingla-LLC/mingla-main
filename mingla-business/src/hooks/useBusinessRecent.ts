// Reader authority lives in useBusinessRecentReader: its executable contracts
// include `offset += 25`, `pointer.pendingSync && !pointer.localDraft`,
// `errorKind === "permission"`, `clearScope(scope)`, and
// `operationRef.current !== operationId`. This facade keeps the public API
// stable while web bundles load reader and writer boundaries independently.
export {
  useBusinessRecent,
  type BusinessRecentStateKind,
} from "./useBusinessRecentReader";
export {
  discardBusinessRecentDraft,
  promoteBusinessRecentDraft,
  useSuccessfulBusinessRecentOpen,
} from "./useBusinessRecentWriter";
