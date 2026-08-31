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

async function followStoryLinkRepeatedly(
	page: Page,
	label: string,
	count: number
) {
	await page
		.frameLocator('iframe[title="Story test preview"]')
		.locator('body')
		.evaluate(
			async (body, options) => {
				const matchingLinks = () =>
					Array.from(
						body.querySelectorAll<HTMLElement>('tw-passage tw-link')
					).filter(link => link.textContent?.trim() === options.label);

				for (let index = 0; index < options.count; index += 1) {
					const link = matchingLinks().at(-1);

					if (!link) {
						throw new Error(
							`Missing ${options.label} link after ${index} of ${options.count} navigations.`
						);
					}

					await new Promise<void>((resolve, reject) => {
						let settled = false;
						const finish = (error?: Error) => {
							if (settled) return;

							settled = true;
							observer.disconnect();
							window.clearTimeout(timeout);
							error ? reject(error) : resolve();
						};
						const replacementReady = () =>
							matchingLinks().some(candidate => candidate !== link);
						const observer = new MutationObserver(() => {
							if (replacementReady()) finish();
						});
						const timeout = window.setTimeout(
							() =>
								finish(
									new Error(
										`Timed out after ${index} of ${options.count} ${options.label} navigations.`
									)
								),
							10_000
						);

						observer.observe(body, {childList: true, subtree: true});
						link.click();
						if (replacementReady()) finish();
					});
				}
			},
			{count, label}
		);
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
	await page.getByRole('tab', {name: 'Passage', exact: true}).click();
	await page.getByRole('button', {name: 'Rename', exact: true}).click();
	const renamePrompt = page.getByRole('dialog', {
		name: 'What should “Start” be renamed to?'
	});
	await renamePrompt.getByRole('textbox').fill('Offline Start');
	await renamePrompt.getByRole('button', {name: 'Save'}).click();
	const renameReview = page.getByRole('dialog', {
		name: 'Review Passage Rename'
	});
	await expect(renameReview.getByText('Rename passage')).toBeVisible();
	await renameReview.getByRole('button', {name: 'Apply Rename'}).click();
	await expect(renameReview).toHaveCount(0);
	await expect(
		page.getByRole('region', {name: 'Offline Start', exact: true})
	).toBeVisible();
	await page.getByRole('tab', {name: 'Story', exact: true}).click();
	await page.getByLabel('Find and Replace', {exact: true}).click();
	const searchPanel = page.getByRole('region', {name: 'References'});
	await searchPanel.getByRole('textbox', {name: 'Find'}).fill('Fresh-install');
	await searchPanel
		.getByRole('textbox', {name: 'Replace With'})
		.fill('Offline-reviewed');
	await searchPanel.getByText('Include Passage Names', {exact: true}).click();
	await searchPanel
		.getByText('Include Story JavaScript', {exact: true})
		.click();
	await searchPanel
		.getByText('Include Story Stylesheet', {exact: true})
		.click();
	await searchPanel
		.getByRole('button', {name: 'Replace In Story Sources'})
		.click();
	const replaceReview = page.getByRole('dialog', {
		name: 'Review Project Replacement'
	});
	await expect(replaceReview.getByText('1 change')).toBeVisible();
	await replaceReview.getByRole('button', {name: 'Apply Replacement'}).click();
	await expect(replaceReview).toHaveCount(0);
	const replacedMarker = marker.replace('Fresh-install', 'Offline-reviewed');

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
	).toContainText(replacedMarker);
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
	test.setTimeout(240_000);
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
	await setPassageText(
		page,
		'(set:$alpha to 1)(set:_passage to "offline")(if:visits is 1)[(set:_firstTurn to "offline first")](else:)[(set:_nextTurn to "offline next")]Offline exact Harlowe marker. [[Repeat->Start]]'
	);
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
	const storyFrame = preview.frameLocator('iframe[title="Story test preview"]');
	const storyBody = storyFrame.locator('body');

	await expect(storyBody).toContainText('Offline exact Harlowe marker.', {
		timeout: 20_000
	});
	await preview.getByRole('button', {name: 'Debugger'}).click();
	const inspector = preview.getByRole('region', {
		name: 'Runtime debugger inspector'
	});
	const currentPassageSection = inspector
		.getByRole('heading', {name: 'Current passage'})
		.locator('..')
		.locator('..');

	await expect(inspector).toContainText('Adapter: harlowe-3.3.9');
	await expect(inspector).toContainText('Reliability: exact-version');
	await expect(inspector).toContainText('alpha');
	const temporaryVariablesSection = inspector
		.getByRole('heading', {name: 'Temporary variables'})
		.locator('..')
		.locator('..');
	await expect(
		temporaryVariablesSection.getByText('passage', {exact: true})
	).toBeVisible();
	await expect(
		temporaryVariablesSection.getByText('this passage', {exact: true})
	).toBeVisible();
	await expect(
		temporaryVariablesSection.getByText('firstTurn', {exact: true})
	).toBeVisible();
	await expect(
		inspector.getByText(
			'Harlowe temporary variables are assignments observed during this turn; scope names are supplied by Harlowe.'
		)
	).toBeVisible();
	await expect(
		inspector.getByRole('heading', {name: 'Visited passages'})
	).toBeVisible();
	await expect(
		currentPassageSection.getByText('Start', {exact: true})
	).toBeVisible();
	const visitedPassagesSection = inspector
		.getByRole('heading', {name: 'Visited passages'})
		.locator('..')
		.locator('..');

	await followStoryLinkRepeatedly(preview, 'Repeat', 1);
	await expect(
		temporaryVariablesSection.getByText('nextTurn', {exact: true})
	).toBeVisible();
	await expect(
		temporaryVariablesSection.getByText('firstTurn', {exact: true})
	).toHaveCount(0);
	await followStoryLinkRepeatedly(preview, 'Repeat', 199);
	await expect(
		visitedPassagesSection.getByText('Truncated: item-limit', {exact: true})
	).toBeVisible({timeout: 20_000});
	await expect(visitedPassagesSection.locator('li')).toHaveCount(200);
	await expect(inspector).toContainText('alpha');
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
	await expect(
		temporaryVariablesSection.getByText('passage', {exact: true})
	).toBeVisible();
	await expect(
		temporaryVariablesSection.getByText('firstTurn', {exact: true})
	).toBeVisible();
	await expect(
		temporaryVariablesSection.getByText('nextTurn', {exact: true})
	).toHaveCount(0);
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
