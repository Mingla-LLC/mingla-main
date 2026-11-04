// #3682 wave 3 — the words for a send-now where some recipients failed at the
// provider. Pure (no client imports) so screens and services share it.

/** Truthful line for a send where some recipients failed at the provider. */
export function partialSendLine(delivered: number, failed: number): string {
  const people = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;
  return `Sent to ${people(delivered)}. ${people(failed)} couldn't be reached by the provider.`;
}
