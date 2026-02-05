/**
 * Platform Settings Utility
 * Centralized management of platform-wide settings
 */

/**
 * Get the current platform commission rate
 * Defaults to 10% if not set by admin
 */
export function getPlatformCommission(): number {
  const saved = localStorage.getItem('platformCommission');
  return saved ? parseFloat(saved) : 10;
}

/**
 * Set the platform commission rate (admin only)
 */
export function setPlatformCommission(rate: number): void {
  localStorage.setItem('platformCommission', rate.toString());
  window.dispatchEvent(new Event('storage'));
}

/**
 * Calculate revenue split for a purchase
 */
export function calculateRevenueSplit(amount: number, curatorCommissionRate: number): {
  totalAmount: number;
  platformFee: number;
  curatorCommission: number;
  businessRevenue: number;
} {
  const platformCommission = getPlatformCommission();
  const platformFee = amount * (platformCommission / 100);
  const curatorCommission = amount * (curatorCommissionRate / 100);
  const businessRevenue = amount - platformFee - curatorCommission;

  return {
    totalAmount: amount,
    platformFee,
    curatorCommission,
    businessRevenue
  };
}
