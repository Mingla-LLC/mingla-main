export const formatQuoteMoney = (minor: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`.trim();
  }
};
