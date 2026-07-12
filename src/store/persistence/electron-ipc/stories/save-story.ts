import {TwineElectronWindow} from '../../../../electron/shared';
import {Story} from '../../../stories';
import {publishStory, publishStoryWithFormat} from '../../../../util/publish';
import {
	formatWithNameAndVersion,
	StoryFormatsState
} from '../../../story-formats';
import {getAppInfo} from '../../../../util/app-info';
import {fetchStoryFormatProperties} from '../../../../util/story-format/fetch-properties';
import {loadProjectMetadata} from '../../../project-metadata';
import {recordPerformanceHarnessEvent} from '../../../../util/performance';
import type {
	ProjectFolderDocumentUpdate,
	ProjectFolderSaveOptions
} from '../../project-folder-save-hints';

async function saveNativeProjectFolder(
	twineElectron: NonNullable<TwineElectronWindow['twineElectron']>,
	story: Story,
	options: ProjectFolderSaveOptions = {}
) {
	const projectMetadata = loadProjectMetadata(story.id);

	if (
		projectMetadata?.storageKind !== 'electron-project-folder' ||
		projectMetadata.status !== 'file-backed' ||
		!projectMetadata.rootPath
	) {
		return false;
	}

	if (!twineElectron.saveProjectFolder) {
		console.warn('Could not update native project folder; bridge is missing.');
		return true;
	}

	try {
		recordPerformanceHarnessEvent('save-native-call-started', {
			rootPath: projectMetadata.rootPath,
			storyId: story.id
		});
		const documentUpdates = options.documentUpdates ?? [];
		const passageDocumentUpdates = documentUpdates.filter(
			(
				update
			): update is Extract<
				ProjectFolderDocumentUpdate,
				{type: 'passageText'}
			> => update.type === 'passageText'
		);
		const useCompactIncrementalPayload =
			documentUpdates.length > 0 &&
			options.hints?.every(hint => hint.type !== 'full');
		const includesPassageMetadata = options.hints?.some(
			hint => hint.type === 'passageMetadata'
		);
		const saveStory = useCompactIncrementalPayload
			? {
					...story,
					passages: includesPassageMetadata
						? story.passages.map(passage => ({
								...passage,
								text:
									passageDocumentUpdates.find(
										update => update.passageId === passage.id
									)?.text ?? passage.text
							}))
						: passageDocumentUpdates.flatMap(update => {
								const passage = story.passages.find(
									candidate => candidate.id === update.passageId
								);
								return passage ? [{...passage, text: update.text}] : [];
							})
				}
			: story;
		const saveOptions = useCompactIncrementalPayload
			? {...options, incrementalOnly: true}
			: options;
		const hasOptions =
			!!saveOptions.hints?.length ||
			saveOptions.revision !== undefined ||
			saveOptions.sessionId !== undefined;
		const result = hasOptions
			? await twineElectron.saveProjectFolder(
					projectMetadata.rootPath,
					saveStory,
					saveOptions
				)
			: await twineElectron.saveProjectFolder(
					projectMetadata.rootPath,
					saveStory
				);
		recordPerformanceHarnessEvent('save-native-call-completed', {
			rootPath: projectMetadata.rootPath,
			storyId: story.id
		});
		if (result?.performanceTimings) {
			recordPerformanceHarnessEvent('save-native-timings', {
				rootPath: projectMetadata.rootPath,
				storyId: story.id,
				...result.performanceTimings
			});
		}
	} catch (error) {
		throw new Error(
			`Could not update native project folder: ${(error as Error).message}`,
			{cause: error}
		);
	}

	return true;
}

/**
 * Sends an IPC message to save a story to disk, ideally in published form.
 */
export async function saveStory(
	story: Story,
	formats: StoryFormatsState,
	options: ProjectFolderSaveOptions = {}
) {
	const {twineElectron} = window as TwineElectronWindow;

	if (!twineElectron) {
		throw new Error('Electron bridge is not present on window.');
	}

	if (await saveNativeProjectFolder(twineElectron, story, options)) {
		return;
	}

	let storyHtml: string;

	try {
		const format = formatWithNameAndVersion(
			formats,
			story.storyFormat,
			story.storyFormatVersion
		);

		if (format.loadState === 'loaded') {
			storyHtml = publishStoryWithFormat(
				story,
				format.properties.source,
				getAppInfo(),
				{startOptional: true}
			);
		} else {
			const {source} = await fetchStoryFormatProperties(format.url);

			storyHtml = publishStoryWithFormat(story, source, getAppInfo(), {
				startOptional: true
			});
		}
	} catch (error) {
		console.warn(
			`Could not save full story (${
				(error as Error).message
			}). Trying to save story data only.`
		);
		storyHtml = publishStory(story, getAppInfo(), {startOptional: true});
	}

	twineElectron.saveStoryHtml(story, storyHtml);
}
