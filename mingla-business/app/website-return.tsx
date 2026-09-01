import { Redirect, useLocalSearchParams } from "expo-router";
import { brandWebsiteReturnPath } from "../src/sites/studioReturn";

// orch-strict-grep-allow safearea-on-fullscreen-routes — Redirect-only route renders no visible surface before leaving.
/** Fixed native Studio return target; arbitrary paths are never accepted. */
export default function WebsiteReturnRoute() {
  const params = useLocalSearchParams<{
    brandId?: string | string[];
    result?: string | string[];
  }>();
  const brandId = Array.isArray(params.brandId)
    ? params.brandId[0]
    : params.brandId;
  const result = Array.isArray(params.result) ? params.result[0] : params.result;
  const target = brandWebsiteReturnPath(brandId, result);
  return <Redirect href={(target ?? "/(tabs)") as never} />;
}
