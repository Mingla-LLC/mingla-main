// Issue #4422 TEST SUPPORT — drive a function that calls std@0.190 `serve()`
// at module load, without an import map and without opening a socket.
//
// The CI "deno2-discovered" lane runs `deno test` with no import map, so the
// `_serveShim.ts` alias cannot be used there. Instead, while the module under
// test is imported, `Deno.listen` returns an in-memory listener and
// `Deno.serveHttp` an in-memory HTTP connection; std's real Server then hands
// every queued Request to the function's real handler. Nothing binds a port.
//
// Test-only; never imported by an edge function.

interface QueuedRequest {
  request: Request;
  respondWith(response: Response | Promise<Response>): Promise<void>;
}

const pending: QueuedRequest[] = [];
let wake: (() => void) | null = null;

function nextQueued(): Promise<QueuedRequest> {
  const ready = pending.shift();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    wake = () => {
      wake = null;
      resolve(pending.shift() as QueuedRequest);
    };
  });
}

const addr = { transport: "tcp", hostname: "127.0.0.1", port: 0 } as const;

/** Import `specifier` with std's serve() wired to an in-memory connection. */
export async function importWithStdServe(specifier: string): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const deno = Deno as any;
  const previousListen = deno.listen;
  const previousServeHttp = deno.serveHttp;
  let accepted = false;
  deno.listen = () => ({
    addr,
    rid: -1,
    accept: () => {
      if (accepted) return new Promise<never>(() => {});
      accepted = true;
      return Promise.resolve({
        localAddr: addr,
        remoteAddr: addr,
        rid: -1,
        close() {},
      });
    },
    close() {},
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<never>(() => {}) };
    },
  });
  deno.serveHttp = () => ({
    rid: -1,
    nextRequest: () => nextQueued(),
    close() {},
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: false, value: await nextQueued() }) };
    },
  });
  try {
    await import(specifier);
    // Let std's accept loop reach serveHttp before the stubs are restored.
    for (let i = 0; i < 20 && !accepted; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    deno.listen = previousListen;
    deno.serveHttp = previousServeHttp;
  }
}

/** Send one Request to the imported handler and wait for its Response. */
export function invokeStdServe(request: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    pending.push({
      request,
      respondWith: async (response) => {
        try {
          resolve(await response);
        } catch (error) {
          reject(error);
        }
      },
    });
    wake?.();
  });
}
