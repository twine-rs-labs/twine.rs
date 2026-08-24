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

test('bundled Harlowe retains exact debugger admission offline', async ({
	context,
	page
}) => {
	test.setTimeout(120_000);
	await installServiceWorker(page);
	await context.setOffline(true);
	await page.goto(`${appUrl}/#/new-project`);
	await expect(page.getByRole('heading', {name: 'New Project'})).toBeVisible();
	await page.getByLabel('Project name').fill('Offline exact Harlowe');
	await page
		.locator('label')
		.filter({hasText: 'Story format'})
		.getByRole('combobox')
		.selectOption({label: 'Harlowe 3.3.9'});
	await page
		.getByRole('tab')
		.filter({hasText: /^Text$/})
		.click();
	await page.getByRole('button', {name: 'Create Project'}).click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
	await setPassageText(page, 'Offline exact Harlowe marker.');
	await context.addInitScript(() => {
		if (window !== window.top) return;
		const target = window as typeof window & {
			__harloweBootstrapMessages?: unknown[];
		};
		const NativeMessageChannel = window.MessageChannel;

		target.__harloweBootstrapMessages = [];
		window.MessageChannel = function () {
			const channel = new NativeMessageChannel();

			channel.port1.addEventListener('message', event => {
				if (
					event.data?.source === 'twine.rs.preview.bridge' &&
					event.data?.type === 'debugger-bootstrap-ready'
				) {
					target.__harloweBootstrapMessages!.push(event.data);
				}
			});
			channel.port1.start();
			return channel;
		} as typeof MessageChannel;
		window.addEventListener('message', event => {
			if (
				event.data?.source === 'twine.rs.preview.bridge' &&
				event.data?.type === 'debugger-bootstrap-arm'
			) {
				target.__harloweBootstrapMessages!.push(event.data);
			}
		});
	});

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

	await expect(storyBody).toContainText('Offline exact Harlowe marker.', {
		timeout: 20_000
	});
	await preview.getByRole('button', {name: 'Debugger'}).click();
	const inspector = preview.getByRole('region', {
		name: 'Runtime debugger inspector'
	});

	await expect(inspector).toContainText('Adapter: harlowe-3.3.9');
	await expect(inspector).toContainText('Reliability: exact-version');
	await expect(inspector.getByText('Start', {exact: true})).toBeVisible();
	expect(
		await preview.evaluate(() => {
			const messages = (
				window as typeof window & {
					__harloweBootstrapMessages?: Array<{
						bootstrapChallenge?: string;
						type?: string;
					}>;
				}
			).__harloweBootstrapMessages;

			return {
				arm: messages?.find(
					message => message.type === 'debugger-bootstrap-arm'
				),
				ready: messages?.find(
					message => message.type === 'debugger-bootstrap-ready'
				)
			};
		})
	).toEqual({
		arm: expect.not.objectContaining({bootstrapChallenge: expect.anything()}),
		ready: expect.objectContaining({
			bootstrapChallenge: expect.stringMatching(/^[0-9a-f]{64}$/)
		})
	});
	const bootstrapBeforeNavigation = await preview.evaluate(() => {
		const messages = (
			window as typeof window & {
				__harloweBootstrapMessages?: Array<{
					bootstrapChallenge?: string;
					type?: string;
				}>;
			}
		).__harloweBootstrapMessages;

		return {
			armCount:
				messages?.filter(message => message.type === 'debugger-bootstrap-arm')
					.length ?? 0,
			readyChallenges:
				messages
					?.filter(message => message.type === 'debugger-bootstrap-ready')
					.map(message => message.bootstrapChallenge)
					.filter((value): value is string => typeof value === 'string') ?? []
		};
	});

	await preview.evaluate(() => {
		const frame = document.querySelector<HTMLIFrameElement>(
			'iframe[title="Story test preview"]'
		);

		if (!frame) throw new Error('The Harlowe preview frame is unavailable.');
		const target = window as typeof window & {
			__harloweWindowBeforeNavigation?: Window | null;
		};

		target.__harloweWindowBeforeNavigation = frame.contentWindow;
		frame.srcdoc = frame.srcdoc;
	});
	await expect(storyBody).toContainText('Offline exact Harlowe marker.', {
		timeout: 20_000
	});
	await preview.waitForTimeout(1000);
	const bootstrapAfterNavigation = await preview.evaluate(() => {
		const target = window as typeof window & {
			__harloweBootstrapMessages?: Array<{
				bootstrapChallenge?: string;
				type?: string;
			}>;
			__harloweWindowBeforeNavigation?: Window | null;
		};
		const frame = document.querySelector<HTMLIFrameElement>(
			'iframe[title="Story test preview"]'
		);
		const challenges =
			target.__harloweBootstrapMessages
				?.filter(message => message.type === 'debugger-bootstrap-ready')
				.map(message => message.bootstrapChallenge)
				.filter((value): value is string => typeof value === 'string') ?? [];

		return {
			armCount:
				target.__harloweBootstrapMessages?.filter(
					message => message.type === 'debugger-bootstrap-arm'
				).length ?? 0,
			readyChallenges: challenges,
			sameWindow:
				frame?.contentWindow === target.__harloweWindowBeforeNavigation
		};
	});

	expect(bootstrapAfterNavigation.sameWindow).toBe(true);
	expect(bootstrapAfterNavigation.armCount).toBeGreaterThan(
		bootstrapBeforeNavigation.armCount
	);
	expect(bootstrapAfterNavigation.readyChallenges).toEqual(
		bootstrapBeforeNavigation.readyChallenges
	);

	await preview.getByRole('button', {name: 'Reload'}).click();
	await expect(storyBody).toContainText('Offline exact Harlowe marker.', {
		timeout: 20_000
	});
	await expect
		.poll(() =>
			preview.evaluate(before => {
				const messages = (
					window as typeof window & {
						__harloweBootstrapMessages?: Array<{
							bootstrapChallenge?: string;
							type?: string;
						}>;
					}
				).__harloweBootstrapMessages;

				return (
					messages
						?.filter(message => message.type === 'debugger-bootstrap-ready')
						.map(message => message.bootstrapChallenge)
						.filter(
							(value): value is string =>
								typeof value === 'string' &&
								!before.readyChallenges.includes(value)
						).length ?? 0
				);
			}, bootstrapBeforeNavigation)
		)
		.toBeGreaterThan(0);
	await preview.getByRole('button', {name: 'Debugger'}).click();
	await expect(inspector).toContainText('Adapter: harlowe-3.3.9');
	await preview.close();
});
