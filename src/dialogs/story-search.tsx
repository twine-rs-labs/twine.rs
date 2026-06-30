import * as React from 'react';
import debounce from 'lodash/debounce';
import {useTranslation} from 'react-i18next';
import {useHistory} from 'react-router-dom';
import {DialogCard} from '../components/container/dialog-card';
import {CodeArea} from '../components/control/code-area';
import {Button, Checkbox} from '../components/design-system';
import {useCoreProjectHost} from '../core';
import type {CoreSearchHit} from '../core/bindings/CoreSearchHit';
import type {CoreStoryIndex} from '../core';
import {
	StorySearchFlags,
	highlightPassages,
	passageReplaceError,
	replaceInStoryCommand,
	selectPassage,
	storyWithId,
	useStoriesContext
} from '../store/stories';
import {
	sourceNavigationTargetFromSourceId,
	sourceTarget
} from '../routes/story-edit/source-navigation';
import {useDialogsContext} from './context';
import {DialogComponentProps} from './dialogs.types';
import {canOpenStorySource, openStorySourceDialog} from './story-source-dialog';
import './story-search.css';

// See https://github.com/codemirror/CodeMirror/issues/5444

const ignoreTab: any = {
	Tab: false,
	'Shift-Tab': false
};

// We put as much state as possible into props so that if the dialog switches
// position and is re-rendered as a new component, nothing is lost.

export interface StorySearchDialogProps extends DialogComponentProps {
	find: string;
	flags: StorySearchFlags;
	replace: string;
	storyId: string;
}

export const StorySearchDialog: React.FC<StorySearchDialogProps> = props => {
	const {find, flags, replace, storyId, onClose, onChangeProps, ...other} =
		props;
	const closingRef = React.useRef(false);
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const history = useHistory();
	const {dispatch, stories} = useStoriesContext();
	const {t} = useTranslation();
	const story = storyWithId(stories, storyId);
	const coreProjectHost = useCoreProjectHost();
	const storyRef = React.useRef(story);
	const [index, setIndex] = React.useState<CoreStoryIndex>();
	const includePassageNames = flags.includePassageNames ?? false;
	const matchCase = flags.matchCase ?? false;
	const useRegexes = flags.useRegexes ?? false;
	const errorText = React.useMemo(() => {
		const error = passageReplaceError(story.passages, find, replace, flags);

		if (error) {
			if ('passage' in error) {
				return t(`dialogs.storySearch.error.${error.error}`, {
					name: error.passage.name
				});
			}

			return t(`dialogs.storySearch.error.${error.error}`);
		}
	}, [find, flags, replace, story.passages]);
	React.useEffect(() => {
		let active = true;
		const options = {
			includeAssets: false,
			includeContents: false,
			includeDiagnostics: false,
			includeFiles: false,
			includeGraph: false,
			includePassageNames,
			includePassageText: true,
			includeScript: true,
			includeStylesheet: true,
			includeTags: false,
			includeVariables: false,
			matchCase,
			query: find,
			replacement: replace,
			useRegexes
		};

		setIndex(undefined);
		void coreProjectHost.queryStoryIndexAsync(story.id, options).then(index => {
			if (active) {
				setIndex(index);
			}
		});

		return () => {
			active = false;
		};
	}, [
		coreProjectHost,
		find,
		includePassageNames,
		matchCase,
		replace,
		story,
		useRegexes
	]);
	const searchHits = index?.searchHits ?? [];
	const matches = React.useMemo(() => {
		const passageIds = searchHits
			.map(hit => hit.passageId)
			.filter((id): id is string => !!id);

		return Array.from(new Set(passageIds));
	}, [searchHits]);
	const replaceableHits = React.useMemo(
		() =>
			searchHits.filter(hit =>
				['passageName', 'passageText', 'script', 'stylesheet'].includes(
					hit.scope
				)
			),
		[searchHits]
	);
	const debouncedDispatch = React.useMemo(
		() => debounce(dispatch, 250, {leading: false, trailing: true}),
		[dispatch]
	);

	React.useEffect(() => {
		storyRef.current = story;
	}, [story]);

	React.useEffect(
		() => () => {
			debouncedDispatch.cancel();
			dispatch(highlightPassages(storyRef.current, []));
		},
		[debouncedDispatch, dispatch]
	);

	React.useEffect(() => {
		// If we are in the process of closing, don't dispatch any highlight
		// changes. We don't want to overwrite the dispatch that occurs in
		// handleClose.

		if (!closingRef.current) {
			debouncedDispatch(highlightPassages(story, matches));
		}

		// This doesn't return a cleanup function--cleanup occurs in handleClose
		// instead. This is safe because we know this effect will only ever change
		// highlight status of passages.
	}, [debouncedDispatch, matches, story]);

	function patchProps(props: Partial<StorySearchDialogProps>) {
		// Only patch relevant props--the management props will always be
		// overwritten.

		onChangeProps({
			storyId,
			find: props.find ?? find,
			flags: props.flags ?? flags,
			replace: props.replace ?? replace
		});
	}

	function handleClose() {
		closingRef.current = true;
		debouncedDispatch.cancel();
		dispatch(highlightPassages(story, []));
		onClose();
	}

	function handleReplaceWithChange(text: string) {
		patchProps({replace: text});
	}

	function handleSearchForChange(text: string) {
		patchProps({find: text});
	}

	function handleReplace() {
		void coreProjectHost.applyStoryCommand(
			replaceInStoryCommand(story, find, replace, flags),
			'undoChange.replaceAllText'
		);
	}

	function handleSelectResult(hit: CoreSearchHit) {
		const target = sourceNavigationTargetFromSourceId(
			hit.sourceId,
			hit.passageId
		);
		const passage = hit.passageId
			? story.passages.find(passage => passage.id === hit.passageId)
			: undefined;

		if (passage) {
			dispatch(selectPassage(story, passage, true));
			dispatch(highlightPassages(story, [passage.id]));
		}

		if (target) {
			history.push(
				sourceTarget(story, {
					line: hit.line,
					offset: hit.start,
					search: {query: find, scope: hit.scope},
					target
				})
			);
		} else {
			openStorySourceDialog(dialogsDispatch, story.id, hit.sourceId, hit.scope);
		}
	}

	function toggleFlag(name: keyof StorySearchFlags) {
		patchProps({flags: {...flags, [name]: !flags[name]}});
	}

	return (
		<DialogCard
			{...other}
			className="story-search-dialog"
			fixedSize
			headerLabel={t('dialogs.storySearch.title')}
			onClose={handleClose}
		>
			<div className="search-fields">
				<CodeArea
					id="story-search-dialog-find"
					label={t('dialogs.storySearch.find')}
					onChangeText={handleSearchForChange}
					options={{
						extraKeys: ignoreTab,
						mode: 'text'
					}}
					value={find}
				/>
				<CodeArea
					id="story-search-dialog-replace-with"
					label={t('dialogs.storySearch.replaceWith')}
					onChangeText={handleReplaceWithChange}
					options={{extraKeys: ignoreTab, mode: 'text'}}
					value={replace}
				/>
			</div>
			<div className="search-flags">
				<Checkbox
					checked={flags.includePassageNames ?? false}
					label={t('dialogs.storySearch.includePassageNames')}
					onChange={() => toggleFlag('includePassageNames')}
				/>
				<Checkbox
					checked={flags.matchCase ?? false}
					label={t('dialogs.storySearch.matchCase')}
					onChange={() => toggleFlag('matchCase')}
				/>
				<Checkbox
					checked={flags.useRegexes ?? false}
					label={t('dialogs.storySearch.useRegexes')}
					onChange={() => toggleFlag('useRegexes')}
				/>
			</div>
			{errorText && <p className="search-error">{errorText}</p>}
			<div className="search-results">
				<Button
					disabled={!!errorText || replaceableHits.length === 0}
					icon="replace"
					onClick={handleReplace}
					variant="danger"
				>
					{t('dialogs.storySearch.replaceAll')}
				</Button>
				<span>
					{find
						? searchHits.length > 0
							? t('dialogs.storySearch.matchCount', {
									count: searchHits.length
								})
							: t('dialogs.storySearch.noMatches')
						: t('dialogs.storySearch.ready')}
				</span>
			</div>
			{searchHits.length > 0 && (
				<ol className="search-result-list">
					{searchHits.slice(0, 50).map((hit, index) => (
						<li key={`${hit.sourceId}-${hit.scope}-${hit.start}-${index}`}>
							<button
								className="search-result"
								disabled={
									!hit.passageId && !canOpenStorySource(hit.sourceId, hit.scope)
								}
								onClick={() => handleSelectResult(hit)}
								type="button"
							>
								<span className="search-result-title">
									{hit.sourceName}
									<span>{scopeLabel(hit.scope, t)}</span>
								</span>
								<span className="search-result-excerpt">{hit.excerpt}</span>
								{hit.before && hit.after && (
									<span className="search-result-preview">
										<del>{hit.before}</del>
										<ins>{hit.after}</ins>
									</span>
								)}
							</button>
						</li>
					))}
				</ol>
			)}
		</DialogCard>
	);
};

function scopeLabel(scope: CoreSearchHit['scope'], t: (key: string) => string) {
	return t(`dialogs.storySearch.scope.${scope}`);
}
