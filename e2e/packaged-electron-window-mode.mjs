export const packagedElectronWindowModeEnvironment = 'TWINE_E2E_WINDOW_MODE';
export const visibleWindowTag = '@visible-window';

export function resolvePackagedElectronWindowMode(environment) {
	const mode = environment[packagedElectronWindowModeEnvironment];

	if (mode === 'hidden' || mode === 'visible') {
		return mode;
	}

	throw new Error(
		`${packagedElectronWindowModeEnvironment} must be either "hidden" or "visible".`
	);
}

export function windowModeForTest(mode, tags) {
	return tags.includes(visibleWindowTag) ? 'visible' : mode;
}

export function environmentForPackagedElectronWindowMode(mode, environment) {
	const result = {...environment};

	if (mode === 'hidden') {
		result.TWINE_E2E_BACKGROUND_WINDOW = '1';
	} else {
		delete result.TWINE_E2E_BACKGROUND_WINDOW;
	}

	return result;
}
