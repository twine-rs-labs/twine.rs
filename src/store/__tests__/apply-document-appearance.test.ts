import {applyDocumentAppearance} from '../apply-document-appearance';

describe('applyDocumentAppearance()', () => {
	it('applies plain appearance values to the document contract', () => {
		applyDocumentAppearance({
			highContrast: true,
			reducedMotion: true,
			theme: 'dark'
		});

		expect(document.body.dataset.appTheme).toBe('dark');
		expect(document.body.dataset.highContrast).toBe('true');
		expect(document.body.dataset.reducedMotion).toBe('true');
		expect(
			document.documentElement.style.getPropertyValue('color-scheme')
		).toBe('dark');

		applyDocumentAppearance({
			highContrast: false,
			reducedMotion: false,
			theme: 'light'
		});

		expect(document.body.dataset.appTheme).toBe('light');
		expect(document.body.dataset.highContrast).toBe('false');
		expect(document.body.dataset.reducedMotion).toBe('false');
		expect(
			document.documentElement.style.getPropertyValue('color-scheme')
		).toBe('light');
	});
});
