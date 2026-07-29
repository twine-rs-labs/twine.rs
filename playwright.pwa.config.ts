import type {PlaywrightTestConfig} from '@playwright/test';
import {devices} from '@playwright/test';

const buildCommand = process.env.TWINE_PWA_USE_EXISTING_BUILD
	? ''
	: 'npm run build:web && ';

const config: PlaywrightTestConfig = {
	expect: {timeout: 10_000},
	forbidOnly: !!process.env.CI,
	fullyParallel: false,
	outputDir: 'output/playwright/pwa',
	projects: [
		{
			name: 'chromium',
			use: {...devices['Desktop Chrome']}
		}
	],
	reporter: 'line',
	retries: process.env.CI ? 2 : 0,
	testDir: './e2e',
	testMatch: 'pwa-offline.spec.ts',
	timeout: 60_000,
	webServer: {
		command: `${buildCommand}npx vite preview --host 127.0.0.1 --port 4173 --strictPort`,
		reuseExistingServer: false,
		timeout: 120_000,
		url: 'http://127.0.0.1:4173'
	},
	workers: 1
};

export default config;
