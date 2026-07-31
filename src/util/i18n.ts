import i18next from 'i18next';
import HttpBackend from 'i18next-http-backend';
import {initReactI18next} from 'react-i18next';
import {browserI18nBaseUrl, browserI18nOptions} from './i18n-options';

export const i18n = i18next.createInstance();

// Shared story/core modules are also compiled into Electron's main process.
// Initialize the HTTP backend only when this module is running in a browser
// renderer; the main process has its own bundled locale instance.
if (typeof window !== 'undefined') {
	const baseUrl = browserI18nBaseUrl(
		process.env.BASE_URL ?? './',
		window.location.href
	);

	i18n
		.use(HttpBackend)
		.use(initReactI18next)
		.init(browserI18nOptions(baseUrl, process.env.NODE_ENV === 'development'));
}
