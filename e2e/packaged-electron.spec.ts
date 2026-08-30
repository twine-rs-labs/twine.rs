import {expect, test, type TestInfo} from '@playwright/test';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
	_electron as electron,
	chromium,
	ElectronApplication,
	Page
} from 'playwright';
import type {Dirent} from 'node:fs';
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	open,
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
import extractZip from 'extract-zip';
import {
	environmentForPackagedElectronWindowMode,
	resolvePackagedElectronWindowMode,
	windowModeForTest
} from './packaged-electron-window-mode.mjs';

type DialogState = {
	calls: Array<{properties?: string[]; title?: string}>;
	responses: Array<{canceled: boolean; filePaths: string[]}>;
};

type RunningPackagedApp = {
	app: ElectronApplication;
	mainProcessLogs: string[];
	page: Page;
	rendererLogs: string[];
};

const packagedAppCloseTimeoutMs = 30_000;
const packagedAppCleanupTimeoutMs = 10_000;

function waitForCompletedDownload(app: ElectronApplication, savePath: string) {
	return app.evaluate(
		({session}, downloadPath) =>
			new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error('Electron download did not complete in 30s.')),
					30_000
				);
				session.defaultSession.once('will-download', (_event, item) => {
					item.setSavePath(downloadPath);
					item.once('done', (_downloadEvent, state) => {
						clearTimeout(timeout);
						if (state === 'completed') {
							resolve();
						} else {
							reject(new Error(`Electron download ended in state ${state}.`));
						}
					});
				});
			}),
		savePath
	);
}

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
	twinePerformance?: {
		snapshot(): Promise<unknown>;
	};
	twinePerformanceNative?: {
		reconcileProjectSession(rootPath: string): Promise<unknown>;
	};
	twineElectron?: {
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
	const environment = {
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

	return environmentForPackagedElectronWindowMode(
		windowModeForTest(
			resolvePackagedElectronWindowMode(process.env),
			test.info().tags
		),
		environment
	);
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

function appendMainProcessLog(
	logs: string[],
	channel: string,
	message: string
) {
	for (const line of message.split(/\r?\n/).filter(Boolean)) {
		logs.push(`${channel}: ${line}`);
	}
	if (logs.length > 500) {
		logs.splice(0, logs.length - 500);
	}
}

function packagedAppShutdownError(error: unknown) {
	return {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined
	};
}

async function attachPackagedAppShutdownDiagnostics(
	testInfo: TestInfo,
	running: RunningPackagedApp,
	error: unknown
) {
	const process = running.app.process();
	const pages = running.app.windows().map(page => ({
		closed: page.isClosed(),
		url: page.isClosed() ? undefined : page.url()
	}));
	const diagnostics = {
		error: packagedAppShutdownError(error),
		mainProcessLogs: running.mainProcessLogs,
		pages,
		process: {
			connected: process.connected,
			exitCode: process.exitCode,
			killed: process.killed,
			pid: process.pid,
			signalCode: process.signalCode
		},
		rendererLogs: running.rendererLogs
	};

	console.error(
		'Packaged app shutdown diagnostics:',
		JSON.stringify(
			{
				...diagnostics,
				mainProcessLogs: diagnostics.mainProcessLogs.slice(-50),
				rendererLogs: diagnostics.rendererLogs.slice(-50)
			},
			null,
			2
		)
	);

	await testInfo.attach('packaged-app-shutdown-diagnostics', {
		body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
		contentType: 'application/json'
	});
}

async function waitForPackagedAppClose(
	running: RunningPackagedApp,
	timeout: number
) {
	await running.app.waitForEvent('close', {timeout});
}

async function withPackagedAppTimeout<T>(
	operation: Promise<T>,
	timeout: number,
	message: string
) {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) => {
				timeoutId = setTimeout(() => reject(new Error(message)), timeout);
			})
		]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

async function waitForChildProcessExit(
	process: ReturnType<ElectronApplication['process']>,
	timeout: number
) {
	if (process.exitCode !== null || process.signalCode !== null) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			process.off('exit', onExit);
			reject(
				new Error(
					`Electron child process did not exit within ${timeout} ms after cleanup.`
				)
			);
		}, timeout);
		const onExit = () => {
			clearTimeout(timeoutId);
			resolve();
		};

		process.once('exit', onExit);
	});
}

function forceKillPackagedAppProcessTree(
	childProcess: ReturnType<ElectronApplication['process']>
) {
	const pid = childProcess.pid;

	if (!pid) {
		return Promise.reject(
			new Error('Electron child process has no PID for forced cleanup.')
		);
	}
	if (process.platform === 'win32') {
		return new Promise<void>((resolve, reject) => {
			execFile(
				'taskkill',
				['/PID', String(pid), '/T', '/F'],
				{timeout: packagedAppCleanupTimeoutMs, windowsHide: true},
				error => {
					if (
						error &&
						childProcess.exitCode === null &&
						childProcess.signalCode === null
					) {
						reject(error);
					} else {
						resolve();
					}
				}
			);
		});
	}

	try {
		process.kill(-pid, 'SIGKILL');
		return Promise.resolve();
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ESRCH'
		) {
			return Promise.resolve();
		}

		return Promise.reject(error);
	}
}

async function closePackagedAppForTest(
	running: RunningPackagedApp,
	testInfo: TestInfo
) {
	try {
		await withPackagedAppTimeout(
			running.app.close(),
			packagedAppCloseTimeoutMs,
			`Electron app.close() did not finish within ${packagedAppCloseTimeoutMs} ms.`
		);
	} catch (error) {
		await attachPackagedAppShutdownDiagnostics(testInfo, running, error);
		throw error;
	}
}

async function closePackagedWindowAndWaitForApp(
	running: RunningPackagedApp,
	testInfo: TestInfo
) {
	try {
		const appClosed = waitForPackagedAppClose(
			running,
			packagedAppCloseTimeoutMs
		);

		await withPackagedAppTimeout(
			Promise.all([
				running.app.evaluate(({BrowserWindow}) => {
					BrowserWindow.getAllWindows()[0]?.close();
				}),
				appClosed
			]),
			packagedAppCloseTimeoutMs,
			`Electron window close did not finish within ${packagedAppCloseTimeoutMs} ms.`
		);
	} catch (error) {
		await attachPackagedAppShutdownDiagnostics(testInfo, running, error);
		throw error;
	}
}

async function cleanupPackagedApp(running: RunningPackagedApp) {
	try {
		await withPackagedAppTimeout(
			running.app.close(),
			packagedAppCleanupTimeoutMs,
			`Electron app cleanup did not finish within ${packagedAppCleanupTimeoutMs} ms.`
		);
		return;
	} catch {
		const process = running.app.process();

		if (process.exitCode === null && process.signalCode === null) {
			const appClosed = waitForPackagedAppClose(
				running,
				packagedAppCleanupTimeoutMs
			);
			const processExited = waitForChildProcessExit(
				process,
				packagedAppCleanupTimeoutMs
			);
			const shutdownObserved = Promise.allSettled([appClosed, processExited]);
			let killError: unknown;

			console.warn(
				`Force-killing Electron process tree ${process.pid ?? 'unknown'} after graceful test cleanup timed out.`
			);
			try {
				await forceKillPackagedAppProcessTree(process);
			} catch (error) {
				killError = error;
			}
			await shutdownObserved;

			if (
				killError &&
				process.exitCode === null &&
				process.signalCode === null
			) {
				throw killError;
			}
		}

		if (process.exitCode === null && process.signalCode === null) {
			throw new Error(
				`Electron process ${process.pid ?? 'unknown'} remained alive after forced test cleanup.`
			);
		}
	}
}

async function launchPackagedApp(
	executablePath: string,
	profileRoot: string,
	sharedMainProcessLogs?: string[]
): Promise<RunningPackagedApp> {
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
	const mainProcessLogs = sharedMainProcessLogs ?? [];

	app.on('console', message =>
		appendMainProcessLog(
			mainProcessLogs,
			`console ${message.type()}`,
			message.text()
		)
	);
	app
		.process()
		.stdout?.on('data', (chunk: Buffer | string) =>
			appendMainProcessLog(mainProcessLogs, 'stdout', String(chunk))
		);
	app
		.process()
		.stderr?.on('data', (chunk: Buffer | string) =>
			appendMainProcessLog(mainProcessLogs, 'stderr', String(chunk))
		);
	const page = await app.firstWindow();
	const rendererLogs: string[] = [];

	page.on('console', message =>
		appendMainProcessLog(
			rendererLogs,
			`console ${message.type()}`,
			message.text()
		)
	);
	page.on('pageerror', error =>
		appendMainProcessLog(rendererLogs, 'pageerror', error.message)
	);

	await page.waitForLoadState('domcontentloaded');
	await expect(page.getByLabel('twine.rs')).toBeVisible();
	return {app, mainProcessLogs, page, rendererLogs};
}

function sourceEditor(page: Page) {
	return page.locator('[data-testid^="story-editor-window-"]').first();
}

function legacyStoryHtml(name: string, ifid: string, body: string) {
	return [
		`<tw-storydata name="${name}" startnode="1"`,
		' creator="Twine" creator-version="2.12.0"',
		' format="Harlowe" format-version="3.3.9"',
		` ifid="${ifid}">`,
		'<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style>',
		'<script role="script" id="twine-user-script" type="text/twine-javascript"></script>',
		'<tw-passagedata pid="1" name="Start" tags="" position="100,100" size="100,100">',
		body,
		'</tw-passagedata></tw-storydata>'
	].join('');
}

function tabWithText(page: Page, text: string) {
	return page.getByRole('tab').filter({hasText: new RegExp(`^${text}$`)});
}

function comparableProjectRoot(rootPath: string) {
	const normalized = path.normalize(rootPath);

	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function canonicalProjectRoot(rootPath: string) {
	return comparableProjectRoot(await realpath(rootPath));
}

async function launcherProjectRows(page: Page) {
	const rows = page.getByTestId('story-list-row');
	const entries = await rows.evaluateAll(elements =>
		elements.map((element, index) => {
			const storyId = element.getAttribute('data-id');
			const metadataSource = storyId
				? window.localStorage.getItem(`twine-rs-project-metadata-${storyId}`)
				: null;
			let rootPath: string | undefined;

			try {
				const metadata = metadataSource
					? JSON.parse(metadataSource)
					: undefined;

				if (typeof metadata?.rootPath === 'string') {
					rootPath = metadata.rootPath;
				}
			} catch {
				// Leave malformed metadata visible in the returned diagnostics.
			}

			return {
				index,
				rootPath,
				storyId,
				text: element.textContent?.trim() ?? ''
			};
		})
	);

	return Promise.all(
		entries.map(async entry => ({
			...entry,
			canonicalRoot: entry.rootPath
				? await canonicalProjectRoot(entry.rootPath).catch(() => undefined)
				: undefined
		}))
	);
}

async function launcherProjectRowForRoot(page: Page, rootPath: string) {
	const canonicalRoot = await canonicalProjectRoot(rootPath);
	let observedRows: Awaited<ReturnType<typeof launcherProjectRows>> = [];

	try {
		await expect
			.poll(
				async () => {
					observedRows = await launcherProjectRows(page);
					return observedRows.filter(
						entry => entry.canonicalRoot === canonicalRoot
					).length;
				},
				{
					message: `Expected exactly one launcher row for ${rootPath}`,
					timeout: 30_000
				}
			)
			.toBe(1);
	} catch (error) {
		observedRows = await launcherProjectRows(page).catch(() => observedRows);
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}
Expected canonical project root: ${canonicalRoot}
Launcher rows: ${JSON.stringify(observedRows, null, 2)}`
		);
	}
	const [match] = observedRows.filter(
		entry => entry.canonicalRoot === canonicalRoot
	);

	if (!match?.storyId || !match.rootPath) {
		throw new Error(
			`Launcher row for ${rootPath} has incomplete identity metadata: ${JSON.stringify(
				await launcherProjectRows(page)
			)}`
		);
	}

	return {
		rootPath: match.rootPath,
		row: page.locator(
			`[data-testid="story-list-row"][data-id="${match.storyId}"]`
		),
		storyId: match.storyId
	};
}

async function projectLibraryIndexSnapshot(profileRoot: string) {
	const libraryRoot = path.join(profileRoot, 'library');
	const indexPath = path.join(libraryRoot, '.twine', 'native-projects.json');

	try {
		const source = await readFile(indexPath, 'utf8');
		const index = JSON.parse(source) as {
			projects?: Array<{
				rootPath?: unknown;
				storyIds?: unknown;
				updatedAt?: unknown;
			}>;
			version?: unknown;
		};
		const projects = await Promise.all(
			(index.projects ?? []).map(async project => {
				const rootPath =
					typeof project.rootPath === 'string'
						? project.rootPath
						: String(project.rootPath);
				const absoluteRoot = path.isAbsolute(rootPath)
					? rootPath
					: path.resolve(libraryRoot, rootPath);

				try {
					return {
						...project,
						absoluteRoot,
						canonicalRoot: await canonicalProjectRoot(absoluteRoot),
						rootPath
					};
				} catch (error) {
					return {
						...project,
						absoluteRoot,
						canonicalRoot: undefined,
						resolutionError:
							error instanceof Error ? error.message : String(error),
						rootPath
					};
				}
			})
		);

		return {indexPath, projects, source, version: index.version};
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : String(error),
			indexPath,
			projects: []
		};
	}
}

async function expectProjectLibraryIndexRoots(
	profileRoot: string,
	expectedRoots: string[],
	checkpoint: string
) {
	const expectedCanonicalRoots = (
		await Promise.all(expectedRoots.map(canonicalProjectRoot))
	).sort();
	const snapshot = await projectLibraryIndexSnapshot(profileRoot);
	const actualCanonicalRoots = snapshot.projects
		.flatMap(project =>
			typeof project.canonicalRoot === 'string' ? [project.canonicalRoot] : []
		)
		.sort();

	expect(
		actualCanonicalRoots,
		`Project library index mismatch ${checkpoint}
Expected canonical roots: ${JSON.stringify(expectedCanonicalRoots, null, 2)}
Index snapshot: ${JSON.stringify(snapshot, null, 2)}`
	).toEqual(expectedCanonicalRoots);
}

async function packagedProjectLibraryTree(profileRoot: string) {
	const libraryRoot = path.join(profileRoot, 'library');

	try {
		return (await readdir(libraryRoot, {recursive: true})).map(String).sort();
	} catch (error) {
		return [
			`Could not list ${libraryRoot}: ${
				error instanceof Error ? error.message : String(error)
			}`
		];
	}
}

async function attachDuplicateProjectDiagnostics(
	testInfo: TestInfo,
	profileRoot: string,
	mainProcessLogs: string[],
	running?: RunningPackagedApp
) {
	const [index, libraryTree, launcherRows] = await Promise.all([
		projectLibraryIndexSnapshot(profileRoot),
		packagedProjectLibraryTree(profileRoot),
		running && !running.page.isClosed()
			? launcherProjectRows(running.page).catch(error => [
					{
						error: error instanceof Error ? error.message : String(error)
					}
				])
			: Promise.resolve([{error: 'No running launcher page.'}])
	]);

	await testInfo.attach('duplicate-project-diagnostics', {
		body: Buffer.from(
			JSON.stringify(
				{
					index,
					launcherRows,
					libraryTree,
					mainProcessLogs,
					rendererLogs: running?.rendererLogs ?? []
				},
				null,
				2
			)
		),
		contentType: 'application/json'
	});
}

test('packaged desktop drains a trailing legacy editor save before exit', async ({}, testInfo) => {
	const executablePath = await packagedExecutable();
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-shutdown-legacy-save-')
	);
	const storyName = 'Shutdown Legacy Save';
	const storyPath = path.join(profileRoot, 'library', `${storyName}.html`);
	let running: RunningPackagedApp | undefined;

	try {
		await prepareIsolatedEnvironment(profileRoot);
		await writeFile(
			storyPath,
			legacyStoryHtml(
				storyName,
				'11111111-2222-4333-8444-555555555555',
				'first save'
			)
		);
		running = await launchPackagedApp(executablePath, profileRoot);
		const {page} = running;
		const row = page
			.getByTestId('story-list-row')
			.filter({has: page.getByText(storyName, {exact: true})});

		await row
			.getByRole('button', {name: `Open ${storyName}`})
			.first()
			.click();
		await page
			.getByLabel('Workspace Mode')
			.getByRole('tab', {name: 'Text'})
			.click();
		await replaceEditorText(page, 'Trailing legacy editor save');
		await closePackagedWindowAndWaitForApp(running, testInfo);
		running = undefined;

		await expect(readFile(storyPath, 'utf8')).resolves.toContain(
			'Trailing legacy editor save'
		);
	} finally {
		if (running) {
			await cleanupPackagedApp(running);
		}
	}
});

test('packaged desktop drains a trailing native project save before exit', async ({}, testInfo) => {
	const executablePath = await packagedExecutable();
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-shutdown-save-')
	);
	let running: RunningPackagedApp | undefined;

	try {
		running = await launchPackagedApp(executablePath, profileRoot);
		const {page} = running;
		const windowMode = windowModeForTest(
			resolvePackagedElectronWindowMode(process.env),
			testInfo.tags
		);
		if (windowMode === 'hidden') {
			await expect
				.poll(() =>
					running.app.evaluate(({BrowserWindow}) => {
						const window = BrowserWindow.getAllWindows()[0];
						return {
							focused: window?.isFocused() ?? null,
							visible: window?.isVisible() ?? null
						};
					})
				)
				.toEqual({focused: false, visible: false});
		} else {
			await expect
				.poll(() =>
					running.app.evaluate(
						({BrowserWindow}) =>
							BrowserWindow.getAllWindows()[0]?.isVisible() ?? null
					)
				)
				.toBe(true);
		}

		await page.getByTitle('New Project').click();
		await page.getByLabel('Project name').fill('Shutdown Save');
		await tabWithText(page, 'Text').click();
		await page.getByRole('button', {name: 'Create Project'}).click();
		await expect(sourceEditor(page)).toBeVisible();
		const projectRoot = await projectRootFromRenderer(page);

		await replaceEditorText(page, 'Trailing editor save');
		await closePackagedWindowAndWaitForApp(running, testInfo);
		running = undefined;

		await expect(savedProjectSource(projectRoot)).resolves.toContain(
			'Trailing editor save'
		);
	} finally {
		if (running) {
			await cleanupPackagedApp(running);
		}
	}
});

async function replaceEditorText(page: Page, text: string) {
	const editor = sourceEditor(page);

	await expect(editor).toBeVisible();
	await editor.locator('.cm-content').focus();
	await page.keyboard.press(
		process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
	);
	await page.keyboard.insertText(text);
	await expect(editor).toContainText(text.replace(/\r?\n/g, ''));
	await page.keyboard.press('Tab');
}

test('packaged desktop duplicates a project from the launcher and preserves it across restart and source deletion', async ({}, testInfo) => {
	const executablePath = await packagedExecutable();
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-duplicate-')
	);
	const mainProcessLogs: string[] = [];
	let running: RunningPackagedApp | undefined;

	try {
		running = await launchPackagedApp(
			executablePath,
			profileRoot,
			mainProcessLogs
		);
		const {page} = running;

		await page.getByTitle('New Project').click();
		await page.getByLabel('Project name').fill('Packaged Duplicate');
		await page.getByRole('button', {name: 'Create Project'}).click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+$/);

		const sourceRoot = await projectRootFromRenderer(page);
		await expectProjectLibraryIndexRoots(
			profileRoot,
			[sourceRoot],
			'after source creation'
		);
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
		await expectProjectLibraryIndexRoots(
			profileRoot,
			[sourceRoot, duplicateRoot],
			'after duplication'
		);
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
		await expectProjectLibraryIndexRoots(
			profileRoot,
			[sourceRoot, duplicateRoot],
			'after application shutdown'
		);
		running = await launchPackagedApp(
			executablePath,
			profileRoot,
			mainProcessLogs
		);
		const relaunchedPage = running.page;
		const source = await launcherProjectRowForRoot(relaunchedPage, sourceRoot);
		const duplicate = await launcherProjectRowForRoot(
			relaunchedPage,
			duplicateRoot
		);
		const relaunchedProjects = await relaunchedPage.evaluate(
			async ({duplicateRoot, sourceRoot}) => {
				const bridge = (window as PackagedProjectWindow).twineElectron;

				if (!bridge) {
					throw new Error('Desktop project bridge is unavailable.');
				}
				const [source, duplicate] = await Promise.all([
					bridge.hydrateProjectFolder(sourceRoot),
					bridge.hydrateProjectFolder(duplicateRoot)
				]);
				const identity = (project: typeof source) => ({
					stories: project.stories.map(story => ({
						id: story.id,
						name: story.name
					})),
					storyIds: project.storyIds
				});

				return {
					duplicate: identity(duplicate),
					source: identity(source)
				};
			},
			{duplicateRoot: duplicate.rootPath, sourceRoot: source.rootPath}
		);

		expect(relaunchedProjects).toEqual({
			duplicate: {
				stories: [{id: duplicateStoryId, name: 'Packaged Duplicate 1'}],
				storyIds: [duplicateStoryId]
			},
			source: {
				stories: [{id: sourceStoryId, name: 'Packaged Duplicate'}],
				storyIds: [sourceStoryId]
			}
		});
		const sourceRow = source.row;
		const relaunchedDuplicateRow = duplicate.row;

		expect(source.storyId).toBe(sourceStoryId);
		expect(duplicate.storyId).toBe(duplicateStoryId);
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
	} catch (error) {
		await attachDuplicateProjectDiagnostics(
			testInfo,
			profileRoot,
			mainProcessLogs,
			running
		);
		throw error;
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
		const performanceHarness = (window as PackagedProjectWindow)
			.twinePerformance;
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
	running: RunningPackagedApp,
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
	running: RunningPackagedApp,
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
						const files = await readdir(passagesRoot, {recursive: true});
						const passageFile = files.find(file => file.endsWith('.twee'));

						return passageFile
							? await readFile(path.join(passagesRoot, passageFile), 'utf8')
							: '';
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
			const native = (window as PackagedProjectWindow).twinePerformanceNative;

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

test('packaged app preserves sibling stories across full save, rename, and reopen', async ({}, testInfo) => {
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
	let running: RunningPackagedApp | undefined;

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
			running,
			projectRoot,
			'Packaged save survived the native bridge.',
			testInfo
		);
		await tabWithText(page, 'Passage').click();
		await page.getByRole('button', {name: 'Rename', exact: true}).click();
		const renamePrompt = page.getByRole('dialog', {
			name: 'What should “Start” be renamed to?'
		});
		await renamePrompt.getByRole('textbox').fill('Packaged Start');
		await renamePrompt.getByRole('button', {name: 'Save'}).click();
		const renameReview = page.getByRole('dialog', {
			name: 'Review Passage Rename'
		});
		await expect(renameReview.getByText('Rename passage')).toBeVisible();
		await renameReview.getByRole('button', {name: 'Apply Rename'}).click();
		await expect(renameReview).toHaveCount(0);
		await expect(
			page.getByRole('region', {name: 'Packaged Start', exact: true})
		).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(async rootPath => {
					const bridge = (window as PackagedProjectWindow).twineElectron;

					if (!bridge) {
						throw new Error('Desktop project bridge is unavailable.');
					}
					const hydrated = await bridge.hydrateProjectFolder(rootPath);

					return hydrated.stories[0]?.passages[0]?.name;
				}, projectRoot)
			)
			.toBe('Packaged Start');

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
		const searchPanel = page.getByRole('region', {name: 'References'});

		await expect(
			searchPanel.getByRole('tab', {name: 'Find / Replace'})
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			searchPanel.getByRole('textbox', {name: 'Find'})
		).toBeVisible();

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
		await page.getByRole('button', {name: 'Create Project'}).click();
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
			running,
			singleProjectRoot,
			'Single-file save survived the native bridge.',
			testInfo
		);

		await closePackagedAppForTest(running, testInfo);
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
		if (running) {
			await cleanupPackagedApp(running);
		}
	}
});

test('packaged desktop embeds referenced media for every bundled format family', async ({}, testInfo) => {
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
	let running: RunningPackagedApp | undefined;

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
			await waitForSavedText(
				running,
				projectRoot,
				'Offline referenced media is ready.',
				testInfo
			);
			await page.getByTitle('Build & Export').click();
			await expect(page).toHaveURL(/#\/stories\/[^/]+\/build$/);
			const embedSwitch = page.getByLabel('Embed referenced media');

			await expect(
				page.getByText(
					/4 candidates · (?!0 B)\d+(?:\.\d+)? (?:B|KB|MB) estimated encoded size\./
				)
			).toBeVisible({timeout: 30_000});
			await expect(embedSwitch).toBeChecked({timeout: 30_000});

			const cleanFormatRoot = path.join(
				cleanOutputRoot,
				format.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
			);
			const outputPath = path.join(cleanFormatRoot, 'story.html');

			await mkdir(cleanFormatRoot, {recursive: true});
			const download = waitForCompletedDownload(running.app, outputPath);
			await page.getByRole('button', {name: 'Export Playable HTML'}).click();
			const buildError = page
				.getByText('Last build failed')
				.locator('..')
				.locator('.build-route__note-detail');
			try {
				await download;
			} catch (error) {
				if (await buildError.isVisible()) {
					throw new Error(
						`${format} export failed: ${await buildError.innerText()}`
					);
				}
				throw error;
			}
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

test('packaged desktop exports an asset-complete archive that plays after its source project is removed', async ({}, testInfo) => {
	test.setTimeout(5 * 60 * 1000);
	const executablePath = await packagedExecutable();
	const profileRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-package-')
	);
	const transferRoot = await mkdtemp(
		path.join(os.tmpdir(), 'twine-rs-packaged-package-transfer-')
	);
	const archivePath = path.join(transferRoot, 'offline-package.zip');
	const offlineRoot = path.join(transferRoot, 'clean-offline-machine');
	let running: RunningPackagedApp | undefined;
	let offlineBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

	try {
		running = await launchPackagedApp(executablePath, profileRoot);
		const {page} = running;

		await page.getByTitle('New Project').click();
		await expect(page).toHaveURL(/#\/new-project$/);
		await page.getByLabel('Project name').fill('Offline Package E2E');
		await page
			.locator('label')
			.filter({hasText: 'Story format'})
			.getByRole('combobox')
			.selectOption({label: 'Harlowe 3.3.9'});
		await tabWithText(page, 'Text').click();
		await page.getByRole('button', {name: 'Create Project'}).click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
		await expect(sourceEditor(page)).toBeVisible();

		const projectRoot = await projectRootFromRenderer(page);
		const expectedAssets = await importReferencedMedia(page, projectRoot);

		await replaceEditorText(page, mediaSource);
		await waitForSavedText(
			running,
			projectRoot,
			'Offline referenced media is ready.',
			testInfo
		);
		await page.getByTitle('Build & Export').click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+\/build$/);
		await page.getByText('Package (.zip)', {exact: true}).click();
		const prepare = page.getByRole('button', {name: 'Prepare Package'});

		await expect(prepare).toBeEnabled({timeout: 30_000});
		await prepare.click();
		await expect(
			page.getByRole('region', {name: 'Package review'})
		).toContainText('Complete in assessed scopes', {timeout: 30_000});
		const save = page.getByRole('button', {name: 'Save Complete Package'});

		const download = waitForCompletedDownload(running.app, archivePath);
		await save.click();
		await download;

		await running.app.close();
		running = undefined;
		await rm(projectRoot, {force: true, recursive: true});
		await mkdir(offlineRoot);
		await extractZip(archivePath, {dir: offlineRoot});

		const manifest = JSON.parse(
			await readFile(
				path.join(offlineRoot, '_twine-package', 'manifest.json'),
				'utf8'
			)
		) as {
			assets: Array<{
				archivePath?: string;
				sha256?: string;
				sizeBytes?: number;
				status: string;
			}>;
			completeness: {
				projectAssetBytes: string;
				staticRuntimeDependencies: string;
			};
		};

		expect(manifest.completeness).toMatchObject({
			projectAssetBytes: 'complete',
			staticRuntimeDependencies: 'complete'
		});
		for (const [name, expected] of expectedAssets) {
			const packaged = await readFile(path.join(offlineRoot, 'assets', name));
			const record = manifest.assets.find(
				asset => asset.archivePath === `assets/${name}`
			);

			expect(packaged.equals(expected)).toBe(true);
			expect(record).toMatchObject({
				sha256: createHash('sha256').update(expected).digest('hex'),
				sizeBytes: expected.length,
				status: 'included'
			});
		}

		offlineBrowser = await chromium.launch();
		const offlinePage = await offlineBrowser.newPage();
		const requestedUrls: string[] = [];

		offlinePage.on('request', request => requestedUrls.push(request.url()));
		await offlinePage.route(/^https?:\/\//, route => route.abort());
		await offlinePage.goto(
			pathToFileURL(path.join(offlineRoot, 'Offline Package E2E.html')).href
		);
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
		).toContain('assets/poster.png');
		expect(
			await offlinePage
				.locator('#css-media')
				.evaluate(element => getComputedStyle(element).backgroundImage)
		).toContain('back%20drop.png');
		expect(
			requestedUrls.every(url =>
				url.startsWith(pathToFileURL(`${offlineRoot}${path.sep}`).href)
			)
		).toBe(true);
	} finally {
		await offlineBrowser?.close();
		await running?.app.close();
		await rm(profileRoot, {force: true, recursive: true});
		await rm(transferRoot, {force: true, recursive: true});
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
