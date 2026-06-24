import {
	forgetNativeProjectFolder,
	listRememberedNativeProjectFolders,
	rememberNativeProjectFolder
} from '../native';
import {
	forgetProjectFolder,
	rememberedProjectFolders,
	rememberProjectFolder
} from '../project-library-index';

jest.mock('../native', () => ({
	forgetNativeProjectFolder: jest.fn(),
	listRememberedNativeProjectFolders: jest.fn(),
	rememberNativeProjectFolder: jest.fn()
}));
jest.mock('../story-directory', () => ({
	getStoryDirectoryPath: () => 'mock-story-library'
}));

describe('project library index', () => {
	const forgetNativeProjectFolderMock = forgetNativeProjectFolder as jest.Mock;
	const listRememberedNativeProjectFoldersMock =
		listRememberedNativeProjectFolders as jest.Mock;
	const rememberNativeProjectFolderMock =
		rememberNativeProjectFolder as jest.Mock;

	beforeEach(() => {
		listRememberedNativeProjectFoldersMock.mockReturnValue([]);
	});

	it('stores in-library project paths relative to the story library', () => {
		rememberProjectFolder({
			passageTextLoaded: false,
			rootPath: 'mock-story-library/Projects/moon-castle.twine.rs',
			stories: [],
			storyIds: ['story-id']
		});

		expect(rememberNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			expect.objectContaining({
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['story-id']
			})
		);
	});

	it('returns remembered relative project paths as absolute paths', () => {
		listRememberedNativeProjectFoldersMock.mockReturnValue([
			{
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['story-id'],
				updatedAt: '2026-06-23T12:00:00.000Z'
			}
		]);

		expect(rememberedProjectFolders()).toEqual([
			{
				rootPath: expect.stringMatching(
					/mock-story-library\/Projects\/moon-castle\.twine\.rs$/
				),
				storyIds: ['story-id'],
				updatedAt: '2026-06-23T12:00:00.000Z'
			}
		]);
	});

	it('deduplicates remembered project paths after resolving them', () => {
		listRememberedNativeProjectFoldersMock.mockReturnValue([
			{
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['old-story-id'],
				updatedAt: '2026-06-23T12:00:00.000Z'
			},
			{
				rootPath: `${process.cwd()}/mock-story-library/Projects/moon-castle.twine.rs`,
				storyIds: ['new-story-id'],
				updatedAt: '2026-06-23T12:05:00.000Z'
			}
		]);

		expect(rememberedProjectFolders()).toEqual([
			expect.objectContaining({
				rootPath: expect.stringMatching(
					/mock-story-library\/Projects\/moon-castle\.twine\.rs$/
				),
				storyIds: ['new-story-id']
			})
		]);
	});

	it('migrates existing absolute in-library project paths to relative paths', () => {
		listRememberedNativeProjectFoldersMock.mockReturnValue([
			{
				rootPath: `${process.cwd()}/mock-story-library/Projects/moon-castle.twine.rs`,
				storyIds: ['story-id'],
				updatedAt: '2026-06-23T12:00:00.000Z'
			}
		]);

		rememberedProjectFolders();

		expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			`${process.cwd()}/mock-story-library/Projects/moon-castle.twine.rs`
		);
		expect(rememberNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			expect.objectContaining({
				rootPath: 'Projects/moon-castle.twine.rs',
				storyIds: ['story-id']
			})
		);
	});

	it('forgets both relative and legacy absolute forms for in-library projects', () => {
		forgetProjectFolder('mock-story-library/Projects/moon-castle.twine.rs');

		expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			'Projects/moon-castle.twine.rs'
		);
		expect(forgetNativeProjectFolderMock).toHaveBeenCalledWith(
			'mock-story-library/.twine/native-projects.json',
			'mock-story-library/Projects/moon-castle.twine.rs'
		);
	});
});
