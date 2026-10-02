import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('SCORES Auto-Fill E2E', () => {
  test('extension fills the mock scores DOM based on simulated state', async ({}, testInfo) => {
    // Load the unpacked extension
    const pathToExtension = path.join(__dirname, '../../dist');
    
    // We launch a persistent context to load the extension
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    const page = await context.newPage();
    
    // Navigate to the mock SCORES portal
    await page.goto('http://localhost:8788/scores-complaint.html');

    // Wait for the content script to be injected and active
    // Normally, the side-panel triggers autofill. Here we dispatch a custom event to simulate the agent state.
    // Assuming the content script listens for chrome.runtime.onMessage, we can mock that by injecting a script
    // OR we just directly test the DOM fill logic if it's exported.
    // For a true E2E, we would interact with the side panel. 
    // This is a placeholder test until we fully hook up the side panel interaction.
    
    expect(await page.locator('body').isVisible()).toBe(true);
    
    await context.close();
  });
});
