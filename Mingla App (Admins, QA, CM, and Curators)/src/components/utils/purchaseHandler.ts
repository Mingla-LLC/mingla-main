/**
 * Purchase Handler Utility
 * Handles purchase creation with business association and commission tracking
 */

import { getPlatformCommission } from './platformSettings';

export interface PurchaseData {
  id: string;
  experienceId: string;
  experienceName: string;
  buyerName: string;
  buyerEmail: string;
  buyerId: string;
  amount: number;
  packageTitle: string;
  purchaseDate: string;
  qrCode: string;
  redeemed: boolean;
  redeemedAt?: string;
  businessId?: string;
  businessName?: string;
  curatorId?: string;
  curatorName?: string;
  curatorCommission?: number;
}

/**
 * Generate a unique QR code for purchase validation
 */
export function generateQRCode(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `MGP-${timestamp}-${random}`.toUpperCase();
}

/**
 * Create a purchase record with business and commission tracking
 */
export function createPurchase(
  experienceData: any,
  purchaseOption: any,
  currentUser: any
): PurchaseData {
  const qrCode = generateQRCode();
  
  // Calculate commissions based on structure:
  // - Mingla takes platform commission percentage (configurable by admin)
  // - Curator takes their agreed percentage (from business.curatorCommission)
  // - Business gets the remainder
  const amount = purchaseOption.price || 0;
  const curatorCommissionRate = experienceData.curatorCommissionRate || 0;
  const curatorCommission = experienceData.businessId && experienceData.curatorId 
    ? amount * (curatorCommissionRate / 100)
    : 0;

  const purchase: PurchaseData = {
    id: `purchase-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    experienceId: experienceData.id,
    experienceName: experienceData.title,
    buyerName: currentUser.name || 'Guest User',
    buyerEmail: currentUser.email || 'guest@example.com',
    buyerId: currentUser.id,
    amount,
    packageTitle: purchaseOption.title,
    purchaseDate: new Date().toISOString(),
    qrCode,
    redeemed: false,
    // Business association
    businessId: experienceData.businessId,
    businessName: experienceData.businessName,
    curatorId: experienceData.curatorId,
    curatorName: experienceData.curatorName,
    curatorCommission
  };

  return purchase;
}

/**
 * Save purchase to localStorage
 */
export function savePurchase(purchase: PurchaseData): void {
  const purchases = JSON.parse(localStorage.getItem('purchases') || '[]');
  purchases.push(purchase);
  localStorage.setItem('purchases', JSON.stringify(purchases));
  
  // Trigger storage event to update other components
  window.dispatchEvent(new Event('storage'));
}

/**
 * Get all purchases
 */
export function getAllPurchases(): PurchaseData[] {
  return JSON.parse(localStorage.getItem('purchases') || '[]');
}

/**
 * Get purchases for a specific business
 */
export function getBusinessPurchases(businessId: string): PurchaseData[] {
  const allPurchases = getAllPurchases();
  return allPurchases.filter(p => p.businessId === businessId);
}

/**
 * Get purchases for a specific curator (to calculate commissions)
 */
export function getCuratorPurchases(curatorId: string): PurchaseData[] {
  const allPurchases = getAllPurchases();
  return allPurchases.filter(p => p.curatorId === curatorId);
}

/**
 * Get purchase by QR code
 */
export function getPurchaseByQR(qrCode: string): PurchaseData | null {
  const allPurchases = getAllPurchases();
  return allPurchases.find(p => p.qrCode === qrCode) || null;
}

/**
 * Mark purchase as redeemed
 */
export function redeemPurchase(purchaseId: string): boolean {
  const purchases = getAllPurchases();
  const index = purchases.findIndex(p => p.id === purchaseId);
  
  if (index === -1) return false;
  
  purchases[index].redeemed = true;
  purchases[index].redeemedAt = new Date().toISOString();
  
  localStorage.setItem('purchases', JSON.stringify(purchases));
  window.dispatchEvent(new Event('storage'));
  
  return true;
}

/**
 * Calculate total revenue for a business
 */
export function calculateBusinessRevenue(businessId: string): {
  totalRevenue: number;
  minglaFee: number;
  curatorCommissions: number;
  netRevenue: number;
  purchaseCount: number;
} {
  const purchases = getBusinessPurchases(businessId);
  
  const totalRevenue = purchases.reduce((sum, p) => sum + p.amount, 0);
  const platformCommissionRate = getPlatformCommission();
  const minglaFee = totalRevenue * (platformCommissionRate / 100);
  const curatorCommissions = purchases.reduce((sum, p) => sum + (p.curatorCommission || 0), 0);
  const netRevenue = totalRevenue - minglaFee - curatorCommissions;
  
  return {
    totalRevenue,
    minglaFee,
    curatorCommissions,
    netRevenue,
    purchaseCount: purchases.length
  };
}

/**
 * Calculate total commissions for a curator
 */
export function calculateCuratorCommissions(curatorId: string): {
  totalCommissions: number;
  totalSales: number;
  purchaseCount: number;
} {
  const purchases = getCuratorPurchases(curatorId);
  
  const totalCommissions = purchases.reduce((sum, p) => sum + (p.curatorCommission || 0), 0);
  const totalSales = purchases.reduce((sum, p) => sum + p.amount, 0);
  
  return {
    totalCommissions,
    totalSales,
    purchaseCount: purchases.length
  };
}
