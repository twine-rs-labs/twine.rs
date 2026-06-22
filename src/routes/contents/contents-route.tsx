import * as React from 'react';
import classNames from 'classnames';
import {useHistory, useParams} from 'react-router-dom';
import {
	Badge,
	Button,
	Input,
	Select,
	TablerIcon,
	Tag
} from '../../components/design-system';
import {
	contentsViewModel,
	setStartPassageCommand,
	useCoreProjectHost,
	workbenchSelection
} from '../../core';
import type {ContentsViewModelEntry} from '../../core/view-models';
import type {CoreContentsEntryKind} from '../../core/bindings/CoreContentsEntryKind';
import {
	Passage,
	selectPassage,
	Story,
	useStoriesContext
} from '../../store/stories';
import {useStoryLaunch} from '../../store/use-story-launch';
import './contents-route.css';

type ContentsFilter =
	| 'all'
	| 'asset'
	| 'diagnostics'
	| 'entryPoint'
	| 'group'
	| 'metadata'
	| 'passage'
	| 'problems'
	| 'script'
	| 'stylesheet'
	| 'tag'
	| 'variable';

type ContentsSort = 'Group' | 'Issues' | 'Name';

const typeFilters: Array<{
	id: ContentsFilter;
	icon: string;
	label: string;
}> = [
	{id: 'all', icon: 'list-tree', label: 'All'},
	{id: 'passage', icon: 'file-text', label: 'Passages'},
	{id: 'tag', icon: 'tags', label: 'Tags'},
	{id: 'variable', icon: 'variable', label: 'Variables'},
	{id: 'asset', icon: 'photo', label: 'Assets'},
	{id: 'script', icon: 'braces', label: 'Scripts'},
	{id: 'stylesheet', icon: 'hash', label: 'Styles'},
	{id: 'group', icon: 'folders', label: 'Groups'},
	{id: 'diagnostics', icon: 'alert-triangle', label: 'Diagnostics'},
	{id: 'metadata', icon: 'info-circle', label: 'Metadata'}
];

const problemFilters: Array<{
	id: ContentsFilter;
	icon: string;
	label: string;
}> = [
	{id: 'problems', icon: 'alert-triangle', label: 'All Problems'},
	{id: 'entryPoint', icon: 'rocket', label: 'Entry Points'}
];

function storyForId(stories: Story[], storyId: string | undefined) {
	return stories.find(story => story.id === storyId);
}

function kindIcon(kind: CoreContentsEntryKind) {
	switch (kind) {
		case 'asset':
			return 'photo';
		case 'brokenLink':
			return 'unlink';
		case 'diagnostic':
			return 'alert-triangle';
		case 'entryPoint':
			return 'rocket';
		case 'group':
			return 'folders';
		case 'metadata':
			return 'info-circle';
		case 'orphan':
			return 'arrows-split';
		case 'passage':
			return 'file-text';
		case 'script':
			return 'braces';
		case 'stylesheet':
			return 'hash';
		case 'tag':
			return 'tags';
		case 'variable':
			return 'variable';
	}
}

function kindLabel(kind: CoreContentsEntryKind) {
	switch (kind) {
		case 'brokenLink':
			return 'Broken link';
		case 'entryPoint':
			return 'Entry point';
		default:
			return kind;
	}
}

function entryMatchesFilter(
	entry: ContentsViewModelEntry,
	filter: ContentsFilter
) {
	switch (filter) {
		case 'all':
			return true;
		case 'diagnostics':
			return (
				entry.core.kind === 'brokenLink' ||
				entry.core.kind === 'diagnostic' ||
				entry.core.kind === 'orphan'
			);
		case 'problems':
			return !!entry.severity;
		default:
			return entry.core.kind === filter;
	}
}

function entryMatchesQuery(entry: ContentsViewModelEntry, query: string) {
	const normalized = query.trim().toLowerCase();

	if (!normalized) {
		return true;
	}

	return [
		entry.group,
		entry.label,
		entry.meta,
		entry.core.detail,
		entry.core.kind,
		entry.core.sourceId
	]
		.filter(Boolean)
		.some(value => value!.toLowerCase().includes(normalized));
}

function filterCount(
	entries: ContentsViewModelEntry[],
	filter: ContentsFilter
) {
	return entries.filter(entry => entryMatchesFilter(entry, filter)).length;
}

function severityTone(severity: ContentsViewModelEntry['severity']) {
	if (severity === 'error') {
		return 'error';
	}

	if (severity === 'warning') {
		return 'warn';
	}

	return 'link';
}

function passageForEntry(story: Story, entry: ContentsViewModelEntry) {
	return entry.core.passageId
		? story.passages.find(passage => passage.id === entry.core.passageId)
		: undefined;
}

function sourceTarget(story: Story, mode: 'graph' | 'text', passage?: Passage) {
	const query = new URLSearchParams({mode});

	if (passage) {
		query.set('passage', passage.id);
	}

	return `/stories/${story.id}?${query.toString()}`;
}

const DetailField: React.FC<{
	label: string;
	value: React.ReactNode;
}> = ({label, value}) => (
	<div className="contents-route__field">
		<span>{label}</span>
		<b>{value}</b>
	</div>
);

export const ContentsRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {dispatch, stories} = useStoriesContext();
	const history = useHistory();
	const {testStory} = useStoryLaunch();
	const coreProjectHost = useCoreProjectHost();
	const story = storyForId(stories, storyId);
	const [filter, setFilter] = React.useState<ContentsFilter>('all');
	const [query, setQuery] = React.useState('');
	const [sort, setSort] = React.useState<ContentsSort>('Group');
	const [selectedId, setSelectedId] = React.useState<string>();
	const [patchVersion, setPatchVersion] = React.useState(0);

	React.useEffect(
		() =>
			coreProjectHost.subscribeToPatches(() =>
				setPatchVersion(version => version + 1)
			),
		[coreProjectHost]
	);

	const index = React.useMemo(
		() => (story ? coreProjectHost.queryStoryIndex(story.id) : undefined),
		[coreProjectHost, patchVersion, story]
	);
	const contents = React.useMemo(
		() => (index ? contentsViewModel(index) : undefined),
		[index]
	);
	const visibleEntries = React.useMemo(() => {
		const entries = contents?.entries ?? [];
		const filtered = entries.filter(
			entry =>
				entryMatchesFilter(entry, filter) && entryMatchesQuery(entry, query)
		);

		return [...filtered].sort((left, right) => {
			if (sort === 'Issues') {
				const issueDelta = Number(!!right.severity) - Number(!!left.severity);

				if (issueDelta !== 0) {
					return issueDelta;
				}
			}

			if (sort === 'Name') {
				return left.label.localeCompare(right.label);
			}

			return (
				left.group.localeCompare(right.group) ||
				left.label.localeCompare(right.label)
			);
		});
	}, [contents, filter, query, sort]);
	const selectedEntry =
		visibleEntries.find(entry => entry.id === selectedId) ?? visibleEntries[0];
	const selectedPassage =
		story && selectedEntry ? passageForEntry(story, selectedEntry) : undefined;
	const selectedFacts =
		story && index && selectedPassage
			? workbenchSelection(story, index, selectedPassage.id)
			: undefined;

	React.useEffect(() => {
		if (selectedEntry && selectedEntry.id !== selectedId) {
			setSelectedId(selectedEntry.id);
		}
	}, [selectedEntry, selectedId]);

	function openEntry(
		entry: ContentsViewModelEntry | undefined,
		mode: 'graph' | 'text'
	) {
		if (!story || !entry) {
			return;
		}

		const passage = passageForEntry(story, entry);

		if (passage) {
			dispatch(selectPassage(story, passage, true));
		}

		history.push(sourceTarget(story, mode, passage));
	}

	function markStart() {
		if (story && selectedPassage) {
			coreProjectHost.applyStoryCommand(
				setStartPassageCommand(story.id, selectedPassage.id)
			);
		}
	}

	function testSelectedPassage() {
		if (story && selectedPassage) {
			void testStory(story.id, selectedPassage.id);
		}
	}

	if (!story || !contents || !index) {
		return (
			<div className="contents-route__empty">
				<TablerIcon icon="list-tree" />
				<span>No story is open.</span>
			</div>
		);
	}

	let lastGroup: string | undefined;

	return (
		<div className="contents-route">
			<aside className="contents-route__types" aria-label="Contents filters">
				<div className="contents-route__filter-label">Browse</div>
				{typeFilters.map(candidate => (
					<button
						aria-current={candidate.id === filter}
						className="contents-route__type"
						key={candidate.id}
						onClick={() => setFilter(candidate.id)}
						type="button"
					>
						<TablerIcon icon={candidate.icon} />
						<span>{candidate.label}</span>
						<span className="contents-route__count">
							{filterCount(contents.entries, candidate.id)}
						</span>
					</button>
				))}
				<div className="contents-route__filter-label">Problems</div>
				{problemFilters.map(candidate => (
					<button
						aria-current={candidate.id === filter}
						className="contents-route__type contents-route__type--problem"
						key={candidate.id}
						onClick={() => setFilter(candidate.id)}
						type="button"
					>
						<TablerIcon icon={candidate.icon} />
						<span>{candidate.label}</span>
						<span className="contents-route__count">
							{filterCount(contents.entries, candidate.id)}
						</span>
					</button>
				))}
			</aside>
			<main className="contents-route__main" aria-label="Contents">
				<div className="contents-route__toolbar">
					<Input
						aria-label="Filter contents"
						block
						icon="search"
						kbd="Cmd P"
						onChange={event => setQuery(event.target.value)}
						placeholder="Filter contents"
						value={query}
					/>
					<Select
						ariaLabel="Sort contents"
						onChange={value => setSort(value as ContentsSort)}
						options={['Group', 'Name', 'Issues']}
						size="sm"
						value={sort}
					/>
					<span className="contents-route__toolbar-stat">
						{visibleEntries.length} of {contents.totalCount}
					</span>
					<Button icon="checkbox" size="sm" variant="ghost">
						Select
					</Button>
					<Button icon="tags" size="sm" variant="ghost">
						Bulk Tag
					</Button>
				</div>
				<div className="contents-route__list">
					{visibleEntries.length === 0 ? (
						<div className="contents-route__list-empty">
							No contents match this filter.
						</div>
					) : (
						visibleEntries.map(entry => {
							const showGroup = entry.group !== lastGroup;

							lastGroup = entry.group;

							return (
								<React.Fragment key={entry.id}>
									{showGroup && (
										<div className="contents-route__group">
											<TablerIcon icon="folder" />
											{entry.group}
										</div>
									)}
									<button
										aria-current={entry.id === selectedEntry?.id}
										className={classNames('contents-route__row', {
											'contents-route__row--problem': !!entry.severity
										})}
										onClick={() => setSelectedId(entry.id)}
										type="button"
									>
										<TablerIcon
											className="contents-route__row-icon"
											icon={kindIcon(entry.core.kind)}
										/>
										<span className="contents-route__row-name">
											<b>{entry.label}</b>
											<span>{kindLabel(entry.core.kind)}</span>
										</span>
										<span className="contents-route__row-stats">
											{entry.core.count > 1 && (
												<span>{entry.core.count} refs</span>
											)}
											{entry.meta && <span>{entry.meta}</span>}
											{entry.severity && (
												<Badge tone={severityTone(entry.severity)}>
													{entry.severity}
												</Badge>
											)}
										</span>
										<TablerIcon icon="chevron-right" />
									</button>
								</React.Fragment>
							);
						})
					)}
				</div>
			</main>
			<aside className="contents-route__inspector" aria-label="Content details">
				{selectedEntry ? (
					<>
						<header className="contents-route__inspector-head">
							<div className="contents-route__inspector-title">
								{selectedEntry.label}
							</div>
							<div className="contents-route__inspector-path">
								{selectedEntry.core.sourceId ?? selectedEntry.core.id}
							</div>
							<div className="contents-route__badges">
								<Badge icon={kindIcon(selectedEntry.core.kind)} mono>
									{kindLabel(selectedEntry.core.kind)}
								</Badge>
								{selectedEntry.severity && (
									<Badge
										icon={
											selectedEntry.severity === 'error'
												? 'alert-octagon'
												: 'alert-triangle'
										}
										tone={severityTone(selectedEntry.severity)}
									>
										{selectedEntry.severity}
									</Badge>
								)}
								{selectedPassage?.id === story.startPassage && (
									<Badge dot tone="saved">
										Start
									</Badge>
								)}
							</div>
						</header>
						<section className="contents-route__section">
							<div className="contents-route__section-title">Metadata</div>
							<DetailField label="Group" value={selectedEntry.group} />
							<DetailField
								label="Type"
								value={kindLabel(selectedEntry.core.kind)}
							/>
							<DetailField label="Count" value={selectedEntry.core.count} />
							<DetailField
								label="Detail"
								value={selectedEntry.meta ?? 'None'}
							/>
							<DetailField
								label="Source"
								value={selectedEntry.core.sourceId ?? 'Project index'}
							/>
						</section>
						{selectedPassage && selectedFacts && (
							<section className="contents-route__section">
								<div className="contents-route__section-title">Passage</div>
								<DetailField label="Words" value={selectedFacts.wordCount} />
								<DetailField
									label="Outgoing links"
									value={selectedFacts.linkFacts.length}
								/>
								<DetailField
									label="Backlinks"
									value={selectedFacts.backlinks.length}
								/>
								<DetailField
									label="Assets"
									value={selectedFacts.assetReferences.length}
								/>
								<DetailField
									label="Diagnostics"
									value={selectedFacts.diagnostics.length}
								/>
								{selectedPassage.tags.length > 0 && (
									<div className="contents-route__tag-row">
										{selectedPassage.tags.map(tag => (
											<Tag color={story.tagColors[tag] ?? 'blue'} key={tag}>
												{tag}
											</Tag>
										))}
									</div>
								)}
							</section>
						)}
						<div className="contents-route__actions">
							<Button
								block
								disabled={!selectedPassage}
								icon="tool"
								onClick={testSelectedPassage}
								size="sm"
								variant="primary"
							>
								Test From Here
							</Button>
							<Button
								block
								icon="file-text"
								onClick={() => openEntry(selectedEntry, 'text')}
								size="sm"
							>
								Reveal in Source
							</Button>
							<Button
								block
								disabled={!selectedPassage}
								icon="binary-tree"
								onClick={() => openEntry(selectedEntry, 'graph')}
								size="sm"
							>
								Reveal in Graph
							</Button>
							<Button
								block
								disabled={!selectedPassage}
								icon="rocket"
								onClick={markStart}
								size="sm"
								variant="ghost"
							>
								Mark as Start
							</Button>
							<Button block icon="download" size="sm" variant="ghost">
								Export Selection
							</Button>
						</div>
					</>
				) : (
					<div className="contents-route__empty-detail">
						Select an indexed item.
					</div>
				)}
			</aside>
		</div>
	);
};
