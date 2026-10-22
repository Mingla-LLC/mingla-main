const isValidCount = (n: number): boolean =>
  Number.isFinite(n) && Number.isInteger(n) && n >= 0;

const compactTier = (
  n: number,
  unit: number,
  tenthsDivisor: number,
  suffix: string,
): string => {
  if (n < unit * 10) {
    const tenths = Math.floor(n / tenthsDivisor);
    const whole = Math.floor(tenths / 10);
    const decimal = tenths % 10;
    return decimal === 0 ? `${whole}${suffix}` : `${whole}.${decimal}${suffix}`;
  }
  return `${Math.floor(n / unit)}${suffix}`;
};

export function formatCompactCount(n: number): string | null {
  if (!isValidCount(n)) return null;
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return compactTier(n, 1_000, 100, "k");
  if (n < 1_000_000_000) return compactTier(n, 1_000_000, 100_000, "M");
  return compactTier(n, 1_000_000_000, 100_000_000, "B");
}

export function formatFollowerCountLine(n: number): string | null {
  const compact = formatCompactCount(n);
  if (compact === null) return null;
  if (n === 0) return "Be the first to follow";
  return `${compact} ${n === 1 ? "follower" : "followers"}`;
}

export function formatFollowerCountA11y(n: number): string | null {
  if (!isValidCount(n)) return null;
  if (n === 0) return "No followers yet";
  if (n < 1_000) return `${n} ${n === 1 ? "follower" : "followers"}`;

  const compact = formatCompactCount(n);
  if (compact === null) return null;
  const suffix = compact.slice(-1);
  const amount = compact.slice(0, -1);
  const unit = suffix === "k" ? "thousand" : suffix === "M" ? "million" : "billion";
  return `about ${amount} ${unit} followers`;
}

export function formatExactCount(n: number): string | null {
  if (!isValidCount(n)) return null;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatExactFollowers(n: number): string | null {
  const exact = formatExactCount(n);
  if (exact === null) return null;
  return `${exact} ${n === 1 ? "follower" : "followers"}`;
}
