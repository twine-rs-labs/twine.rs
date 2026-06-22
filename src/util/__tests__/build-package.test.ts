import {
	buildAssetCopyPlan,
	createStoryBuildPackage,
	filePathFromFileUrl,
	safeBuildAssetOutputPath
} from '../build-package';
import {
	fakeAppInfo,
	fakeStory,
	fakeStoryFormatProperties
} from '../../test-util';
import type {CoreAssetInventoryEntry} from '../../core/bindings/CoreAssetInventoryEntry';

function asset(
	props: Partial<CoreAssetInventoryEntry> = {}
): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'image',
		missing: false,
		modifiedAt: null,
		normalizedPath: 'assets/cover.png',
		path: 'assets/cover.png',
		previewUrl: 'file:///tmp/cover.png',
		publish: {
			copy: true,
			outputPath: 'assets/cover.png',
			reason: 'Copy asset into published output'
		},
		referenceCount: 1,
		references: [],
		sizeBytes: 12,
		snippet: {
			label: 'Insert asset reference',
			mediaType: 'image',
			text: '<img src="assets/cover.png" alt="">'
		},
		thumbnailUrl: 'file:///tmp/cover.png',
		unused: false,
		width: null,
		...props
	};
}

describe('M6 build package', () => {
	it('creates a copy plan from publishable asset inventory', () => {
		expect(filePathFromFileUrl('file:///tmp/cover%20art.png')).toBe(
			'/tmp/cover art.png'
		);
		expect(safeBuildAssetOutputPath('./assets/cover.png')).toBe(
			'assets/cover.png'
		);
		expect(() => safeBuildAssetOutputPath('../cover.png')).toThrow();

		expect(buildAssetCopyPlan([asset()])).toEqual([
			expect.objectContaining({
				outputPath: 'assets/cover.png',
				path: 'assets/cover.png',
				sourcePath: '/tmp/cover.png'
			})
		]);
	});

	it('builds preview packages with report metadata', () => {
		const story = fakeStory();
		const properties = fakeStoryFormatProperties();
		const result = createStoryBuildPackage(story, fakeAppInfo(), {
			assetInventory: [asset()],
			formatProperties: properties,
			target: 'play'
		});

		expect(result.html).toContain('<tw-storydata');
		expect(result.assets).toHaveLength(1);
		expect(result.files).toEqual([
			expect.objectContaining({
				kind: 'html',
				role: 'primary'
			})
		]);
		expect(result.report).toEqual(
			expect.objectContaining({
				assetCount: 1,
				copiedAssetCount: 1,
				outputCount: 1,
				publishSafe: true,
				target: 'play'
			})
		);
	});

	it('builds JSON export packages without rendering story format HTML', () => {
		const story = fakeStory();
		const result = createStoryBuildPackage(story, fakeAppInfo(), {
			formatProperties: fakeStoryFormatProperties(),
			target: 'export-json'
		});

		expect(result.html).toBe('');
		expect(result.files).toEqual([
			expect.objectContaining({
				kind: 'json',
				role: 'primary'
			})
		]);
		expect(JSON.parse(result.files[0].contents)).toEqual(
			expect.objectContaining({
				id: story.id,
				ifid: story.ifid,
				name: story.name
			})
		);
		expect(result.report.fidelity.preserves).toContain(
			'current story store fields'
		);
	});

	it('builds package targets with a manifest, compatibility outputs, and assets', () => {
		const story = fakeStory();
		const result = createStoryBuildPackage(story, fakeAppInfo(), {
			assetInventory: [asset()],
			formatProperties: fakeStoryFormatProperties(),
			target: 'package'
		});
		const manifest = JSON.parse(result.files[0].contents);
		const archive = JSON.parse(result.files[1].contents);

		expect(result.files.map(file => file.kind)).toEqual([
			'package-manifest',
			'archive',
			'html',
			'json',
			'twee'
		]);
		expect(manifest).toEqual(
			expect.objectContaining({
				type: 'twine.rs/story-build-package',
				story: expect.objectContaining({id: story.id})
			})
		);
		expect(manifest.assets).toEqual([
			expect.objectContaining({outputPath: 'assets/cover.png'})
		]);
		expect(archive).toEqual(
			expect.objectContaining({
				type: 'twine.rs/project-archive',
				files: expect.arrayContaining([
					expect.objectContaining({
						contents: expect.stringContaining('twine.rs/story-graph/v1')
					})
				])
			})
		);
		expect(result.report.outputs.map(output => output.kind)).toEqual([
			'package-manifest',
			'archive',
			'html',
			'json',
			'twee'
		]);
		expect(result.report.diagnostics).toEqual([]);
	});

	it('promotes package asset-source gaps into build diagnostics', () => {
		const result = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			assetInventory: [
				asset({
					previewUrl: null,
					thumbnailUrl: null
				})
			],
			formatProperties: fakeStoryFormatProperties(),
			target: 'package'
		});

		expect(result.report.diagnostics).toEqual([
			expect.objectContaining({
				code: 'asset-copy-source-missing',
				outputPath: 'assets/cover.png',
				severity: 'warning'
			})
		]);
	});

	it('builds compatibility exports without twine.rs StoryData graph metadata', () => {
		const result = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			formatProperties: fakeStoryFormatProperties(),
			target: 'compatibility-export'
		});

		expect(result.files.map(file => file.kind)).toEqual(['html', 'twee']);
		expect(result.files[0].contents).not.toContain(
			'data-twine-rs-story-graph'
		);
		expect(result.files[1].contents).not.toContain('"twine.rs"');
		expect(result.report.fidelity.omits).toContain(
			'twine.rs StoryData graph metadata carrier'
		);
		expect(result.report.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'fidelity-omission',
					severity: 'warning'
				})
			])
		);
	});

	it('builds source and HTML inspection reports', () => {
		const sourceInspection = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			formatProperties: fakeStoryFormatProperties(),
			target: 'inspect-source'
		});
		const htmlInspection = createStoryBuildPackage(fakeStory(), fakeAppInfo(), {
			formatProperties: fakeStoryFormatProperties(),
			target: 'inspect-html'
		});

		expect(sourceInspection.files[0]).toEqual(
			expect.objectContaining({
				kind: 'inspection',
				role: 'primary',
				contents: expect.stringContaining('Source inspection')
			})
		);
		expect(htmlInspection.files[0]).toEqual(
			expect.objectContaining({
				kind: 'inspection',
				role: 'primary',
				contents: expect.stringContaining('HTML inspection')
			})
		);
	});

	it('blocks publish packages when dev-only format code would ship', () => {
		const story = fakeStory();
		const properties = {
			...fakeStoryFormatProperties(),
			source: '{{STORY_DATA}}<script>import.meta.hot</script>'
		};

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'publish'
			})
		).toThrow('not publish-safe');

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'export-html'
			})
		).toThrow('not publish-safe');

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'compatibility-export'
			})
		).toThrow('not publish-safe');

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'package'
			})
		).toThrow('not publish-safe');

		expect(() =>
			createStoryBuildPackage(story, fakeAppInfo(), {
				formatProperties: properties,
				target: 'test'
			})
		).not.toThrow();
	});
});
