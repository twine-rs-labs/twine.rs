import {readdirSync, readFileSync} from 'fs';
import i18next, {ResourceKey} from 'i18next';
import {join} from 'path';

jest.unmock('i18next');

const localeDirectory = join(__dirname, '../../../public/locales');
const countSamples = [0, 1, 2, 5, 21, 1.2];
const expectedTitleCounts: Record<string, string[]> = {
	'en-US': [
		'No Stories',
		'1 Story',
		'2 Stories',
		'5 Stories',
		'21 Stories',
		'1.2 Stories'
	],
	cs: [
		'Žádné příběhy',
		'1 příběh',
		'2 příběhů',
		'5 příběhů',
		'21 příběhů',
		'1.2 příběhů'
	],
	pl: [
		'Brak opowieści',
		'1 opowieść',
		'2 opowieści',
		'5 opowieści',
		'21 opowieści',
		'1.2 opowieści'
	],
	ru: [
		'Нет историй',
		'1 история',
		'Количество историй: 2',
		'Количество историй: 5',
		'1 история',
		'Количество историй: 1.2'
	],
	uk: [
		'Немає оповідань',
		'1 оповідання',
		'2 оповідання',
		'5 оповідань',
		'1 оповідання',
		'1.2 оповідань'
	],
	fr: [
		'Aucune histoire',
		'1 histoire',
		'2 histoires',
		'5 histoires',
		'21 histoires',
		'1 histoire'
	],
	ja: [
		'ストーリーなし',
		'ストーリー1件',
		'ストーリー2件',
		'ストーリー5件',
		'ストーリー21件',
		'ストーリー1.2件'
	],
	'pt-PT': [
		'Não há Histórias',
		'1 História',
		'2 Histórias',
		'5 Histórias',
		'21 Histórias',
		'1.2 Histórias'
	]
};

function readCatalog(locale: string) {
	return JSON.parse(
		readFileSync(join(localeDirectory, `${locale}.json`), 'utf8')
	) as ResourceKey;
}

function legacyKeys(value: unknown, path: string[] = []): string[] {
	if (!value || typeof value !== 'object') {
		return [];
	}

	return Object.entries(value).flatMap(([key, child]) => {
		const childPath = [...path, key];

		return /_(?:plural|0|1|2)$/.test(key)
			? [childPath.join('.')]
			: legacyKeys(child, childPath);
	});
}

describe('i18n catalogs', () => {
	it('contains valid JSON v4 catalogs with no legacy plural suffixes', () => {
		const filenames = readdirSync(localeDirectory).filter(filename =>
			filename.endsWith('.json')
		);

		expect(filenames).toHaveLength(23);
		for (const filename of filenames) {
			const catalog = JSON.parse(
				readFileSync(join(localeDirectory, filename), 'utf8')
			) as ResourceKey;

			expect({filename, legacyKeys: legacyKeys(catalog)}).toEqual({
				filename,
				legacyKeys: []
			});
		}
	});

	it.each(Object.entries(expectedTitleCounts))(
		'resolves CLDR count categories for %s',
		async (locale, expected) => {
			const instance = i18next.createInstance();

			await instance.init({
				fallbackLng: false,
				lng: locale,
				load: 'currentOnly',
				resources: {[locale]: {translation: readCatalog(locale)}}
			});

			expect(
				countSamples.map(count =>
					instance.t('routes.storyList.titleCount', {count})
				)
			).toEqual(expected);
		}
	);

	it('preserves the active zh-CN passage count spelling', async () => {
		const instance = i18next.createInstance();

		await instance.init({
			fallbackLng: false,
			lng: 'zh-CN',
			load: 'currentOnly',
			resources: {'zh-CN': {translation: readCatalog('zh-CN')}}
		});

		expect(
			[1, 2].map(count =>
				instance.t('components.storyCard.passageCount', {count})
			)
		).toEqual(['1个片段', '2个片段']);
	});
});
