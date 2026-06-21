import type {
	StoryFormatCapabilityDeclarations,
	StoryFormatDeclaredModule,
	StoryFormatModuleSlot,
	StoryFormatProperties
} from '../../store/story-formats';
import {
	declaredStoryFormatModules,
	resolveStoryFormatModules,
	storyFormatModuleSlots,
	type StoryFormatResolvedModule
} from './modules';

export type StoryFormatBundleInclusionPolicy =
	| 'legacy-monolith'
	| 'declared-modules'
	| 'runtime-only';

export interface StoryFormatCapabilityManifest {
	autocomplete: boolean;
	bundleInclusionPolicy: StoryFormatBundleInclusionPolicy;
	devOnlyTools: boolean;
	devtoolsPanels: boolean;
	diagnostics: boolean;
	docs: boolean;
	editorToolbarActions: boolean;
	exporter: boolean;
	lazyLoadedModules: boolean;
	menuItems: boolean;
	migration: boolean;
	modules: Record<StoryFormatModuleSlot, StoryFormatDeclaredModule[]>;
	parser: boolean;
	preprocessing: boolean;
	publishSafe: boolean;
	resolvedModules: Record<StoryFormatModuleSlot, StoryFormatResolvedModule[]>;
	statistics: boolean;
	syntax: boolean;
}

export interface StoryFormatPublishSafetyIssue {
	code: string;
	message: string;
	severity: 'error' | 'warning';
}

export interface StoryFormatPublishSafetyReport {
	issues: StoryFormatPublishSafetyIssue[];
	publishSafe: boolean;
}

const devRuntimeMarkers: {code: string; pattern: RegExp; message: string}[] = [
	{
		code: 'dev-server-url',
		message: 'Story format runtime contains a local dev-server URL.',
		pattern: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+\b/i
	},
	{
		code: 'vite-hmr-client',
		message: 'Story format runtime contains a Vite HMR client reference.',
		pattern: /\/@vite\/client|import\.meta\.hot/i
	},
	{
		code: 'webpack-hmr-client',
		message: 'Story format runtime contains a webpack HMR reference.',
		pattern: /webpackHotUpdate|module\.hot/i
	},
	{
		code: 'live-reload-client',
		message: 'Story format runtime contains a live-reload client reference.',
		pattern: /livereload|live-reload/i
	},
	{
		code: 'twine-devtools-marker',
		message: 'Story format runtime contains a devtools-only marker.',
		pattern: /__twine(?:Rs)?Devtools__|__twine_devtools__/i
	}
];

function modulesBySlot(properties: StoryFormatProperties) {
	return Object.fromEntries(
		storyFormatModuleSlots.map(slot => [
			slot,
			declaredStoryFormatModules(properties).filter(
				module => module.slot === slot
			)
		])
	) as Record<StoryFormatModuleSlot, StoryFormatDeclaredModule[]>;
}

function hasEditorExtension(
	properties: StoryFormatProperties,
	predicate: (
		extension: NonNullable<
			NonNullable<StoryFormatProperties['editorExtensions']>['twine']
		>[string]
	) => boolean
) {
	const extensions = properties.editorExtensions?.twine;

	return extensions ? Object.values(extensions).some(predicate) : false;
}

function declared(
	properties: StoryFormatProperties,
	name: keyof StoryFormatCapabilityDeclarations,
	fallback: boolean
) {
	const value = properties.twineRs?.capabilities?.[name];

	return typeof value === 'boolean' ? value : fallback;
}

export function inspectStoryFormatPublishSafety(
	properties: StoryFormatProperties,
	source = properties.source
): StoryFormatPublishSafetyReport {
	const issues: StoryFormatPublishSafetyIssue[] = [];
	const allowRuntimeDevMarkers =
		properties.twineRs?.publish?.allowDevMarkersInRuntime === true;
	const publishIncludedModules = Object.values(
		resolveStoryFormatModules(properties)
	)
		.flat()
		.filter(module => module.includeInPublish);

	for (const module of publishIncludedModules) {
		if (module.slot !== 'runtime' && module.includeInPublish) {
			issues.push({
				code: `publish-includes-${module.slot}-module`,
				message: `Module "${module.id}" is marked ${module.slot} but is included in publish output.`,
				severity: 'error'
			});
		}
	}

	if (!allowRuntimeDevMarkers) {
		const development = properties.twineRs?.development;

		if (development?.devServerUrl) {
			issues.push({
				code: 'development-dev-server-url',
				message: 'Story format declares a local development server URL.',
				severity: 'error'
			});
		}

		if (development?.hmr) {
			issues.push({
				code: 'development-hmr',
				message: 'Story format declares hot-module reloading for development.',
				severity: 'error'
			});
		}

		for (const marker of devRuntimeMarkers) {
			if (marker.pattern.test(source)) {
				issues.push({
					code: marker.code,
					message: marker.message,
					severity: 'error'
				});
			}
		}

		for (const module of publishIncludedModules) {
			const moduleSource = `${module.declaredUrl} ${module.resolvedUrl ?? ''}`;

			for (const marker of devRuntimeMarkers) {
				if (marker.pattern.test(moduleSource)) {
					issues.push({
						code: `module-${marker.code}`,
						message: `Publish-included module "${module.id}" ${marker.message
							.charAt(0)
							.toLowerCase()}${marker.message.slice(1)}`,
						severity: 'error'
					});
				}
			}
		}
	}

	return {
		issues,
		publishSafe: !issues.some(issue => issue.severity === 'error')
	};
}

export function storyFormatCapabilities(
	properties: StoryFormatProperties
): StoryFormatCapabilityManifest {
	const modules = modulesBySlot(properties);
	const resolvedModules = resolveStoryFormatModules(properties);
	const safety = inspectStoryFormatPublishSafety(properties);
	const syntax = hasEditorExtension(
		properties,
		extension => !!extension.codeMirror?.mode
	);
	const editorToolbarActions = hasEditorExtension(
		properties,
		extension => !!extension.codeMirror?.toolbar
	);
	const parser = hasEditorExtension(
		properties,
		extension => !!extension.references?.parsePassageText
	);
	const menuItems = hasEditorExtension(
		properties,
		extension =>
			!!extension.codeMirror?.toolbar?.toString().includes("type: 'menu'") ||
			!!extension.codeMirror?.toolbar?.toString().includes('type:"menu"')
	);
	const lazyLoadedModules = declaredStoryFormatModules(properties).some(
		module => module.lazy
	);
	const devOnlyTools =
		modules.preview.length > 0 ||
		modules.editor.length > 0 ||
		modules.diagnostics.length > 0 ||
		modules.devtools.length > 0 ||
		!!properties.twineRs?.development;

	return {
		autocomplete: declared(properties, 'autocomplete', false),
		bundleInclusionPolicy:
			declaredStoryFormatModules(properties).length > 0
				? 'declared-modules'
				: devOnlyTools
					? 'runtime-only'
					: 'legacy-monolith',
		devOnlyTools: declared(properties, 'devOnlyTools', devOnlyTools),
		devtoolsPanels: declared(
			properties,
			'devtoolsPanels',
			modules.devtools.length > 0
		),
		diagnostics: declared(
			properties,
			'diagnostics',
			modules.diagnostics.length > 0
		),
		docs: declared(
			properties,
			'docs',
			!!properties.url || !!properties.description
		),
		editorToolbarActions: declared(
			properties,
			'editorToolbarActions',
			editorToolbarActions
		),
		exporter: declared(
			properties,
			'exporter',
			properties.source.includes('{{STORY_DATA}}')
		),
		lazyLoadedModules: declared(
			properties,
			'lazyLoadedModules',
			lazyLoadedModules
		),
		menuItems: declared(properties, 'menuItems', menuItems),
		migration: declared(properties, 'migration', false),
		modules,
		parser: declared(properties, 'parser', parser),
		preprocessing: declared(properties, 'preprocessing', false),
		publishSafe: safety.publishSafe,
		resolvedModules,
		statistics: declared(properties, 'statistics', false),
		syntax: declared(properties, 'syntax', syntax)
	};
}
