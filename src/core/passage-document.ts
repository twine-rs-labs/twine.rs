import * as React from 'react';
import type {CorePassageDocument} from './bindings/CorePassageDocument';
import type {CoreSourceDocument} from './bindings/CoreSourceDocument';
import {useCoreProjectHost} from './project-host';
import {recordPerformanceHarnessEvent} from '../util/performance';

const maxDocumentCount = 32;
const maxDocumentBytes = 8 * 1024 * 1024;

interface CacheEntry {
	document: CorePassageDocument;
	lastUsed: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(storyId: string, passageId: string) {
	return `${storyId}:${passageId}`;
}

function documentBytes(document: CorePassageDocument) {
	return document.text.length * 2;
}

function retain(document: CorePassageDocument) {
	cache.set(cacheKey(document.storyId, document.passageId), {
		document,
		lastUsed: Date.now()
	});
	let bytes = [...cache.values()].reduce(
		(total, entry) => total + documentBytes(entry.document),
		0
	);
	while (cache.size > maxDocumentCount || bytes > maxDocumentBytes) {
		const oldest = [...cache.entries()].sort(
			([, left], [, right]) => left.lastUsed - right.lastUsed
		)[0];
		if (!oldest) {
			break;
		}
		cache.delete(oldest[0]);
		bytes -= documentBytes(oldest[1].document);
	}
}

export interface CorePassageDocumentState {
	apply(text: string): Promise<void>;
	document?: CorePassageDocument;
	error?: Error;
	loading: boolean;
}

/** Loads only the active passage body and keeps a small cross-editor LRU. */
export function useCorePassageDocument(
	storyId: string | undefined,
	passageId: string | undefined
): CorePassageDocumentState {
	const host = useCoreProjectHost();
	const key = storyId && passageId ? cacheKey(storyId, passageId) : undefined;
	const [document, setDocument] = React.useState<
		CorePassageDocument | undefined
	>(() => (key ? cache.get(key)?.document : undefined));
	const [error, setError] = React.useState<Error>();
	const [loading, setLoading] = React.useState(!!key && !document);

	React.useEffect(() => {
		let active = true;
		if (!storyId || !passageId) {
			setDocument(undefined);
			setLoading(false);
			return;
		}
		const cached = cache.get(cacheKey(storyId, passageId));
		if (cached) {
			cached.lastUsed = Date.now();
			setDocument(cached.document);
			setLoading(false);
		}
		if (
			!cached ||
			cached.document.revision !== host.sessionStatus(storyId).revision
		) {
			setLoading(true);
			void host
				.queryPassageDocumentAsync(storyId, passageId)
				.then(next => {
					if (active) {
						retain(next);
						setDocument(next);
						setError(undefined);
						recordPerformanceHarnessEvent('core-passage-document-ready', {
							passageId,
							revision: next.revision,
							storyId,
							textBytes: next.text.length * 2
						});
					}
				})
				.catch(reason => active && setError(reason as Error))
				.finally(() => active && setLoading(false));
		}
		const unsubscribe = host.subscribeToPatches(batch => {
			for (const patch of batch.patches) {
				if (
					patch.type === 'passageUpdated' &&
					patch.story_id === storyId &&
					patch.passage_id === passageId &&
					patch.changes.text !== null
				) {
					const next = {
						passageId,
						revision: host.sessionStatus(storyId).revision,
						storyId,
						text: patch.changes.text
					};
					retain(next);
					setDocument(next);
				}
			}
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [host, passageId, storyId]);

	const apply = React.useCallback(
		async (text: string) => {
			if (!storyId || !passageId || text === document?.text) {
				return;
			}
			await host.applyStoryCommandPersisted({
				passage_id: passageId,
				story_id: storyId,
				text,
				type: 'updatePassageText'
			});
		},
		[document?.text, host, passageId, storyId]
	);

	return {apply, document, error, loading};
}

export function useCoreSourceDocument(
	storyId: string | undefined,
	kind: 'script' | 'stylesheet' | undefined
) {
	const host = useCoreProjectHost();
	const [document, setDocument] = React.useState<CoreSourceDocument>();
	const [error, setError] = React.useState<Error>();
	const [loading, setLoading] = React.useState(true);

	React.useEffect(() => {
		let active = true;
		if (!storyId || !kind) {
			setDocument(undefined);
			setLoading(false);
			return;
		}
		setLoading(true);
		void host
			.querySourceDocumentAsync(storyId, kind)
			.then(next => {
				if (active) {
					setDocument(next);
					recordPerformanceHarnessEvent('core-source-document-ready', {
						kind,
						revision: next.revision,
						storyId,
						textBytes: next.text.length * 2
					});
				}
			})
			.catch(reason => active && setError(reason as Error))
			.finally(() => active && setLoading(false));
		const unsubscribe = host.subscribeToPatches(batch => {
			const patch = batch.patches.find(
				candidate =>
					'story_id' in candidate &&
					candidate.story_id === storyId &&
					candidate.type ===
						(kind === 'script'
							? 'storyScriptUpdated'
							: 'storyStylesheetUpdated')
			);
			if (patch?.type === 'storyScriptUpdated') {
				setDocument({
					kind: 'script',
					revision: host.sessionStatus(storyId).revision,
					storyId,
					text: patch.script
				});
			} else if (patch?.type === 'storyStylesheetUpdated') {
				setDocument({
					kind: 'stylesheet',
					revision: host.sessionStatus(storyId).revision,
					storyId,
					text: patch.stylesheet
				});
			}
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [host, kind, storyId]);

	const apply = React.useCallback(
		async (text: string) => {
			if (!storyId || !kind || text === document?.text) {
				return;
			}
			await host.applyStoryCommandPersisted(
				kind === 'script'
					? {script: text, story_id: storyId, type: 'updateStoryScript'}
					: {
							story_id: storyId,
							stylesheet: text,
							type: 'updateStoryStylesheet'
						}
			);
		},
		[document?.text, host, kind, storyId]
	);

	return {apply, document, error, loading};
}
