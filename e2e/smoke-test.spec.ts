import {BrowserContext, expect, Locator, Page, test} from '@playwright/test';

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
	startPassage = 'Start',
	format?: string
) {
	await page.goto(`${appUrl}/#/new-project`);
	await expect(page).toHaveURL(/#\/new-project$/);
	await expect(page.getByRole('heading', {name: 'New Project'})).toBeVisible();
	await page.getByLabel('Project name').fill(name);
	await page.getByLabel('Start passage').fill(startPassage);
	if (format) {
		await page
			.locator('label')
			.filter({hasText: 'Story format'})
			.getByRole('combobox')
			.selectOption({label: format});
	}
	await page
		.locator('label')
		.filter({hasText: 'Initial mode'})
		.getByRole('tab')
		.filter({hasText: 'Text'})
		.click();
	await page.getByRole('button', {name: 'Create Project'}).click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
	await expect(page.getByRole('region', {name: startPassage})).toBeVisible();
}

function sourceEditor(page: Page): Locator {
	return page.locator('[data-testid^="story-editor-window-"]').first();
}

async function setPassageText(page: Page, text: string) {
	const editor = sourceEditor(page);

	await expect(editor).toBeVisible();
	await editor.locator('.cm-content').focus();
	await page.keyboard.press(
		process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
	);
	await page.keyboard.insertText(text);
	await expect(editor).toContainText(text);
	await page.waitForTimeout(450);
}

async function selectPassage(page: Page, name: string) {
	const passage = page
		.getByRole('listitem')
		.filter({has: page.getByText(name, {exact: true})})
		.getByRole('button');

	await expect(passage).toBeVisible();
	await passage.click();
	await expect(page.getByRole('region', {name, exact: true})).toBeVisible();
}

async function launchTestFromHere(
	context: BrowserContext,
	trigger: () => Promise<unknown>
) {
	const [preview] = await Promise.all([
		context.waitForEvent('page'),
		trigger()
	]);

	return preview;
}

async function expectTestAtPassage(
	preview: Page,
	passageName: string,
	marker: string
) {
	await expect(
		preview
			.frameLocator('iframe[title="Story test preview"]')
			.locator('tw-passage')
	).toContainText(marker);
	await expect(
		preview.getByText(`Start: ${passageName}`, {exact: true})
	).toBeVisible();
}

async function openStoryInTextMode(page: Page, name: string) {
	await storyRow(page, name)
		.getByRole('button', {name: `Open ${name}`})
		.first()
		.click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+$/);
	await page
		.getByLabel('Workspace Mode')
		.getByRole('tab', {name: 'Text'})
		.click();
	await expect(sourceEditor(page)).toBeVisible();
}

function importedStoryHtml(name: string, ifid: string, body: string) {
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

function storyRow(page: Page, name: string) {
	return page
		.getByTestId('story-list-row')
		.filter({has: page.getByText(name, {exact: true})});
}

async function persistedPassageBodies(page: Page) {
	return page.evaluate(() => {
		const ids = (key: string) =>
			(window.localStorage.getItem(key) ?? '').split(',').filter(Boolean);
		const serializedManifest = window.localStorage.getItem(
			'twine-story-storage-manifest'
		);
		const manifest = serializedManifest
			? (JSON.parse(serializedManifest) as {
					passages: Array<{key: string}>;
					stories: Array<{id: string; key: string}>;
				})
			: undefined;
		const passages = (manifest?.passages.map(({key}) =>
			JSON.parse(window.localStorage.getItem(key) ?? '{}')
		) ??
			ids('twine-passages').map(id =>
				JSON.parse(window.localStorage.getItem(`twine-passages-${id}`) ?? '{}')
			)) as Array<{story?: string; text?: unknown}>;
		const stories =
			manifest?.stories.map(({id, key}) => ({id, key})) ??
			ids('twine-stories').map(id => ({id, key: `twine-stories-${id}`}));

		return Object.fromEntries(
			stories.map(({id, key}) => {
				const story = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
					name?: string;
				};

				return [
					story.name ?? id,
					passages
						.filter(passage => passage.story === id)
						.map(passage =>
							typeof passage.text === 'string' ? passage.text : null
						)
						.sort()
				];
			})
		);
	});
}

async function expectPersistedPassageBodies(
	page: Page,
	expected: Record<string, Array<string | null>>
) {
	await expect.poll(() => persistedPassageBodies(page)).toEqual(expected);
}

test.beforeEach(async ({page}) => {
	await resetBrowserState(page);
});

test('opens the current project launcher on first run', async ({page}) => {
	await expect(page.getByLabel('Twine')).toBeVisible();
	await expect(
		page.getByRole('heading', {name: 'No projects yet'})
	).toBeVisible();
	await expect(
		page
			.getByLabel('Project actions')
			.getByRole('button', {name: 'New Project'})
	).toBeVisible();
});

test('creates a project from the D-series launcher flow', async ({page}) => {
	await createProject(page, 'Create project smoke');
	await expect(page).toHaveTitle('Create project smoke - Twine RS');

	await page.goto(`${appUrl}/#/`);
	await expect(page.getByText('Create project smoke').first()).toBeVisible();

	await page.reload();
	await expect(page.getByText('Create project smoke').first()).toBeVisible();
});

test('persists embedded source-editor passage edits', async ({page}) => {
	await createProject(page, 'Edit passage smoke');
	await setPassageText(page, 'Smoke text survives a reload.');

	await page.reload();
	await expect(sourceEditor(page)).toContainText(
		'Smoke text survives a reload.'
	);
});

test('keeps colliding passage IDs scoped to their projects', async ({page}) => {
	await createProject(page, 'Passage collision first');
	await page.getByRole('button', {name: 'New', exact: true}).click();
	await page.getByTitle('Stories').click();
	await expectPersistedPassageBodies(page, {
		'Passage collision first': ['', '']
	});

	await createProject(page, 'Passage collision second');
	await page.getByRole('button', {name: 'New', exact: true}).click();
	await page.getByTitle('Stories').click();

	const collisions = await page.evaluate(() => {
		const manifest = JSON.parse(
			window.localStorage.getItem('twine-story-storage-manifest') ?? '{}'
		) as {passages?: Array<{id: string; storyId: string}>};
		const storyIdsByPassage = new Map<string, Set<string>>();

		for (const passage of manifest.passages ?? []) {
			const storyIds = storyIdsByPassage.get(passage.id) ?? new Set<string>();

			storyIds.add(passage.storyId);
			storyIdsByPassage.set(passage.id, storyIds);
		}

		return [...storyIdsByPassage.entries()]
			.filter(([, storyIds]) => storyIds.size > 1)
			.map(([passageId]) => passageId);
	});

	expect(collisions.length).toBeGreaterThan(0);
	await expectPersistedPassageBodies(page, {
		'Passage collision first': ['', ''],
		'Passage collision second': ['', '']
	});

	await page.reload();
	await expectPersistedPassageBodies(page, {
		'Passage collision first': ['', ''],
		'Passage collision second': ['', '']
	});
});

test('keeps hydrated passage bodies when selecting another project and reloading', async ({
	page
}) => {
	const firstBody = 'The first hydrated body survives project selection.';
	const secondBody = 'The second hydrated body remains intact.';

	await createProject(page, 'Hydrated selection first');
	await setPassageText(page, firstBody);
	await page.getByTitle('Stories').click();
	await createProject(page, 'Hydrated selection second');
	await setPassageText(page, secondBody);
	await page.getByTitle('Stories').click();

	// Reloading establishes the startup hydration/separation boundary before the
	// selection-only update that previously overwrote passage records.
	await page.reload();
	await expect(storyRow(page, 'Hydrated selection first')).toBeVisible();
	await storyRow(page, 'Hydrated selection first').click();
	await page.reload();

	await expectPersistedPassageBodies(page, {
		'Hydrated selection first': [firstBody],
		'Hydrated selection second': [secondBody]
	});
	await storyRow(page, 'Hydrated selection first')
		.getByRole('button', {name: 'Open Hydrated selection first'})
		.first()
		.click();
	await expect(sourceEditor(page)).toContainText(firstBody);
});

test('duplicates a nonempty project after hydration and persists both bodies', async ({
	page
}) => {
	const body = 'A duplicate created after hydration keeps this complete body.';

	await createProject(page, 'Hydrated duplicate source');
	await setPassageText(page, body);
	await page.getByTitle('Stories').click();
	await page.reload();

	await page
		.getByRole('button', {
			name: 'Duplicate story Hydrated duplicate source'
		})
		.click();
	await expect(storyRow(page, 'Hydrated duplicate source 1')).toBeVisible();
	await expectPersistedPassageBodies(page, {
		'Hydrated duplicate source': [body],
		'Hydrated duplicate source 1': [body]
	});
	await openStoryInTextMode(page, 'Hydrated duplicate source 1');
	await expect(sourceEditor(page)).toContainText(body);
	await page.getByTitle('Stories').click();

	await page.reload();
	await expect(storyRow(page, 'Hydrated duplicate source 1')).toBeVisible();
	await expectPersistedPassageBodies(page, {
		'Hydrated duplicate source': [body],
		'Hydrated duplicate source 1': [body]
	});
});

test('imports a nonempty project after hydration and persists every body', async ({
	page
}) => {
	const existingBody = 'The already hydrated project keeps its body.';
	const importedBody = 'The imported project body is registered and persisted.';
	const importedHtml = importedStoryHtml(
		'Imported after hydration',
		'B0A505E2-8A2C-4B29-8610-FF3B144D19B1',
		importedBody
	);

	await createProject(page, 'Hydrated import sentinel');
	await setPassageText(page, existingBody);
	await page.getByTitle('Stories').click();
	await page.reload();
	await page.getByRole('button', {name: 'Import', exact: true}).click();
	await expect(page).toHaveURL(/#\/new-project\/import$/);

	await page.getByLabel('Source file').setInputFiles({
		buffer: Buffer.from(importedHtml),
		mimeType: 'text/html',
		name: 'imported-after-hydration.html'
	});
	await expect(
		page.getByText('Imported after hydration', {exact: true})
	).toBeVisible();
	await page.getByRole('button', {name: 'Run Import'}).click();
	await expect(page).toHaveURL(/#\/$/);
	await expect(storyRow(page, 'Imported after hydration')).toBeVisible();
	await expectPersistedPassageBodies(page, {
		'Hydrated import sentinel': [existingBody],
		'Imported after hydration': [importedBody]
	});
	await openStoryInTextMode(page, 'Imported after hydration');
	await expect(sourceEditor(page)).toContainText(importedBody);
	await page.getByTitle('Stories').click();

	await page.reload();
	await expect(storyRow(page, 'Imported after hydration')).toBeVisible();
	await expectPersistedPassageBodies(page, {
		'Hydrated import sentinel': [existingBody],
		'Imported after hydration': [importedBody]
	});
});

test('overwrites a hydrated project in the active session and persistence', async ({
	page
}) => {
	const originalBody = 'The body before overwrite.';
	const importedBody = 'The replacement body from the selected import.';
	const storyName = 'Hydrated overwrite target';

	await createProject(page, storyName);
	await setPassageText(page, originalBody);
	await page.getByTitle('Stories').click();
	await page.reload();
	await page.getByRole('button', {name: 'Import', exact: true}).click();
	await page.getByLabel('Source file').setInputFiles({
		buffer: Buffer.from(
			importedStoryHtml(
				storyName,
				'FDE71DCF-8A9F-48B1-A814-F1EB20654CD5',
				importedBody
			)
		),
		mimeType: 'text/html',
		name: 'hydrated-overwrite-target.html'
	});

	const reviewRow = page.locator('tbody tr').filter({hasText: storyName});

	await expect(reviewRow.getByText('Replace', {exact: true})).toBeVisible();
	await reviewRow.locator('label.tw-check').click();
	await page.getByRole('button', {name: 'Run Import'}).click();
	await expect(page).toHaveURL(/#\/$/);
	await expectPersistedPassageBodies(page, {[storyName]: [importedBody]});

	await openStoryInTextMode(page, storyName);
	await expect(sourceEditor(page)).toContainText(importedBody);
	await page.getByTitle('Stories').click();
	await page.reload();
	await expectPersistedPassageBodies(page, {[storyName]: [importedBody]});
	await openStoryInTextMode(page, storyName);
	await expect(sourceEditor(page)).toContainText(importedBody);
});

test('publishes the current project to a playable page', async ({
	context,
	page
}) => {
	await createProject(page, 'Publish smoke');
	await setPassageText(page, 'Smoke story is playable.');

	const [publishedPage] = await Promise.all([
		context.waitForEvent('page'),
		page.getByTitle('Play').click()
	]);

	await expect(
		publishedPage
			.frameLocator('iframe[title="Story preview"]')
			.locator(':visible:text-is("Smoke story is playable.")')
	).toBeVisible();
	await publishedPage.close();
});

test.describe('runtime console clipboard', () => {
	test.skip(
		({browserName}) => browserName !== 'chromium',
		'Runtime console clipboard acceptance is anchored in Chromium.'
	);

	test('copies the host-owned runtime console exactly', async ({
		context,
		page
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
			origin: appUrl
		});
		await createProject(page, 'Runtime console clipboard');
		await setPassageText(page, 'Console story.');
		const [publishedPage] = await Promise.all([
			context.waitForEvent('page'),
			page.getByTitle('Play').click()
		]);
		const frame = publishedPage.frameLocator('iframe[title="Story preview"]');
		await expect(
			frame.locator(':visible:text-is("Console story.")')
		).toBeVisible();
		await frame.locator('body').evaluate(() => {
			const originalNow = Date.now;
			try {
				Date.now = () => 0;
				console.log('<safe>\nline');
				console.warn('warn');
				console.error('error');
			} finally {
				Date.now = originalNow;
			}
		});
		await publishedPage.getByRole('button', {name: 'Debugger'}).click();
		const inspector = publishedPage.getByRole('region', {
			name: 'Runtime debugger inspector'
		});
		await expect(
			inspector.getByRole('heading', {name: 'Runtime Console'})
		).toBeVisible();
		await expect(inspector).toContainText('<safe>');
		expect(await inspector.locator('safe').count()).toBe(0);
		await publishedPage.getByRole('button', {name: 'Copy Runtime Log'}).click();
		await expect(inspector.getByText('Runtime log copied.')).toBeVisible();
		expect(
			await publishedPage.evaluate(() => navigator.clipboard.readText())
		).toBe(
			'[1970-01-01T00:00:00.000Z] ERROR: "error"\n[1970-01-01T00:00:00.000Z] WARNING: "warn"\n[1970-01-01T00:00:00.000Z] LOG: "<safe>\\nline"'
		);
		await publishedPage.close();
	});
});

test('tracks Harlowe navigation and owner reveals in a sandboxed browser preview', async ({
	context,
	page
}) => {
	await createProject(page, 'Harlowe passage telemetry');
	await setPassageText(
		page,
		'(set:$alpha to 1)Start marker. [[Continue->Next]]'
	);
	await selectPassage(page, 'Next');
	await setPassageText(page, 'Next marker.');

	const [publishedPage] = await Promise.all([
		context.waitForEvent('page'),
		page.getByTitle('Play').click()
	]);
	const previewFrame = publishedPage.frameLocator(
		'iframe[title="Story preview"]'
	);
	const previewIframe = publishedPage.locator('iframe[title="Story preview"]');
	const testCurrent = publishedPage.getByRole('button', {
		name: 'Test Current'
	});

	await expect(previewFrame.locator('tw-passage')).toContainText(
		'Start marker.'
	);
	await expect(
		publishedPage.getByText('Current: Start', {exact: true})
	).toBeVisible();
	await expect(testCurrent).toBeEnabled();
	const debuggerToggle = publishedPage.getByRole('button', {name: 'Debugger'});
	await expect(debuggerToggle).toBeVisible();
	await debuggerToggle.click();
	const debuggerInspector = publishedPage.getByRole('region', {
		name: 'Runtime debugger inspector'
	});
	const currentPassageSection = debuggerInspector
		.getByRole('heading', {name: 'Current passage'})
		.locator('..')
		.locator('..');
	await expect(debuggerInspector).toContainText('Format: Harlowe 3.3.9');
	await expect(debuggerInspector).toContainText('Adapter: harlowe-3.3.9');
	await expect(debuggerInspector).toContainText('Reliability: exact-version');
	await expect(
		currentPassageSection.getByText('Start', {exact: true})
	).toBeVisible();
	await expect(
		debuggerInspector.getByRole('heading', {name: 'Story variables'})
	).toBeVisible();
	await expect(debuggerInspector).toContainText('alpha');
	await expect(
		debuggerInspector.getByRole('heading', {name: 'Visited passages'})
	).toBeVisible();
	expect(
		(await previewIframe.getAttribute('sandbox'))?.split(/\s+/)
	).not.toContain('allow-same-origin');

	await previewFrame.getByText('Continue', {exact: true}).click();

	await expect(previewFrame.locator('tw-passage')).toContainText(
		'Next marker.'
	);
	await expect(
		publishedPage.getByText('Current: Next', {exact: true})
	).toBeVisible();
	await expect(
		currentPassageSection.getByText('Next', {exact: true})
	).toBeVisible();
	await expect(testCurrent).toBeEnabled();
	const previewUrl = publishedPage.url();

	await publishedPage.getByRole('button', {name: 'Edit Passage'}).click();
	await expect(page).toHaveURL(/mode=text&passage=/);
	await expect(
		page.getByRole('region', {name: 'Next', exact: true})
	).toHaveClass(/is-active/);
	expect(publishedPage.url()).toBe(previewUrl);
	await expect(previewFrame.locator('tw-passage')).toContainText(
		'Next marker.'
	);

	await publishedPage.getByRole('button', {name: 'Reveal in Graph'}).click();
	await expect(page).toHaveURL(/mode=graph&passage=/);
	const selectedGraphNode = page.locator(
		'.story-edit-graph-node[data-selected="true"]'
	);

	await expect(selectedGraphNode).toHaveCount(1);
	await expect
		.poll(async () =>
			selectedGraphNode.evaluate(node => {
				const viewport = node.closest('.story-edit-graph-viewport');

				if (!viewport) {
					return Number.POSITIVE_INFINITY;
				}
				const nodeBounds = node.getBoundingClientRect();
				const viewportBounds = viewport.getBoundingClientRect();

				return Math.max(
					Math.abs(
						nodeBounds.left +
							nodeBounds.width / 2 -
							(viewportBounds.left + viewportBounds.width / 2)
					),
					Math.abs(
						nodeBounds.top +
							nodeBounds.height / 2 -
							(viewportBounds.top + viewportBounds.height / 2)
					)
				);
			})
		)
		.toBeLessThan(3);
	expect(publishedPage.url()).toBe(previewUrl);
	await publishedPage.close();
});

test('preserves and wraps Snowman debugger variables in the real browser inspector', async ({
	context,
	page
}) => {
	const spacedValue = `  ${Array.from(
		{length: 32},
		(_, index) => `token-${index}`
	).join('  ')}  `;
	const expectedPreview = JSON.stringify(spacedValue);

	await createProject(
		page,
		'Debugger whitespace fidelity',
		'Start',
		'Snowman 2.1.1'
	);
	await setPassageText(page, 'Whitespace ready.');
	const [publishedPage] = await Promise.all([
		context.waitForEvent('page'),
		page.getByTitle('Play').click()
	]);

	await publishedPage.setViewportSize({height: 700, width: 520});
	const previewFrame = publishedPage.frameLocator(
		'iframe[title="Story preview"]'
	);
	await expect(
		previewFrame
			.locator('tw-passage.passage')
			.filter({hasText: /^Whitespace ready\.$/})
	).toBeVisible();
	await publishedPage.getByRole('button', {name: 'Debugger'}).click();
	await previewFrame.locator('body').evaluate((_, value) => {
		const runtime = window as typeof window & {
			__twineRsPreviewDebug: {captureState(): void};
			story: {state: Record<string, unknown>};
		};

		runtime.story.state.spaced = value;
		runtime.__twineRsPreviewDebug.captureState();
	}, spacedValue);
	const inspector = publishedPage.getByRole('region', {
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

	await expect(variablePreview).toHaveCount(1);
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
	await publishedPage.close();
});

test('opens the M6 Build and Formats surfaces', async ({page}) => {
	await createProject(page, 'M6 surface smoke');

	await page.getByTitle('Build & Export').click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+\/build$/);
	await expect(
		page.getByRole('heading', {name: 'Export your story'})
	).toBeVisible();
	await expect(
		page.locator('.build-route__format-title', {hasText: 'Playable HTML'})
	).toBeVisible();
	await expect(
		page.locator('.build-route__format-title', {hasText: 'Package (.zip)'})
	).toBeVisible();

	await page.getByRole('button', {name: 'Inspect output'}).click();
	await expect(
		page.getByRole('complementary', {name: 'Inspect output'})
	).toContainText('story "M6 surface smoke"');
	await page.getByRole('tab', {name: /HTML/}).click();
	await expect(page.getByText('M6 surface smoke.html')).toBeVisible();
	await page.getByRole('button', {name: 'Close inspect output'}).click();

	await page.getByTitle('Story Formats').click();
	await expect(page).toHaveURL(/#\/formats$/);
	await expect(page.getByLabel('Story formats')).toBeVisible();
	await expect(page.getByLabel('Story format URL')).toBeVisible();
});

test('opens the D6 Contents, Diagnostics, and Assets surfaces', async ({
	page
}) => {
	await createProject(page, 'D6 surface smoke');
	await setPassageText(
		page,
		'Set $score. Go to [[Missing]]. Portrait: <img src="assets/cover.png">'
	);

	await page.getByTitle('Contents').click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+\/contents$/);
	await expect(page.getByLabel('Contents', {exact: true})).toBeVisible();
	await expect(page.getByLabel('Filter contents')).toBeVisible();
	const contentsFilters = page.getByLabel('Contents filters');

	await contentsFilters.getByRole('button', {name: /Variables/}).click();
	await expect(page.getByText('$score').first()).toBeVisible();
	await contentsFilters.getByRole('button', {name: /Assets/}).click();
	await expect(page.getByText('assets/cover.png').first()).toBeVisible();
	await expect(
		page.getByRole('button', {name: 'Reveal in Source'})
	).toBeVisible();

	await page.getByTitle('Diagnostics').click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+\/diagnostics$/);
	await expect(page.getByLabel('Diagnostics', {exact: true})).toBeVisible();
	await expect(page.getByLabel('Filter diagnostics')).toBeVisible();
	await expect(
		page.getByRole('button', {name: 'Recheck Project'})
	).toBeVisible();
	await expect(page.getByRole('button', {name: 'Fix All Safe'})).toBeVisible();

	await page.getByTitle('Assets').click();
	await expect(page).toHaveURL(/#\/stories\/[^/]+\/assets$/);
	await expect(page.getByLabel('Assets', {exact: true})).toBeVisible();
	await expect(page.getByLabel('Search assets')).toBeVisible();
	await page.getByRole('button', {name: 'Open folder assets'}).click();
	await page
		.getByRole('button', {name: 'Select asset assets/cover.png'})
		.click();
	await expect(page.getByText('assets/cover.png').first()).toBeVisible();
	await expect(
		page.getByText('<img src="assets/cover.png" alt="">').first()
	).toBeVisible();
	await expect(page.getByRole('button', {name: 'Find Usages'})).toBeVisible();
});

test('launches Test From Here at the selected non-start passage from every authoring surface', async ({
	context,
	page
}) => {
	test.setTimeout(90 * 1000);
	const passageName = 'Nonstart';
	const marker = 'Nonstart Test From Here marker.';

	await createProject(page, 'Test From Here surface matrix');
	await setPassageText(page, `Start marker. [[Continue->${passageName}]]`);
	await selectPassage(page, passageName);
	await setPassageText(
		page,
		`${marker} [[Missing destination]] <img src="assets/cover.png">`
	);
	await selectPassage(page, 'Missing destination');
	await page.getByRole('button', {name: 'Delete', exact: true}).click();
	await selectPassage(page, passageName);

	await page.getByRole('button', {name: 'Go to Passage'}).click();
	await page.getByLabel('Search by passage name or text').fill(passageName);
	let preview = await launchTestFromHere(context, () =>
		page
			.getByRole('button', {
				name: `Test "${passageName}" From Here`
			})
			.click()
	);
	await expectTestAtPassage(preview, passageName, marker);
	await preview.close();
	await page.getByRole('button', {name: 'Close', exact: true}).click();

	await page.getByTitle('Contents').click();
	await expect(page.getByLabel('Contents', {exact: true})).toBeVisible();
	await page
		.locator('.contents-route__row')
		.filter({has: page.getByText(passageName, {exact: true})})
		.click();
	preview = await launchTestFromHere(context, () =>
		page.getByRole('button', {name: 'Test From Here', exact: true}).click()
	);
	await expectTestAtPassage(preview, passageName, marker);
	await preview.close();

	await page.getByTitle('Diagnostics').click();
	await expect(page.getByLabel('Diagnostics', {exact: true})).toBeVisible();
	await page
		.locator('.diagnostics-route__row')
		.filter({hasText: passageName})
		.click();
	preview = await launchTestFromHere(context, () =>
		page.getByRole('button', {name: 'Test From Here', exact: true}).click()
	);
	await expectTestAtPassage(preview, passageName, marker);
	await preview.close();

	await page.getByTitle('Assets').click();
	await expect(page.getByLabel('Assets', {exact: true})).toBeVisible();
	await page.getByRole('button', {name: 'Open folder assets'}).click();
	await page
		.getByRole('button', {name: 'Select asset assets/cover.png'})
		.click();
	preview = await launchTestFromHere(context, () =>
		page.getByRole('button', {name: 'Test First Usage'}).click()
	);
	await expectTestAtPassage(preview, passageName, marker);
	await preview.close();
});
