import {expect, Locator, Page, test} from '@playwright/test';
import {
	_electron as electron,
	ElectronApplication,
	FrameLocator
} from 'playwright';
import {
	access,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type RunningApp = {
	app: ElectronApplication;
	page: Page;
	profileRoot: string;
};

interface PreviewTestWindow extends Window {
	twineElectron?: {
		hydrateProjectFolder(rootPath: string): Promise<{
			stories: Array<{
				id: string;
				name: string;
				startPassage?: string;
			}>;
		}>;
	};
	twineStoryPreview?: Record<string, unknown>;
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

async function launchPackagedApp(
	executablePath: string,
	profileLabel: string
): Promise<RunningApp> {
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), `twine-rs-preview-${profileLabel}-`)
	);

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
	return {app, page, profileRoot};
}

function isPreviewPage(page: Page) {
	try {
		return new URL(page.url()).pathname.endsWith('/story-preview.html');
	} catch {
		return false;
	}
}

function previewPages(app: ElectronApplication) {
	return app.windows().filter(page => !page.isClosed() && isPreviewPage(page));
}

async function waitForNewPreview(
	app: ElectronApplication,
	previous: ReadonlySet<Page>
) {
	let preview: Page | undefined;

	await expect
		.poll(
			() => {
				preview = previewPages(app).find(candidate => !previous.has(candidate));
				return preview?.url() ?? '';
			},
			{timeout: 60_000}
		)
		.toContain('story-preview.html');
	await preview!.waitForLoadState('domcontentloaded');
	await expect(preview!.locator('.story-preview-route')).toBeVisible();
	return preview!;
}

async function launchPreview(running: RunningApp, launch: () => Promise<void>) {
	const previous = new Set(previewPages(running.app));
	const diagnostics: string[] = [];
	const captureDiagnostics = (page: Page) => {
		page.on('console', message =>
			diagnostics.push(`console ${message.type()}: ${message.text()}`)
		);
		page.on('pageerror', error =>
			diagnostics.push(`pageerror: ${error.message}`)
		);
	};

	running.app.on('window', captureDiagnostics);
	const waiting = waitForNewPreview(running.app, previous);

	try {
		await launch();
		return await waiting;
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}${
				diagnostics.length > 0
					? `\nPreview renderer diagnostics:\n${diagnostics.join('\n')}`
					: ''
			}`
		);
	} finally {
		running.app.off('window', captureDiagnostics);
	}
}

const activeStoryIframeSelector =
	'.story-preview-route__frame-shell:not(.story-preview-route__frame-shell--staging) > iframe.story-preview-route__frame';

function storyFrame(preview: Page): FrameLocator {
	return preview.frameLocator(activeStoryIframeSelector);
}

function storyIframe(preview: Page) {
	return preview.locator(activeStoryIframeSelector);
}

async function previewOrigin(preview: Page) {
	const src = await storyIframe(preview).getAttribute('src');

	if (!src) {
		throw new Error('The managed story iframe has no package URL.');
	}

	const url = new URL(src);

	return {origin: `${url.protocol}//${url.host}`, src};
}

function sourceEditor(page: Page, passageName?: string): Locator {
	const editorWindow = passageName
		? page.getByRole('region', {name: passageName, exact: true})
		: page.locator('.story-edit-editor-window').first();

	return editorWindow.locator('[data-testid^="story-editor-window-"]');
}

async function replaceEditorText(
	page: Page,
	text: string,
	passageName?: string
) {
	const editor = sourceEditor(page, passageName);

	await expect(editor).toBeVisible();
	await editor.locator('.cm-content').click();
	await page.keyboard.press(
		process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
	);
	await page.keyboard.insertText(text);
	await expect
		.poll(() => editor.locator('.cm-content').innerText())
		.toContain(text);
	await page.keyboard.press('Tab');
	// Passage buffers commit to the live project host after a short debounce.
	await page.waitForTimeout(450);
}

async function createProject(
	page: Page,
	options: {
		format?: string;
		name: string;
		startPassage?: string;
	}
) {
	await page.getByTitle('New Project').click();
	await expect(page).toHaveURL(/#\/new-project$/);
	await page.getByLabel('Project name').fill(options.name);
	await page.getByLabel('Start passage').fill(options.startPassage ?? 'Start');
	if (options.format) {
		await page
			.locator('label')
			.filter({hasText: 'Story format'})
			.getByRole('combobox')
			.selectOption({label: options.format});
	}
	await page
		.locator('label')
		.filter({hasText: 'Initial mode'})
		.getByRole('tab')
		.filter({hasText: /^Text$/})
		.click();
	await page.getByRole('button', {name: 'Create Project'}).click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
	await expect(
		page.getByRole('region', {name: options.startPassage ?? 'Start'})
	).toBeVisible();
}

async function selectPassage(page: Page, name: string) {
	await page
		.getByRole('listitem')
		.filter({hasText: new RegExp(`^${name}`)})
		.getByRole('button')
		.click();
	await expect(page.getByRole('region', {name})).toBeVisible();
}

async function createPassage(page: Page, name: string, text: string) {
	await page.getByRole('tab', {name: 'Passage', exact: true}).click();
	await page.getByRole('button', {name: 'New', exact: true}).click();
	const untitledPassage = page
		.getByRole('listitem')
		.filter({hasText: /^Untitled Passage/})
		.getByRole('button');

	await expect(untitledPassage).toBeVisible();
	await untitledPassage.click();
	await expect(
		page.getByRole('region', {name: /Untitled Passage/})
	).toBeVisible();
	await page.getByRole('button', {name: 'Rename', exact: true}).click();
	const renameDialog = page.getByRole('dialog').last();

	await expect(renameDialog).toBeVisible();
	await renameDialog.getByRole('textbox').fill(name);
	await renameDialog.getByRole('button', {name: 'Save'}).click();
	await expect(page.getByRole('region', {name})).toBeVisible();
	await replaceEditorText(page, text, name);
}

async function projectRootFromRenderer(page: Page) {
	return page.evaluate(() => {
		const storyId = window.location.hash.match(/^#\/stories\/([^/?]+)/)?.[1];
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
				const files = (await readdir(passagesRoot, {recursive: true})).filter(
					file => file.endsWith('.twee')
				);
				const sources = await Promise.all(
					files.map(file => readFile(path.join(passagesRoot, file), 'utf8'))
				);

				return sources.join('\n');
			},
			{timeout: 30_000}
		)
		.toContain(expected);
}

async function persistedStartUuid(page: Page) {
	return page.evaluate(async () => {
		const storyId = window.location.hash.match(/^#\/stories\/([^/?]+)/)?.[1];
		const value = storyId
			? window.localStorage.getItem(
					`twine-rs-project-metadata-${decodeURIComponent(storyId)}`
				)
			: undefined;
		const rootPath = value ? JSON.parse(value).rootPath : undefined;
		const bridge = (window as PreviewTestWindow).twineElectron;

		if (!storyId || !rootPath || !bridge) {
			throw new Error('The persisted project bridge is unavailable.');
		}

		const hydrated = await bridge.hydrateProjectFolder(String(rootPath));
		const story = hydrated.stories.find(candidate => candidate.id === storyId);

		if (!story?.startPassage) {
			throw new Error('The persisted story has no start passage UUID.');
		}

		return story.startPassage;
	});
}

async function expectRenderedText(preview: Page, text: string) {
	await expect(
		storyFrame(preview).locator(':visible').filter({hasText: text}).last()
	).toBeVisible({timeout: 60_000});
}

async function expectCurrentPassage(preview: Page, name: string) {
	await expect(
		preview
			.locator('.story-preview-route__runtime-main')
			.getByText(`Current: ${name}`, {exact: true})
	).toBeVisible({timeout: 30_000});
	await expect(
		preview.getByRole('button', {name: 'Test Current'})
	).toBeEnabled();
}

async function waitForReplacement(
	preview: Page,
	previousSrc: string,
	renderedText: string
) {
	await expect
		.poll(
			async () => {
				const operationError = preview.getByRole('alert');

				if (await operationError.isVisible()) {
					return `error: ${await operationError.innerText()}`;
				}

				return (await storyIframe(preview).getAttribute('src')) === previousSrc
					? 'pending'
					: 'replaced';
			},
			{timeout: 60_000}
		)
		.toBe('replaced');
	await expectRenderedText(preview, renderedText);
	return previewOrigin(preview);
}

async function importAsset(page: Page, sourcePath: string, outputPath: string) {
	await page.getByLabel('Asset path').fill(sourcePath);
	await page.getByRole('button', {name: 'Import Asset'}).click();
	await expect(
		page.getByRole('button', {name: `Select asset ${outputPath}`})
	).toBeVisible({timeout: 30_000});
}

async function scratchPreviewRoots(profileRoot: string) {
	return (
		await readdir(path.join(profileRoot, 'scratch'), {withFileTypes: true})
	)
		.filter(entry => entry.isDirectory() && entry.name.startsWith('preview-'))
		.map(entry => entry.name)
		.sort();
}

async function protocolStatus(app: ElectronApplication, url: string) {
	return app.evaluate(
		async ({net}, target) => (await net.fetch(target)).status,
		url
	);
}

async function browserWindowId(app: ElectronApplication, page: Page) {
	return app.evaluate(
		({BrowserWindow}, targetUrl) =>
			BrowserWindow.getAllWindows().find(
				window => window.webContents.getURL() === targetUrl
			)?.id ?? null,
		page.url()
	);
}

const silentWav = (() => {
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
})();

test.describe.configure({mode: 'serial'});

test('Play exposes debug state and replaces fresh Test builds in the same window', async () => {
	test.setTimeout(6 * 60 * 1000);
	const executablePath = await packagedExecutable();
	let running: RunningApp | undefined;

	try {
		running = await launchPackagedApp(executablePath, 'play-debug');
		const {app, page} = running;

		await createProject(page, {
			format: 'Harlowe 3.3.9',
			name: 'Managed Play Debug',
			startPassage: 'Start'
		});
		const projectRoot = await projectRootFromRenderer(page);

		await createPassage(page, 'Next', 'Next passage version one.');
		await selectPassage(page, 'Start');
		await replaceEditorText(
			page,
			'Start passage version one. [[Continue->Next]]',
			'Start'
		);
		await waitForSavedText(
			projectRoot,
			'Start passage version one. [[Continue->Next]]'
		);

		const preview = await launchPreview(running, () =>
			page.getByTitle('Play').click()
		);
		const ownerWindowId = await browserWindowId(app, page);
		const previewWindowId = await browserWindowId(app, preview);

		expect(ownerWindowId).not.toBeNull();
		expect(previewWindowId).not.toBeNull();
		expect(previewWindowId).not.toBe(ownerWindowId);

		await expect(preview.getByText('Play', {exact: true})).toBeVisible();
		await expect(
			preview.getByText('Managed Play Debug', {exact: true})
		).toBeVisible();
		await expect(preview.getByText('2 passages', {exact: true})).toBeVisible();
		await expect(preview.getByText('1 links', {exact: true})).toBeVisible();
		await expect(preview.getByText('0 broken', {exact: true})).toBeVisible();
		await expect(
			preview.getByText('0 diagnostics', {exact: true})
		).toBeVisible();
		await expect(preview.getByText('0 logs', {exact: true})).toBeVisible();
		await expectRenderedText(preview, 'Start passage version one.');
		await expectCurrentPassage(preview, 'Start');

		const shellCapabilities = await preview.evaluate(() => ({
			previewBridge: Object.keys(
				(window as PreviewTestWindow).twineStoryPreview ?? {}
			).sort(),
			twineElectron: typeof (window as PreviewTestWindow).twineElectron
		}));

		expect(shellCapabilities).toEqual({
			previewBridge: [
				'command',
				'frameLoaded',
				'getInitialState',
				'onAppearance',
				'onCommandResult',
				'onReplacement',
				'ready'
			],
			twineElectron: 'undefined'
		});
		expect(
			await storyFrame(preview)
				.locator('body')
				.evaluate(() => ({
					twineElectron: typeof (window as PreviewTestWindow).twineElectron,
					twineStoryPreview: typeof (window as PreviewTestWindow)
						.twineStoryPreview
				}))
		).toEqual({
			twineElectron: 'undefined',
			twineStoryPreview: 'undefined'
		});

		for (const viewport of ['Fit', 'Desktop', 'Tablet', 'Phone']) {
			await expect(
				preview.getByRole('tab', {name: viewport, exact: true})
			).toBeVisible();
		}
		await preview.getByRole('tab', {name: 'Phone', exact: true}).click();
		await expect(
			preview.locator('.story-preview-route__frame-shell')
		).toHaveAttribute('data-viewport', 'phone');
		await expect(
			preview
				.locator('.story-preview-route__runtime-main')
				.getByText(/\d+ x \d+/)
		).toBeVisible();
		await preview.getByRole('tab', {name: 'Fit'}).click();

		await storyFrame(preview).getByText('Continue', {exact: true}).click();
		await expectRenderedText(preview, 'Next passage version one.');
		await expectCurrentPassage(preview, 'Next');

		const latestLog = preview.locator('.story-preview-route__latest-log');

		await storyFrame(preview)
			.locator('body')
			.evaluate(() => console.log('managed-preview-log'));
		await expect(latestLog).toContainText('managed-preview-log');
		await storyFrame(preview)
			.locator('body')
			.evaluate(() => {
				window.setTimeout(() => {
					throw new Error('managed-preview-thrown');
				}, 0);
			});
		await expect(latestLog).toContainText('managed-preview-thrown');
		await storyFrame(preview)
			.locator('body')
			.evaluate(() => {
				void Promise.reject(new Error('managed-preview-rejection'));
			});
		await expect(latestLog).toContainText('managed-preview-rejection');

		await preview.getByRole('button', {name: 'Source'}).click();
		await expect(page).toHaveURL(/mode=text&passage=/);
		await expect(
			page.getByRole('region', {name: 'Next', exact: true})
		).toHaveClass(/is-active/);
		await replaceEditorText(
			page,
			'Next passage version two, built live.',
			'Next'
		);
		await waitForSavedText(
			projectRoot,
			'Next passage version two, built live.'
		);

		await preview.getByRole('button', {name: 'Graph'}).click();
		await expect(page).toHaveURL(/mode=graph&passage=/);
		await expect(page.getByLabel('Story graph')).toBeVisible();

		const firstPackage = await previewOrigin(preview);
		const previewCount = previewPages(app).length;

		await preview.getByRole('button', {name: 'Test Current'}).click();
		const currentReplacement = await waitForReplacement(
			preview,
			firstPackage.src,
			'Next passage version two, built live.'
		);

		expect(previewPages(app)).toHaveLength(previewCount);
		expect(await browserWindowId(app, preview)).toBe(previewWindowId);
		expect(currentReplacement.origin).not.toBe(firstPackage.origin);
		await expect(preview.getByText('Test', {exact: true})).toBeVisible();
		await expect(preview.getByText('Start: Next', {exact: true})).toBeVisible();
		await expectCurrentPassage(preview, 'Next');

		await preview.getByRole('button', {name: 'Source'}).click();
		await expect(page).toHaveURL(/mode=text&passage=/);
		await expect(
			page.getByRole('region', {name: 'Next', exact: true})
		).toHaveClass(/is-active/);
		await replaceEditorText(
			page,
			'Next passage version three, rebuilt fresh.',
			'Next'
		);
		await waitForSavedText(
			projectRoot,
			'Next passage version three, rebuilt fresh.'
		);
		const secondPackage = await previewOrigin(preview);

		await preview.getByRole('button', {name: 'Test From Start'}).click();
		const startReplacement = await waitForReplacement(
			preview,
			secondPackage.src,
			'Next passage version three, rebuilt fresh.'
		);

		expect(previewPages(app)).toHaveLength(previewCount);
		expect(await browserWindowId(app, preview)).toBe(previewWindowId);
		expect(startReplacement.origin).not.toBe(secondPackage.origin);
		await expect(preview.getByText('Start: Next', {exact: true})).toBeVisible();
	} finally {
		await running?.app.close();
	}
});

test('Test From Here preserves the saved start and Proof uses Paperthin in the managed shell', async () => {
	test.setTimeout(5 * 60 * 1000);
	const executablePath = await packagedExecutable();
	let running: RunningApp | undefined;

	try {
		running = await launchPackagedApp(executablePath, 'test-proof');
		const {page} = running;

		await createProject(page, {
			format: 'Harlowe 3.3.9',
			name: 'Managed Test And Proof',
			startPassage: 'Saved Start'
		});
		await replaceEditorText(page, 'The saved start must remain unchanged.');
		await createPassage(
			page,
			'Nonstart',
			'This is the passage-specific debug launch.'
		);
		const projectRoot = await projectRootFromRenderer(page);

		await waitForSavedText(
			projectRoot,
			'This is the passage-specific debug launch.'
		);
		const savedStartBefore = await persistedStartUuid(page);
		const testPreview = await launchPreview(running, () =>
			page
				.getByRole('region', {name: 'Nonstart'})
				.getByRole('button', {name: 'Test From Here'})
				.click()
		);

		await expect(testPreview.getByText('Test', {exact: true})).toBeVisible();
		await expect(
			testPreview.getByText('Start: Nonstart', {exact: true})
		).toBeVisible();
		await expectRenderedText(
			testPreview,
			'This is the passage-specific debug launch.'
		);
		await expectCurrentPassage(testPreview, 'Nonstart');
		await testPreview.getByRole('button', {name: 'Reload'}).click();
		await expectRenderedText(
			testPreview,
			'This is the passage-specific debug launch.'
		);
		await expectCurrentPassage(testPreview, 'Nonstart');
		expect(await persistedStartUuid(page)).toBe(savedStartBefore);
		await testPreview.close();

		await page.getByTitle('Build & Export').click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+\/build$/);
		await page.getByRole('tab', {name: 'Preview'}).click();
		const proofingFormat = page.getByLabel('Proofing format');

		await proofingFormat.selectOption({label: 'Paperthin 1.0.0'});
		await expect(proofingFormat).toHaveValue(/Paperthin/);
		const proofPreview = await launchPreview(running, () =>
			page
				.getByRole('region', {name: 'Preview actions'})
				.getByRole('button', {name: 'Proof'})
				.click()
		);

		await expect(proofPreview.getByText('Proof', {exact: true})).toBeVisible();
		await expect(
			proofPreview.getByText('Managed Test And Proof', {exact: true})
		).toBeVisible();
		await expect(
			storyFrame(proofPreview).getByRole('heading', {
				level: 1,
				name: 'Managed Test And Proof'
			})
		).toBeVisible();
		await expect(
			storyFrame(proofPreview).locator('tw-passagedata[name="Saved Start"]')
		).toBeVisible();
		await expect(
			storyFrame(proofPreview).locator('tw-passagedata[name="Nonstart"]')
		).toBeVisible();
		expect(
			await storyFrame(proofPreview)
				.locator('tw-passagedata[name="Saved Start"]')
				.evaluate(element => getComputedStyle(element).display)
		).toBe('block');
	} finally {
		await running?.app.close();
	}
});

test('copied assets, storage, package origins, cleanup, and protocol lifetime stay isolated', async () => {
	test.setTimeout(8 * 60 * 1000);
	const executablePath = await packagedExecutable();
	let running: RunningApp | undefined;

	try {
		running = await launchPackagedApp(executablePath, 'asset-isolation');
		const {app, page, profileRoot} = running;
		const stageOne = await mkdtemp(
			path.join(os.tmpdir(), 'twine-rs-preview-assets-one-')
		);
		const stageTwo = await mkdtemp(
			path.join(os.tmpdir(), 'twine-rs-preview-assets-two-')
		);
		const svg = (marker: string, color: string) =>
			`<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><title>${marker}</title><rect width="2" height="2" fill="${color}"/></svg>`;
		const firstFiles = new Map<string, string | Buffer>([
			['hero.svg', svg('asset-one', 'red')],
			['back drop.svg', svg('encoded-one', 'green')],
			['poster.svg', svg('root-one', 'blue')],
			[
				'theme.css',
				'html body .asset-marker { color: rgb(1, 2, 3) !important; }'
			],
			['payload.json', '{"project":"one"}'],
			['tone.wav', silentWav],
			['clip.mp4', Buffer.from('preview-video-range-one')]
		]);
		const secondFiles = new Map<string, string | Buffer>([
			['hero.svg', svg('asset-two', 'purple')],
			['payload.json', '{"project":"two"}']
		]);

		await Promise.all(
			[...firstFiles].map(([name, bytes]) =>
				writeFile(path.join(stageOne, name), bytes)
			)
		);
		await Promise.all(
			[...secondFiles].map(([name, bytes]) =>
				writeFile(path.join(stageTwo, name), bytes)
			)
		);

		await createProject(page, {
			format: 'Harlowe 3.3.9',
			name: 'Asset Preview One'
		});
		const projectOneRoot = await projectRootFromRenderer(page);

		await page.getByTitle('Assets').click();
		for (const name of firstFiles.keys()) {
			await importAsset(page, path.join(stageOne, name), `assets/${name}`);
		}
		await writeFile(
			path.join(stageOne, 'hero.svg'),
			svg('mutated-source', 'black')
		);
		await page.getByTitle('Workbench').click();
		await page
			.getByRole('group', {name: 'Workspace Mode'})
			.getByRole('tab', {name: 'Text'})
			.click();
		await replaceEditorText(
			page,
			[
				'<p class="asset-marker">Asset preview one.</p>',
				'<img id="hero" src="./assets/hero.svg?cache=1">',
				'<img id="encoded" src="assets/back%20drop.svg?cache=1">',
				'<img id="root-relative" src="/assets/poster.svg">',
				'<link rel="stylesheet" href="assets/theme.css">',
				'<audio id="audio" src="assets/tone.wav" controls></audio>',
				'<video id="video" src="assets/clip.mp4" controls></video>',
				'<a id="payload" href="assets/payload.json">payload</a>'
			].join('\n')
		);
		const previewOne = await launchPreview(running, () =>
			page.getByTitle('Play').click()
		);

		await expectRenderedText(previewOne, 'Asset preview one.');
		const packageOne = await previewOrigin(previewOne);
		expect(
			await readFile(path.join(projectOneRoot, 'assets', 'hero.svg'), 'utf8')
		).toContain('asset-one');
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(async () => (await fetch('assets/hero.svg?cache=2')).text())
		).toContain('asset-one');
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(async () =>
					(await fetch('assets/back%20drop.svg?x=1')).text()
				)
		).toContain('encoded-one');
		for (const image of ['#hero', '#encoded', '#root-relative']) {
			await expect
				.poll(() =>
					storyFrame(previewOne)
						.locator(image)
						.evaluate((element: HTMLImageElement) =>
							Boolean(element.complete && element.naturalWidth)
						)
				)
				.toBe(true);
		}
		const stylesheetResponse = await storyFrame(previewOne)
			.locator('body')
			.evaluate(async () => {
				const response = await fetch('assets/theme.css?theme=2');

				return {
					contentType: response.headers.get('content-type'),
					status: response.status,
					text: await response.text()
				};
			});

		expect(stylesheetResponse).toEqual({
			contentType: 'text/css; charset=utf-8',
			status: 200,
			text: expect.stringContaining('rgb(1, 2, 3)')
		});
		const stylesheetState = await storyFrame(previewOne)
			.locator('body')
			.evaluate(async () => {
				const link = document.createElement('link');

				link.rel = 'stylesheet';
				link.href = 'assets/theme.css?theme=1';
				const loaded = new Promise<'error' | 'load' | 'timeout'>(resolve => {
					link.addEventListener('load', () => resolve('load'), {once: true});
					link.addEventListener('error', () => resolve('error'), {once: true});
					window.setTimeout(() => resolve('timeout'), 10_000);
				});
				document.head.append(link);
				const event = await loaded;

				return {
					documentOrigin: location.origin,
					event,
					href: link.href,
					hrefOrigin: new URL(link.href).origin,
					sheetHref: link.sheet?.href ?? null
				};
			});

		expect(stylesheetState).toEqual({
			documentOrigin: packageOne.origin,
			event: 'load',
			href: `${packageOne.origin}/assets/theme.css?theme=1`,
			hrefOrigin: packageOne.origin,
			sheetHref: `${packageOne.origin}/assets/theme.css?theme=1`
		});
		await expect
			.poll(
				() =>
					storyFrame(previewOne)
						.locator('.asset-marker')
						.evaluate(element => getComputedStyle(element).color),
				{timeout: 30_000}
			)
			.toBe('rgb(1, 2, 3)');
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(async () => {
					const response = await fetch('assets/tone.wav', {
						headers: {Range: 'bytes=0-3'}
					});

					return {
						contentRange: response.headers.get('content-range'),
						length: (await response.arrayBuffer()).byteLength,
						status: response.status
					};
				})
		).toEqual({
			contentRange: `bytes 0-3/${silentWav.byteLength}`,
			length: 4,
			status: 206
		});
		await expect
			.poll(
				() =>
					storyFrame(previewOne)
						.locator('#audio')
						.evaluate((element: HTMLAudioElement) => element.readyState),
				{timeout: 30_000}
			)
			.toBeGreaterThan(0);
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(async () => {
					const response = await fetch('assets/clip.mp4', {
						headers: {Range: 'bytes=1-5'}
					});

					return {
						contentRange: response.headers.get('content-range'),
						length: (await response.arrayBuffer()).byteLength,
						status: response.status
					};
				})
		).toEqual({
			contentRange: `bytes 1-5/${Buffer.byteLength('preview-video-range-one')}`,
			length: 5,
			status: 206
		});
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(async () => (await fetch('assets/payload.json')).json())
		).toEqual({project: 'one'});

		await createProject(page, {
			format: 'Harlowe 3.3.9',
			name: 'Asset Preview Two'
		});
		await page.getByTitle('Assets').click();
		for (const name of secondFiles.keys()) {
			await importAsset(page, path.join(stageTwo, name), `assets/${name}`);
		}
		await page.getByTitle('Workbench').click();
		await page
			.getByRole('group', {name: 'Workspace Mode'})
			.getByRole('tab', {name: 'Text'})
			.click();
		await replaceEditorText(
			page,
			[
				'<p>Asset preview two.</p>',
				'<img id="hero" src="assets/hero.svg">',
				'<a href="assets/payload.json">payload</a>'
			].join('\n')
		);
		const previewTwo = await launchPreview(running, () =>
			page.getByTitle('Play').click()
		);
		const packageTwo = await previewOrigin(previewTwo);

		expect(packageTwo.origin).not.toBe(packageOne.origin);
		expect(previewPages(app)).toHaveLength(2);
		await expect(previewOne.getByText('0 logs', {exact: true})).toBeVisible();
		await expect(previewTwo.getByText('0 logs', {exact: true})).toBeVisible();
		await storyFrame(previewOne)
			.locator('body')
			.evaluate(() => console.log('asset-one-window'));
		await expect(
			previewOne.locator('.story-preview-route__latest-log')
		).toContainText('asset-one-window');
		await expect(previewTwo.getByText('0 logs', {exact: true})).toBeVisible();
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(async () => (await fetch('assets/hero.svg')).text())
		).toContain('asset-one');
		expect(
			await storyFrame(previewTwo)
				.locator('body')
				.evaluate(async () => (await fetch('assets/hero.svg')).text())
		).toContain('asset-two');

		await storyFrame(previewOne)
			.locator('body')
			.evaluate(() => localStorage.setItem('colliding-key', 'one'));
		await storyFrame(previewTwo)
			.locator('body')
			.evaluate(() => localStorage.setItem('colliding-key', 'two'));
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(() => localStorage.getItem('colliding-key'))
		).toBe('one');
		expect(
			await storyFrame(previewTwo)
				.locator('body')
				.evaluate(() => localStorage.getItem('colliding-key'))
		).toBe('two');

		await previewOne.getByRole('button', {name: 'Reload'}).click();
		await expectRenderedText(previewOne, 'Asset preview one.');
		expect((await previewOrigin(previewOne)).origin).toBe(packageOne.origin);
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(() => localStorage.getItem('colliding-key'))
		).toBe('one');
		await previewTwo.getByRole('button', {name: 'Reload'}).click();
		await expectRenderedText(previewTwo, 'Asset preview two.');
		expect((await previewOrigin(previewTwo)).origin).toBe(packageTwo.origin);
		expect(
			await storyFrame(previewTwo)
				.locator('body')
				.evaluate(() => localStorage.getItem('colliding-key'))
		).toBe('two');

		await previewOne.getByRole('button', {name: 'Test From Start'}).click();
		const replacement = await waitForReplacement(
			previewOne,
			packageOne.src,
			'Asset preview one.'
		);

		expect(replacement.origin).not.toBe(packageOne.origin);
		await expect
			.poll(() => protocolStatus(app, `${packageOne.origin}/assets/hero.svg`), {
				timeout: 30_000
			})
			.toBe(404);
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(() => localStorage.getItem('colliding-key'))
		).toBeNull();
		expect((await previewOrigin(previewTwo)).origin).toBe(packageTwo.origin);
		expect(
			await storyFrame(previewTwo)
				.locator('body')
				.evaluate(() => localStorage.getItem('colliding-key'))
		).toBe('two');
		expect(
			await storyFrame(previewTwo)
				.locator('body')
				.evaluate(async () => (await fetch('assets/hero.svg')).text())
		).toContain('asset-two');
		await expect
			.poll(() => scratchPreviewRoots(profileRoot), {timeout: 30_000})
			.toHaveLength(2);

		await previewOne.close();
		await expect
			.poll(
				() => protocolStatus(app, `${replacement.origin}/assets/hero.svg`),
				{timeout: 30_000}
			)
			.toBe(404);
		await expect
			.poll(() => scratchPreviewRoots(profileRoot), {timeout: 30_000})
			.toHaveLength(1);
		await previewTwo.close();
		await expect
			.poll(() => protocolStatus(app, `${packageTwo.origin}/assets/hero.svg`), {
				timeout: 30_000
			})
			.toBe(404);
		await expect
			.poll(() => scratchPreviewRoots(profileRoot), {timeout: 30_000})
			.toHaveLength(0);

		const previewAfterCleanup = await launchPreview(running, () =>
			page.getByTitle('Play').click()
		);

		await expectRenderedText(previewAfterCleanup, 'Asset preview two.');
		expect((await previewOrigin(previewAfterCleanup)).origin).not.toBe(
			packageTwo.origin
		);
		await previewAfterCleanup.close();
		await expect
			.poll(() => scratchPreviewRoots(profileRoot), {timeout: 30_000})
			.toHaveLength(0);
	} finally {
		await running?.app.close();
	}
});

test('current passage resolves to a stable ID in every bundled format family', async () => {
	test.setTimeout(8 * 60 * 1000);
	const executablePath = await packagedExecutable();
	const formats = [
		'Chapbook 2.3.1',
		'Harlowe 3.3.9',
		'Snowman 2.1.1',
		'SugarCube 2.37.3'
	];
	const linkSource = (format: string) =>
		format.startsWith('Chapbook')
			? "Start passage. {link to: 'Next', label: 'Continue'}"
			: 'Start passage. [[Continue->Next]]';
	let running: RunningApp | undefined;

	try {
		running = await launchPackagedApp(executablePath, 'format-passage');
		const {page} = running;

		for (const format of formats) {
			const storyName = `Passage Detection ${format}`;
			const marker = `Next passage marker for ${format}.`;

			await createProject(page, {format, name: storyName});
			await createPassage(page, 'Next', marker);
			await selectPassage(page, 'Start');
			await replaceEditorText(page, linkSource(format));
			const preview = await launchPreview(running, () =>
				page.getByTitle('Play').click()
			);

			await expect(preview.getByText('Play', {exact: true})).toBeVisible();
			await expect(preview.getByText(storyName, {exact: true})).toBeVisible();
			await expectCurrentPassage(preview, 'Start');
			await storyFrame(preview).getByText('Continue', {exact: true}).click();
			await expectRenderedText(preview, marker);
			await expectCurrentPassage(preview, 'Next');
			await preview.close();
		}
	} finally {
		await running?.app.close();
	}
});
