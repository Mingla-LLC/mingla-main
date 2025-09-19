import { test, expect } from '@playwright/test';

test.describe('Recommendations System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Mock location permissions
    await page.addInitScript(() => {
      navigator.geolocation = {
        getCurrentPosition: (success) => {
          success({
            coords: { latitude: 35.7915, longitude: -78.7811 }
          });
        }
      };
    });
  });

  test('happy path - preferences to recommendations flow', async ({ page }) => {
    // Open preferences
    await page.click('button[data-testid="preferences-button"]');
    
    // Set budget
    await page.fill('input[name="budget-min"]', '25');
    await page.fill('input[name="budget-max"]', '100');
    
    // Select categories
    await page.click('button:has-text("Casual Eats")');
    await page.click('button:has-text("Sip & Chill")');
    
    // Set time to "This Weekend"
    await page.click('button:has-text("This Weekend")');
    
    // Set travel to Drive, max 15 minutes
    await page.click('button:has-text("Drive")');
    await page.click('button:has-text("By Time")');
    await page.fill('input[name="travel-time"]', '15');
    
    // Apply preferences
    await page.click('button:has-text("Apply Preferences")');
    
    // Should show recommendations toggle
    await expect(page.locator('button[data-testid="recommendations-toggle"]')).toBeVisible();
    
    // Click recommendations toggle
    await page.click('button[data-testid="recommendations-toggle"]');
    
    // Wait for recommendations to load
    await expect(page.locator('[data-testid="recommendations-grid"]')).toBeVisible();
    
    // Should show at least 3 cards
    await expect(page.locator('[data-testid="recommendation-card"]')).toHaveCount({ min: 3 });
    
    // Each card should have required elements
    const firstCard = page.locator('[data-testid="recommendation-card"]').first();
    await expect(firstCard.locator('h3')).toBeVisible(); // Title
    await expect(firstCard.locator('img')).toBeVisible(); // Image
    await expect(firstCard.locator('button:has-text("View Route")')).toBeVisible();
    
    // Click View Route button should open maps link
    const [newPage] = await Promise.all([
      page.waitForEvent('popup'),
      firstCard.locator('button:has-text("View Route")').click()
    ]);
    expect(newPage.url()).toContain('google.com/maps');
  });

  test('transit mode with time constraint', async ({ page }) => {
    await page.click('button[data-testid="preferences-button"]');
    
    // Select category
    await page.click('button:has-text("Screen & Relax")');
    
    // Set to Tonight
    await page.click('button:has-text("Tonight")');
    
    // Set travel to Public Transport, max 20 minutes
    await page.click('button:has-text("Public Transport")');
    await page.click('button:has-text("By Time")');
    await page.fill('input[name="travel-time"]', '20');
    
    await page.click('button:has-text("Apply Preferences")');
    await page.click('button[data-testid="recommendations-toggle"]');
    
    await expect(page.locator('[data-testid="recommendations-grid"]')).toBeVisible();
    
    // Check that travel times are within constraint
    const cards = page.locator('[data-testid="recommendation-card"]');
    const count = await cards.count();
    
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const travelInfo = await card.locator('[data-testid="travel-info"]').textContent();
      expect(travelInfo).toMatch(/\d+m/); // Should show minutes
      
      // Extract minutes and verify <= 20
      const minutes = parseInt(travelInfo?.match(/(\d+)m/)?.[1] || '0');
      expect(minutes).toBeLessThanOrEqual(20);
    }
    
    // Maps links should use transit mode
    const firstCard = cards.first();
    const [transitPage] = await Promise.all([
      page.waitForEvent('popup'),
      firstCard.locator('button:has-text("View Route")').click()
    ]);
    expect(transitPage.url()).toContain('travelmode=transit');
  });

  test('diversity check - multiple categories return varied results', async ({ page }) => {
    await page.click('button[data-testid="preferences-button"]');
    
    // Select 3 different categories
    await page.click('button:has-text("Take a Stroll")');
    await page.click('button:has-text("Creative & Hands-On")');
    await page.click('button:has-text("Play & Move")');
    
    await page.click('button:has-text("Apply Preferences")');
    await page.click('button[data-testid="recommendations-toggle"]');
    
    await expect(page.locator('[data-testid="recommendations-grid"]')).toBeVisible();
    
    // Should have cards from different categories
    const cards = page.locator('[data-testid="recommendation-card"]');
    await expect(cards).toHaveCount({ min: 6 }); // At least 2 per category
    
    // Check that we have variety in categories
    const categories = await cards.locator('[data-testid="category-badge"]').allTextContents();
    const uniqueCategories = new Set(categories);
    expect(uniqueCategories.size).toBeGreaterThanOrEqual(2); // At least 2 different categories
    
    // Top 10 should contain at least 1 from each selected category
    const top10Cards = cards.locator(':nth-child(-n+10)');
    const top10Categories = await top10Cards.locator('[data-testid="category-badge"]').allTextContents();
    
    expect(top10Categories.some(cat => cat.includes('Stroll'))).toBeTruthy();
    expect(top10Categories.some(cat => cat.includes('Creative'))).toBeTruthy();
    expect(top10Categories.some(cat => cat.includes('Play'))).toBeTruthy();
  });

  test('empty state and error handling', async ({ page }) => {
    // Mock API to return empty results
    await page.route('**/functions/v1/recommendations', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cards: [] })
      });
    });
    
    await page.click('button[data-testid="preferences-button"]');
    await page.click('button:has-text("Dining Experience")');
    await page.click('button:has-text("Apply Preferences")');
    await page.click('button[data-testid="recommendations-toggle"]');
    
    // Should show empty state
    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
    await expect(page.locator('h3:has-text("No matches found")')).toBeVisible();
    await expect(page.locator('button:has-text("Adjust Filters")')).toBeVisible();
    
    // Click adjust filters should open preferences
    await page.click('button:has-text("Adjust Filters")');
    await expect(page.locator('h2:has-text("Preferences")')).toBeVisible();
  });

  test('invite and save functionality', async ({ page }) => {
    await page.click('button[data-testid="preferences-button"]');
    await page.click('button:has-text("Casual Eats")');
    await page.click('button:has-text("Apply Preferences")');
    await page.click('button[data-testid="recommendations-toggle"]');
    
    await expect(page.locator('[data-testid="recommendations-grid"]')).toBeVisible();
    
    const firstCard = page.locator('[data-testid="recommendation-card"]').first();
    
    // Test invite button
    await firstCard.locator('button[data-testid="invite-button"]').click();
    await expect(page.locator('.toast:has-text("Invite sent")')).toBeVisible();
    
    // Test save button
    await firstCard.locator('button[data-testid="save-button"]').click();
    await expect(page.locator('.toast:has-text("Saved")')).toBeVisible();
    
    // Save button should change to saved state
    await expect(firstCard.locator('button[data-testid="save-button"] svg[fill="current"]')).toBeVisible();
  });
});