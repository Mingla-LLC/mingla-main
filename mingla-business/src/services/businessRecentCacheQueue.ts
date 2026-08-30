let chain: Promise<void> = Promise.resolve();

export function enqueueBusinessRecentCacheMutation(
  mutation: () => Promise<void>,
): Promise<void> {
  chain = chain.catch(() => undefined).then(mutation);
  return chain;
}
