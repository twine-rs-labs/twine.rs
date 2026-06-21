import type {
	StoryFormatDeclaredModule,
	StoryFormatModuleSlot,
	StoryFormatProperties
} from '../../store/story-formats';

export const storyFormatModuleSlots: StoryFormatModuleSlot[] = [
	'runtime',
	'preview',
	'editor',
	'diagnostics',
	'devtools'
];

export interface StoryFormatResolvedModule extends StoryFormatDeclaredModule {
	declaredUrl: string;
	includeInPublish: boolean;
	resolutionError: string | null;
	resolvedUrl: string | null;
}

export interface StoryFormatLoadedModule extends StoryFormatResolvedModule {
	mediaType: string | null;
	source: string;
}

export interface StoryFormatModuleResolverOptions {
	baseUrl?: string;
}

export interface StoryFormatModuleLoaderOptions extends StoryFormatModuleResolverOptions {
	fetch?: (
		url: string
	) => Promise<Pick<Response, 'headers' | 'ok' | 'status' | 'text'>>;
	includeLazy?: boolean;
	slots?: StoryFormatModuleSlot[];
}

export function declaredStoryFormatModules(properties: StoryFormatProperties) {
	return properties.twineRs?.modules ?? [];
}

export function moduleIncludedInPublish(module: StoryFormatDeclaredModule) {
	return module.includeInPublish ?? module.slot === 'runtime';
}

function fileUrlFromFolderPath(path: string) {
	const normalized = path.replace(/\\/g, '/').replace(/\/?$/, '/');
	const withLeadingSlash = normalized.startsWith('/')
		? normalized
		: `/${normalized}`;

	return `file://${withLeadingSlash}`;
}

function baseUrlForModules(
	properties: StoryFormatProperties,
	options: StoryFormatModuleResolverOptions = {}
) {
	return (
		options.baseUrl ??
		properties.twineRs?.development?.devServerUrl ??
		(properties.twineRs?.development?.localFolderPath
			? fileUrlFromFolderPath(properties.twineRs.development.localFolderPath)
			: undefined) ??
		properties.url ??
		null
	);
}

export function resolveStoryFormatModule(
	properties: StoryFormatProperties,
	module: StoryFormatDeclaredModule,
	options: StoryFormatModuleResolverOptions = {}
): StoryFormatResolvedModule {
	const declaredUrl = module.url ?? `${module.id}.js`;
	const baseUrl = baseUrlForModules(properties, options);

	try {
		return {
			...module,
			declaredUrl,
			includeInPublish: moduleIncludedInPublish(module),
			resolutionError: null,
			resolvedUrl: new URL(declaredUrl, baseUrl ?? undefined).toString()
		};
	} catch (error) {
		return {
			...module,
			declaredUrl,
			includeInPublish: moduleIncludedInPublish(module),
			resolutionError: `Could not resolve module "${module.id}" from "${
				baseUrl ?? 'no base URL'
			}": ${(error as Error).message}`,
			resolvedUrl: null
		};
	}
}

function emptyModulesBySlot<T>() {
	return Object.fromEntries(
		storyFormatModuleSlots.map(slot => [slot, [] as T[]])
	) as Record<StoryFormatModuleSlot, T[]>;
}

export function resolveStoryFormatModules(
	properties: StoryFormatProperties,
	options: StoryFormatModuleResolverOptions = {}
) {
	const modulesBySlot = emptyModulesBySlot<StoryFormatResolvedModule>();

	for (const module of declaredStoryFormatModules(properties)) {
		modulesBySlot[module.slot].push(
			resolveStoryFormatModule(properties, module, options)
		);
	}

	return modulesBySlot;
}

async function loadStoryFormatModule(
	module: StoryFormatResolvedModule,
	fetchModule: NonNullable<StoryFormatModuleLoaderOptions['fetch']>
): Promise<StoryFormatLoadedModule> {
	if (!module.resolvedUrl) {
		throw new Error(
			module.resolutionError ?? `Module "${module.id}" has no URL.`
		);
	}

	const response = await fetchModule(module.resolvedUrl);

	if (!response.ok) {
		throw new Error(
			`Could not load story format module "${module.id}" from ${module.resolvedUrl}: HTTP ${response.status}.`
		);
	}

	return {
		...module,
		mediaType: response.headers.get('content-type'),
		source: await response.text()
	};
}

export async function loadStoryFormatModules(
	properties: StoryFormatProperties,
	options: StoryFormatModuleLoaderOptions = {}
) {
	const fetchModule =
		options.fetch ??
		(url =>
			window.fetch(url, {credentials: 'same-origin'}) as Promise<Response>);
	const slots = options.slots ?? storyFormatModuleSlots;
	const resolvedModules = resolveStoryFormatModules(properties, options);
	const loadedModulesBySlot = emptyModulesBySlot<StoryFormatLoadedModule>();

	await Promise.all(
		slots.flatMap(slot =>
			resolvedModules[slot]
				.filter(module => options.includeLazy || !module.lazy)
				.map(async module => {
					loadedModulesBySlot[slot].push(
						await loadStoryFormatModule(module, fetchModule)
					);
				})
		)
	);

	return loadedModulesBySlot;
}
