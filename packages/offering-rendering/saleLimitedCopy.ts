export const saleLimitedCopy = (name: string, remaining: number): string =>
  remaining <= 0
    ? `The ${name} price has sold out.`
    : `Only ${remaining} left at the ${name} price.`;
