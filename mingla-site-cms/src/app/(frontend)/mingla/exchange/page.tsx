import ExchangeClient from "./ExchangeClient";
import { cmsConfig } from "../../../../lib/config";

// #2829 W9f — rendered per request so the configured Business origin (local
// Business web in local mode) is read on the server, never baked at build.
export const dynamic = "force-dynamic";

export default function ExchangePage() {
  return <ExchangeClient businessOrigin={cmsConfig().businessOrigin} />;
}
