// Issue #4276: lets the conductor's end-to-end test import functions that call serve()
// at the top of their module. It records the handler instead of opening a port.
type Handler = (req: Request) => Response | Promise<Response>;
const key = "__issue4276ServeHandler";

export function serve(handler: Handler): Promise<void> {
  (globalThis as unknown as Record<string, Handler>)[key] = handler;
  return Promise.resolve();
}
