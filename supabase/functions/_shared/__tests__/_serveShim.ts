// ORCH-1205 TEST SUPPORT — serve() capture shim.
//
// `process-booking-deadlines/index.ts` calls `serve(handler)` at module load
// with NO `import.meta.main` guard, so it cannot be imported directly in a test
// without binding a real HTTP listener. The adversarial runtime test aliases the
// Deno std `http/server.ts` import to THIS module (via an import map) so that
// `serve()` simply records the handler instead of starting a server — letting
// the test invoke that handler with a real OPTIONS Request and inspect the
// ACTUAL Response headers at runtime.
//
// This file is test-only support; it is NOT product code and is never imported
// by any edge function at deploy time.

// deno-lint-ignore no-explicit-any
let capturedHandler: ((req: Request) => Response | Promise<Response>) | null =
  null;

export function serve(
  handler: (req: Request) => Response | Promise<Response>,
  _opts?: unknown,
): void {
  capturedHandler = handler;
}

export function getCapturedHandler():
  | ((req: Request) => Response | Promise<Response>)
  | null {
  return capturedHandler;
}

export function resetCapturedHandler(): void {
  capturedHandler = null;
}
