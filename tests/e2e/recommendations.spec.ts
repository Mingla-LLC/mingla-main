import { test, expect } from '@playwright/test';

test.describe('Recommendations System E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Happy Path: Premium dating recommendations flow', async ({ page }) => {
    // Click preferences or get started
    await page.getByRole('button', { name: /get started|preferences/i }).click();
    
    // Set budget for dating ($25-150)
    await page.getByText('Sip & Chill').click();
    await page.getByText('Dining Experience').click();
    
    // Set time to Tonight for dates
    await page.getByRole('button', { name: 'Tonight' }).click();
    
    // Apply preferences
    await page.getByRole('button', { name: 'Apply Preferences' }).click();
    
    // Wait for single card to appear
    await page.waitForSelector('.single-card-display', { timeout: 10000 });
    
    // Verify single card layout
    const cardTitle = page.locator('.single-card-display h1');
    await expect(cardTitle).toBeVisible();
    
    // Test like button advances card
    const initialTitle = await cardTitle.textContent();
    await page.locator('button').filter({ hasText: '❤️' }).click();
    
    await page.waitForTimeout(500);
    const newTitle = await cardTitle.textContent();
    expect(newTitle).not.toBe(initialTitle);
  });

  test('Expand functionality works correctly', async ({ page }) => {
    // Setup preferences
    await page.getByRole('button', { name: /get started|preferences/i }).click();
    await page.getByText('Sip & Chill').click();
    await page.getByRole('button', { name: 'Apply Preferences' }).click();
    
    // Wait for card and test expand
    await page.waitForSelector('.single-card-display', { timeout: 10000 });
    
    const detailsButton = page.getByRole('button', { name: 'Details' });
    await detailsButton.click();
    
    await expect(page.locator('text="Open in Maps"')).toBeVisible();
  });
});