/**
 * Seed Purchases Data
 * Creates sample purchases for testing business management and commission tracking
 */

import { PurchaseData } from './purchaseHandler';

export function seedPurchases(): void {
  // Check if purchases already exist
  const existingPurchases = localStorage.getItem('purchases');
  if (existingPurchases && JSON.parse(existingPurchases).length > 0) {
    console.log('Purchases already seeded');
    return;
  }

  // Get businesses from localStorage
  const businesses = JSON.parse(localStorage.getItem('businesses') || '[]');
  
  // Get platform cards
  const platformCards = JSON.parse(localStorage.getItem('platformCards') || '[]');

  const purchases: PurchaseData[] = [];

  // Create sample purchases for businesses with experiences
  businesses.forEach((business: any) => {
    // Find experiences for this business
    const businessExperiences = platformCards.filter((card: any) => card.businessId === business.id);
    
    businessExperiences.forEach((experience: any, index: number) => {
      // Create 2-3 purchases per experience
      const purchaseCount = Math.floor(Math.random() * 2) + 2;
      
      for (let i = 0; i < purchaseCount; i++) {
        const daysAgo = Math.floor(Math.random() * 30);
        const purchaseDate = new Date();
        purchaseDate.setDate(purchaseDate.getDate() - daysAgo);
        
        // Randomly decide if redeemed (50% chance if purchase is older than 7 days)
        const isRedeemed = daysAgo > 7 ? Math.random() > 0.5 : false;
        
        const redeemedDate = isRedeemed ? new Date(purchaseDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000) : undefined;
        
        // Get a random package price from the experience
        const packages = experience.purchaseOptions || [];
        const randomPackage = packages[Math.floor(Math.random() * packages.length)] || { title: 'Standard Package', price: 50 };
        
        const amount = randomPackage.price;
        const curatorCommission = business.curatorId ? amount * 0.10 : 0;

        const purchase: PurchaseData = {
          id: `purchase-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${i}`,
          experienceId: experience.id,
          experienceName: experience.title,
          buyerName: getBuyerName(i),
          buyerEmail: `buyer${i}@example.com`,
          buyerId: `user-${i}`,
          amount,
          packageTitle: randomPackage.title,
          purchaseDate: purchaseDate.toISOString(),
          qrCode: `MGP-${purchaseDate.getTime()}-${Math.random().toString(36).substring(2, 10)}`.toUpperCase(),
          redeemed: isRedeemed,
          redeemedAt: redeemedDate?.toISOString(),
          businessId: business.id,
          businessName: business.name,
          curatorId: business.curatorId,
          curatorName: business.curatorName,
          curatorCommission
        };

        purchases.push(purchase);
      }
    });
  });

  // Save to localStorage
  localStorage.setItem('purchases', JSON.stringify(purchases));
  console.log(`✅ Seeded ${purchases.length} purchases for ${businesses.length} businesses`);
}

function getBuyerName(index: number): string {
  const names = [
    'Jordan Smith',
    'Alex Johnson',
    'Taylor Davis',
    'Morgan Wilson',
    'Casey Martinez',
    'Riley Anderson',
    'Avery Thomas',
    'Quinn Jackson',
    'Sage White',
    'River Harris'
  ];
  return names[index % names.length];
}

/**
 * Clear all purchases (for testing)
 */
export function clearPurchases(): void {
  localStorage.removeItem('purchases');
  console.log('✅ Cleared all purchases');
}

/**
 * Get purchase statistics
 */
export function getPurchaseStats(): {
  totalPurchases: number;
  totalRevenue: number;
  totalCommissions: number;
  redeemedCount: number;
  pendingCount: number;
} {
  const purchases: PurchaseData[] = JSON.parse(localStorage.getItem('purchases') || '[]');
  
  return {
    totalPurchases: purchases.length,
    totalRevenue: purchases.reduce((sum, p) => sum + p.amount, 0),
    totalCommissions: purchases.reduce((sum, p) => sum + (p.curatorCommission || 0), 0),
    redeemedCount: purchases.filter(p => p.redeemed).length,
    pendingCount: purchases.filter(p => !p.redeemed).length
  };
}
