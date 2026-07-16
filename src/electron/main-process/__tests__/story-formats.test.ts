import {fakePendingStoryFormat} from '../../../test-util';
import {dialog} from 'electron';
import {copy, pathExists, readFile, stat} from 'fs-extra';
import {loadJsonFile} from '../json-file';
import {addLocalStoryFormat, loadStoryFormats} from '../story-formats';

jest.mock('electron');
jest.mock('fs-extra', () => ({
	copy: jest.fn(),
	mkdirp: jest.fn(),
	pathExists: jest.fn(),
	readFile: jest.fn(),
	stat: jest.fn(),
	writeFile: jest.fn()
}));
jest.mock('../json-file');

describe('loadStoryFormats()', () => {
	const loadJsonFileMock = loadJsonFile as jest.Mock;

	it('resolves to the result of loading story-formats.json', async () => {
		const formats = [fakePendingStoryFormat(), fakePendingStoryFormat()];

		loadJsonFileMock.mockImplementation((name: string) => {
			if (name === 'story-formats.json') {
				return Promise.resolve(formats);
			}

			throw new Error(`Loaded incorrect file "${name}"`);
		});
		expect(await loadStoryFormats()).toBe(formats);
	});
});

describe('addLocalStoryFormat()', () => {
	const copyMock = copy as jest.Mock;
	const pathExistsMock = pathExists as jest.Mock;
	const readFileMock = readFile as jest.Mock;
	const showOpenDialogMock = dialog.showOpenDialog as jest.Mock;
	const statMock = stat as jest.Mock;

	function storyFormatSource(image: string) {
		return `window.storyFormat(${JSON.stringify({
			image,
			name: 'Mock Format',
			version: '1.2.3'
		})});`;
	}

	beforeEach(() => {
		showOpenDialogMock.mockResolvedValue({
			canceled: false,
			filePaths: ['/source/format.js']
		});
		statMock.mockResolvedValue({isDirectory: () => false});
		pathExistsMock.mockResolvedValue(true);
	});

	it('copies a relative image next to the managed format', async () => {
		readFileMock.mockResolvedValue(storyFormatSource('images/icon.svg'));

		await addLocalStoryFormat();
		expect(copyMock).toHaveBeenCalledWith(
			'/source/images/icon.svg',
			'mock-electron-app-path-userData/story-formats/Mock-Format-1.2.3/images/icon.svg',
			{overwrite: true}
		);
	});

	it('does not copy an image whose URL has a scheme', async () => {
		readFileMock.mockResolvedValue(
			storyFormatSource('data:image/svg+xml,%3Csvg%3E')
		);

		await addLocalStoryFormat();
		expect(copyMock).not.toHaveBeenCalled();
		expect(pathExistsMock).not.toHaveBeenCalled();
	});
});
