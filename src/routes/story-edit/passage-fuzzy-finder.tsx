import debounce from 'lodash/debounce';
import * as React from 'react';
import {useHotkeys} from 'react-hotkeys-hook';
import {useTranslation} from 'react-i18next';
import {CSSTransition} from 'react-transition-group';
import {FuzzyFinder} from '../../components/fuzzy-finder';
import {useCoreProjectHost} from '../../core';
import {selectPassage, Story, useStoriesContext} from '../../store/stories';
import {Point} from '../../util/geometry';

export interface PassageFuzzyFinderProps {
	onClose: () => void;
	onOpen: () => void;
	onRevealPassageInGraph?: (passage: Story['passages'][number]) => void;
	onTestPassage?: (passage: Story['passages'][number]) => void;
	open?: boolean;
	setCenter: (value: Point) => void;
	story: Story;
	testPassagePending?: boolean;
	testPassagePendingId?: string;
}

export const PassageFuzzyFinder: React.FC<PassageFuzzyFinderProps> = props => {
	const {
		onClose,
		onOpen,
		onRevealPassageInGraph,
		onTestPassage,
		open,
		setCenter,
		story,
		testPassagePending = false,
		testPassagePendingId
	} = props;
	const {dispatch} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const [search, setSearch] = React.useState('');
	const transitionRef = React.useRef<HTMLDivElement>(null);
	const [debouncedSearch, setDebouncedSearch] = React.useState('');
	const updateDebouncedSearch = React.useMemo(
		() =>
			debounce(
				(value: string) => {
					setDebouncedSearch(value);
				},
				100,
				{leading: true, trailing: true}
			),
		[]
	);
	const [matches, setMatches] = React.useState<
		Array<{detail: string; passage: Story['passages'][number]}>
	>([]);
	React.useEffect(() => {
		let active = true;
		if (!debouncedSearch.trim()) {
			setMatches([]);
			return () => {
				active = false;
			};
		}
		void coreProjectHost
			.querySearchPageAsync(story.id, {
				fuzzy: true,
				includePassageNames: true,
				includePassageText: true,
				includeScript: false,
				includeStylesheet: false,
				limit: 12,
				query: debouncedSearch
			})
			.then(page => {
				if (!active) {
					return;
				}
				const seen = new Set<string>();
				setMatches(
					page.searchHits
						.flatMap(hit => {
							if (!hit.passageId || seen.has(hit.passageId)) {
								return [];
							}
							const passage = story.passages.find(
								candidate => candidate.id === hit.passageId
							);
							if (!passage) {
								return [];
							}
							seen.add(hit.passageId);
							return [{detail: hit.excerpt, passage}];
						})
						.slice(0, 5)
				);
			});
		return () => {
			active = false;
		};
	}, [coreProjectHost, debouncedSearch, story.id, story.passages]);
	const results = React.useMemo(
		() =>
			matches.map(match => ({
				action: onTestPassage
					? {
							disabled: testPassagePending,
							label: `Test "${match.passage.name}" From Here`,
							loading: testPassagePendingId === match.passage.id,
							onClick: () => onTestPassage(match.passage)
						}
					: undefined,
				detail: match.detail,
				heading: match.passage.name
			})),
		[matches, onTestPassage, testPassagePending, testPassagePendingId]
	);
	useHotkeys('p', onOpen);
	const {t} = useTranslation();

	function handleChangeSearch(value: string) {
		setSearch(value);
		updateDebouncedSearch(value);
	}

	function handleSelectResult(index: number) {
		const match = matches[index]?.passage;
		if (!match) {
			return;
		}

		if (onRevealPassageInGraph) {
			onRevealPassageInGraph(match);
		} else {
			setCenter(match);
			dispatch(selectPassage(story, match, true));
		}
		setSearch('');
		onClose();
	}

	return (
		<CSSTransition
			classNames="pop"
			mountOnEnter
			nodeRef={transitionRef}
			timeout={200}
			unmountOnExit
			in={open}
		>
			<FuzzyFinder
				ref={transitionRef}
				noResultsText={t('components.passageFuzzyFinder.noResults')}
				onClose={onClose}
				onChangeSearch={handleChangeSearch}
				onSelectResult={handleSelectResult}
				prompt={t('components.passageFuzzyFinder.prompt')}
				search={search}
				results={results}
			/>
		</CSSTransition>
	);
};
