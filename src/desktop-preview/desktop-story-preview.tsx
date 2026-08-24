import * as React from 'react';
import type {
	NativeStoryPreviewCommand,
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewDescriptor,
	NativeStoryPreviewReplacementResult
} from '../electron/shared';
import type {
	NativeStoryPreviewBridge,
	NativeStoryPreviewInitialState
} from '../electron/preview-ipc-channels';
import {StoryPreviewFrame} from '../routes/story-preview-frame';
import {storyPreviewDebugMetrics} from '../routes/story-preview-debug';
import {applyDocumentAppearance} from '../store/apply-document-appearance';

type PreviewWindow = Window & {
	twineStoryPreview?: NativeStoryPreviewBridge;
};

type PreviewCommandWithoutGeneration =
	NativeStoryPreviewCommand extends infer Command
		? Command extends {generation: number}
			? Omit<Command, 'generation'>
			: never
		: never;

function installedPreviewBridge() {
	const bridge = (window as PreviewWindow).twineStoryPreview;

	if (!bridge) {
		throw new Error('The desktop story preview bridge is unavailable.');
	}

	return bridge;
}

function targetLabel(descriptor: NativeStoryPreviewDescriptor) {
	switch (descriptor.target) {
		case 'play':
			return 'Play';
		case 'proof':
			return 'Proof';
		case 'test':
			return 'Test';
	}
}

function resultError(
	result: NativeStoryPreviewCommandResult | NativeStoryPreviewReplacementResult
) {
	return result.status === 'error' ? result.message : undefined;
}

export interface DesktopStoryPreviewProps {
	api?: NativeStoryPreviewBridge;
}

export const DesktopStoryPreview: React.FC<
	DesktopStoryPreviewProps
> = props => {
	const api = React.useMemo(
		() => props.api ?? installedPreviewBridge(),
		[props.api]
	);
	const [initialError, setInitialError] = React.useState<string>();
	const [operationError, setOperationError] = React.useState<string>();
	const [pendingTestGeneration, setPendingTestGeneration] =
		React.useState<number>();
	const [pendingOwnerCommandCount, setPendingOwnerCommandCount] =
		React.useState(0);
	const pendingOwnerCommandsRef = React.useRef(
		new Set<NativeStoryPreviewCommand['type']>()
	);
	const [preview, setPreview] =
		React.useState<NativeStoryPreviewInitialState>();
	const previewRef = React.useRef(preview);
	const [candidate, setCandidate] =
		React.useState<NativeStoryPreviewInitialState>();
	const candidateRef = React.useRef(candidate);
	const acknowledgingCandidateGenerationRef = React.useRef<number | undefined>(
		undefined
	);
	const markOwnerCommand = React.useCallback(
		(command: NativeStoryPreviewCommand['type'], pending: boolean) => {
			if (pending) {
				pendingOwnerCommandsRef.current.add(command);
			} else {
				pendingOwnerCommandsRef.current.delete(command);
			}
			setPendingOwnerCommandCount(pendingOwnerCommandsRef.current.size);
		},
		[]
	);

	React.useEffect(() => {
		let active = true;

		const unsubscribeAppearance = api.onAppearance(update => {
			const current = previewRef.current;

			if (!current) {
				return;
			}

			if (update.generation === current.descriptor.generation) {
				applyDocumentAppearance(update.appearance);
				const updatedPreview = {
					...current,
					descriptor: {...current.descriptor, appearance: update.appearance}
				};

				previewRef.current = updatedPreview;
				setPreview(updatedPreview);
				return;
			}

			const staged = candidateRef.current;

			if (update.generation === staged?.descriptor.generation) {
				const updatedCandidate = {
					...staged,
					descriptor: {...staged.descriptor, appearance: update.appearance}
				};

				candidateRef.current = updatedCandidate;
				setCandidate(updatedCandidate);
			}
		});
		const unsubscribeCommandResult = api.onCommandResult(result => {
			const current = previewRef.current;

			if (!current || result.generation !== current.descriptor.generation) {
				return;
			}

			setOperationError(resultError(result));
			markOwnerCommand(result.command, false);
			if (
				result.command === 'testCurrent' ||
				result.command === 'testFromStart'
			) {
				setPendingTestGeneration(undefined);
			}
		});
		const unsubscribeReplacement = api.onReplacement(result => {
			const current = previewRef.current;

			if (!current) {
				return;
			}

			if (result.status === 'error') {
				const staged = candidateRef.current;

				if (staged?.descriptor.generation === result.generation) {
					candidateRef.current = undefined;
					setCandidate(undefined);
				} else if (result.generation < current.descriptor.generation) {
					return;
				}

				setOperationError(result.message);
				return;
			}

			if (
				result.generation <= current.descriptor.generation ||
				result.generation <= (candidateRef.current?.descriptor.generation ?? -1)
			) {
				return;
			}

			const {replacement} = result;

			if (
				replacement.generation !== result.generation ||
				replacement.descriptor.generation !== result.generation
			) {
				return;
			}

			setOperationError(undefined);
			const nextPreview = {
				descriptor: replacement.descriptor,
				url: replacement.url
			};

			candidateRef.current = nextPreview;
			setCandidate(nextPreview);
		});

		void api
			.getInitialState()
			.then(initial => {
				if (!active) {
					return;
				}

				previewRef.current = initial;
				setPreview(initial);
				api.ready(initial.descriptor.generation);
			})
			.catch(error => {
				if (active) {
					setInitialError(
						error instanceof Error
							? error.message
							: 'Could not initialize the story preview.'
					);
				}
			});

		return () => {
			active = false;
			unsubscribeAppearance();
			unsubscribeCommandResult();
			unsubscribeReplacement();
		};
	}, [api, markOwnerCommand]);

	React.useEffect(() => {
		if (!preview) {
			return;
		}

		applyDocumentAppearance(preview.descriptor.appearance);
		document.title = `${preview.descriptor.storyName} — ${targetLabel(
			preview.descriptor
		)}`;
	}, [preview]);

	const sendCommand = React.useCallback(
		async (command: PreviewCommandWithoutGeneration) => {
			const generation = previewRef.current?.descriptor.generation;
			const isTestCommand =
				command.type === 'testCurrent' || command.type === 'testFromStart';

			if (
				generation === undefined ||
				pendingOwnerCommandsRef.current.has(command.type) ||
				(isTestCommand && pendingTestGeneration !== undefined)
			) {
				return;
			}

			setOperationError(undefined);
			if (isTestCommand) {
				setPendingTestGeneration(generation);
			}
			markOwnerCommand(command.type, true);

			try {
				const result = await api.command({
					...command,
					generation
				} as NativeStoryPreviewCommand);

				if (result.generation === previewRef.current?.descriptor.generation) {
					setOperationError(resultError(result));
					if (result.status !== 'busy' && isTestCommand) {
						setPendingTestGeneration(undefined);
					}
					if (result.status !== 'busy') {
						markOwnerCommand(command.type, false);
					}
				}
			} catch (error) {
				markOwnerCommand(command.type, false);
				if (isTestCommand) {
					setPendingTestGeneration(undefined);
				}
				setOperationError(
					error instanceof Error
						? error.message
						: 'The preview command could not be sent.'
				);
			}
		},
		[api, markOwnerCommand, pendingTestGeneration]
	);

	if (initialError) {
		return (
			<main className="desktop-story-preview">
				<div className="desktop-story-preview__notice" role="alert">
					{initialError}
				</div>
			</main>
		);
	}

	if (!preview) {
		return (
			<main className="desktop-story-preview">
				<div className="desktop-story-preview__loading" role="status">
					Loading story preview…
				</div>
			</main>
		);
	}

	const {descriptor, url} = preview;
	const generation = descriptor.generation;
	const contentLoaded = () => {
		void api.frameLoaded(generation).then(
			() => {
				setPendingTestGeneration(undefined);
			},
			error => {
				setPendingTestGeneration(undefined);
				setOperationError(
					error instanceof Error
						? error.message
						: 'The preview frame could not be committed.'
				);
			}
		);
	};
	const candidateLoaded = () => {
		const staged = candidateRef.current;

		if (
			!staged ||
			acknowledgingCandidateGenerationRef.current ===
				staged.descriptor.generation
		) {
			return;
		}

		const candidateGeneration = staged.descriptor.generation;

		acknowledgingCandidateGenerationRef.current = candidateGeneration;
		void api
			.frameLoaded(candidateGeneration)
			.then(
				() => {
					if (
						candidateRef.current?.descriptor.generation !== candidateGeneration
					) {
						return;
					}

					const committed = candidateRef.current;

					candidateRef.current = undefined;
					previewRef.current = committed;
					setCandidate(undefined);
					setPreview(committed);
					setPendingTestGeneration(undefined);
					markOwnerCommand('testCurrent', false);
					markOwnerCommand('testFromStart', false);
				},
				error => {
					if (
						candidateRef.current?.descriptor.generation === candidateGeneration
					) {
						candidateRef.current = undefined;
						setCandidate(undefined);
					}
					setOperationError(
						error instanceof Error
							? error.message
							: 'The preview frame could not be committed.'
					);
				}
			)
			.finally(() => {
				if (
					acknowledgingCandidateGenerationRef.current === candidateGeneration
				) {
					acknowledgingCandidateGenerationRef.current = undefined;
				}
			});
	};

	return (
		<div className="desktop-story-preview">
			{operationError && (
				<div className="desktop-story-preview__notice" role="alert">
					{operationError}
				</div>
			)}
			<StoryPreviewFrame
				contentSource={{
					bridgeSessionId: descriptor.bridgeSessionId,
					htmlBytes: descriptor.htmlBytes,
					storyDataCount: descriptor.storyDataCount,
					type: 'url',
					url
				}}
				debugMetrics={storyPreviewDebugMetrics(descriptor.summary)}
				missingStoryMessage="The story preview is unavailable."
				onCopyRuntimeLog={text => api.copyText(text)}
				onBeginClearState={() => api.beginClearState(generation)}
				onCancelClearState={operation => api.cancelClearState(operation)}
				onCompleteClearState={operation => api.completeClearState(operation)}
				onContentLoad={contentLoaded}
				onRevealGraph={passageId =>
					void sendCommand({passageId, type: 'revealGraph'})
				}
				onRevealSource={passageId =>
					void sendCommand({passageId, type: 'revealSource'})
				}
				onStagedContentLoad={candidateLoaded}
				onTestCurrentPassage={passageId =>
					void sendCommand({passageId, type: 'testCurrent'})
				}
				onTestFromStart={() => void sendCommand({type: 'testFromStart'})}
				passages={descriptor.passages}
				previewTarget={descriptor.target}
				runtimeControlsBusy={pendingOwnerCommandCount > 0}
				stagedContentSource={
					candidate
						? {
								bridgeSessionId: candidate.descriptor.bridgeSessionId,
								htmlBytes: candidate.descriptor.htmlBytes,
								storyDataCount: candidate.descriptor.storyDataCount,
								type: 'url',
								url: candidate.url
							}
						: undefined
				}
				stagedPassages={candidate?.descriptor.passages}
				stagedTitle={
					candidate
						? `${candidate.descriptor.storyName} candidate story preview`
						: undefined
				}
				startPassageName={descriptor.launchPassage?.name}
				storyExists
				storyName={descriptor.storyName}
				targetLabel={targetLabel(descriptor)}
				testCommandsBusy={pendingTestGeneration !== undefined}
				title={`${descriptor.storyName} story preview`}
			/>
		</div>
	);
};
