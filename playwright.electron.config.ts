import type {PlaywrightTestConfig} from '@playwright/test';

const config: PlaywrightTestConfig = {
	expect: {timeout: 30_000},
	forbidOnly: true,
	fullyParallel: false,
	outputDir: 'output/playwright/electron-performance',
	projects: [{name: 'electron-performance'}],
	reporter: 'line',
	retries: process.platform === 'darwin' ? 1 : 0,
	testDir: './e2e',
	testMatch: 'electron-performance.spec.ts',
	timeout: 20 * 60 * 1000,
	workers: 1
};

export default config;
