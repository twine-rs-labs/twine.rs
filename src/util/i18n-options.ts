import {localeFilename} from './locales';

export function browserI18nOptions(baseUrl: string, debug: boolean) {
	return {
		debug,
		backend: {
			loadPath: ([locale]: string[]) =>
				`${baseUrl}locales/${localeFilename(locale ?? 'en-us')}`
		},
		fallbackLng: 'en-us',
		interpolation: {
			escapeValue: false
		},
		load: 'currentOnly' as const,
		maxRetries: 1
	};
}
