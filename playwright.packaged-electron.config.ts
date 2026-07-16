import type {PlaywrightTestConfig} from '@playwright/test';

const config: PlaywrightTestConfig = {
	expect: {timeout: 30_000},
	forbidOnly: true,
	fullyParallel: false,
	outputDir: 'output/playwright/packaged-electron',
	projects: [{name: `packaged-electron-${process.platform}`}],
	reporter: process.env.CI ? 'github' : 'line',
	retries: process.env.CI ? 1 : 0,
	testDir: './e2e',
	testMatch: 'packaged-electron.spec.ts',
	timeout: 3 * 60 * 1000,
	workers: 1
};

export default config;
