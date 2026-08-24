import {expect, Page, test} from '@playwright/test';

const appUrl = 'http://127.0.0.1:4173';

async function installServiceWorker(page: Page) {
	await page.goto(`${appUrl}/#/`);
	await page.waitForFunction(async () => {
		const registration = await navigator.serviceWorker.ready;

		return registration.active?.state === 'activated';
	});

	if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
		await page.reload();
	}

	await expect
		.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
		.toBe(true);
}

async function cachedUrls(page: Page) {
	return page.evaluate(async () => {
		const urls: string[] = [];

		for (const cacheName of await caches.keys()) {
			const cache = await caches.open(cacheName);

			urls.push(...(await cache.keys()).map(request => request.url));
		}

		return urls;
	});
}

async function setPassageText(page: Page, text: string) {
	const editor = page.locator('[data-testid^="story-editor-window-"]').first();

	await expect(editor).toBeVisible();
	await editor.locator('.cm-content').focus();
	await page.keyboard.press(
		process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
	);
	await page.keyboard.insertText(text);
	await expect(editor).toContainText(text);
	await page.waitForTimeout(450);
}

test('a fresh install can create and test a project offline', async ({
	context,
	page
}) => {
	const failedAppRequests: string[] = [];
	const storyFormatCallbackRequests: string[] = [];
	const appOrigin = new URL(appUrl).origin;

	context.on('requestfailed', request => {
		if (new URL(request.url()).origin === appOrigin) {
			failedAppRequests.push(request.url());
		}
	});
	context.on('request', request => {
		const url = new URL(request.url());

		if (
			url.origin === appOrigin &&
			url.pathname.endsWith('/story-formats/harlowe-3.3.9/format.js') &&
			url.searchParams.get('callback') === 'storyFormat'
		) {
			storyFormatCallbackRequests.push(url.href);
		}
	});

	await installServiceWorker(page);

	const precachedUrls = await cachedUrls(page);

	expect(
		precachedUrls.some(url =>
			new URL(url).pathname.endsWith('/story-formats/harlowe-3.3.9/format.js')
		)
	).toBe(true);
	expect(
		precachedUrls.some(url => new URL(url).pathname.endsWith('.wasm'))
	).toBe(true);

	await context.setOffline(true);
	await page.goto(`${appUrl}/#/new-project`);
	await expect(page.getByRole('heading', {name: 'New Project'})).toBeVisible();
	await page.getByLabel('Project name').fill('Offline PWA test');
	await page.getByLabel('Start passage').fill('Start');
	await page
		.getByRole('tab')
		.filter({hasText: /^Text$/})
		.click();
	await page.getByRole('button', {name: 'Create Project'}).click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+$/);

	const marker = 'Fresh-install offline story format loaded.';

	await setPassageText(page, marker);

	const [testPage] = await Promise.all([
		context.waitForEvent('page'),
		page
			.getByRole('button', {name: 'Test From Here', exact: true})
			.first()
			.click()
	]);

	await expect(
		testPage
			.frameLocator('iframe[title="Story test preview"]')
			.locator('tw-passage')
	).toContainText(marker);
	await expect(
		testPage.getByText("Couldn't load story format properties")
	).toHaveCount(0);
	expect(storyFormatCallbackRequests.length).toBeGreaterThan(0);
	expect(failedAppRequests).toEqual([]);
});

test('bundled SugarCube profile endpoints retain exact admission offline', async ({
	context,
	page
}) => {
	test.setTimeout(120_000);
	await installServiceWorker(page);
	await context.setOffline(true);

	for (const version of ['2.31.0', '2.37.3']) {
		await page.goto(`${appUrl}/#/new-project`);
		await expect(
			page.getByRole('heading', {name: 'New Project'})
		).toBeVisible();
		await page.getByLabel('Project name').fill(`Offline SugarCube ${version}`);
		await page
			.locator('label')
			.filter({hasText: 'Story format'})
			.getByRole('combobox')
			.selectOption({label: `SugarCube ${version}`});
		await page
			.getByRole('tab')
			.filter({hasText: /^Text$/})
			.click();
		await page.getByRole('button', {name: 'Create Project'}).click();
		await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
		const marker = `Offline exact SugarCube ${version}.`;

		await setPassageText(
			page,
			`<<set $offline = ${JSON.stringify(version)}>>${marker}`
		);
		const [preview] = await Promise.all([
			context.waitForEvent('page'),
			page
				.getByRole('button', {name: 'Test From Here', exact: true})
				.first()
				.click()
		]);
		const storyBody = preview
			.frameLocator('iframe[title="Story test preview"]')
			.locator('body');

		await expect(storyBody).toContainText(marker, {timeout: 20_000});
		await preview.getByRole('button', {name: 'Debugger'}).click();
		const inspector = preview.getByRole('region', {
			name: 'Runtime debugger inspector'
		});

		await expect(inspector).toContainText(`Adapter: sugarcube-${version}`);
		await expect(
			inspector.getByRole('button', {name: 'Restart'})
		).toBeVisible();
		await inspector.getByRole('button', {name: 'Restart'}).click();
		await expect(
			preview.getByText(
				/^(Story restarted from its launch passage\.|Restart is no longer available for this runtime\.|Restart could not be confirmed\. The current artifact was remounted\.)$/
			)
		).toBeVisible();
		await expect(storyBody).toContainText(marker, {timeout: 20_000});
		await preview.close();
	}
});
