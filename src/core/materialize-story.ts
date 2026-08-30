import type {CoreDocumentPage} from './bindings/CoreDocumentPage';
import type {CoreProjectHost} from './project-host-public';
import type {Story, StoryWithDocuments} from '../store/stories';

export interface MaterializedStorySnapshot {
	revision: number;
	story: StoryWithDocuments;
}

/**
 * Materializes all source and retains the exact Core revision that supplied it.
 * Callers which publish companion metadata should use this result rather than
 * consulting a later React story value.
 */
export async function materializeStorySnapshotFromSession(
	host: CoreProjectHost,
	story: Story
): Promise<MaterializedStorySnapshot> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const expectedRevision = host.sessionStatus(story.id).revision;
		const passageText = new Map<string, string>();
		let script = story.script;
		let stylesheet = story.stylesheet;
		let cursor: string | null = null;
		let pageRevision: number | undefined;

		try {
			do {
				const page: CoreDocumentPage = await host.queryDocumentPageAsync(
					story.id,
					{cursor, limit: 500}
				);
				pageRevision ??= page.revision;
				if (page.revision !== pageRevision) {
					throw new Error(
						'Core document revision changed during materialization.'
					);
				}
				for (const document of page.documents) {
					if (document.kind === 'passage' && document.passageId) {
						passageText.set(document.passageId, document.text);
					} else if (document.kind === 'script') {
						script = document.text;
					} else if (document.kind === 'stylesheet') {
						stylesheet = document.text;
					}
				}
				cursor = page.nextCursor;
			} while (cursor);

			if (
				pageRevision !== expectedRevision ||
				host.sessionStatus(story.id).revision !== expectedRevision
			) {
				throw new Error('Core session changed during story materialization.');
			}
			if (
				passageText.size !== story.passages.length ||
				story.passages.some(passage => !passageText.has(passage.id))
			) {
				throw new Error(
					'Core document enumeration returned an incomplete story.'
				);
			}

			return {
				revision: expectedRevision,
				story: {
					...story,
					passages: story.passages.map(passage => ({
						...passage,
						text: passageText.get(passage.id)!
					})),
					script,
					stylesheet
				}
			};
		} catch (error) {
			if (attempt === 1) {
				throw error;
			}
		}
	}

	throw new Error('Could not materialize story documents.');
}

/** Materializes all source only for workflows that explicitly require it. */
export async function materializeStoryFromSession(
	host: CoreProjectHost,
	story: Story
): Promise<StoryWithDocuments> {
	return (await materializeStorySnapshotFromSession(host, story)).story;
}
