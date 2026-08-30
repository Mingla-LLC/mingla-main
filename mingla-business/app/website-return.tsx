import { Redirect, useLocalSearchParams } from "expo-router";
import { brandWebsiteReturnPath } from "../src/sites/studioReturn";

/** Fixed native Studio return target; arbitrary paths are never accepted. */
export default function WebsiteReturnRoute() {
  const params = useLocalSearchParams<{ brandId?: string | string[] }>();
  const brandId = Array.isArray(params.brandId)
    ? params.brandId[0]
    : params.brandId;
  const target = brandWebsiteReturnPath(brandId);
  return <Redirect href={(target ?? "/(tabs)") as never} />;
}
