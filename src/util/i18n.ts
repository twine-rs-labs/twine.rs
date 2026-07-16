import i18next from 'i18next';
import HttpBackend from 'i18next-http-backend';
import {initReactI18next} from 'react-i18next';
import {localeFilename} from './locales';

export const i18n = i18next.createInstance();
const baseUrl = process.env.BASE_URL ?? './';

i18n
	.use(HttpBackend)
	.use(initReactI18next)
	.init({
		debug: process.env.NODE_ENV === 'development',
		backend: {
			loadPath: ([locale]: string[]) =>
				`${baseUrl}locales/${localeFilename(locale ?? 'en-us')}`,
			maxRetries: 1
		},
		fallbackLng: 'en-us',
		interpolation: {
			escapeValue: false
		},
		load: 'currentOnly'
	});
