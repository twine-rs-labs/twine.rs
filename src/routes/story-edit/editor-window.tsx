import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	Badge,
	Button,
	IconButton,
	SourceEditor,
	SourceEditorDocumentChange,
	SourceEditorHandle,
	SourceEditorLanguage,
	TablerIcon
} from '../../components/design-system';
import {VisibleWhitespace} from '../../components/visible-whitespace';
import {TagCardButton} from '../../components/tag/tag-card-button';
import {
	setPassageTagsCommand,
	setStoryTagColorCommand,
	useCorePassageDocument,
	useCoreProjectHost,
	useCoreSourceDocument
} from '../../core';
import type {CoreStoryIndex, WorkbenchSelection} from '../../core';
import {quickFixActionsForDiagnostic} from '../../core/quick-fix-registry';
import {Passage, Story, storyPassageTags} from '../../store/stories';
import {defaults, usePrefsContext} from '../../store/prefs';
import {useStoryFormatsContext} from '../../store/story-formats';
import {useFormatEditorIntegration} from '../../store/use-format-editor-integration';
import {Color, colorString} from '../../util/color';
import {recordPerformanceHarnessEvent} from '../../util/performance';
import {registerPerformanceRetainedObject} from '../../util/performance-memory-owners';
import {rendererQuitQuiescence} from '../../util/renderer-quit-quiescence';
import {workbenchBufferCoordinator} from '../../util/workbench-buffer-coordinator';
import {
	createLegacyStreamDocumentService,
	type LegacyStreamModeAdapter
} from '../../util/story-format/legacy-editor/legacy-stream-mode';
import {useNativeEditorSession} from '../../util/story-format';
import type {EditorWindowSpec} from './editor-window-spec';
import {StoryFormatToolbar} from './story-format-toolbar';

export interface EditorWindowProps {
	active: boolean;
	index: CoreStoryIndex;
	onClose: () => void;
	onDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
	onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
	onFocus: () => void;
	onRevealPassageInGraph?: (passage: Passage) => void;
	onSelectPassage?: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	revealRequest?: {key: number; position?: number};
	searchRequest?: {key: number; query?: string};
	selection?: WorkbenchSelection;
	spec: EditorWindowSpec;
	story: Story;
}

function languageForPassage(passage: Passage): SourceEditorLanguage {
	if (passage.tags.includes('stylesheet') && !passage.tags.includes('script')) {
		return 'css';
	}

	if (passage.tags.includes('script') && !passage.tags.includes('stylesheet')) {
		return 'javascript';
	}

	if (passage.tags.includes('html')) {
		return 'html';
	}

	return 'twine';
}

function windowIcon(spec: EditorWindowSpec) {
	return spec.kind === 'script'
		? 'braces'
		: spec.kind === 'stylesheet'
			? 'file-code'
			: 'file-text';
}

interface ResolvedBuffer {
	id: string;
	language: SourceEditorLanguage;
	memoryKey: string;
	name: string;
	passage?: Passage;
	value: string;
}

interface TextInterval {
	from: number;
	to: number;
}

function mergeIntervals(intervals: TextInterval[]) {
	const sorted = [...intervals].sort((left, right) => left.from - right.from);
	const merged: TextInterval[] = [];

	for (const interval of sorted) {
		const previous = merged[merged.length - 1];

		if (previous && interval.from <= previous.to) {
			previous.to = Math.max(previous.to, interval.to);
		} else {
			merged.push({...interval});
		}
	}

	return merged;
}

function completeLineInterval(document: string, from: number, to: number) {
	const boundedFrom = Math.max(0, Math.min(from, document.length));
	const boundedTo = Math.max(boundedFrom, Math.min(to, document.length));
	const previousNewline =
		boundedFrom === 0 ? -1 : document.lastIndexOf('\n', boundedFrom - 1);
	const nextNewline = document.indexOf('\n', boundedTo);

	return {
		from: previousNewline === -1 ? 0 : previousNewline + 1,
		to: nextNewline === -1 ? document.length : nextNewline + 1
	};
}

export function countDelimiterLines(
	document: string,
	intervals?: TextInterval[]
) {
	const regions = intervals ?? [{from: 0, to: document.length}];
	let count = 0;

	for (const {from, to} of mergeIntervals(regions)) {
		const text = document.slice(from, to);
		const delimiterPattern = /(?:^|\n)--(?=\r?\n|$)/g;
		let match: RegExpExecArray | null;

		while ((match = delimiterPattern.exec(text))) {
			const delimiterPosition =
				from + match.index + (match[0].startsWith('\n') ? 1 : 0);

			// Chapbook discovers its variables section with lookAhead(), so a
			// delimiter on the current first line is not part of the predicate.
			if (delimiterPosition > 0) {
				count++;
			}
		}
	}

	return count;
}

export function delimiterDelta(
	previousDocument: string,
	change: SourceEditorDocumentChange
) {
	const oldIntervals = change.edits.map(edit =>
		completeLineInterval(previousDocument, edit.from, edit.to)
	);
	const newIntervals = change.edits.map(edit =>
		completeLineInterval(change.document, edit.fromNew, edit.toNew)
	);

	return (
		countDelimiterLines(change.document, newIntervals) -
		countDelimiterLines(previousDocument, oldIntervals)
	);
}

export function nextDelimiterState(
	previousCount: number,
	previousDocument: string,
	change: SourceEditorDocumentChange
) {
	const estimatedCount = Math.max(
		0,
		previousCount + delimiterDelta(previousDocument, change)
	);
	const hadDelimiter = previousCount > 0;

	if (hadDelimiter === estimatedCount > 0) {
		return {count: estimatedCount, presenceChanged: false};
	}

	// A controlled value echo can combine edits whose coordinate ranges make
	// incremental accounting conservative. Verify only apparent presence
	// transitions; this keeps ordinary edits bounded to changed lines.
	const verifiedCount = countDelimiterLines(change.document);

	return {
		count: verifiedCount,
		presenceChanged: hadDelimiter !== verifiedCount > 0
	};
}

export function legacyDocumentUpdateStrategy(
	lookAheadPolicy: 'chapbook-delimiter-presence' | 'current-document',
	delimiterPresenceChanged: boolean
): 'preserve-look-ahead' | 'replace-document' {
	return lookAheadPolicy === 'chapbook-delimiter-presence' &&
		!delimiterPresenceChanged
		? 'preserve-look-ahead'
		: 'replace-document';
}

export function shouldAcceptAuthoritativeText(
	expectedText: string | undefined,
	authoritativeText: string
) {
	return expectedText === undefined || expectedText === authoritativeText;
}

/**
 * One self-contained, closeable editor buffer (a passage, the story
 * JavaScript, or the story Stylesheet). The titlebar carries ONLY per-buffer
 * controls — name, dirty dot, find, close. Story-level chrome (format,
 * validate, Open editor) lives once on the dock chrome above the grid, never
 * here. See docs/product/workbench.md.
 */
export const EditorWindow: React.FC<EditorWindowProps> = props => {
	const {
		active,
		index,
		onClose,
		onDragEnd,
		onDragStart,
		onFocus,
		onRevealPassageInGraph,
		onSelectPassage,
		onTestPassage,
		revealRequest,
		searchRequest,
		selection,
		spec,
		story
	} = props;
	const {t} = useTranslation();
	const coreProjectHost = useCoreProjectHost();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const {dispatch: storyFormatsDispatch} = useStoryFormatsContext();
	const formatIntegration = useFormatEditorIntegration(
		story.storyFormat,
		story.storyFormatVersion
	);
	const [editor, setEditor] = React.useState<SourceEditorHandle>();
	const [readyBufferId, setReadyBufferId] = React.useState<string>();
	const [adapterFailure, setAdapterFailure] = React.useState<Error>();
	const [bufferSaveError, setBufferSaveError] = React.useState<Error>();
	const [delimiterGeneration, setDelimiterGeneration] = React.useState(0);
	const delimiterCount = React.useRef<number | undefined>(undefined);
	const reportedIntegrationFailures = React.useRef(new Set<string>());
	const [searchRequestKey, setSearchRequestKey] = React.useState(0);
	const combinedSearchRequestKey =
		searchRequest?.key !== undefined
			? `${searchRequestKey}:${searchRequest.key}`
			: searchRequestKey;

	const passage =
		spec.kind === 'passage'
			? story.passages.find(candidate => candidate.id === spec.passageId)
			: undefined;
	const passageDocument = useCorePassageDocument(story.id, passage?.id);
	const scriptDocument = useCoreSourceDocument(
		spec.kind === 'script' ? story.id : undefined,
		spec.kind === 'script' ? 'script' : undefined
	);
	const stylesheetDocument = useCoreSourceDocument(
		spec.kind === 'stylesheet' ? story.id : undefined,
		spec.kind === 'stylesheet' ? 'stylesheet' : undefined
	);

	const buffer = React.useMemo<ResolvedBuffer>(() => {
		if (spec.kind === 'script') {
			return {
				id: `${story.id}:script`,
				language: 'javascript',
				memoryKey: `${story.id}:script`,
				name: t('routes.storyEdit.toolbar.javaScript'),
				value: scriptDocument.document?.text ?? story.script
			};
		}

		if (spec.kind === 'stylesheet') {
			return {
				id: `${story.id}:stylesheet`,
				language: 'css',
				memoryKey: `${story.id}:stylesheet`,
				name: t('routes.storyEdit.toolbar.stylesheet'),
				value: stylesheetDocument.document?.text ?? story.stylesheet
			};
		}

		return {
			id: passage?.id ?? `${story.id}:passage`,
			language: passage ? languageForPassage(passage) : 'twine',
			memoryKey: passage ? `${story.id}:${passage.id}` : `${story.id}:passage`,
			name: passage?.name ?? t('routes.storyEdit.workspace.noPassages'),
			passage,
			value: passageDocument.document?.text ?? ''
		};
	}, [
		passage,
		passageDocument.document?.text,
		scriptDocument.document?.text,
		spec.kind,
		story.id,
		story.script,
		story.stylesheet,
		stylesheetDocument.document?.text,
		t
	]);

	const [localText, setLocalText] = React.useState(buffer.value);
	const currentLocalText = React.useRef(localText);
	const currentBufferValue = React.useRef(buffer.value);
	const expectedText = React.useRef<string | undefined>(undefined);
	const pendingText = React.useRef<string | undefined>(undefined);
	const failedPersistenceText = React.useRef<string | undefined>(undefined);
	const pendingTimeout = React.useRef<number | undefined>(undefined);
	const pendingCommit = React.useRef<Promise<void> | undefined>(undefined);
	const editRevision = React.useRef(0);
	const acceptingTextChanges = React.useRef(!rendererQuitQuiescence.isDraining);
	const [quitReadOnly, setQuitReadOnly] = React.useState(
		rendererQuitQuiescence.isDraining
	);
	const dirty = localText !== buffer.value;

	currentLocalText.current = localText;
	currentBufferValue.current = buffer.value;

	const passageNames = selection?.passageNames ?? [];
	const links = selection?.links ?? [];
	const brokenLinks = React.useMemo(
		() => (selection?.brokenLinks ?? []).map(fact => fact.targetName),
		[selection?.brokenLinks]
	);
	const backlinks = selection?.backlinks ?? [];
	const outgoingPassages = (selection?.linkFacts ?? [])
		.map(fact =>
			fact.targetId
				? story.passages.find(candidate => candidate.id === fact.targetId)
				: undefined
		)
		.filter((candidate): candidate is Passage => !!candidate);

	const inlineDiagnostics = React.useMemo(
		() =>
			passage
				? index.diagnostics.filter(
						diagnostic => diagnostic.passageId === passage.id
					)
				: [],
		[index.diagnostics, passage]
	);
	const inlineQuickFixes = React.useMemo(
		() =>
			inlineDiagnostics
				.flatMap(diagnostic =>
					quickFixActionsForDiagnostic(coreProjectHost, story, diagnostic)
				)
				.filter(action => action.enabled)
				.slice(0, 3),
		[coreProjectHost, inlineDiagnostics, story]
	);
	const passageTags = React.useMemo(() => storyPassageTags(story), [story]);

	const commitText = React.useCallback(
		(text: string) => {
			if (spec.kind === 'passage') {
				if (passage) {
					return passageDocument.apply(text);
				}
			} else if (spec.kind === 'script') {
				return scriptDocument.apply(text);
			} else {
				return stylesheetDocument.apply(text);
			}
		},
		[
			coreProjectHost,
			passage,
			passageDocument,
			scriptDocument,
			spec.kind,
			story.id,
			story.script,
			story.stylesheet,
			stylesheetDocument
		]
	);
	const commitTextRef = React.useRef(commitText);

	React.useEffect(() => {
		commitTextRef.current = commitText;
	}, [commitText]);

	const commitBufferedText = React.useCallback((text: string) => {
		const previousCommit = pendingCommit.current;
		let operation: Promise<void>;

		try {
			operation = previousCommit
				? previousCommit
						.catch(() => undefined)
						.then(() => Promise.resolve(commitTextRef.current(text)))
				: Promise.resolve(commitTextRef.current(text));
		} catch (error) {
			operation = Promise.reject(error);
		}
		const guarded = operation
			.then(() => {
				if (currentLocalText.current === text) {
					failedPersistenceText.current = undefined;
				}
				setBufferSaveError(undefined);
			})
			.catch(error => {
				if (
					pendingText.current === undefined &&
					currentLocalText.current === text
				) {
					failedPersistenceText.current = text;
				}
				setBufferSaveError(error as Error);
				throw error;
			});

		pendingCommit.current = guarded;
		void guarded.then(
			() => {
				if (pendingCommit.current === guarded) {
					pendingCommit.current = undefined;
				}
			},
			() => {
				if (pendingCommit.current === guarded) {
					pendingCommit.current = undefined;
				}
			}
		);
		return guarded;
	}, []);

	const flushPendingText = React.useCallback(() => {
		if (pendingTimeout.current) {
			window.clearTimeout(pendingTimeout.current);
			pendingTimeout.current = undefined;
		}
		const text = pendingText.current ?? failedPersistenceText.current;

		pendingText.current = undefined;
		if (text === undefined) {
			return pendingCommit.current;
		}
		return commitBufferedText(text);
	}, [commitBufferedText]);

	React.useLayoutEffect(
		() =>
			rendererQuitQuiescence.registerBuffer({
				closeAdmission() {
					acceptingTextChanges.current = false;
					setQuitReadOnly(true);
				},
				flush: flushPendingText,
				reopenAdmission() {
					acceptingTextChanges.current = true;
					setQuitReadOnly(false);
				}
			}),
		[buffer.id, flushPendingText]
	);

	React.useLayoutEffect(
		() =>
			workbenchBufferCoordinator.register({
				bufferId: buffer.id,
				flush: flushPendingText,
				hasPendingChanges: () =>
					pendingText.current !== undefined ||
					pendingCommit.current !== undefined ||
					failedPersistenceText.current !== undefined,
				revision: () => editRevision.current,
				storyId: story.id
			}),
		[buffer.id, flushPendingText, story.id]
	);

	// Flush any pending edit when the buffer changes or the window closes.
	React.useEffect(() => {
		expectedText.current = undefined;

		return () => {
			const flushing = flushPendingText();

			if (flushing) {
				void flushing.catch(() => {
					// The owning project host may already be gone during app
					// teardown. Normal in-session commits retain their error path.
				});
			}
		};
	}, [buffer.id, flushPendingText]);

	React.useEffect(() => {
		if (!shouldAcceptAuthoritativeText(expectedText.current, buffer.value)) {
			return;
		}

		if (
			failedPersistenceText.current !== undefined &&
			failedPersistenceText.current !== buffer.value
		) {
			failedPersistenceText.current = undefined;
			setBufferSaveError(undefined);
		}
		expectedText.current = undefined;
		currentLocalText.current = buffer.value;
		setLocalText(buffer.value);
		if (failedPersistenceText.current === undefined) {
			setBufferSaveError(undefined);
		}
	}, [buffer.id, buffer.value]);

	const handleChangeText = React.useCallback(
		(text: string) => {
			if (
				!acceptingTextChanges.current ||
				(spec.kind === 'passage' && !passage)
			) {
				return;
			}

			currentLocalText.current = text;
			editRevision.current++;
			setLocalText(text);
			expectedText.current = text;
			pendingText.current = text;

			if (pendingTimeout.current) {
				window.clearTimeout(pendingTimeout.current);
			}

			pendingTimeout.current = window.setTimeout(() => {
				pendingTimeout.current = undefined;
				pendingText.current = undefined;
				void commitBufferedText(text).catch(() => undefined);
			}, 300);
		},
		[commitBufferedText, passage, spec.kind]
	);

	const handleClose = React.useCallback(async () => {
		try {
			await flushPendingText();
			onClose();
		} catch {
			// The failed text remains registered and dirty for an explicit retry.
		}
	}, [flushPendingText, onClose]);

	function handleAddTag(name: string) {
		if (!passage) {
			return;
		}

		coreProjectHost.applyStoryCommand({
			type: 'batch',
			commands: [
				...(passageTags.includes(name)
					? []
					: [setStoryTagColorCommand(story.id, name, colorString(name))]),
				setPassageTagsCommand(story.id, passage.id, [...passage.tags, name])
			]
		});
	}

	function handleChangeTagColor(name: string, color: Color) {
		coreProjectHost.applyStoryCommand(
			setStoryTagColorCommand(story.id, name, color === 'none' ? null : color)
		);
	}

	function handleRemoveTag(name: string) {
		if (!passage) {
			return;
		}

		coreProjectHost.applyStoryCommand(
			setPassageTagsCommand(
				story.id,
				passage.id,
				passage.tags.filter(tag => tag !== name)
			)
		);
	}

	const missingPassage = spec.kind === 'passage' && !passage;
	const passageDocumentSettled =
		spec.kind === 'passage' &&
		!!passage &&
		!passageDocument.loading &&
		passageDocument.document?.storyId === story.id &&
		passageDocument.document.passageId === passage.id;
	const formatIntegrationApplies =
		passageDocumentSettled &&
		readyBufferId === buffer.id &&
		buffer.language === 'twine' &&
		formatIntegration.type === 'adapted-legacy';
	const nativeIntegrationApplies =
		passageDocumentSettled &&
		readyBufferId === buffer.id &&
		buffer.language === 'twine' &&
		formatIntegration.type === 'native';
	const nativeEditorSession = useNativeEditorSession(
		nativeIntegrationApplies && formatIntegration.type === 'native'
			? formatIntegration
			: undefined,
		{
			passageNames,
			preferences:
				prefs.storyFormatEditorPreferences[
					formatIntegration.type === 'native'
						? formatIntegration.dialect.id
						: 'harlowe-3.3.9'
				] ?? defaults().storyFormatEditorPreferences['harlowe-3.3.9'],
			tagNames: passageTags
		}
	);

	React.useEffect(() => {
		if (formatIntegration.type !== 'native' || !nativeEditorSession.error) {
			return;
		}

		storyFormatsDispatch({
			id: formatIntegration.formatId,
			props: {
				editorIntegrationDiagnostic: {
					code: 'native-editor-runtime-error',
					feature: 'provider',
					message:
						'Native CM6 editor integration failed; using the generic CM6 editor'
				}
			},
			type: 'update'
		});
	}, [formatIntegration, nativeEditorSession.error, storyFormatsDispatch]);
	const legacyCodeMirror =
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.codeMirror
			: undefined;
	const handleEditorRef = React.useCallback(
		(instance: SourceEditorHandle | null) =>
			setEditor(current =>
				current === (instance ?? undefined) ? current : (instance ?? undefined)
			),
		[]
	);

	React.useEffect(() => {
		setReadyBufferId(undefined);

		if (!editor || !passageDocumentSettled) {
			return;
		}

		if (editor.getSnapshot().document === currentBufferValue.current) {
			setReadyBufferId(buffer.id);
		}

		return editor.subscribeDocumentChanges(change => {
			if (change.document === currentBufferValue.current) {
				setReadyBufferId(buffer.id);
			}
		});
	}, [buffer.id, editor, passageDocumentSettled]);

	React.useEffect(() => {
		setAdapterFailure(undefined);
		setDelimiterGeneration(0);
		delimiterCount.current = undefined;
	}, [buffer.id, formatIntegration.key]);

	const legacyDocumentServiceRef = React.useRef<
		| {
				bufferId: string;
				editor: SourceEditorHandle;
				integrationKey: string;
				lifecycleToken: number;
				mode: unknown;
				service: ReturnType<typeof createLegacyStreamDocumentService>;
		  }
		| undefined
	>(undefined);
	const legacyDocumentServiceLifecycle = React.useRef(0);
	const [, renderLegacyResources] = React.useReducer(
		(revision: number) => revision + 1,
		0
	);
	const legacyDocumentServiceState = legacyDocumentServiceRef.current;
	const legacyDocumentService =
		legacyDocumentServiceState &&
		legacyDocumentServiceState.bufferId === buffer.id &&
		legacyDocumentServiceState.editor === editor &&
		legacyDocumentServiceState.integrationKey === formatIntegration.key &&
		legacyDocumentServiceState.mode === legacyCodeMirror?.mode &&
		formatIntegrationApplies
			? legacyDocumentServiceState.service
			: undefined;

	React.useEffect(() => {
		if (!editor || !formatIntegrationApplies || !legacyCodeMirror?.mode) {
			return;
		}

		const service = createLegacyStreamDocumentService(
			editor.getSnapshot().document,
			{
				onLineIndexRebuild: metrics => {
					recordPerformanceHarnessEvent('legacy-lookahead-line-index-rebuilt', {
						formatName: formatIntegration.formatName,
						formatVersion: formatIntegration.formatVersion,
						integrationKey: formatIntegration.key,
						lineIndexRebuilds: metrics.lineIndexRebuilds
					});
				}
			}
		);

		registerPerformanceRetainedObject('legacyDocumentService', service);
		const lifecycleToken = ++legacyDocumentServiceLifecycle.current;

		legacyDocumentServiceRef.current = {
			bufferId: buffer.id,
			editor,
			integrationKey: formatIntegration.key,
			lifecycleToken,
			mode: legacyCodeMirror.mode,
			service
		};

		renderLegacyResources();
		return () => {
			const current = legacyDocumentServiceRef.current;

			if (current?.lifecycleToken === lifecycleToken) {
				current.service.dispose();
				legacyDocumentServiceRef.current = undefined;
			}
		};
	}, [
		buffer.id,
		editor,
		formatIntegration.key,
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.formatName
			: undefined,
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.formatVersion
			: undefined,
		formatIntegrationApplies,
		legacyCodeMirror?.mode
	]);

	React.useEffect(() => {
		if (
			!editor ||
			!legacyDocumentService ||
			!formatIntegrationApplies ||
			!legacyCodeMirror?.mode
		) {
			return;
		}

		let previousDocument = editor.getSnapshot().document;

		legacyDocumentService.replaceDocument(previousDocument);
		delimiterCount.current = countDelimiterLines(previousDocument);

		const unsubscribe = editor.subscribeDocumentChanges(change => {
			const hadDelimiter = (delimiterCount.current ?? 0) > 0;
			const nextDelimiter = nextDelimiterState(
				delimiterCount.current ?? 0,
				previousDocument,
				change
			);
			delimiterCount.current = nextDelimiter.count;
			const delimiterPresenceChanged = nextDelimiter.presenceChanged;
			const updateStrategy = legacyDocumentUpdateStrategy(
				formatIntegration.lookAheadPolicy,
				delimiterPresenceChanged
			);

			if (updateStrategy === 'preserve-look-ahead') {
				legacyDocumentService.preserveLookAheadSnapshot();
			} else {
				legacyDocumentService.replaceDocument(change.document);
			}
			previousDocument = change.document;

			if (delimiterPresenceChanged) {
				recordPerformanceHarnessEvent('legacy-delimiter-presence-changed', {
					editCount: change.edits.length,
					formatName: formatIntegration.formatName,
					formatVersion: formatIntegration.formatVersion,
					integrationKey: formatIntegration.key,
					nextDelimiterCount: delimiterCount.current,
					previousHadDelimiter: hadDelimiter
				});
				setDelimiterGeneration(generation => generation + 1);
			}
		});

		return () => {
			unsubscribe();
		};
	}, [
		editor,
		formatIntegration.key,
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.formatName
			: undefined,
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.formatVersion
			: undefined,
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.lookAheadPolicy
			: undefined,
		formatIntegrationApplies,
		legacyCodeMirror?.mode,
		legacyDocumentService
	]);

	const reportIntegrationFailure = React.useCallback(
		(feature: 'command' | 'mode' | 'toolbar', error: Error) => {
			const apiName =
				'apiName' in error && typeof error.apiName === 'string'
					? error.apiName
					: undefined;
			const detail = apiName ?? error.message;
			const key = `${formatIntegration.key}:${feature}:${error.name}:${detail}`;

			if (!reportedIntegrationFailures.current.has(key)) {
				reportedIntegrationFailures.current.add(key);
				if (formatIntegration.type === 'adapted-legacy') {
					storyFormatsDispatch({
						id: formatIntegration.formatId,
						props: {
							editorIntegrationDiagnostic: {
								code: 'legacy-editor-runtime-error',
								feature,
								message: apiName
									? `Legacy editor ${feature} disabled after an unsupported format API call`
									: `Legacy editor ${feature} disabled: ${error.message}`,
								unsupportedApi: apiName
							}
						},
						type: 'update'
					});
				} else if (formatIntegration.type === 'native') {
					storyFormatsDispatch({
						id: formatIntegration.formatId,
						props: {
							editorIntegrationDiagnostic: {
								code: 'native-editor-runtime-error',
								feature,
								message: `Native CM6 editor ${feature} disabled; using the generic CM6 editor`
							}
						},
						type: 'update'
					});
				}
				console.warn(
					`Story format editor fallback for ${story.storyFormat} ${story.storyFormatVersion}: ${feature} failed (${error.name}: ${detail})`
				);
			}
		},
		[
			formatIntegration.key,
			formatIntegration.type,
			formatIntegration.type === 'adapted-legacy'
				? formatIntegration.formatId
				: undefined,
			story.storyFormat,
			story.storyFormatVersion,
			storyFormatsDispatch
		]
	);

	const reportIntegrationFailureRef = React.useRef(reportIntegrationFailure);

	reportIntegrationFailureRef.current = reportIntegrationFailure;
	const modeAdapterRecipe =
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.modeAdapterRecipe
			: undefined;

	const adaptedModeKey =
		!adapterFailure &&
		legacyDocumentService &&
		modeAdapterRecipe &&
		formatIntegrationApplies
			? `${buffer.id}:${formatIntegration.key}:${delimiterGeneration}`
			: undefined;
	const adaptedModeRef = React.useRef<
		| {
				adapter: LegacyStreamModeAdapter;
				key: string;
				lifecycleToken: number;
				recipe: NonNullable<typeof modeAdapterRecipe>;
				service: ReturnType<typeof createLegacyStreamDocumentService>;
		  }
		| undefined
	>(undefined);
	const adaptedModeLifecycle = React.useRef(0);
	const adaptedModeState = adaptedModeRef.current;
	const adaptedMode =
		adaptedModeKey &&
		adaptedModeState?.key === adaptedModeKey &&
		adaptedModeState.recipe === modeAdapterRecipe &&
		adaptedModeState.service === legacyDocumentService
			? adaptedModeState.adapter
			: undefined;

	React.useEffect(() => {
		if (
			!adaptedModeKey ||
			!legacyDocumentService ||
			!formatIntegrationApplies ||
			!modeAdapterRecipe ||
			adapterFailure
		) {
			return;
		}

		const adapter = modeAdapterRecipe.create({
			documentService: legacyDocumentService,
			onFailure: failure => {
				const error = new Error(failure.message) as Error & {
					apiName?: string;
				};

				error.name = `LegacyStreamMode${failure.kind}`;
				error.apiName = failure.unsupportedApi;
				queueMicrotask(() => {
					reportIntegrationFailureRef.current('mode', error);
					setAdapterFailure(error);
				});
			}
		});

		registerPerformanceRetainedObject('legacyModeAdapter', adapter);
		recordPerformanceHarnessEvent('legacy-editor-adapter-created', {
			delimiterGeneration,
			formatName: formatIntegration.formatName,
			formatVersion: formatIntegration.formatVersion,
			integrationKey: formatIntegration.key
		});
		const lifecycleToken = ++adaptedModeLifecycle.current;

		adaptedModeRef.current = {
			adapter,
			key: adaptedModeKey,
			lifecycleToken,
			recipe: modeAdapterRecipe,
			service: legacyDocumentService
		};

		renderLegacyResources();
		return () => {
			const current = adaptedModeRef.current;

			if (current?.lifecycleToken === lifecycleToken) {
				current.adapter.dispose();
				adaptedModeRef.current = undefined;
			}
		};
	}, [
		adaptedModeKey,
		adapterFailure,
		delimiterGeneration,
		formatIntegration.key,
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.formatName
			: undefined,
		formatIntegration.type === 'adapted-legacy'
			? formatIntegration.formatVersion
			: undefined,
		formatIntegrationApplies,
		legacyDocumentService,
		modeAdapterRecipe
	]);

	return (
		<section
			aria-label={buffer.name}
			className={classNames('story-edit-editor-window', {
				'is-active': active
			})}
			onPointerDownCapture={onFocus}
		>
			<header
				className="story-edit-editor-window-bar"
				draggable={!!onDragStart}
				onDragEnd={onDragEnd}
				onDragStart={onDragStart}
			>
				<TablerIcon
					className="story-edit-editor-window-grip"
					icon="grip-vertical"
				/>
				<TablerIcon
					className="story-edit-editor-window-icon"
					icon={windowIcon(spec)}
				/>
				<span className="story-edit-editor-window-name">
					<VisibleWhitespace value={buffer.name} />
				</span>
				{dirty && (
					<span
						aria-label={t('common.unsavedChanges')}
						className="story-edit-editor-window-dirty"
						title={t('common.unsavedChanges')}
					/>
				)}
				{bufferSaveError && (
					<Badge
						icon="alert-triangle"
						title={bufferSaveError.message}
						tone="error"
					>
						Save failed
					</Badge>
				)}
				<span className="story-edit-editor-window-bar-sp" />
				<IconButton
					icon="search"
					label={t('routes.storyEdit.workspace.findInEditor')}
					onClick={() => setSearchRequestKey(key => key + 1)}
					size="sm"
				/>
				<IconButton
					icon="x"
					label={`${t('common.close')} ${buffer.name}`}
					onClick={() => void handleClose()}
					size="sm"
				/>
			</header>

			{spec.kind === 'passage' && passage && (
				<div className="story-edit-editor-window-sub">
					<TagCardButton
						allTags={passageTags}
						id={`story-editor-window-tag-input-${passage.id}`}
						onAdd={handleAddTag}
						onChangeColor={handleChangeTagColor}
						onRemove={handleRemoveTag}
						tagColors={story.tagColors}
						tags={passage.tags}
					/>
					<span className="story-edit-editor-window-sub-sp" />
					{brokenLinks.length > 0 && (
						<Badge icon="unlink" tone="error">
							{brokenLinks.length}
						</Badge>
					)}
					<Badge icon="arrow-up-right" tone="link">
						{links.length}
					</Badge>
					<Badge icon="arrow-back-up" tone="neutral">
						{backlinks.length}
					</Badge>
					{onTestPassage && (
						<IconButton
							icon="tool"
							label={t('routes.storyEdit.toolbar.testFromHere')}
							onClick={() => onTestPassage(passage)}
							size="sm"
						/>
					)}
					{onRevealPassageInGraph && (
						<IconButton
							icon="focus-2"
							label={t('routes.storyEdit.workspace.revealInGraph')}
							onClick={() => onRevealPassageInGraph(passage)}
							size="sm"
						/>
					)}
				</div>
			)}

			{missingPassage ? (
				<p className="story-edit-editor-window-empty">
					{t('routes.storyEdit.workspace.noPassages')}
				</p>
			) : (
				<div className="story-edit-editor-window-code">
					<SourceEditor
						autocompletePassageNames={passageNames}
						brokenLinkNames={spec.kind === 'passage' ? brokenLinks : undefined}
						completionSources={nativeEditorSession.session?.completionSources}
						dynamicExtensions={
							nativeEditorSession.session
								? [...nativeEditorSession.session.extensions]
								: adaptedMode
									? [adaptedMode.extension]
									: undefined
						}
						dynamicExtensionsKey={`${buffer.id}:${formatIntegration.key}:${delimiterGeneration}:${
							nativeEditorSession.error
								? 'native-failed'
								: nativeEditorSession.session
									? nativeEditorSession.session.key
									: adapterFailure
										? 'failed'
										: adaptedMode
											? 'active'
											: 'inactive'
						}`}
						id={`story-editor-window-${buffer.id}`}
						key={buffer.id}
						label={t('dialogs.passageEdit.passageTextEditorLabel')}
						language={buffer.language}
						memoryKey={buffer.memoryKey}
						onChange={handleChangeText}
						onDynamicExtensionError={error => {
							reportIntegrationFailure('mode', error);
							setAdapterFailure(error);
						}}
						placeholderText={t('dialogs.passageEdit.passageTextPlaceholder')}
						readOnly={quitReadOnly}
						ref={handleEditorRef}
						replaceGenericTwineSyntax={
							nativeEditorSession.session?.ownsSyntax ?? !!adaptedMode
						}
						revealPosition={
							revealRequest?.position !== undefined
								? {
										key: revealRequest.key,
										position: revealRequest.position
									}
								: undefined
						}
						searchQuery={searchRequest?.query}
						searchRequestKey={combinedSearchRequestKey}
						selfLinkName={spec.kind === 'passage' ? passage?.name : undefined}
						useCodeFont={nativeEditorSession.session?.useCodeFont}
						value={localText}
					/>
				</div>
			)}

			{editor &&
				formatIntegrationApplies &&
				formatIntegration.codeMirror.toolbar && (
					<StoryFormatToolbar
						editor={editor}
						integration={formatIntegration}
						onFailure={reportIntegrationFailure}
					/>
				)}

			{editor &&
				nativeEditorSession.session?.Toolbar &&
				formatIntegration.type === 'native' && (
					<nativeEditorSession.session.Toolbar
						controller={nativeEditorSession.session.controller}
						editor={editor}
						onChangePreferences={preferences =>
							prefsDispatch({
								name: 'storyFormatEditorPreferences',
								type: 'update',
								value: {
									...prefs.storyFormatEditorPreferences,
									[formatIntegration.dialect.id]: preferences
								}
							})
						}
						preferences={
							prefs.storyFormatEditorPreferences[
								formatIntegration.dialect.id
							] ?? defaults().storyFormatEditorPreferences['harlowe-3.3.9']
						}
					/>
				)}

			{spec.kind === 'passage' && brokenLinks.length > 0 && (
				<div className="story-edit-editor-window-diag">
					<TablerIcon icon="alert-octagon" />
					<strong>{t('routes.storyEdit.workspace.brokenLinks')}</strong>
					<span>{brokenLinks.join(', ')}</span>
					{inlineQuickFixes.map(action => (
						<Button
							icon="wand"
							key={action.command}
							onClick={action.apply}
							size="sm"
							variant="ghost"
						>
							{action.title}
						</Button>
					))}
					{outgoingPassages.length > 0 && onSelectPassage && (
						<Button
							icon="arrow-up-right"
							onClick={() => onSelectPassage(outgoingPassages[0])}
							size="sm"
							variant="primary"
						>
							{t('routes.storyEdit.workspace.links')}
						</Button>
					)}
				</div>
			)}
		</section>
	);
};
