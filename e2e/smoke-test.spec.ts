import {expect, Locator, Page, test} from '@playwright/test';

const appUrl = 'http://127.0.0.1:5173';

test.describe.configure({mode: 'serial'});

async function resetBrowserState(page: Page) {
	await page.goto(`${appUrl}/#/`);
	await page.evaluate(() => window.localStorage.clear());
	await page.reload();
}

async function createProject(
	page: Page,
	name = 'E2E Test Story',
	startPassage = 'Start'
) {
	await page.goto(`${appUrl}/#/new-project`);
	await expect(page).toHaveURL(/#\/new-project$/);
	await expect(page.getByRole('heading', {name: 'New Project'})).toBeVisible();
	await page.getByLabel('Project name').fill(name);
	await page.getByLabel('Start passage').fill(startPassage);
	await page
		.locator('label')
		.filter({hasText: 'Initial mode'})
		.getByRole('tab')
		.filter({hasText: 'Text'})
		.click();
	await page.getByRole('button', {name: 'Create Project'}).click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
	await expect(page.getByRole('heading', {name: startPassage})).toBeVisible();
}

function sourceEditor(page: Page): Locator {
	return page.locator('[data-testid^="story-text-source-editor-"]').first();
}

async function setPassageText(page: Page, text: string) {
	const editor = sourceEditor(page);

	await expect(editor).toBeVisible();
	await editor.locator('.cm-content').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.insertText(text);
	await expect(editor).toContainText(text);
	await page.waitForTimeout(450);
}

test.beforeEach(async ({page}) => {
	await resetBrowserState(page);
});

test('opens the current project launcher on first run', async ({page}) => {
	await expect(page.getByLabel('Twine')).toBeVisible();
	await expect(page.getByRole('heading', {name: 'No projects yet'})).toBeVisible();
	await expect(
		page
			.getByLabel('Project actions')
			.getByRole('button', {name: 'New Project'})
	).toBeVisible();
});

test('creates a project from the D-series launcher flow', async ({page}) => {
	await createProject(page, 'Create project smoke');
	await expect(page).toHaveTitle('Create project smoke');

	await page.goto(`${appUrl}/#/`);
	await expect(page.getByText('Create project smoke').first()).toBeVisible();

	await page.reload();
	await expect(page.getByText('Create project smoke').first()).toBeVisible();
});

test('persists embedded source-editor passage edits', async ({page}) => {
	await createProject(page, 'Edit passage smoke');
	await setPassageText(page, 'Smoke text survives a reload.');

	await page.reload();
	await expect(sourceEditor(page)).toContainText('Smoke text survives a reload.');
});

test('publishes the current project to a playable page', async ({context, page}) => {
	await createProject(page, 'Publish smoke');
	await setPassageText(page, 'Smoke story is playable.');

	const [publishedPage] = await Promise.all([
		context.waitForEvent('page'),
		page.getByTitle('Play').click()
	]);

	await expect(
		publishedPage.locator(':visible:text-is("Smoke story is playable.")')
	).toBeVisible();
	await publishedPage.close();
});
