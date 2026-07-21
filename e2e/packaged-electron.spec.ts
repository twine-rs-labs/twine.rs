import {expect, test} from '@playwright/test';
import {_electron as electron, ElectronApplication, Page} from 'playwright';
import {access, mkdir, mkdtemp, readFile, readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type DialogState = {
	calls: Array<{properties?: string[]; title?: string}>;
	responses: Array<{canceled: boolean; filePaths: string[]}>;
};

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

async function replaceEditorText(page: Page, text: string) {
	const editor = sourceEditor(page);

	await expect(editor).toBeVisible();
	await editor.locator('.cm-content').click();
	await page.keyboard.press(
		process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
	);
	await page.keyboard.insertText(text);
	await expect(editor).toContainText(text);
	await page.keyboard.press('Tab');
}

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

test('packaged app creates, saves, routes, opens dialogs, and reopens a project', async () => {
	const executablePath = await packagedExecutable();
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

		expect(await openDialogCalls(running.app)).toEqual([
			{properties: ['openDirectory'], title: 'Open Project Folder'},
			{properties: ['openDirectory'], title: 'Open Project Folder'}
		]);
	} finally {
		await running?.app.close();
	}
});
