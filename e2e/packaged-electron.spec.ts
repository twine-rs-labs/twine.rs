import {expect, test} from '@playwright/test';
import {
	_electron as electron,
	chromium,
	ElectronApplication,
	Locator,
	Page
} from 'playwright';
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	rmdir,
	symlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

type DialogState = {
	calls: Array<{properties?: string[]; title?: string}>;
	responses: Array<{canceled: boolean; filePaths: string[]}>;
};

type PackagedProjectStory = {
	[key: string]: unknown;
	id: string;
	name: string;
	passages: Array<{
		[key: string]: unknown;
		id: string;
		text: string;
	}>;
	script: string;
	stylesheet: string;
};

interface PackagedProjectWindow extends Window {
	twineElectron?: {
		beginLegacyStoryWrite(storyId: string): string;
		finishLegacyStoryWrite(token: string, errorMessage?: string): void;
		duplicateProjectFolder(
			rootPath: string,
			replacements: Array<{
				passageIds: Array<{
					duplicatePassageId: string;
					sourcePassageId: string;
				}>;
				sourceStoryId: string;
				story: PackagedProjectStory;
			}>
		): Promise<{
			rootPath: string;
			stories: PackagedProjectStory[];
			storyIds: string[];
		}>;
		hydrateProjectFolder(
			rootPath: string,
			storyIds?: string[]
		): Promise<{stories: PackagedProjectStory[]; storyIds: string[]}>;
		saveProjectFolder(
			rootPath: string,
			story: PackagedProjectStory
		): Promise<{stories: PackagedProjectStory[]; storyIds: string[]}>;
		saveStoryHtml(
			story: {id: string; name: string},
			data: string
		): Promise<void>;
	};
}

function executableName() {
	switch (process.platform) {
		case 'darwin':
			return path.join('Twine RS.app', 'Contents', 'MacOS', 'Twine RS');
		case 'win32':
			return 'Twine RS.exe';
		default:
			return 'twine-rs';
	}
}

async function packagedExecutable() {
	if (process.env.TWINE_E2E_EXECUTABLE) {
		return path.resolve(process.env.TWINE_E2E_EXECUTABLE);
	}

	const releaseRoot = path.resolve('release');
	const entries = await readdir(releaseRoot, {withFileTypes: true});

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const candidate = path.join(releaseRoot, entry.name, executableName());

		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next unpacked output directory.
		}
	}

	throw new Error(
		`No packaged ${process.platform} executable found beneath ${releaseRoot}.`
	);
}

function isolatedEnvironment(root: string) {
	return {
		...process.env,
		...(process.platform === 'win32'
			? {}
			: {
					APPDATA: path.join(root, 'AppData', 'Roaming'),
					HOME: root,
					LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
					USERPROFILE: root,
					XDG_CACHE_HOME: path.join(root, '.cache'),
					XDG_CONFIG_HOME: path.join(root, '.config')
				}),
		TWINE_PERF: '1',
		TWINE_PERF_USER_DATA: path.join(root, 'user-data')
	};
}

async function prepareIsolatedEnvironment(root: string) {
	await Promise.all(
		[
			path.join('AppData', 'Local'),
			path.join('AppData', 'Roaming'),
			'.cache',
			'.config',
			'backups',
			'library',
			'scratch',
			path.join('user-data', 'session')
		].map(directory => mkdir(path.join(root, directory), {recursive: true}))
	);
}

async function launchPackagedApp(executablePath: string, profileRoot: string) {
	await prepareIsolatedEnvironment(profileRoot);
	const app = await electron.launch({
		args: [
			`--storyLibraryFolderPath=${path.join(profileRoot, 'library')}`,
			`--backupFolderPath=${path.join(profileRoot, 'backups')}`,
			`--scratchFolderPath=${path.join(profileRoot, 'scratch')}`,
			'--backupCadenceMinutes=10080',
			...(process.platform === 'win32'
				? ['--disableHardwareAcceleration=true']
				: [])
		],
		env: isolatedEnvironment(profileRoot),
		executablePath
	});
	const page = await app.firstWindow();

	await page.waitForLoadState('domcontentloaded');
	await expect(page.getByLabel('twine.rs')).toBeVisible();
	return {app, page};
}

function sourceEditor(page: Page) {
	return page.locator('[data-testid^="story-editor-window-"]').first();
}

function tabWithText(page: Page, text: string) {
	return page.getByRole('tab').filter({hasText: new RegExp(`^${text}$`)});
}

async function clickAfterDeferringProjectSessionReviews(
	page: Page,
	target: Locator
) {
	let lastClickError: unknown;

	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			await target.click({timeout: 5_000});
			return;
		} catch (error) {
			lastClickError = error;
			const later = page.getByRole('button', {name: 'Later', exact: true});

			if (!(await later.isVisible())) {
				throw error;
			}
			await later.click();
		}
	}

	throw lastClickError;
}

test('packaged desktop flushes a trailing legacy HTML save before exit', async () => {
	const executablePath = await packagedExecutable();
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-shutdown-save-')
	);
	let running: {app: ElectronApplication; page: Page} | undefined;

	try {
		running = await launchPackagedApp(executablePath, profileRoot);
		const story = {id: 'shutdown-save-story', name: 'Shutdown Save'};

		await running.page.evaluate(
			async ({story}) => {
				const bridge = (window as PackagedProjectWindow).twineElectron;

				if (!bridge) {
					throw new Error('Electron bridge is unavailable.');
				}
				await bridge.saveStoryHtml(story, 'first save');
			},
			{story}
		);
		await running.page.evaluate(
			({story}) => {
				const bridge = (window as PackagedProjectWindow).twineElectron;

				if (!bridge) {
					throw new Error('Electron bridge is unavailable.');
				}
				const reservation = bridge.beginLegacyStoryWrite(story.id);

				window.setTimeout(() => {
					void bridge.saveStoryHtml(story, 'trailing save').then(
						() => bridge.finishLegacyStoryWrite(reservation),
						error => bridge.finishLegacyStoryWrite(reservation, String(error))
					);
				}, 100);
			},
			{story}
		);
		const appClosed = running.app.waitForEvent('close');

		await running.app.evaluate(({BrowserWindow}) => {
			BrowserWindow.getAllWindows()[0]?.close();
		});
		await appClosed;
		running = undefined;

		await expect(
			readFile(path.join(profileRoot, 'library', 'Shutdown Save.html'), 'utf8')
		).resolves.toBe('trailing save');
	} finally {
		await running?.app.close();
	}
});

async function replaceEditorText(page: Page, text: string) {
	const editor = sourceEditor(page);

	await expect(editor).toBeVisible();
	await editor.locator('.cm-content').click();
	await page.keyboard.press(
		process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
	);
	await page.keyboard.insertText(text);
	await expect(editor).toContainText(text.replace(/\r?\n/g, ''));
	await page.keyboard.press('Tab');
}

test('packaged desktop duplicates a project from the launcher and preserves it across restart and source deletion', async () => {
	const executablePath = await packagedExecutable();
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-duplicate-')
	);
	let running: {app: ElectronApplication; page: Page} | undefined;

	try {
		running = await launchPackagedApp(executablePath, profileRoot);
		const {page} = running;

		await page.getByTitle('New Project').click();
		await page.getByLabel('Project name').fill('Packaged Duplicate');
		await page.getByRole('button', {name: 'Create Project'}).click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+$/);

		const sourceRoot = await projectRootFromRenderer(page);
		await writeFile(
			path.join(sourceRoot, 'assets', 'cover.bin'),
			Buffer.from('asset bytes')
		);
		await writeFile(path.join(sourceRoot, 'notes.txt'), 'unmanaged notes');
		const sourceStoryId = await page.evaluate(
			() => window.location.hash.match(/^#\/stories\/([^/]+)/)?.[1]
		);

		expect(sourceStoryId).toBeTruthy();
		await page.evaluate(() => {
			window.location.hash = '#/';
		});
		await expect(page).toHaveURL(/#\/$/);
		await page
			.getByRole('button', {name: 'Duplicate project Packaged Duplicate'})
			.click();
		const duplicateRow = page
			.getByTestId('story-list-row')
			.filter({has: page.getByText('Packaged Duplicate 1', {exact: true})});

		await expect(duplicateRow).toBeVisible();
		const duplicateStoryId = await duplicateRow.getAttribute('data-id');

		expect(duplicateStoryId).toBeTruthy();
		const duplicateRoot = await page.evaluate(storyId => {
			const metadata = JSON.parse(
				window.localStorage.getItem(`twine-rs-project-metadata-${storyId}`) ??
					'null'
			);

			if (!metadata?.rootPath) {
				throw new Error('Duplicated project metadata was not persisted.');
			}
			return String(metadata.rootPath);
		}, duplicateStoryId);

		expect(duplicateRoot).not.toBe(sourceRoot);
		await expect(
			readFile(path.join(duplicateRoot, 'assets', 'cover.bin'))
		).resolves.toEqual(Buffer.from('asset bytes'));
		await expect(
			readFile(path.join(duplicateRoot, 'notes.txt'), 'utf8')
		).resolves.toBe('unmanaged notes');
		const manifest = await readFile(
			path.join(duplicateRoot, 'twine.toml'),
			'utf8'
		);

		expect(manifest).toContain(`id = "${duplicateStoryId}"`);
		expect(manifest).not.toContain(`id = "${sourceStoryId}"`);

		await running.app.close();
		running = undefined;
		running = await launchPackagedApp(executablePath, profileRoot);
		const relaunchedPage = running.page;
		const sourceRow = relaunchedPage.getByTestId('story-list-row').filter({
			has: relaunchedPage.getByRole('button', {
				name: 'Delete story Packaged Duplicate',
				exact: true
			})
		});
		const relaunchedDuplicateRow = relaunchedPage
			.getByTestId('story-list-row')
			.filter({
				has: relaunchedPage.getByRole('button', {
					name: 'Delete story Packaged Duplicate 1',
					exact: true
				})
			});

		await expect(sourceRow).toBeVisible();
		await expect(relaunchedDuplicateRow).toBeVisible();
		relaunchedPage.once('dialog', dialog => void dialog.accept());
		await sourceRow
			.getByRole('button', {name: 'Delete story Packaged Duplicate'})
			.click();
		await expect(sourceRow).toHaveCount(0);
		await expect(access(sourceRoot)).rejects.toThrow();
		await expect(relaunchedDuplicateRow).toBeVisible();
		await expect(
			readFile(path.join(duplicateRoot, 'assets', 'cover.bin'))
		).resolves.toEqual(Buffer.from('asset bytes'));
	} finally {
		await running?.app.close();
	}
});

async function projectRootFromRenderer(page: Page) {
	return page.evaluate(() => {
		const storyId = window.location.hash.match(/^#\/stories\/([^/]+)/)?.[1];
		const value = storyId
			? window.localStorage.getItem(
					`twine-rs-project-metadata-${decodeURIComponent(storyId)}`
				)
			: undefined;
		const metadata = value ? JSON.parse(value) : undefined;

		if (metadata?.rootPath) {
			return String(metadata.rootPath);
		}

		throw new Error('No file-backed project metadata was written.');
	});
}

async function waitForSavedText(projectRoot: string, expected: string) {
	await expect
		.poll(
			async () => {
				try {
					return await readFile(path.join(projectRoot, 'story.twee'), 'utf8');
				} catch {
					// Passage-file projects keep their editable prose below passages/.
				}
				const passagesRoot = path.join(projectRoot, 'passages');
				const files = await readdir(passagesRoot, {recursive: true});
				const passageFile = files.find(file => file.endsWith('.twee'));

				return passageFile
					? readFile(path.join(passagesRoot, passageFile), 'utf8')
					: '';
			},
			{timeout: 30_000}
		)
		.toContain(expected);
}

async function projectTextFiles(projectRoot: string) {
	const entries = await readdir(projectRoot, {recursive: true});
	const files = await Promise.all(
		entries.map(async relativePath => {
			try {
				return {
					relativePath,
					source: await readFile(path.join(projectRoot, relativePath), 'utf8')
				};
			} catch {
				// Recursive readdir also returns directories.
				return undefined;
			}
		})
	);

	return files.filter(
		(file): file is {relativePath: string; source: string} => !!file
	);
}

function silentWav() {
	const sampleRate = 8000;
	const samples = Buffer.alloc(sampleRate / 10, 128);
	const result = Buffer.alloc(44 + samples.length);

	result.write('RIFF', 0);
	result.writeUInt32LE(result.length - 8, 4);
	result.write('WAVEfmt ', 8);
	result.writeUInt32LE(16, 16);
	result.writeUInt16LE(1, 20);
	result.writeUInt16LE(1, 22);
	result.writeUInt32LE(sampleRate, 24);
	result.writeUInt32LE(sampleRate, 28);
	result.writeUInt16LE(1, 32);
	result.writeUInt16LE(8, 34);
	result.write('data', 36);
	result.writeUInt32LE(samples.length, 40);
	samples.copy(result, 44);
	return result;
}

const tinyPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/2E5nWQAAAABJRU5ErkJggg==',
	'base64'
);

const mediaSource = [
	'<p id="offline-marker">Offline referenced media is ready.</p>',
	'<img id="hero-media" src="assets/hero.png">',
	'<img id="repeated-media" src="./assets/hero.png?cache=1">',
	'<audio id="audio-media" src="assets/tone.wav" controls></audio>',
	'<video id="poster-media" poster="/assets/poster.png" controls></video>',
	'<div id="css-media" style="width: 4px; height: 4px; background-image: url(\'assets/back%20drop.png\')"></div>'
].join('\n');

async function savedProjectSource(projectRoot: string) {
	try {
		return await readFile(path.join(projectRoot, 'story.twee'), 'utf8');
	} catch {
		const passagesRoot = path.join(projectRoot, 'passages');
		const files = await readdir(passagesRoot, {recursive: true});
		const passageFile = files.find(file => file.endsWith('.twee'));

		if (!passageFile) {
			throw new Error('No saved passage source was found.');
		}

		return readFile(path.join(passagesRoot, passageFile), 'utf8');
	}
}

async function importReferencedMedia(page: Page, projectRoot: string) {
	const stagingRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-media-staging-')
	);
	const fixtures = new Map<string, Buffer>([
		['back drop.png', tinyPng],
		['hero.png', tinyPng],
		['poster.png', tinyPng],
		['tone.wav', silentWav()]
	]);

	await Promise.all(
		[...fixtures].map(([name, bytes]) =>
			writeFile(path.join(stagingRoot, name), bytes)
		)
	);
	for (const name of fixtures.keys()) {
		await page.evaluate(
			async ({rootPath, sourcePath}) => {
				const bridge = (
					window as typeof window & {
						twineElectron?: {
							copyAssetToProject(
								rootPath: string,
								sourcePath: string
							): Promise<{effectToken?: string}>;
							discardProjectAssetEffect(token: string): Promise<void>;
						};
					}
				).twineElectron;
				const result = await bridge?.copyAssetToProject(rootPath, sourcePath);

				if (!result) {
					throw new Error('Desktop asset bridge is unavailable.');
				}
				if (result.effectToken) {
					await bridge?.discardProjectAssetEffect(result.effectToken);
				}
			},
			{rootPath: projectRoot, sourcePath: path.join(stagingRoot, name)}
		);
	}
	return fixtures;
}

async function installOpenDialogResponses(
	app: ElectronApplication,
	responses: DialogState['responses']
) {
	await app.evaluate(({dialog}, queuedResponses) => {
		const state: DialogState = {calls: [], responses: queuedResponses};

		(
			globalThis as typeof globalThis & {
				__twinePackagedDialogState?: DialogState;
			}
		).__twinePackagedDialogState = state;
		dialog.showOpenDialog = async options => {
			state.calls.push({
				properties: options.properties,
				title: options.title
			});
			return state.responses.shift() ?? {canceled: true, filePaths: []};
		};
	}, responses);
}

async function openDialogCalls(app: ElectronApplication) {
	return app.evaluate(() => {
		return (
			globalThis as typeof globalThis & {
				__twinePackagedDialogState?: DialogState;
			}
		).__twinePackagedDialogState?.calls;
	});
}

test('packaged app preserves sibling stories across full save, rename, and reopen', async () => {
	const executablePath = await packagedExecutable();
	const renamedStoryName = 'Packaged Sibling Renamed';
	const siblingStoryId = 'packaged-sibling-story-id';
	const siblingPassageId = 'packaged-sibling-passage-id';
	const siblingStoryName = 'Packaged Sibling';
	const siblingPassageText = 'Packaged sibling passage survived a full save.';
	const siblingScript = 'window.packagedSiblingScript = "survived";';
	const siblingStylesheet = '.packaged-sibling { color: rgb(12, 34, 56); }';
	const createProfile = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-create-')
	);
	const openProfile = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-open-')
	);
	let running: {app: ElectronApplication; page: Page} | undefined;

	try {
		running = await launchPackagedApp(executablePath, createProfile);
		const {app, page} = running;

		await expect(
			page.getByRole('heading', {name: 'No projects yet'})
		).toBeVisible();
		await page.getByTitle('New Project').click();
		await expect(page).toHaveURL(/#\/new-project$/);
		await page.getByLabel('Project name').fill('Packaged Smoke');
		await tabWithText(page, 'Text').click();
		await page.getByRole('button', {name: 'Create Project'}).click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
		await expect(sourceEditor(page)).toBeVisible();

		const projectRoot = await projectRootFromRenderer(page);
		await access(path.join(projectRoot, 'twine.toml'));
		expect(await readdir(projectRoot)).toContain('passages');
		expect(await readdir(projectRoot)).not.toContain('story.twee');
		await replaceEditorText(page, 'Packaged save survived the native bridge.');
		await waitForSavedText(
			projectRoot,
			'Packaged save survived the native bridge.'
		);

		const siblingSave = await page.evaluate(
			async ({
				passageId,
				passageText,
				rootPath,
				script,
				storyId,
				storyName,
				stylesheet
			}) => {
				const bridge = (window as PackagedProjectWindow).twineElectron;

				if (!bridge) {
					throw new Error('Desktop project bridge is unavailable.');
				}
				const hydrated = await bridge.hydrateProjectFolder(rootPath);
				const originalStory = hydrated.stories[0];

				if (!originalStory || hydrated.stories.length !== 1) {
					throw new Error(
						'Expected one story before adding the packaged sibling.'
					);
				}
				const originalPassage = originalStory.passages[0];

				if (!originalPassage) {
					throw new Error(
						'Expected the created story to have a start passage.'
					);
				}
				const siblingStory = {
					...originalStory,
					id: storyId,
					ifid: 'A1B2C3D4-E5F6-47A8-89B0-C1D2E3F4A5B6',
					lastUpdate: new Date('2026-07-22T10:00:00.000Z'),
					name: storyName,
					passages: [
						{
							...originalPassage,
							height: 140,
							highlighted: true,
							id: passageId,
							left: 320,
							name: 'Sibling Start',
							selected: true,
							story: storyId,
							tags: ['packaged-regression'],
							text: passageText,
							top: 180,
							width: 180
						}
					],
					script,
					selected: false,
					startPassage: passageId,
					stylesheet,
					tagColors: {'packaged-regression': 'red'}
				};
				const saved = await bridge.saveProjectFolder(rootPath, siblingStory);

				return {
					originalStoryId: originalStory.id,
					storyIds: saved.storyIds,
					storyResultIds: saved.stories.map(story => story.id)
				};
			},
			{
				passageId: siblingPassageId,
				passageText: siblingPassageText,
				rootPath: projectRoot,
				script: siblingScript,
				storyId: siblingStoryId,
				storyName: siblingStoryName,
				stylesheet: siblingStylesheet
			}
		);
		const originalStoryId = siblingSave.originalStoryId;

		expect(siblingSave.storyIds).toHaveLength(2);
		expect(siblingSave.storyIds).toEqual(
			expect.arrayContaining([originalStoryId, siblingStoryId])
		);
		expect(siblingSave.storyResultIds).toEqual(
			expect.arrayContaining([originalStoryId, siblingStoryId])
		);
		expect(siblingSave.storyResultIds).toHaveLength(2);

		const renamedSave = await page.evaluate(
			async ({name, rootPath, storyId}) => {
				const bridge = (window as PackagedProjectWindow).twineElectron;

				if (!bridge) {
					throw new Error('Desktop project bridge is unavailable.');
				}
				const hydrated = await bridge.hydrateProjectFolder(rootPath);
				const siblingStory = hydrated.stories.find(
					story => story.id === storyId
				);

				if (!siblingStory) {
					throw new Error('Canonical packaged sibling story is unavailable.');
				}
				const saved = await bridge.saveProjectFolder(rootPath, {
					...siblingStory,
					name
				});

				return {
					stories: saved.stories.map(story => ({
						id: story.id,
						name: story.name
					})),
					storyIds: saved.storyIds
				};
			},
			{name: renamedStoryName, rootPath: projectRoot, storyId: siblingStoryId}
		);

		expect(renamedSave.storyIds).toHaveLength(2);
		expect(renamedSave.storyIds).toEqual(
			expect.arrayContaining([originalStoryId, siblingStoryId])
		);
		expect(renamedSave.stories).toHaveLength(2);
		expect(renamedSave.stories).toEqual(
			expect.arrayContaining([
				expect.objectContaining({id: originalStoryId, name: 'Packaged Smoke'}),
				expect.objectContaining({
					id: siblingStoryId,
					name: renamedStoryName
				})
			])
		);
		await expect
			.poll(
				async () => readFile(path.join(projectRoot, 'twine.toml'), 'utf8'),
				{
					timeout: 30_000
				}
			)
			.toContain(renamedStoryName);

		const hydratedAfterRename = await page.evaluate(
			async ({rootPath, storyIds}) => {
				const bridge = (window as PackagedProjectWindow).twineElectron;

				if (!bridge) {
					throw new Error('Desktop project bridge is unavailable.');
				}
				const result = await bridge.hydrateProjectFolder(rootPath, storyIds);

				return {
					storyIds: result.storyIds,
					stories: result.stories.map(story => ({
						id: story.id,
						name: story.name,
						passages: story.passages.map(passage => ({
							id: passage.id,
							text: passage.text
						})),
						script: story.script,
						stylesheet: story.stylesheet
					}))
				};
			},
			{rootPath: projectRoot, storyIds: [originalStoryId, siblingStoryId]}
		);
		const hydratedOriginal = hydratedAfterRename.stories.find(
			story => story.id === originalStoryId
		);
		const hydratedSibling = hydratedAfterRename.stories.find(
			story => story.id === siblingStoryId
		);

		expect(hydratedAfterRename.storyIds).toEqual(
			expect.arrayContaining([originalStoryId, siblingStoryId])
		);
		expect(hydratedAfterRename.storyIds).toHaveLength(2);
		expect(hydratedAfterRename.stories).toHaveLength(2);
		expect(hydratedOriginal?.name).toBe('Packaged Smoke');
		expect(hydratedOriginal?.passages).toHaveLength(1);
		expect(hydratedOriginal?.passages[0]?.text).toContain(
			'Packaged save survived the native bridge.'
		);
		expect(hydratedSibling).toEqual(
			expect.objectContaining({
				name: renamedStoryName,
				passages: [
					expect.objectContaining({
						id: siblingPassageId,
						text: siblingPassageText
					})
				],
				script: siblingScript,
				stylesheet: siblingStylesheet
			})
		);

		const savedFiles = await projectTextFiles(projectRoot);
		const manifest = savedFiles.find(
			file => file.relativePath === 'twine.toml'
		)?.source;
		const rendererSidecar = JSON.parse(
			savedFiles.find(file =>
				file.relativePath.endsWith(path.join('.twine', 'project.json'))
			)?.source ?? '{}'
		) as {
			stories?: Array<{
				id?: string;
				name?: string;
				passages?: Array<{id?: string}>;
			}>;
		};

		expect(manifest).toContain(`id = "${originalStoryId}"`);
		expect(manifest).toContain(`id = "${siblingStoryId}"`);
		expect(manifest).toContain('name = "Packaged Smoke"');
		expect(manifest).toContain(`name = "${renamedStoryName}"`);
		expect(
			savedFiles.find(
				file =>
					file.relativePath.endsWith('.twee') &&
					file.source.includes('Packaged save survived the native bridge.')
			)
		).toBeDefined();
		expect(
			savedFiles.find(
				file =>
					file.relativePath.endsWith('.twee') &&
					file.source.includes(siblingPassageText)
			)
		).toBeDefined();
		expect(
			savedFiles.find(
				file =>
					file.relativePath.endsWith('.js') && file.source === siblingScript
			)
		).toBeDefined();
		expect(
			savedFiles.find(
				file =>
					file.relativePath.endsWith('.css') &&
					file.source === siblingStylesheet
			)
		).toBeDefined();
		expect(rendererSidecar.stories).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: originalStoryId,
					name: 'Packaged Smoke'
				}),
				expect.objectContaining({
					id: siblingStoryId,
					name: renamedStoryName,
					passages: [expect.objectContaining({id: siblingPassageId})]
				})
			])
		);
		expect(rendererSidecar.stories).toHaveLength(2);

		const backupRoot = path.join(
			path.dirname(projectRoot),
			`.${path.basename(projectRoot)}.backups`
		);

		await expect
			.poll(async () => readdir(backupRoot), {timeout: 30_000})
			.not.toHaveLength(0);
		const backupCandidates = await Promise.all(
			(await readdir(backupRoot)).map(async name => ({
				files: await projectTextFiles(path.join(backupRoot, name)),
				name
			}))
		);
		const preRenameBackup = backupCandidates.find(candidate => {
			const source = candidate.files.find(
				file => file.relativePath === 'twine.toml'
			)?.source;

			return (
				source?.includes(`id = "${originalStoryId}"`) &&
				source.includes(`id = "${siblingStoryId}"`) &&
				source.includes('name = "Packaged Smoke"') &&
				source.includes(`name = "${siblingStoryName}"`)
			);
		});

		expect(preRenameBackup).toBeDefined();
		expect(
			preRenameBackup?.files.find(
				file =>
					file.relativePath.endsWith('.twee') &&
					file.source.includes('Packaged save survived the native bridge.')
			)
		).toBeDefined();
		expect(
			preRenameBackup?.files.find(
				file =>
					file.relativePath.endsWith('.twee') &&
					file.source.includes(siblingPassageText)
			)
		).toBeDefined();
		expect(
			preRenameBackup?.files.find(
				file =>
					file.relativePath.endsWith('.js') && file.source === siblingScript
			)
		).toBeDefined();
		expect(
			preRenameBackup?.files.find(
				file =>
					file.relativePath.endsWith('.css') &&
					file.source === siblingStylesheet
			)
		).toBeDefined();
		const backupSidecar = JSON.parse(
			preRenameBackup?.files.find(file =>
				file.relativePath.endsWith(path.join('.twine', 'project.json'))
			)?.source ?? '{}'
		) as {stories?: Array<{id?: string; name?: string}>};

		expect(backupSidecar.stories).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: originalStoryId,
					name: 'Packaged Smoke'
				}),
				expect.objectContaining({
					id: siblingStoryId,
					name: siblingStoryName
				})
			])
		);
		expect(backupSidecar.stories).toHaveLength(2);

		const modeControls = page.getByRole('group', {name: 'Workspace Mode'});
		await modeControls
			.getByRole('tab')
			.filter({hasText: /^Graph$/})
			.press('Enter');
		await expect(page.getByLabel('Story graph')).toBeVisible();
		await modeControls
			.getByRole('tab')
			.filter({hasText: /^Text$/})
			.press('Enter');
		await expect(sourceEditor(page)).toBeVisible();

		await page.getByTitle('Contents').click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+\/contents$/);
		await expect(page.getByLabel('Contents', {exact: true})).toBeVisible();
		await page.getByTitle('Workbench').click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+$/);

		await tabWithText(page, 'Story').click();
		await page.getByLabel('Find and Replace', {exact: true}).click();
		const searchDialog = page.getByRole('dialog', {name: 'Find and Replace'});
		await expect(searchDialog).toBeVisible();

		await page.keyboard.press('Escape');
		await page.getByTitle('New Project').click();
		await page.getByLabel('Project name').fill('Packaged Single Source');
		await page
			.locator('label')
			.filter({hasText: 'Source layout'})
			.getByRole('tab')
			.filter({hasText: /^Single$/})
			.click();
		await tabWithText(page, 'Text').click();
		await clickAfterDeferringProjectSessionReviews(
			page,
			page.getByRole('button', {name: 'Create Project'})
		);
		await expect(page).toHaveURL(/#\/stories\/[^/]+$/);

		const singleProjectRoot = await projectRootFromRenderer(page);
		await access(path.join(singleProjectRoot, 'twine.toml'));
		expect(await readdir(singleProjectRoot)).toContain('story.twee');
		expect(await readdir(singleProjectRoot)).not.toContain('passages');
		await replaceEditorText(
			page,
			'Single-file save survived the native bridge.'
		);
		await waitForSavedText(
			singleProjectRoot,
			'Single-file save survived the native bridge.'
		);

		await app.close();
		running = undefined;

		running = await launchPackagedApp(executablePath, openProfile);
		await installOpenDialogResponses(running.app, [
			{canceled: true, filePaths: []},
			{canceled: false, filePaths: [projectRoot]}
		]);
		await running.page.getByTitle('New Project').click();
		await tabWithText(running.page, 'Import').click();
		const openButton = running.page.getByRole('button', {
			name: 'Open Project Folder'
		});

		await openButton.click();
		await expect(running.page).toHaveURL(/#\/new-project\/import$/);
		await openButton.click();
		await expect(running.page).toHaveURL(/#\/$/);
		await expect(
			running.page.getByText('Packaged Smoke').first()
		).toBeVisible();
		await expect(
			running.page.getByText(renamedStoryName).first()
		).toBeVisible();
		await running.page
			.getByRole('button', {name: 'Open Packaged Smoke'})
			.first()
			.click();
		await expect(running.page).toHaveURL(/#\/stories\/[^/]+$/);
		await running.page
			.getByRole('group', {name: 'Workspace Mode'})
			.getByRole('tab')
			.filter({hasText: /^Text$/})
			.click();
		await expect(sourceEditor(running.page)).toContainText(
			'Packaged save survived the native bridge.'
		);
		await running.page.evaluate(() => {
			window.location.hash = '#/';
		});
		await expect(running.page).toHaveURL(/#\/$/);
		await running.page
			.getByRole('button', {name: `Open ${renamedStoryName}`})
			.first()
			.click();
		await expect(running.page).toHaveURL(
			new RegExp(`#\\/stories\\/${siblingStoryId}$`)
		);
		await running.page
			.getByRole('group', {name: 'Workspace Mode'})
			.getByRole('tab')
			.filter({hasText: /^Text$/})
			.click();
		await expect(sourceEditor(running.page)).toContainText(siblingPassageText);

		expect(await openDialogCalls(running.app)).toEqual([
			{properties: ['openDirectory'], title: 'Open Project Folder'},
			{properties: ['openDirectory'], title: 'Open Project Folder'}
		]);
	} finally {
		await running?.app.close();
	}
});

test('packaged desktop embeds referenced media for every bundled format family', async () => {
	const executablePath = await packagedExecutable();
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-media-')
	);
	const cleanOutputRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-media-output-')
	);
	const formats = [
		'Chapbook 2.3.1',
		'Harlowe 3.3.9',
		'Snowman 2.1.1',
		'SugarCube 2.37.3'
	];
	let running: {app: ElectronApplication; page: Page} | undefined;

	try {
		running = await launchPackagedApp(executablePath, profileRoot);
		const {page} = running;

		for (const format of formats) {
			await page.getByTitle('New Project').click();
			await expect(page).toHaveURL(/#\/new-project$/);
			await page.getByLabel('Project name').fill(`Media ${format}`);
			await page
				.locator('label')
				.filter({hasText: 'Story format'})
				.getByRole('combobox')
				.selectOption({label: format});
			await tabWithText(page, 'Text').click();
			await page.getByRole('button', {name: 'Create Project'}).click();
			await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
			await expect(sourceEditor(page)).toBeVisible();

			const projectRoot = await projectRootFromRenderer(page);
			const originalAssets = await importReferencedMedia(page, projectRoot);

			await replaceEditorText(page, mediaSource);
			await waitForSavedText(projectRoot, 'Offline referenced media is ready.');
			await page.getByTitle('Build & Export').click();
			await expect(page).toHaveURL(/#\/stories\/[^/]+\/build$/);
			const embedSwitch = page.getByLabel('Embed referenced media');

			await embedSwitch.locator('..').click();
			await expect(embedSwitch).toBeChecked({timeout: 30_000});

			const cleanFormatRoot = path.join(
				cleanOutputRoot,
				format.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
			);
			const outputPath = path.join(cleanFormatRoot, 'story.html');

			await mkdir(cleanFormatRoot, {recursive: true});
			await running.app.evaluate(({session}, savePath) => {
				session.defaultSession.once('will-download', (_event, item) => {
					item.setSavePath(savePath);
				});
			}, outputPath);
			await page.getByRole('button', {name: 'Export Playable HTML'}).click();
			const buildError = page
				.getByText('Last build failed')
				.locator('..')
				.locator('.build-route__note-detail');
			await expect
				.poll(
					async () => {
						if (await buildError.isVisible()) {
							throw new Error(
								`${format} export failed: ${await buildError.innerText()}`
							);
						}

						try {
							return (await readFile(outputPath)).byteLength;
						} catch {
							return 0;
						}
					},
					{timeout: 30_000}
				)
				.toBeGreaterThan(0);
			await expect(page.getByText(/4 embedded, 0 external/)).toBeVisible();
			await expect(page.getByText('Referenced media embedded')).toBeVisible();

			const html = await readFile(outputPath, 'utf8');

			expect(html).toContain('data:image/png;base64,');
			expect(html).toContain('data:audio/wav;base64,');
			for (const original of [
				'assets/hero.png',
				'assets/tone.wav',
				'assets/poster.png',
				'assets/back%20drop.png'
			]) {
				expect(html).not.toContain(original);
			}
			expect(await readdir(cleanFormatRoot)).toEqual(['story.html']);

			const browser = await chromium.launch();
			const offlinePage = await browser.newPage();

			await offlinePage.route(/^https?:\/\//, route => route.abort());
			await offlinePage.goto(pathToFileURL(outputPath).href);
			await expect(offlinePage.locator('#offline-marker')).toContainText(
				'Offline referenced media is ready.'
			);
			await expect
				.poll(() =>
					offlinePage
						.locator('#hero-media')
						.evaluate((image: HTMLImageElement) =>
							Boolean(image.complete && image.naturalWidth)
						)
				)
				.toBe(true);
			await expect
				.poll(() =>
					offlinePage
						.locator('#audio-media')
						.evaluate((audio: HTMLAudioElement) => audio.readyState > 0)
				)
				.toBe(true);
			expect(
				await offlinePage.locator('#poster-media').getAttribute('poster')
			).toMatch(/^data:image\/png;base64,/);
			expect(
				await offlinePage
					.locator('#css-media')
					.evaluate(element => getComputedStyle(element).backgroundImage)
			).toContain('data:image/png;base64,');
			await browser.close();

			const persistedSource = await savedProjectSource(projectRoot);

			expect(persistedSource).toContain('assets/hero.png');
			expect(persistedSource).toContain('assets/back%20drop.png');
			for (const [name, expectedBytes] of originalAssets) {
				expect(
					(await readFile(path.join(projectRoot, 'assets', name))).equals(
						expectedBytes
					)
				).toBe(true);
			}
		}
	} finally {
		await running?.app.close();
	}
});

test('packaged Windows preload rejects referenced media through a directory junction', async () => {
	test.skip(
		process.platform !== 'win32',
		'Windows directory junction hardening is Windows-specific.'
	);

	const executablePath = await packagedExecutable();
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-junction-')
	);
	const outsideRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-junction-outside-')
	);
	let junctionPath: string | undefined;
	let running: {app: ElectronApplication; page: Page} | undefined;

	try {
		await writeFile(
			path.join(outsideRoot, 'outside.png'),
			Buffer.from('outside')
		);
		running = await launchPackagedApp(executablePath, profileRoot);
		const {page} = running;

		await page.getByTitle('New Project').click();
		await expect(page).toHaveURL(/#\/new-project$/);
		await page.getByLabel('Project name').fill('Junction Gate');
		await tabWithText(page, 'Text').click();
		await page.getByRole('button', {name: 'Create Project'}).click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
		await expect(sourceEditor(page)).toBeVisible();

		const projectRoot = await projectRootFromRenderer(page);
		const referencedPath = 'assets/escape/outside.png';

		await mkdir(path.join(projectRoot, 'assets'), {recursive: true});
		junctionPath = path.join(projectRoot, 'assets', 'escape');
		await symlink(outsideRoot, junctionPath, 'junction');
		expect(await realpath(junctionPath)).toBe(await realpath(outsideRoot));

		const batch = await page.evaluate(
			async ({rootPath, assetPath}) => {
				const bridge = (
					window as typeof window & {
						twineElectron?: {
							readProjectAssetPayloads(
								rootPath: string,
								paths: string[],
								limits: {
									maxFileBytes: number;
									maxFileCount: number;
									maxTotalEncodedBytes: number;
								}
							): Promise<{
								failures: Array<{path: string; reason: string}>;
								payloads: Array<{
									bytes: ArrayBuffer | Uint8Array;
									path: string;
								}>;
							}>;
						};
					}
				).twineElectron;

				if (!bridge) {
					throw new Error('Desktop asset bridge is unavailable.');
				}
				const result = await bridge.readProjectAssetPayloads(
					rootPath,
					[assetPath],
					{
						maxFileBytes: 1024,
						maxFileCount: 1,
						maxTotalEncodedBytes: 1024
					}
				);

				return {
					failures: result.failures,
					payloads: result.payloads.map(payload => ({
						bytes: Array.from(new Uint8Array(payload.bytes)),
						path: payload.path
					}))
				};
			},
			{assetPath: referencedPath, rootPath: projectRoot}
		);

		expect(batch.payloads).toEqual([]);
		expect(batch.failures).toHaveLength(1);
		expect(batch.failures[0]).toMatchObject({
			path: referencedPath,
			reason: 'symlink-escape'
		});
	} finally {
		await running?.app.close();
		if (junctionPath) {
			await rmdir(junctionPath).catch(() => undefined);
		}
		await Promise.all(
			[profileRoot, outsideRoot].map(root =>
				rm(root, {force: true, recursive: true})
			)
		);
	}
});
