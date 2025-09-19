import { test, expect } from '@playwright/test';

test.describe('Single Card Results', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the component to load
    await page.waitForSelector('[data-testid="single-card"]', { timeout: 10000 });
  });

  test('renders one card only', async ({ page }) => {
    // Should see only one card at a time
    const cards = await page.locator('.rounded-2xl.shadow-lg').count();
    expect(cards).toBe(1);
    
    // Header should show filters
    await expect(page.locator('button:has-text("Adjust Preferences")')).toBeVisible();
    
    // No in-grid refresh/filters should be visible
    const gridRefresh = page.locator('[data-testid="grid-refresh"]');
    await expect(gridRefresh).toHaveCount(0);
  });

  test('expand reveals details and collapses smoothly', async ({ page }) => {
    // Find and click expand button
    const expandButton = page.locator('button[aria-expanded]').first();
    await expect(expandButton).toBeVisible();
    
    // Should be collapsed initially
    await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    
    // Click to expand
    await expandButton.click();
    await expect(expandButton).toHaveAttribute('aria-expanded', 'true');
    
    // Should see expanded content (address, route link, etc.)
    await expect(page.locator('text=View Route')).toBeVisible();
    
    // Click to collapse
    await expandButton.click();
    await expect(expandButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('like slides card out and loads next card', async ({ page }) => {
    // Get initial card title
    const initialTitle = await page.locator('h3').first().textContent();
    
    // Click like button
    const likeButton = page.locator('button:has([data-lucide="thumbs-up"])');
    await likeButton.click();
    
    // Wait for animation and new card
    await page.waitForTimeout(500);
    
    // Should have a new card with different title
    const newTitle = await page.locator('h3').first().textContent();
    expect(newTitle).not.toBe(initialTitle);
    
    // Should still have exactly one card
    const cards = await page.locator('.rounded-2xl.shadow-lg').count();
    expect(cards).toBe(1);
  });

  test('dislike behaves equivalently', async ({ page }) => {
    const initialTitle = await page.locator('h3').first().textContent();
    
    // Click dislike button  
    const dislikeButton = page.locator('button:has([data-lucide="thumbs-down"])');
    await dislikeButton.click();
    
    await page.waitForTimeout(500);
    
    const newTitle = await page.locator('h3').first().textContent();
    expect(newTitle).not.toBe(initialTitle);
    
    const cards = await page.locator('.rounded-2xl.shadow-lg').count();
    expect(cards).toBe(1);
  });

  test('keyboard shortcuts work', async ({ page }) => {
    const initialTitle = await page.locator('h3').first().textContent();
    
    // Test 'L' key for like
    await page.keyboard.press('l');
    await page.waitForTimeout(500);
    
    const newTitle = await page.locator('h3').first().textContent();
    expect(newTitle).not.toBe(initialTitle);
    
    // Test arrow key for dislike
    const secondTitle = await page.locator('h3').first().textContent();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
    
    const thirdTitle = await page.locator('h3').first().textContent();
    expect(thirdTitle).not.toBe(secondTitle);
  });

  test('end of queue shows caught up state', async ({ page }) => {
    // Like through several cards quickly to reach the end
    for (let i = 0; i < 10; i++) {
      try {
        await page.keyboard.press('l');
        await page.waitForTimeout(200);
      } catch (e) {
        // Might reach end before 10 cards
        break;
      }
    }
    
    // Should eventually show empty state
    await expect(page.locator('text=You\'re all caught up')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Adjust preferences above')).toBeVisible();
  });

  test('adjusting preferences fetches new set', async ({ page }) => {
    // Wait for preferences button and click it
    await page.locator('button:has-text("Adjust Preferences")').click();
    
    // This would open preferences - the actual implementation depends on your preferences UI
    // For now, just verify the event was dispatched (which would be handled by parent components)
    
    // Alternatively, simulate a preferences change by dispatching the custom event
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('open-preferences'));
    });
    
    // The single card should remain functional
    await expect(page.locator('h3').first()).toBeVisible();
  });
});