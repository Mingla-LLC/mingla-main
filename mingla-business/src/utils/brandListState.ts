export type BrandListStatus =
  | "auth_loading"
  | "signed_out"
  | "query_disabled"
  | "query_loading"
  | "ready"
  | "empty"
  | "error";

export const resolveBrandListStatus = ({
  authStatus,
  hasUser,
  isError,
  isFetched,
  isFetching,
  isLoading,
  itemCount,
}: {
  authStatus: string;
  hasUser: boolean;
  isError: boolean;
  isFetched: boolean;
  isFetching: boolean;
  isLoading: boolean;
  itemCount: number;
}): BrandListStatus => {
  if (authStatus === "bootstrapping" || authStatus === "refreshing") {
    return "auth_loading";
  }
  if (authStatus === "error") return "error";
  if (authStatus === "signed_out") return "signed_out";
  if (!hasUser) return "query_disabled";
  if (isError) return "error";
  // ORCH-1136 F-4: a background refetch (`isFetching` with `isFetched === true`)
  // must NOT downgrade an already-fetched list to `query_loading` — that
  // discarded cached brands and wedged the switcher/Account on "Loading…".
  // `query_loading` is reserved for the genuine FIRST load only: React Query's
  // own first-load flag (`isLoading`, true only with no data) OR a query that
  // has not yet fetched at least once (`!isFetched`). After the first successful
  // fetch, `itemCount` decides — regardless of an in-flight background refetch.
  if (isLoading || !isFetched) return "query_loading";
  return itemCount === 0 ? "empty" : "ready";
};
