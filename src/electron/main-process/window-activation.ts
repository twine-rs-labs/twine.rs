import {performanceHarnessEnabled} from './performance-harness';

interface WindowActivationTarget {
	show(): void;
}

export function backgroundWindowForE2E() {
	return (
		process.env.TWINE_E2E_BACKGROUND_WINDOW === '1' &&
		performanceHarnessEnabled()
	);
}

export function showWindowWhenReady(window: WindowActivationTarget) {
	if (!backgroundWindowForE2E()) {
		window.show();
	}
}

export function shouldFocusOwnerWindow() {
	return !backgroundWindowForE2E();
}
