import i18next from 'i18next';
import HttpBackend from 'i18next-http-backend';
import {initReactI18next} from 'react-i18next';
import {browserI18nOptions} from './i18n-options';

export const i18n = i18next.createInstance();
const baseUrl = process.env.BASE_URL ?? './';

i18n
	.use(HttpBackend)
	.use(initReactI18next)
	.init(browserI18nOptions(baseUrl, process.env.NODE_ENV === 'development'));
