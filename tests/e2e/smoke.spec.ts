import { test, expect } from '@playwright/test';
test('app renders title bar with brand wordmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=KHUTBAH EDITOR')).toBeVisible();
  await expect(page.locator('img[alt="Al-Himmah"]')).toBeVisible();
});
