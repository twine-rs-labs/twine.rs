import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router';
import {Button, Checkbox} from '../../components/design-system';
import {TagEditor} from '../../components/tag/tag-editor';
import {StoryFormatSelect} from '../../components/story-format/story-format-select';
import {
	formatWithId,
	formatWithNameAndVersion,
	useStoryFormatsContext
} from '../../store/story-formats';
import {FormatLoader} from '../../store/format-loader';
import {Color} from '../../util/color';
import {
	renamePassageTagCommand,
	replaceAllTextCommand,
	setStoryFormatCommand,
	setStorySnapToGridCommand,
	setStoryTagColorCommand,
	type StoryCommand
} from '../../core';
import type {CoreContentsPage} from '../../core/bindings/CoreContentsPage';
import type {CoreSearchHit} from '../../core/bindings/CoreSearchHit';
import type {CoreSearchPage} from '../../core/bindings/CoreSearchPage';
import type {CoreStorySummary} from '../../core/bindings/CoreStorySummary';
import type {CoreTagEntry} from '../../core/bindings/CoreTagEntry';
import {
	editorWindowSpecForSourceNavigationTarget,
	sourceNavigationTargetFromSourceId
} from './source-navigation';
import type {StoryWorkbenchExtensionContext} from './workbench-extensions';
import './story-workbench-panels.css';

const dateFormatter = new Intl.DateTimeFormat([], {
	dateStyle: 'full',
	timeStyle: 'long'
});
const emptySearchHits: CoreSearchHit[] = [];

export interface FindReplaceWorkbenchRequest {
	includePassageNames?: boolean;
	key: number;
	query?: string;
}

function useProjectPatchVersion(
	host: StoryWorkbenchExtensionContext['host'],
	storyId: string
) {
	const [version, setVersion] = React.useState(0);

	React.useEffect(
		() =>
			host.subscribeToPatches(batch => {
				if (
					batch.patches.some(patch =>
						'story_id' in patch
							? patch.story_id === storyId
							: patch.type === 'storyCreated'
								? patch.story.id === storyId
								: patch.type === 'projectSnapshotReplaced' &&
									patch.snapshot.stories.some(story => story.id === storyId)
					)
				) {
					setVersion(current => current + 1);
				}
			}),
		[host, storyId]
	);

	return [version, () => setVersion(current => current + 1)] as const;
}

export const FindReplaceWorkbenchPanel: React.FC<{
	context: StoryWorkbenchExtensionContext;
	onOpenDetails?: () => void;
	request?: FindReplaceWorkbenchRequest;
}> = ({context, onOpenDetails, request}) => {
	const {
		host,
		onHighlightPassages,
		onOpenEditorWindow,
		onSelectPassage,
		story
	} = context;
	const {t} = useTranslation();
	const navigate = useNavigate();
	const [find, setFind] = React.useState(request?.query ?? '');
	const [replace, setReplace] = React.useState('');
	const [includePassageNames, setIncludePassageNames] = React.useState(
		request?.includePassageNames ?? true
	);
	const [matchCase, setMatchCase] = React.useState(false);
	const [useRegexes, setUseRegexes] = React.useState(false);
	const [searchPage, setSearchPage] = React.useState<CoreSearchPage>();
	const [patchVersion, refresh] = useProjectPatchVersion(host, story.id);

	React.useEffect(() => {
		if (request?.query !== undefined) {
			setFind(request.query);
		}
		if (request?.includePassageNames !== undefined) {
			setIncludePassageNames(request.includePassageNames);
		}
	}, [request]);
	React.useEffect(() => {
		let active = true;
		setSearchPage(undefined);
		void host
			.querySearchPageAsync(story.id, {
				includePassageNames,
				includePassageText: true,
				includeScript: true,
				includeStylesheet: true,
				matchCase,
				query: find,
				replacement: replace,
				useRegexes
			})
			.then(page => active && setSearchPage(page));
		return () => {
			active = false;
		};
	}, [
		find,
		host,
		includePassageNames,
		matchCase,
		patchVersion,
		replace,
		story.id,
		useRegexes
	]);

	const hits = searchPage?.searchHits ?? emptySearchHits;
	const matchedPassageIds = React.useMemo(
		() =>
			Array.from(
				new Set(
					hits.map(hit => hit.passageId).filter((id): id is string => !!id)
				)
			),
		[hits]
	);
	const onHighlightPassagesRef = React.useRef(onHighlightPassages);
	React.useEffect(() => {
		onHighlightPassagesRef.current = onHighlightPassages;
	}, [onHighlightPassages]);
	React.useEffect(() => {
		onHighlightPassages?.(matchedPassageIds);
	}, [matchedPassageIds, onHighlightPassages]);
	React.useEffect(
		() => () => {
			onHighlightPassagesRef.current?.([]);
		},
		[]
	);
	const replaceableHits = hits.filter(hit =>
		['passageName', 'passageText', 'script', 'stylesheet'].includes(hit.scope)
	);
	function selectResult(hit: CoreSearchHit) {
		const target = sourceNavigationTargetFromSourceId(
			hit.sourceId,
			hit.passageId
		);
		const passage = hit.passageId
			? story.passages.find(candidate => candidate.id === hit.passageId)
			: undefined;

		if (passage) {
			onSelectPassage(passage);
			onHighlightPassages?.([passage.id]);
		}
		if (target) {
			onOpenEditorWindow?.(editorWindowSpecForSourceNavigationTarget(target));
			navigate(
				`/stories/${story.id}?mode=text&source=${target.kind}${
					target.kind === 'passage' ? `:${target.passageId}` : ''
				}&offset=${hit.start}&q=${encodeURIComponent(find)}`
			);
		} else if (hit.scope === 'metadata' || hit.sourceId.endsWith(':metadata')) {
			onOpenDetails?.();
		}
	}

	return (
		<div className="story-workbench-search">
			<div className="search-fields">
				<label className="search-field">
					{t('dialogs.storySearch.find')}
					<textarea
						onChange={event => setFind(event.target.value)}
						value={find}
					/>
				</label>
				<label className="search-field">
					{t('dialogs.storySearch.replaceWith')}
					<textarea
						onChange={event => setReplace(event.target.value)}
						value={replace}
					/>
				</label>
			</div>
			<div className="search-flags">
				<Checkbox
					checked={includePassageNames}
					label={t('dialogs.storySearch.includePassageNames')}
					onChange={setIncludePassageNames}
				/>
				<Checkbox
					checked={matchCase}
					label={t('dialogs.storySearch.matchCase')}
					onChange={setMatchCase}
				/>
				<Checkbox
					checked={useRegexes}
					label={t('dialogs.storySearch.useRegexes')}
					onChange={setUseRegexes}
				/>
			</div>
			<div className="search-results">
				<Button
					disabled={replaceableHits.length === 0}
					icon="replace"
					onClick={async () => {
						await host.applyStoryCommand(
							replaceAllTextCommand(story.id, find, replace, {
								includePassageNames,
								matchCase,
								useRegexes
							}),
							'undoChange.replaceAllText'
						);
						refresh();
					}}
					variant="danger"
				>
					{t('dialogs.storySearch.replaceAll')}
				</Button>
				<span>
					{find
						? hits.length
							? t('dialogs.storySearch.matchCount', {count: hits.length})
							: t('dialogs.storySearch.noMatches')
						: t('dialogs.storySearch.ready')}
				</span>
			</div>
			{hits.length > 0 && (
				<ol className="search-result-list">
					{hits.slice(0, 50).map((hit, index) => (
						<li key={`${hit.sourceId}-${hit.scope}-${hit.start}-${index}`}>
							<button
								className="search-result"
								disabled={
									!hit.passageId &&
									!sourceNavigationTargetFromSourceId(hit.sourceId) &&
									hit.scope !== 'metadata' &&
									!hit.sourceId.endsWith(':metadata')
								}
								onClick={() => selectResult(hit)}
								type="button"
							>
								<span className="search-result-title">
									{hit.sourceName}
									<span>{t(`dialogs.storySearch.scope.${hit.scope}`)}</span>
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
		</div>
	);
};

export const PassageTagsWorkbenchPanel: React.FC<{
	context: StoryWorkbenchExtensionContext;
}> = ({context: {host, story}}) => {
	const {t} = useTranslation();
	const [tags, setTags] = React.useState<CoreTagEntry[]>([]);
	const [patchVersion, refresh] = useProjectPatchVersion(host, story.id);
	React.useEffect(() => {
		let active = true;
		void (async () => {
			const next: CoreTagEntry[] = [];
			for (const filter of ['tag', 'group'] as const) {
				let cursor: string | null = null;
				do {
					const page: CoreContentsPage = await host.queryContentsPageAsync(
						story.id,
						{cursor, filter, limit: 500, sort: 'name'}
					);
					next.push(
						...page.entries.map(entry => ({
							color: entry.detail,
							count: entry.count,
							name: entry.label,
							passageIds: entry.passageId ? [entry.passageId] : []
						}))
					);
					cursor = page.nextCursor;
				} while (cursor && active);
			}
			if (active)
				setTags(
					next.sort((left, right) => left.name.localeCompare(right.name))
				);
		})().catch(
			error => active && console.warn(`Rust tag query failed: ${error}`)
		);
		return () => {
			active = false;
		};
	}, [host, patchVersion, story.id]);
	async function applyTagCommand(command: StoryCommand, annotation: string) {
		await host.applyStoryCommand(command, annotation);
		refresh();
	}
	const names = tags.map(tag => tag.name);
	return (
		<div className="story-workbench-passage-tags">
			{tags.length ? (
				tags.map(tag => (
					<div className="passage-tag-entry" key={tag.name}>
						<TagEditor
							allTags={names}
							color={story.tagColors[tag.name]}
							name={tag.name}
							onChangeColor={(color: Color) =>
								void applyTagCommand(
									setStoryTagColorCommand(
										story.id,
										tag.name,
										color === 'none' ? null : color
									),
									t('undoChange.changeTagColor')
								)
							}
							onChangeName={name =>
								void applyTagCommand(
									renamePassageTagCommand(story.id, tag.name, name),
									t('undoChange.renameTag')
								)
							}
						/>
						<span className="passage-tag-count">
							{t('dialogs.passageTags.count', {count: tag.count})}
						</span>
					</div>
				))
			) : (
				<p>{t('dialogs.passageTags.noTags')}</p>
			)}
		</div>
	);
};

export const StoryDetailsWorkbenchPanel: React.FC<{
	context: StoryWorkbenchExtensionContext;
}> = ({context: {host, story}}) => {
	const {formats} = useStoryFormatsContext();
	const {t} = useTranslation();
	const [stats, setStats] = React.useState<CoreStorySummary>();
	const [patchVersion] = useProjectPatchVersion(host, story.id);
	React.useEffect(() => {
		let active = true;
		void host
			.queryStorySummaryAsync(story.id)
			.then(value => active && setStats(value));
		return () => {
			active = false;
		};
	}, [host, patchVersion, story.id]);
	return (
		<div className="story-workbench-details">
			<div className="story-format">
				<FormatLoader block={false} />
				<StoryFormatSelect
					formats={formats}
					onChange={event => {
						const format = formatWithId(formats, event.target.value);
						void host.applyStoryCommand(
							setStoryFormatCommand(story.id, format.name, format.version)
						);
					}}
					selectedFormat={formatWithNameAndVersion(
						formats,
						story.storyFormat,
						story.storyFormatVersion
					)}
				>
					{t('common.storyFormat')}
				</StoryFormatSelect>
				<a
					href="https://twinery.org/2storyformats"
					rel="noreferrer"
					target="_blank"
				>
					{t('dialogs.storyDetails.storyFormatExplanation')}
				</a>
			</div>
			<Checkbox
				checked={story.snapToGrid}
				label={t('dialogs.storyDetails.snapToGrid')}
				onChange={value =>
					void host.applyStoryCommand(
						setStorySnapToGridCommand(story.id, value)
					)
				}
			/>
			<div className="story-stats">
				<table className="counts">
					<tbody>
						{[
							[stats?.characterCount ?? '—', 'characters'],
							[stats?.wordCount ?? '—', 'words'],
							[stats?.passageCount ?? story.passages.length, 'passages'],
							[stats?.graph.links ?? '—', 'links'],
							[stats?.graph.brokenLinks ?? '—', 'brokenLinks']
						].map(([value, label]) => (
							<tr key={String(label)}>
								<td>{value}</td>
								<td>{t(`dialogs.storyDetails.stats.${label}`)}</td>
							</tr>
						))}
					</tbody>
				</table>
				<div className="update-and-ifid">
					<p>
						{t('dialogs.storyDetails.stats.lastUpdate', {
							date: dateFormatter.format(story.lastUpdate)
						})}
					</p>
					<p>
						{t('dialogs.storyDetails.stats.ifid', {ifid: story.ifid})}&nbsp;
						<a
							href="https://ifdb.org/help-ifid"
							rel="noreferrer"
							target="_blank"
						>
							{t('dialogs.storyDetails.stats.ifidExplanation')}
						</a>
					</p>
				</div>
			</div>
		</div>
	);
};
