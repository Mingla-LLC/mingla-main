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
  if (isLoading || isFetching || !isFetched) return "query_loading";
  return itemCount === 0 ? "empty" : "ready";
};
