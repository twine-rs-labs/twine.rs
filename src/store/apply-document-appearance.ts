export interface DocumentAppearance {
	highContrast: boolean;
	reducedMotion: boolean;
	theme: 'dark' | 'light';
}

/**
 * Applies the application appearance contract without requiring React or a
 * preferences store.
 */
export function applyDocumentAppearance(
	appearance: DocumentAppearance,
	targetDocument: Document = document
) {
	if (targetDocument.body) {
		targetDocument.body.dataset.appTheme = appearance.theme;
		targetDocument.body.dataset.highContrast = appearance.highContrast
			? 'true'
			: 'false';
		targetDocument.body.dataset.reducedMotion = appearance.reducedMotion
			? 'true'
			: 'false';
	}

	targetDocument.documentElement.style.setProperty(
		'color-scheme',
		appearance.theme
	);
}
