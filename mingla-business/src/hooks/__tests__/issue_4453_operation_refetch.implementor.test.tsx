/**
 * #4453 — a publish that was just accepted asked Core for operation "null"
 * three times (the receipt's `refetch` runs even while its query is disabled).
 * With no operation to track, nothing is asked.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockGetOperation = jest.fn(async (_siteId: string, _operationId: string) => ({ status: "succeeded" }));
jest.mock("../../services/brandSitesService", () => ({
  ...jest.requireActual("../../services/brandSitesService"),
  getBrandSiteOperation: (siteId: string, operationId: string) => mockGetOperation(siteId, operationId),
}));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true, user: { id: "u1" } }) }));

import { useBrandSiteOperation } from "../useBrandSite";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (el: React.ReactElement) => { update: (el: React.ReactElement) => void; unmount: () => void };
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let receipt: ReturnType<typeof useBrandSiteOperation> | null = null;
const Probe = ({ operationId }: { operationId: string | null }): null => {
  receipt = useBrandSiteOperation("site-1", operationId, Date.now());
  return null;
};

it("asks nothing while there is no operation, and asks for the real one once there is", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrap = (operationId: string | null) => (
    <QueryClientProvider client={client}><Probe operationId={operationId} /></QueryClientProvider>
  );
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => { tree = TestRenderer.create(wrap(null)); });
  const staleRefetch = receipt!.refetch;
  await TestRenderer.act(async () => { await staleRefetch(); });
  expect(mockGetOperation).not.toHaveBeenCalled();

  // The publish is accepted: the operation is set, then the refetch of the render BEFORE it runs.
  await TestRenderer.act(async () => { tree.update(wrap("op-1")); await staleRefetch(); });
  await TestRenderer.act(async () => { await receipt!.refetch(); });
  expect(mockGetOperation).toHaveBeenCalled();
  for (const call of mockGetOperation.mock.calls) expect(call).toEqual(["site-1", "op-1"]);
  await TestRenderer.act(async () => { tree.unmount(); });
  client.clear();
});
