import type {PlaywrightTestConfig} from '@playwright/test';

export function packagedElectronConfig(
	windowMode: 'hidden' | 'visible'
): PlaywrightTestConfig {
	process.env.TWINE_E2E_WINDOW_MODE = windowMode;

	return {
		expect: {timeout: 30_000},
		forbidOnly: true,
		fullyParallel: false,
		outputDir: `output/playwright/packaged-electron${
			windowMode === 'hidden' ? '-hidden' : ''
		}`,
		projects: [{name: `packaged-electron-${windowMode}-${process.platform}`}],
		reporter: process.env.CI ? 'github' : 'line',
		retries: process.env.CI ? 1 : 0,
		testDir: './e2e',
		testMatch: [
			'packaged-electron.spec.ts',
			'packaged-electron-preview.spec.ts'
		],
		timeout: 3 * 60 * 1000,
		workers: 1
	};
}

export default packagedElectronConfig('visible');
