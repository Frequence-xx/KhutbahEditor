import { test, expect } from '@playwright/test';

// The renderer runs in a plain browser here (Vite dev server). `window.khutbah`
// is undefined — components handle this via optional chaining. We exercise the
// UI states reachable without the Electron preload / Python sidecar.

test.beforeEach(async ({ page }) => {
  // Persisted Zustand stores (`khutbah-ui`, `khutbah-projects`) can leak state
  // between tests/runs. Clear before navigating, then load fresh.
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
});

test('shell renders empty state with sidebar', async ({ page }) => {
  // Sidebar header present
  await expect(page.locator('aside').getByText(/khutbahEditor/i)).toBeVisible();

  // Empty state visible (no projects in localStorage on a fresh load)
  await expect(page.getByRole('button', { name: /\+ new khutbah/i }).first()).toBeVisible();
  await expect(page.getByText(/no khutbah selected/i)).toBeVisible();

  // Settings button at bottom of sidebar
  await expect(page.locator('aside').getByRole('button', { name: /settings/i })).toBeVisible();
});

test('clicking + New khutbah opens the modal with three tabs', async ({ page }) => {
  // First "+ New khutbah" is in EmptyState (sidebar's button is the second match).
  await page.getByRole('button', { name: /\+ new khutbah/i }).first().click();

  await expect(page.getByRole('tab', { name: /youtube/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /local/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /dual/i })).toBeVisible();

  // Cancel closes the modal
  await page.getByRole('button', { name: /cancel/i }).click();
  await expect(page.getByRole('tab', { name: /youtube/i })).not.toBeVisible();
});

test('clicking Settings shows the SettingsPane', async ({ page }) => {
  await page.locator('aside').getByRole('button', { name: /settings/i }).click();

  // SettingsPane has a "Compute device" label bound to the device <select>.
  await expect(page.getByLabel(/compute device/i)).toBeVisible();
});
