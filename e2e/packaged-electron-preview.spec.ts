import {expect, Locator, Page, test, type TestInfo} from '@playwright/test';
import {
	_electron as electron,
	ElectronApplication,
	FrameLocator
} from 'playwright';
import type {Dirent} from 'node:fs';
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type RunningApp = {
	app: ElectronApplication;
	mainProcessLogs: string[];
	page: Page;
	profileRoot: string;
	rendererLogs: string[];
};

interface PreviewTestWindow extends Window {
	twinePerformance?: {
		snapshot(): Promise<unknown>;
	};
	twinePerformanceNative?: {
		reconcileProjectSession(rootPath: string): Promise<unknown>;
	};
	twineElectron?: {
		hydrateProjectFolder(rootPath: string): Promise<{
			stories: Array<{
				id: string;
				name: string;
				startPassage?: string;
			}>;
		}>;
	};
	twineStoryPreview?: {
		beginClearState(generation: number): Promise<{
			generation: number;
			operationId: string;
			url: string;
		}>;
		command(command: {generation: number; type: 'revealSource'}): Promise<{
			command: 'revealSource';
			generation: number;
			message?: string;
			status: 'busy' | 'error' | 'success';
		}>;
		getInitialState(): Promise<{
			descriptor: {generation: number};
			url: string;
		}>;
		onCommandResult(
			callback: (result: {
				command: 'revealSource';
				generation: number;
				message?: string;
				status: 'error' | 'success';
			}) => void
		): () => void;
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

function appendDiagnosticLog(logs: string[], channel: string, message: string) {
	for (const line of message.split(/\r?\n/).filter(Boolean)) {
		logs.push(`${channel}: ${line}`);
	}
	if (logs.length > 500) {
		logs.splice(0, logs.length - 500);
	}
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
	const mainProcessLogs: string[] = [];

	app.on('console', message =>
		appendDiagnosticLog(
			mainProcessLogs,
			`console ${message.type()}`,
			message.text()
		)
	);
	app
		.process()
		.stdout?.on('data', (chunk: Buffer | string) =>
			appendDiagnosticLog(mainProcessLogs, 'stdout', String(chunk))
		);
	app
		.process()
		.stderr?.on('data', (chunk: Buffer | string) =>
			appendDiagnosticLog(mainProcessLogs, 'stderr', String(chunk))
		);
	const page = await app.firstWindow();
	const rendererLogs: string[] = [];

	page.on('console', message =>
		appendDiagnosticLog(
			rendererLogs,
			`console ${message.type()}`,
			message.text()
		)
	);
	page.on('pageerror', error =>
		appendDiagnosticLog(rendererLogs, 'pageerror', error.message)
	);

	await page.waitForLoadState('domcontentloaded');
	await expect(page.getByLabel('twine.rs')).toBeVisible();
	return {app, mainProcessLogs, page, profileRoot, rendererLogs};
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

async function reloadDuringPendingClearStateBegin(preview: Page) {
	await preview.evaluate(async () => {
		const api = (window as PreviewTestWindow).twineStoryPreview;

		if (!api) {
			throw new Error('The preview bridge is unavailable.');
		}
		const initial = await api.getInitialState();

		void api
			.beginClearState(initial.descriptor.generation)
			.catch(() => undefined);
		// IPC invokes from this renderer are ordered. Once this response arrives,
		// main has entered the preceding begin handler and acquired its lock.
		await api.getInitialState();
	});
	await preview.reload({waitUntil: 'domcontentloaded'});
	await expect(preview.locator('.story-preview-route')).toBeVisible();
}

async function reloadDuringPendingClearStateAcknowledgement(preview: Page) {
	await preview.evaluate(async selector => {
		const api = (window as PreviewTestWindow).twineStoryPreview;
		const frame = document.querySelector(selector);

		if (!api || !frame) {
			throw new Error('The preview bridge or story frame is unavailable.');
		}
		const initial = await api.getInitialState();
		const beginning = api.beginClearState(initial.descriptor.generation);

		frame.remove();
		await beginning;
	}, activeStoryIframeSelector);
	await preview.reload({waitUntil: 'domcontentloaded'});
	await expect(preview.locator('.story-preview-route')).toBeVisible();
}

async function revealSourceThroughPreviewBridge(preview: Page) {
	return preview.evaluate(async () => {
		const api = (window as PreviewTestWindow).twineStoryPreview;

		if (!api) {
			throw new Error('The preview bridge is unavailable.');
		}
		const initial = await api.getInitialState();

		return new Promise<{message?: string; status: 'error' | 'success'}>(
			(resolve, reject) => {
				const timeout = setTimeout(() => {
					unsubscribe();
					reject(new Error('The preview command did not complete in time.'));
				}, 5000);
				const unsubscribe = api.onCommandResult(result => {
					if (
						result.command !== 'revealSource' ||
						result.generation !== initial.descriptor.generation
					) {
						return;
					}

					clearTimeout(timeout);
					unsubscribe();
					resolve({message: result.message, status: result.status});
				});

				void api
					.command({
						generation: initial.descriptor.generation,
						type: 'revealSource'
					})
					.then(result => {
						if (result.status === 'busy') {
							return;
						}

						clearTimeout(timeout);
						unsubscribe();
						resolve({message: result.message, status: result.status});
					})
					.catch(error => {
						clearTimeout(timeout);
						unsubscribe();
						reject(error);
					});
			}
		);
	});
}

async function expectManagedStoryTransition(
	preview: Page,
	context: string,
	transition: () => Promise<void>
) {
	const expectNoManagedStoryErrors = async () => {
		await expect(
			preview.locator('.story-preview-route__latest-log[data-level="error"]')
		).toHaveCount(0, {timeout: 2_000});
		await expect(
			storyFrame(preview).locator('error-handler.active')
		).toHaveCount(0, {timeout: 2_000});
	};

	try {
		await expectNoManagedStoryErrors();
		await transition();
		await expectNoManagedStoryErrors();
	} catch (error) {
		const [runtimeLogs, activeErrors] = await Promise.all([
			preview
				.locator('.story-preview-route__latest-log')
				.allTextContents()
				.catch(() => []),
			storyFrame(preview)
				.locator('error-handler.active')
				.allTextContents()
				.catch(() => [])
		]);

		throw new Error(
			`${error instanceof Error ? error.message : String(error)}
Managed preview context: ${context}
Runtime logs: ${runtimeLogs.length > 0 ? runtimeLogs.join(' | ') : '(none)'}
Active format errors: ${
				activeErrors.length > 0 ? activeErrors.join(' | ') : '(none)'
			}`
		);
	}
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
	await editor.locator('.cm-content').focus();
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
	const passageTab = page.getByRole('tab', {name: 'Passage', exact: true});

	if ((await passageTab.getAttribute('aria-selected')) !== 'true') {
		await passageTab.click();
	}
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

const projectSaveDiagnosticEntryLimit = 200;
const projectSaveDiagnosticErrorLimit = 20;
const projectSaveDiagnosticFileLimit = 80;
const projectSaveDiagnosticFilePreviewBytes = 8 * 1024;
const projectSaveDiagnosticTotalPreviewBytes = 64 * 1024;
const projectSaveDiagnosticTimeoutMs = 5_000;
const projectSessionReviewStabilityMs = 2_500;

function projectSaveDiagnosticError(error: unknown) {
	return {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined
	};
}

async function expectNoProjectSessionReview(page: Page) {
	const reviewText = await page.evaluate(async stabilityMs => {
		const currentReview = () =>
			document.querySelector<HTMLElement>('.project-session-sync');
		const initialReview = currentReview();

		if (initialReview) {
			return initialReview.textContent?.trim() ?? '';
		}

		return new Promise<string | undefined>(resolve => {
			const observer = new MutationObserver(() => {
				const review = currentReview();

				if (review) {
					window.clearTimeout(timeout);
					observer.disconnect();
					resolve(review.textContent?.trim() ?? '');
				}
			});
			const timeout = window.setTimeout(() => {
				observer.disconnect();
				resolve(undefined);
			}, stabilityMs);

			observer.observe(document.documentElement, {
				childList: true,
				subtree: true
			});
		});
	}, projectSessionReviewStabilityMs);

	expect(
		reviewText,
		'A project session review appeared after the native save completed.'
	).toBeUndefined();
}

async function withProjectSaveDiagnosticTimeout<T>(
	label: string,
	operation: () => Promise<T>
): Promise<T | {error: ReturnType<typeof projectSaveDiagnosticError>}> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const operationResult = Promise.resolve()
		.then(operation)
		.catch(error => ({error: projectSaveDiagnosticError(error)}));
	const timeoutResult = new Promise<{
		error: ReturnType<typeof projectSaveDiagnosticError>;
	}>(resolve => {
		timeoutId = setTimeout(() => {
			resolve({
				error: projectSaveDiagnosticError(
					new Error(
						`${label} timed out after ${projectSaveDiagnosticTimeoutMs} ms.`
					)
				)
			});
		}, projectSaveDiagnosticTimeoutMs);
	});

	try {
		return await Promise.race([operationResult, timeoutResult]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

function isProjectSaveDiagnosticPath(relativePath: string) {
	return (
		relativePath === 'twine.toml' ||
		relativePath.endsWith('.twee') ||
		relativePath.startsWith('.twine/') ||
		/\.(?:baseline|link-probe|rollback|tmp)$/.test(relativePath)
	);
}

function shouldTraverseProjectSaveDiagnosticDirectory(relativePath: string) {
	return (
		relativePath !== 'assets' &&
		!relativePath.startsWith('assets/') &&
		relativePath !== '.twine/cache' &&
		!relativePath.startsWith('.twine/cache/')
	);
}

async function projectSaveFilesystemSnapshot(projectRoot: string) {
	const directories = [{absolutePath: projectRoot, relativePath: ''}];
	const errors: Array<{message: string; path: string}> = [];
	const files: Array<Record<string, unknown>> = [];
	let inspectedBytes = 0;
	let traversedEntries = 0;
	let truncated = false;
	const recordError = (relativePath: string, error: unknown) => {
		if (errors.length < projectSaveDiagnosticErrorLimit) {
			errors.push({
				message: error instanceof Error ? error.message : String(error),
				path: relativePath
			});
		} else {
			truncated = true;
		}
	};

	traversal: while (directories.length > 0) {
		const directory = directories.shift()!;
		let entries: Dirent[];

		try {
			entries = await readdir(directory.absolutePath, {withFileTypes: true});
		} catch (error) {
			recordError(directory.relativePath || '.', error);
			continue;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name));

		for (const entry of entries) {
			traversedEntries++;
			if (traversedEntries > projectSaveDiagnosticEntryLimit) {
				truncated = true;
				break traversal;
			}
			const relativePath = directory.relativePath
				? `${directory.relativePath}/${entry.name}`
				: entry.name;
			const absolutePath = path.join(directory.absolutePath, entry.name);

			if (entry.isDirectory()) {
				if (shouldTraverseProjectSaveDiagnosticDirectory(relativePath)) {
					directories.push({absolutePath, relativePath});
				}
				continue;
			}
			if (!isProjectSaveDiagnosticPath(relativePath)) {
				continue;
			}
			if (files.length >= projectSaveDiagnosticFileLimit) {
				truncated = true;
				continue;
			}

			const file: Record<string, unknown> = {
				path: relativePath,
				type: entry.isFile()
					? 'file'
					: entry.isSymbolicLink()
						? 'symlink'
						: 'other'
			};

			try {
				const stats = await lstat(absolutePath);

				file.mtimeMs = stats.mtimeMs;
				file.sizeBytes = stats.size;
				if (stats.isFile()) {
					const remainingBytes =
						projectSaveDiagnosticTotalPreviewBytes - inspectedBytes;
					const previewBytes = Math.min(
						stats.size,
						projectSaveDiagnosticFilePreviewBytes,
						remainingBytes
					);

					if (previewBytes > 0) {
						let handle: Awaited<ReturnType<typeof open>> | undefined;

						try {
							handle = await open(absolutePath, 'r');
							const buffer = Buffer.alloc(previewBytes);
							const {bytesRead} = await handle.read(
								buffer,
								0,
								buffer.length,
								0
							);

							inspectedBytes += bytesRead;
							file.inspectedBytes = bytesRead;
							file.sourcePreview = buffer
								.subarray(0, bytesRead)
								.toString('utf8');
							file.sourceTruncated = stats.size > bytesRead;
						} catch (error) {
							recordError(relativePath, error);
						} finally {
							await handle?.close().catch(() => undefined);
						}
					}
				}
			} catch (error) {
				recordError(relativePath, error);
			}
			files.push(file);
		}
	}

	if (directories.length > 0) {
		truncated = true;
	}

	return {
		errors,
		files,
		inspectedBytes,
		traversedEntries,
		truncated
	};
}

async function rendererProjectSaveDiagnostics(page: Page) {
	if (page.isClosed()) {
		return {error: 'Renderer page is closed.'};
	}

	return page.evaluate(async () => {
		const saveStatus = document.querySelector<HTMLElement>(
			'.app-shell__status-save'
		);
		const projectSessionReviews = Array.from(
			document.querySelectorAll<HTMLElement>('.project-session-sync')
		);
		const performanceHarness = (window as PreviewTestWindow).twinePerformance;
		let performanceSnapshot:
			| {
					main?: unknown;
					rendererEvents?: unknown[];
			  }
			| {error: string}
			| undefined;

		if (performanceHarness) {
			try {
				const snapshot = (await performanceHarness.snapshot()) as {
					main?: unknown;
					renderer?: {events?: unknown[]};
				};
				const events = Array.isArray(snapshot.renderer?.events)
					? snapshot.renderer.events
					: [];

				performanceSnapshot = {
					main: snapshot.main,
					rendererEvents: events
						.filter(event => {
							const name =
								typeof event === 'object' &&
								event !== null &&
								'name' in event &&
								typeof event.name === 'string'
									? event.name
									: '';

							return /baseline|patch|persist|save|session|watcher/i.test(name);
						})
						.slice(-100)
				};
			} catch (error) {
				performanceSnapshot = {
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}

		return {
			location: window.location.href,
			performance: performanceSnapshot ?? {
				error: 'Performance harness is unavailable.'
			},
			projectSessionReviews: {
				count: projectSessionReviews.length,
				text: projectSessionReviews.map(
					review => review.textContent?.trim() ?? ''
				)
			},
			saveStatus: saveStatus
				? {
						text: saveStatus.textContent?.trim() ?? '',
						title: saveStatus.getAttribute('title')
					}
				: undefined
		};
	});
}

async function attachProjectSaveDiagnostics(
	running: RunningApp,
	projectRoot: string,
	expected: string,
	failure: unknown,
	testInfo: TestInfo
) {
	const [filesystem, renderer] = await Promise.all([
		withProjectSaveDiagnosticTimeout('Filesystem snapshot', () =>
			projectSaveFilesystemSnapshot(projectRoot)
		),
		withProjectSaveDiagnosticTimeout('Renderer snapshot', () =>
			rendererProjectSaveDiagnostics(running.page)
		)
	]);
	const body = JSON.stringify(
		{
			expected: {length: expected.length, text: expected},
			failure: projectSaveDiagnosticError(failure),
			filesystem,
			mainProcessLogs: running.mainProcessLogs,
			projectRoot,
			renderer,
			rendererLogs: running.rendererLogs
		},
		(_key, value) => (typeof value === 'bigint' ? value.toString() : value),
		2
	);

	const diagnosticPath = testInfo.outputPath('project-save-diagnostics.json');

	await writeFile(diagnosticPath, body, 'utf8');
	await testInfo.attach('project-save-diagnostics', {
		contentType: 'application/json',
		path: diagnosticPath
	});
}

async function waitForSavedText(
	running: RunningApp,
	projectRoot: string,
	expected: string,
	testInfo: TestInfo
) {
	try {
		await expect
			.poll(
				async () => {
					try {
						return await readFile(path.join(projectRoot, 'story.twee'), 'utf8');
					} catch {
						// Passage-file projects keep their editable prose below passages/.
					}

					const passagesRoot = path.join(projectRoot, 'passages');

					try {
						const files = (
							await readdir(passagesRoot, {recursive: true})
						).filter(file => file.endsWith('.twee'));
						const sources = await Promise.all(
							files.map(file => readFile(path.join(passagesRoot, file), 'utf8'))
						);

						return sources.join('\n');
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
							return '';
						}
						throw error;
					}
				},
				{timeout: 30_000}
			)
			.toContain(expected);
		await expect(running.page.locator('.app-shell__status-save')).toHaveText(
			'Saved',
			{timeout: 30_000}
		);
		await running.page.evaluate(async rootPath => {
			const native = (window as PreviewTestWindow).twinePerformanceNative;

			if (!native) {
				throw new Error('Performance reconciliation bridge is unavailable.');
			}
			await native.reconcileProjectSession(rootPath);
		}, projectRoot);
		// Continuously cover two 1,250 ms fallback-poll intervals so a delayed
		// self-write review cannot remain hidden by keyboard focus.
		await expectNoProjectSessionReview(running.page);
	} catch (error) {
		try {
			await attachProjectSaveDiagnostics(
				running,
				projectRoot,
				expected,
				error,
				testInfo
			);
		} catch (diagnosticError) {
			console.warn(
				`Could not attach project-save diagnostics: ${
					diagnosticError instanceof Error
						? diagnosticError.message
						: String(diagnosticError)
				}`
			);
		}
		throw error;
	}
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
	).toBeVisible({timeout: 90_000});
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

test('Play exposes debug state and replaces fresh Test builds in the same window', async ({}, testInfo) => {
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
		await waitForSavedText(
			running,
			projectRoot,
			'Next passage version one.',
			testInfo
		);
		await selectPassage(page, 'Start');
		await replaceEditorText(
			page,
			'Start passage version one. [[Continue->Next]]',
			'Start'
		);
		await waitForSavedText(
			running,
			projectRoot,
			'Start passage version one. [[Continue->Next]]',
			testInfo
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
		await expect(preview.getByText('1 link', {exact: true})).toBeVisible();
		await expect(preview.getByText('0 broken', {exact: true})).toBeVisible();
		await expect(
			preview.getByText('0 diagnostics', {exact: true})
		).toBeVisible();
		await expect(preview.getByText('0 logs', {exact: true})).toBeVisible();
		await expectRenderedText(preview, 'Start passage version one.');
		await expectCurrentPassage(preview, 'Start');

		const debuggerToggle = preview.getByRole('button', {name: 'Debugger'});
		await expect(debuggerToggle).toBeVisible();
		await debuggerToggle.click();
		const debuggerInspector = preview.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		await expect(debuggerInspector).toContainText('Format: Harlowe 3.3.9');
		await expect(debuggerInspector).toContainText('Adapter: harlowe-3.3.9');
		await expect(debuggerInspector).toContainText('Reliability: best-effort');
		await expect(
			debuggerInspector.getByRole('heading', {name: 'Current passage'})
		).toBeVisible();
		await expect(
			debuggerInspector.getByRole('heading', {name: 'Story variables'})
		).toHaveCount(0);
		const priorClipboard = await app.evaluate(({clipboard}) =>
			clipboard.readText()
		);
		try {
			await storyFrame(preview)
				.locator('body')
				.evaluate(() => {
					const originalNow = Date.now;
					try {
						Date.now = () => 0;
						console.log('play log');
						console.warn('play warning');
						console.error('play error');
					} finally {
						Date.now = originalNow;
					}
				});
			await expect(debuggerInspector).toContainText('play error');
			await expect(debuggerInspector).toContainText('play warning');
			await preview.getByRole('button', {name: 'Copy Runtime Log'}).click();
			await expect(
				debuggerInspector.getByText('Runtime log copied.')
			).toBeVisible();
			expect(await app.evaluate(({clipboard}) => clipboard.readText())).toBe(
				'[1970-01-01T00:00:00.000Z] ERROR: "play error"\n[1970-01-01T00:00:00.000Z] WARNING: "play warning"\n[1970-01-01T00:00:00.000Z] LOG: "play log"'
			);
		} finally {
			await app
				.evaluate(
					({clipboard}, value) => clipboard.writeText(value),
					priorClipboard
				)
				.catch(() => undefined);
		}
		await debuggerToggle.click();
		await expect(debuggerInspector).toHaveCount(0);

		const shellCapabilities = await preview.evaluate(() => ({
			previewBridge: Object.keys(
				(window as PreviewTestWindow).twineStoryPreview ?? {}
			).sort(),
			twineElectron: typeof (window as PreviewTestWindow).twineElectron
		}));

		expect(shellCapabilities).toEqual({
			previewBridge: [
				'beginClearState',
				'cancelClearState',
				'command',
				'completeClearState',
				'copyText',
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
			running,
			projectRoot,
			'Next passage version two, built live.',
			testInfo
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
			running,
			projectRoot,
			'Next passage version three, rebuilt fresh.',
			testInfo
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

test('Test From Here preserves the saved start and Proof uses Paperthin in the managed shell', async ({}, testInfo) => {
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
		const projectRoot = await projectRootFromRenderer(page);
		await replaceEditorText(page, 'The saved start must remain unchanged.');
		await waitForSavedText(
			running,
			projectRoot,
			'The saved start must remain unchanged.',
			testInfo
		);
		await createPassage(
			page,
			'Nonstart',
			'This is the passage-specific debug launch.'
		);
		await waitForSavedText(
			running,
			projectRoot,
			'This is the passage-specific debug launch.',
			testInfo
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

test('copied assets, storage, package origins, cleanup, and protocol lifetime stay isolated', async ({}, testInfo) => {
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
		const projectOneMarker = 'Asset preview one.';
		await replaceEditorText(
			page,
			[
				`<p class="asset-marker">${projectOneMarker}</p>`,
				'<img id="hero" src="./assets/hero.svg?cache=1">',
				'<img id="encoded" src="assets/back%20drop.svg?cache=1">',
				'<img id="root-relative" src="/assets/poster.svg">',
				'<link rel="stylesheet" href="assets/theme.css">',
				'<audio id="audio" src="assets/tone.wav" controls></audio>',
				'<video id="video" src="assets/clip.mp4" controls></video>',
				'<a id="payload" href="assets/payload.json">payload</a>'
			].join('\n')
		);
		await waitForSavedText(running, projectOneRoot, projectOneMarker, testInfo);
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
		const projectTwoMarker = 'Asset preview two.';
		await replaceEditorText(
			page,
			[
				`<p>${projectTwoMarker}</p>`,
				'<img id="hero" src="assets/hero.svg">',
				'<a href="assets/payload.json">payload</a>'
			].join('\n')
		);
		const projectTwoRoot = await projectRootFromRenderer(page);
		await waitForSavedText(running, projectTwoRoot, projectTwoMarker, testInfo);
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

		await reloadDuringPendingClearStateBegin(previewOne);
		await expectRenderedText(previewOne, 'Asset preview one.');
		await reloadDuringPendingClearStateAcknowledgement(previewOne);
		await expectRenderedText(previewOne, 'Asset preview one.');
		expect(await revealSourceThroughPreviewBridge(previewOne)).toEqual({
			message: undefined,
			status: 'success'
		});
		// Restore the second project as the editor's active context after proving
		// the recovered first preview can issue an owner command.
		expect(await revealSourceThroughPreviewBridge(previewTwo)).toEqual({
			message: undefined,
			status: 'success'
		});

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

		await storyFrame(previewOne)
			.locator('body')
			.evaluate(() => {
				sessionStorage.setItem('Saved Session', 'stale continuation');
				(
					window as typeof window & {__twineRsRestartProbe?: string}
				).__twineRsRestartProbe = 'old runtime';
			});
		await previewOne.getByRole('button', {name: 'Debugger'}).click();
		await previewOne.getByRole('button', {name: 'Restart'}).click();
		await expect
			.poll(async () => {
				try {
					return await storyFrame(previewOne)
						.locator('body')
						.evaluate(
							() =>
								(
									window as typeof window & {
										__twineRsRestartProbe?: string;
									}
								).__twineRsRestartProbe ?? 'new runtime'
						);
				} catch {
					return 'remounting';
				}
			})
			.toBe('new runtime');
		await expect(
			previewOne.getByText('Story restarted from its launch passage.', {
				exact: true
			})
		).toBeVisible();
		expect(await previewOrigin(previewOne)).toEqual(packageOne);
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(() => sessionStorage.getItem('Saved Session'))
		).not.toBe('stale continuation');
		await previewOne.getByRole('button', {name: 'Debugger'}).click();

		for (const [preview, value] of [
			[previewOne, 'one'],
			[previewTwo, 'two']
		] as const) {
			await storyFrame(preview)
				.locator('body')
				.evaluate(async (_, storedValue) => {
					sessionStorage.setItem('clear-session', storedValue);
					document.cookie = `clear-cookie=${storedValue}; path=/`;
					await new Promise<void>((resolve, reject) => {
						const request = indexedDB.open('clear-state-database', 1);

						request.onupgradeneeded = () =>
							request.result.createObjectStore('values');
						request.onerror = () => reject(request.error);
						request.onsuccess = () => {
							const transaction = request.result.transaction(
								'values',
								'readwrite'
							);

							transaction.objectStore('values').put(storedValue, 'value');
							transaction.oncomplete = () => {
								request.result.close();
								resolve();
							};
							transaction.onerror = () => reject(transaction.error);
						};
					});
					const cache = await caches.open('clear-state-cache');

					await cache.put(
						new Request('https://twine.rs.invalid/clear-state-value'),
						new Response(storedValue)
					);
				}, value);
		}
		// Electron 43 does not treat the custom preview scheme as cookieable,
		// even though it is registered as a standard secure scheme. Main still
		// retains exact-domain cookie cleanup for platform behavior changes.
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(() => document.cookie)
		).toBe('');
		expect(
			await storyFrame(previewTwo)
				.locator('body')
				.evaluate(() => document.cookie)
		).toBe('');
		await storyFrame(previewOne)
			.locator('body')
			.evaluate(() => {
				const writeLateState = () => {
					localStorage.setItem('late-clear-writer', 'should-be-cleared');
					sessionStorage.setItem('late-clear-writer', 'should-be-cleared');
				};

				addEventListener('pagehide', writeLateState);
				addEventListener('unload', writeLateState);
			});

		await previewOne.getByRole('button', {name: 'Debugger'}).click();
		await previewOne.getByRole('button', {name: 'Clear State'}).click();
		await previewOne
			.getByRole('dialog')
			.getByRole('button', {name: 'Clear State'})
			.click();
		await expectRenderedText(previewOne, 'Asset preview one.');
		await expect(
			previewOne.getByText('Story state cleared.', {exact: true})
		).toBeVisible();
		expect(await previewOrigin(previewOne)).toEqual(packageOne);
		expect(
			await storyFrame(previewOne)
				.locator('body')
				.evaluate(async () => ({
					cacheNames: await caches.keys(),
					cookies: document.cookie,
					databaseNames: (await indexedDB.databases()).map(
						database => database.name
					),
					lateLocal: localStorage.getItem('late-clear-writer'),
					lateSession: sessionStorage.getItem('late-clear-writer'),
					local: localStorage.getItem('colliding-key'),
					session: sessionStorage.getItem('clear-session')
				}))
		).toEqual({
			cacheNames: [],
			cookies: '',
			databaseNames: [],
			lateLocal: null,
			lateSession: null,
			local: null,
			session: null
		});
		expect((await previewOrigin(previewTwo)).origin).toBe(packageTwo.origin);
		expect(
			await storyFrame(previewTwo)
				.locator('body')
				.evaluate(async () => ({
					cacheNames: await caches.keys(),
					cookies: document.cookie,
					databaseNames: (await indexedDB.databases()).map(
						database => database.name
					),
					local: localStorage.getItem('colliding-key'),
					session: sessionStorage.getItem('clear-session')
				}))
		).toEqual({
			cacheNames: ['clear-state-cache'],
			cookies: '',
			databaseNames: ['clear-state-database'],
			local: 'two',
			session: 'two'
		});

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

test('packaged SugarCube debugger preserves and wraps variable whitespace', async ({}, testInfo) => {
	test.setTimeout(6 * 60 * 1000);
	const executablePath = await packagedExecutable();
	const spacedValue = `  ${Array.from(
		{length: 32},
		(_, index) => `token-${index}`
	).join('  ')}  `;
	const expectedPreview = JSON.stringify(spacedValue);
	const passageSource = `<<set $spaced = ${JSON.stringify(
		spacedValue
	)}>>Whitespace ready.`;
	let running: RunningApp | undefined;

	try {
		running = await launchPackagedApp(executablePath, 'debugger-whitespace');
		const {app, page} = running;

		await createProject(page, {
			format: 'SugarCube 2.37.3',
			name: 'Debugger Whitespace Fidelity'
		});
		const projectRoot = await projectRootFromRenderer(page);

		await replaceEditorText(page, passageSource);
		await waitForSavedText(running, projectRoot, passageSource, testInfo);
		const preview = await launchPreview(running, () =>
			page.getByTitle('Play').click()
		);

		await expectRenderedText(preview, 'Whitespace ready.');
		await preview.getByRole('button', {name: 'Debugger'}).click();
		const inspector = preview.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		const variableSection = inspector
			.getByRole('heading', {name: 'Story variables'})
			.locator('..')
			.locator('..');
		const variableRow = variableSection
			.locator('.story-preview-route__debugger-variables li')
			.filter({hasText: 'spaced'});
		const variablePreview = variableRow.locator(
			'.story-preview-route__debugger-variable-preview'
		);

		await expect(variablePreview).toHaveCount(1, {timeout: 60_000});
		await app.evaluate(
			({BrowserWindow}, target) => {
				const previewWindow = BrowserWindow.getAllWindows().find(
					candidate => candidate.webContents.getURL() === target.url
				);

				if (!previewWindow) {
					throw new Error('The debugger preview window is unavailable.');
				}
				previewWindow.setContentSize(target.width, target.height);
			},
			{height: 700, url: preview.url(), width: 520}
		);
		await expect.poll(() => preview.evaluate(() => innerWidth)).toBe(520);
		const rendered = await variablePreview.evaluate(element => {
			const range = document.createRange();
			const inspector = element.closest<HTMLElement>(
				'.story-preview-route__debugger'
			);

			range.selectNodeContents(element);
			return {
				hasHorizontalOverflow: inspector
					? inspector.scrollWidth > inspector.clientWidth
					: true,
				innerText: (element as HTMLElement).innerText,
				lineFragments: range.getClientRects().length,
				whiteSpace: getComputedStyle(element).whiteSpace
			};
		});

		expect(rendered.innerText).toBe(expectedPreview);
		expect(rendered.whiteSpace).toBe('break-spaces');
		expect(rendered.lineFragments).toBeGreaterThan(1);
		expect(rendered.hasHorizontalOverflow).toBe(false);
		await preview.close();
	} finally {
		await running?.app.close();
	}
});

test('packaged SugarCube endpoint profiles support non-start Test From Here', async ({}, testInfo) => {
	test.setTimeout(6 * 60 * 1000);
	const executablePath = await packagedExecutable();
	let running: RunningApp | undefined;

	try {
		running = await launchPackagedApp(executablePath, 'sugarcube-test-from');
		const {page} = running;

		for (const version of ['2.31.0', '2.37.3']) {
			await createProject(page, {
				format: `SugarCube ${version}`,
				name: `SugarCube Test From ${version}`,
				startPassage: 'Saved Start'
			});
			const projectRoot = await projectRootFromRenderer(page);

			await replaceEditorText(page, 'The saved start remains unchanged.');
			await waitForSavedText(
				running,
				projectRoot,
				'The saved start remains unchanged.',
				testInfo
			);
			const marker = `Non-start SugarCube ${version} launch.`;
			await createPassage(page, 'Nonstart', marker);
			await waitForSavedText(running, projectRoot, marker, testInfo);
			const savedStartBefore = await persistedStartUuid(page);
			const preview = await launchPreview(running, () =>
				page
					.getByRole('region', {name: 'Nonstart'})
					.getByRole('button', {name: 'Test From Here'})
					.click()
			);

			await expectRenderedText(preview, marker);
			await expectCurrentPassage(preview, 'Nonstart');
			await preview.getByRole('button', {name: 'Debugger'}).click();
			await expect(
				preview.getByRole('region', {name: 'Runtime debugger inspector'})
			).toContainText(`Adapter: sugarcube-${version}`);
			expect(await persistedStartUuid(page)).toBe(savedStartBefore);
			await preview.close();
		}
	} finally {
		await running?.app.close();
	}
});

test('current passage resolves to a stable ID in every bundled format family', async ({}, testInfo) => {
	test.setTimeout(8 * 60 * 1000);
	const executablePath = await packagedExecutable();
	const formats = [
		'Chapbook 2.3.1',
		'Harlowe 3.3.9',
		'Snowman 2.1.1',
		'SugarCube 2.31.0',
		'SugarCube 2.32.0',
		'SugarCube 2.33.1',
		'SugarCube 2.35.0',
		'SugarCube 2.36.0',
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
			const startSource = linkSource(format);

			await createProject(page, {format, name: storyName});
			const projectRoot = await projectRootFromRenderer(page);

			await createPassage(page, 'Next', marker);
			await waitForSavedText(running, projectRoot, marker, testInfo);
			await selectPassage(page, 'Start');
			await replaceEditorText(page, startSource);
			await waitForSavedText(running, projectRoot, startSource, testInfo);
			const preview = await launchPreview(running, () =>
				page.getByTitle('Play').click()
			);

			await expect(preview.getByText('Play', {exact: true})).toBeVisible();
			await expect(preview.getByText(storyName, {exact: true})).toBeVisible();
			await expectCurrentPassage(preview, 'Start');
			const continueLink = storyFrame(preview).getByText('Continue', {
				exact: true
			});

			await expectManagedStoryTransition(preview, format, async () => {
				await continueLink.click();
				await expectRenderedText(preview, marker);
				await expectCurrentPassage(preview, 'Next');
			});
			if (format.startsWith('SugarCube ')) {
				await preview.getByRole('button', {name: 'Debugger'}).click();
				const inspector = preview.getByRole('region', {
					name: 'Runtime debugger inspector'
				});
				const adapterId = format.replace('SugarCube ', 'sugarcube-');

				await expect(inspector).toContainText(`Adapter: ${adapterId}`);
				await inspector.getByRole('button', {name: 'Restart'}).click();
				await expect(
					preview.getByText('Story restarted from its launch passage.', {
						exact: true
					})
				).toBeVisible();
				await expectCurrentPassage(preview, 'Start');
			}
			await preview.close();
		}
	} finally {
		await running?.app.close();
	}
});
