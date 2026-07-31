import i18next from 'i18next';
import ca from '../../../public/locales/ca.json';
import cs from '../../../public/locales/cs.json';
import da from '../../../public/locales/da.json';
import de from '../../../public/locales/de.json';
import enUs from '../../../public/locales/en-US.json';
import es from '../../../public/locales/es.json';
import fi from '../../../public/locales/fi.json';
import fr from '../../../public/locales/fr.json';
import it from '../../../public/locales/it.json';
import ja from '../../../public/locales/ja.json';
import ko from '../../../public/locales/ko.json';
import ms from '../../../public/locales/ms.json';
import nb from '../../../public/locales/nb.json';
import nl from '../../../public/locales/nl.json';
import pl from '../../../public/locales/pl.json';
import ptBr from '../../../public/locales/pt-BR.json';
import ptPt from '../../../public/locales/pt-PT.json';
import ru from '../../../public/locales/ru.json';
import sl from '../../../public/locales/sl.json';
import sv from '../../../public/locales/sv.json';
import tr from '../../../public/locales/tr.json';
import uk from '../../../public/locales/uk.json';
import zhCn from '../../../public/locales/zh-CN.json';
import {closestAppLocale} from '../../util/locales';
import {loadPrefs} from './prefs';

export const i18n = i18next.createInstance();

const resources = {
	ca: {translation: ca},
	cs: {translation: cs},
	da: {translation: da},
	de: {translation: de},
	'en-us': {translation: enUs},
	'en-US': {translation: enUs},
	es: {translation: es},
	fi: {translation: fi},
	fr: {translation: fr},
	it: {translation: it},
	ja: {translation: ja},
	ko: {translation: ko},
	ms: {translation: ms},
	nb: {translation: nb},
	nl: {translation: nl},
	pl: {translation: pl},
	'pt-br': {translation: ptBr},
	'pt-BR': {translation: ptBr},
	'pt-pt': {translation: ptPt},
	'pt-PT': {translation: ptPt},
	ru: {translation: ru},
	sl: {translation: sl},
	sv: {translation: sv},
	tr: {translation: tr},
	uk: {translation: uk},
	'zh-cn': {translation: zhCn},
	'zh-CN': {translation: zhCn}
};

export async function initLocales() {
	console.log('Initializing i18next with bundled locales');
	await i18n.init({
		debug: true,
		fallbackLng: 'en-us',
		interpolation: {
			escapeValue: false
		},
		load: 'currentOnly',
		resources
	});

	console.log('Getting locale preference');

	try {
		const {locale} = await loadPrefs();
		const appLocale = closestAppLocale(locale);

		console.log(`Changing i18next language to ${appLocale}`);
		await i18n.changeLanguage(appLocale);
	} catch (error) {
		console.warn("Preference couldn't be loaded, using default locale");
	}
}
