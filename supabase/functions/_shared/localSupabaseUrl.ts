// #4490 — true when a Supabase URL is a local stack (loopback or docker host).
// Kept in its own dependency-free module so a function that only needs this
// check (claim-link) does not import the venue link and token modules, whose
// key ring read would otherwise enter its secret contract closure.
export function isLocalSupabaseUrl(url: string): boolean {
  try {
    return ["kong", "localhost", "127.0.0.1", "host.docker.internal"].includes(
      new URL(url).hostname,
    );
  } catch {
    return false;
  }
}
