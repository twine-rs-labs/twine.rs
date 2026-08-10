import * as React from 'react';
import {LoadingCurtain} from '../components/loading-curtain';
import {Badge, Button, Panel} from '../components/design-system';
import {PersistenceHooks, usePersistence} from './persistence/use-persistence';
import {usePrefsContext} from './prefs';
import {useStoriesContext} from './stories';
import {useStoryFormatsContext} from './story-formats';
import {useStoriesRepair} from './use-stories-repair';
import {markPerformance, measurePerformance} from '../util/performance';
import {
	metadataStory,
	registerBootstrapStories
} from '../core/bootstrap-stories';
import type {Story, StoryWithDocuments} from './stories';
import {isElectronRenderer} from '../util/is-electron';
import {
	discardInvalidLocalReplacementRecovery,
	inspectLocalReplacementRecovery,
	LocalReplacementRecoveryDecision,
	LocalReplacementRecoveryIssue,
	LocalReplacementRecoveryReport,
	recoverLocalReplacementJournal,
	resolveLocalReplacementRecovery
} from './persistence/local-storage/stories/replacement-recovery';
import './state-loader.css';

interface LoadedState {
	formatsState: Awaited<ReturnType<PersistenceHooks['storyFormats']['load']>>;
	prefsState: Awaited<ReturnType<PersistenceHooks['prefs']['load']>>;
	storiesState: Awaited<ReturnType<PersistenceHooks['stories']['load']>>;
}

interface InitialStateLoad extends PersistedStateLoad {
	recoveryReport: LocalReplacementRecoveryReport;
}

interface PersistedStateLoad {
	errors: unknown[];
	state: LoadedState;
}

interface PendingLocalRecovery {
	report: LocalReplacementRecoveryReport;
}

const emptyRecoveryReport: LocalReplacementRecoveryReport = {issues: []};

function isStorageAccessError(error: unknown) {
	return error instanceof DOMException && error.name === 'SecurityError';
}

function unavailableRecoveryReport(
	error: unknown
): LocalReplacementRecoveryReport {
	return {
		issues: [
			{
				canKeepCurrent: false,
				canRestoreOriginal: false,
				message: `Browser storage is unavailable: ${(error as Error).message}`,
				state: 'unavailable',
				storyName: 'Browser storage unavailable'
			}
		]
	};
}

function retryAutomaticLocalRecovery(
	report: LocalReplacementRecoveryReport
): LocalReplacementRecoveryReport {
	// Preserve the startup recovery's one automatic retry, but keep both mutating
	// attempts ahead of any persistence snapshot that can be admitted.
	return report.issues.length > 0 ? recoverLocalReplacementJournal() : report;
}

const LocalReplacementRecoveryResolver: React.FC<{
	busy: boolean;
	error?: string;
	onDecision: (
		issue: LocalReplacementRecoveryIssue,
		decision: LocalReplacementRecoveryDecision
	) => void;
	onRetry: () => void;
	report: LocalReplacementRecoveryReport;
}> = ({busy, error, onDecision, onRetry, report}) => (
	<main
		aria-labelledby="local-replacement-recovery-title"
		className="local-replacement-recovery"
	>
		<Panel icon="rotate-clockwise" pad title="Project recovery required">
			<h1 id="local-replacement-recovery-title">Review recovered projects</h1>
			<p>
				A previous import did not finish cleanly. Project sessions will remain
				closed until each affected local project has a safe resolution.
			</p>
			<div className="local-replacement-recovery__issues">
				{report.issues.map((issue, index) => (
					<section
						className="local-replacement-recovery__issue"
						key={issue.storyId ?? `invalid-${index}`}
					>
						<div>
							<strong>{issue.storyName}</strong>
							<p>{issue.message}</p>
						</div>
						{issue.canKeepCurrent || issue.canRestoreOriginal ? (
							<div className="local-replacement-recovery__actions">
								{issue.canKeepCurrent ? (
									<Button
										aria-label={`Keep current ${issue.storyName}`}
										disabled={busy}
										onClick={() => onDecision(issue, 'keep-current')}
									>
										Keep Current
									</Button>
								) : null}
								{issue.canRestoreOriginal ? (
									<Button
										aria-label={`Restore original ${issue.storyName}`}
										disabled={busy}
										onClick={() => onDecision(issue, 'restore-original')}
										variant="primary"
									>
										Restore Original
									</Button>
								) : null}
							</div>
						) : null}
					</section>
				))}
			</div>
			{error || report.error ? (
				<Badge icon="alert-octagon" role="alert" tone="error">
					{error ?? report.error}
				</Badge>
			) : null}
			<div className="local-replacement-recovery__footer">
				<Button icon="refresh" loading={busy} onClick={onRetry}>
					Retry Recovery
				</Button>
			</div>
		</Panel>
	</main>
);

function storiesWithDocuments(stories: Story[]): StoryWithDocuments[] {
	if (
		stories.some(story =>
			story.passages.some(
				passage =>
					!('text' in passage) ||
					typeof (passage as {text?: unknown}).text !== 'string'
			)
		)
	) {
		throw new Error('Loaded story state is missing passage documents.');
	}
	return stories as StoryWithDocuments[];
}

async function loadOrDefault<T>(
	name: string,
	load: () => Promise<T>,
	defaultValue: T,
	onError?: (error: unknown) => void
): Promise<T> {
	try {
		return await load();
	} catch (error) {
		onError?.(error);
		console.warn(
			`Could not load ${name}; continuing with default state: ${
				(error as Error).message
			}`
		);
		return defaultValue;
	}
}

export const StateLoader: React.FC<React.PropsWithChildren> = ({children}) => {
	const [inited, setInited] = React.useState(false);
	const [pendingLocalRecovery, setPendingLocalRecovery] =
		React.useState<PendingLocalRecovery>();
	const [recoveryBusy, setRecoveryBusy] = React.useState(false);
	const [recoveryError, setRecoveryError] = React.useState<string>();
	const [prefsRepaired, setPrefsRepaired] = React.useState(false);
	const [formatsRepaired, setFormatsRepaired] = React.useState(false);
	const [storiesRepaired, setStoriesRepaired] = React.useState(false);
	const [passageBodiesSeparated, setPassageBodiesSeparated] =
		React.useState(false);
	const {dispatch: prefsDispatch, prefs: prefsState} = usePrefsContext();
	const {dispatch: storiesDispatch, stories: storiesState = []} =
		useStoriesContext();
	const {dispatch: formatsDispatch, formats: formatsState} =
		useStoryFormatsContext();
	const repairStories = useStoriesRepair();
	const {prefs, stories, storyFormats} = usePersistence();
	const initializationRef = React.useRef<Promise<InitialStateLoad> | undefined>(
		undefined
	);
	const initializationAppliedRef = React.useRef(false);
	const mountedRef = React.useRef(true);
	const recoveryRunActiveRef = React.useRef(false);
	const applyLoadedState = React.useCallback(
		({formatsState, prefsState, storiesState}: LoadedState) => {
			if (!mountedRef.current || initializationAppliedRef.current) {
				return;
			}
			initializationAppliedRef.current = true;
			formatsDispatch({type: 'init', state: formatsState});
			prefsDispatch({type: 'init', state: prefsState});
			storiesDispatch({type: 'init', state: storiesState});
			markPerformance('all-passages-ready');
			setPendingLocalRecovery(undefined);
			setInited(true);
		},
		[formatsDispatch, prefsDispatch, storiesDispatch]
	);
	const loadPersistedState =
		React.useCallback(async (): Promise<PersistedStateLoad> => {
			const errors: unknown[] = [];
			const recordError = (error: unknown) => errors.push(error);
			const [formatsState, prefsState, storiesState] = await Promise.all([
				loadOrDefault('story formats', storyFormats.load, [], recordError),
				loadOrDefault('preferences', prefs.load, {}, recordError),
				loadOrDefault('stories', stories.load, [], recordError)
			]);

			return {
				errors,
				state: {formatsState, prefsState, storiesState}
			};
		}, [prefs, stories, storyFormats]);

	React.useEffect(() => {
		mountedRef.current = true;

		return () => {
			mountedRef.current = false;
		};
	}, []);

	// Done in steps so that the repair action can see the inited state, and then
	// each repair action can see the results of the preceding ones.
	//
	// Repairs must go:
	// formats -> prefs (so it can repair bad format preferences) -> stories

	React.useEffect(() => {
		let canceled = false;

		if (!initializationRef.current) {
			markPerformance('open-start');
			initializationRef.current = (async () => {
				const electron = isElectronRenderer();
				const recoveryReport = electron
					? emptyRecoveryReport
					: retryAutomaticLocalRecovery(recoverLocalReplacementJournal());
				// Load every persistence domain so storage failures are reported together.
				// This state is disposable unless the pre-snapshot recovery report is clean.
				const loaded = await loadPersistedState();

				return {
					...loaded,
					recoveryReport
				};
			})();
		}

		void initializationRef.current.then(({errors, recoveryReport, state}) => {
			if (canceled || initializationAppliedRef.current) {
				return;
			}
			const electron = isElectronRenderer();
			const inspectionReport = electron
				? emptyRecoveryReport
				: inspectLocalReplacementRecovery();
			const storageAccessError = electron
				? undefined
				: errors.find(isStorageAccessError);
			const gatedReport =
				recoveryReport.issues.length > 0
					? recoveryReport
					: inspectionReport.issues.length > 0
						? inspectionReport
						: storageAccessError
							? unavailableRecoveryReport(storageAccessError)
							: inspectionReport;

			if (gatedReport.issues.length > 0) {
				setPendingLocalRecovery({report: gatedReport});
				return;
			}
			applyLoadedState(state);
		});

		return () => {
			canceled = true;
		};
	}, [applyLoadedState, loadPersistedState]);

	const finishRecovery = React.useCallback(
		async (operationReport: LocalReplacementRecoveryReport) => {
			const recoveryReport = retryAutomaticLocalRecovery(operationReport);

			if (mountedRef.current) {
				setPendingLocalRecovery({report: recoveryReport});
			}
			// An unresolved report makes this a disposable availability probe. Only a
			// snapshot taken after clean recovery can reach applyLoadedState().
			const {errors, state: loaded} = await loadPersistedState();
			const inspectionReport = inspectLocalReplacementRecovery();
			const storageAccessError = errors.find(isStorageAccessError);

			if (!mountedRef.current) {
				return;
			}
			const gatedReport =
				recoveryReport.issues.length > 0
					? recoveryReport
					: inspectionReport.issues.length > 0
						? inspectionReport
						: storageAccessError
							? unavailableRecoveryReport(storageAccessError)
							: inspectionReport;

			if (gatedReport.issues.length > 0) {
				setPendingLocalRecovery({report: gatedReport});
				return;
			}
			applyLoadedState(loaded);
		},
		[applyLoadedState, loadPersistedState]
	);

	async function handleRecoveryDecision(
		issue: LocalReplacementRecoveryIssue,
		decision: LocalReplacementRecoveryDecision
	) {
		if (!pendingLocalRecovery || recoveryRunActiveRef.current) {
			return;
		}
		recoveryRunActiveRef.current = true;
		setRecoveryBusy(true);
		setRecoveryError(undefined);

		try {
			const report =
				issue.state === 'invalid'
					? discardInvalidLocalReplacementRecovery()
					: resolveLocalReplacementRecovery(issue.storyId!, decision);

			await finishRecovery(report);
		} catch (error) {
			if (mountedRef.current) {
				setRecoveryError((error as Error).message);
			}
		} finally {
			recoveryRunActiveRef.current = false;
			if (mountedRef.current) {
				setRecoveryBusy(false);
			}
		}
	}

	async function handleRecoveryRetry() {
		if (!pendingLocalRecovery || recoveryRunActiveRef.current) {
			return;
		}
		recoveryRunActiveRef.current = true;
		setRecoveryBusy(true);
		setRecoveryError(undefined);

		try {
			await finishRecovery(recoverLocalReplacementJournal());
		} catch (error) {
			if (mountedRef.current) {
				setRecoveryError((error as Error).message);
			}
		} finally {
			recoveryRunActiveRef.current = false;
			if (mountedRef.current) {
				setRecoveryBusy(false);
			}
		}
	}

	React.useEffect(() => {
		if (inited && !formatsRepaired) {
			formatsDispatch({type: 'repair'});
			setFormatsRepaired(true);
		}
	}, [formatsDispatch, formatsRepaired, inited]);

	React.useEffect(() => {
		if (inited && formatsRepaired && !prefsRepaired) {
			prefsDispatch({type: 'repair', allFormats: formatsState});
			setPrefsRepaired(true);
		}
	}, [formatsRepaired, formatsState, inited, prefsDispatch, prefsRepaired]);

	React.useEffect(() => {
		if (inited && formatsRepaired && prefsRepaired && !storiesRepaired) {
			repairStories();
			setStoriesRepaired(true);
		}
	}, [
		formatsDispatch,
		formatsRepaired,
		formatsState,
		inited,
		prefsDispatch,
		prefsRepaired,
		prefsState.storyFormat.name,
		prefsState.storyFormat.version,
		repairStories,
		stories,
		storiesDispatch,
		storiesRepaired
	]);

	React.useEffect(() => {
		if (inited && formatsRepaired && prefsRepaired && storiesRepaired) {
			if (!passageBodiesSeparated) {
				const completeStories = storiesWithDocuments(storiesState);
				registerBootstrapStories(completeStories);
				storiesDispatch({
					state: completeStories.map(metadataStory),
					type: 'init'
				});
				setPassageBodiesSeparated(true);
				return;
			}

			markPerformance('shell-visible');
			measurePerformance('open-to-shell', 'open-start', 'shell-visible');
		}
	}, [
		formatsRepaired,
		inited,
		passageBodiesSeparated,
		prefsRepaired,
		storiesDispatch,
		storiesRepaired,
		storiesState
	]);

	if (pendingLocalRecovery) {
		return (
			<LocalReplacementRecoveryResolver
				busy={recoveryBusy}
				error={recoveryError}
				onDecision={handleRecoveryDecision}
				onRetry={handleRecoveryRetry}
				report={pendingLocalRecovery.report}
			/>
		);
	}

	return inited &&
		formatsRepaired &&
		prefsRepaired &&
		storiesRepaired &&
		passageBodiesSeparated ? (
		<>{children}</>
	) : (
		<LoadingCurtain />
	);
};
