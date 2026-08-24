import {IconTool, IconX} from '@tabler/icons-react';
import classnames from 'classnames';
import * as React from 'react';
import {useHotkeys} from 'react-hotkeys-hook';
import {assignRef} from '../../util/assign-ref';
import {Card} from '../container/card';
import {IconButton} from '../control/icon-button';
import {TextInput} from '../control/text-input';
import {FuzzyFinderResult, FuzzyFinderResultProps} from './fuzzy-finder-result';
import './fuzzy-finder.css';

function elementIsFocused(element: HTMLElement | null): boolean {
	return !!(element && document.activeElement === element);
}

export interface FuzzyFinderProps {
	noResultsText: string;
	onChangeSearch: (value: string) => void;
	onClose: () => void;
	onSelectResult: (index: number) => void;
	prompt: string;
	results: Array<
		Omit<FuzzyFinderResultProps, 'onClick'> & {
			action?: {
				disabled?: boolean;
				label: string;
				loading?: boolean;
				onClick: () => void;
			};
		}
	>;
	search: string;
}

export const FuzzyFinder = React.forwardRef<HTMLDivElement, FuzzyFinderProps>(
	(props, forwardedRef) => {
		const {
			noResultsText,
			onChangeSearch,
			onClose,
			onSelectResult,
			prompt,
			search,
			results
		} = props;
		const [selectedResult, setSelectedResult] = React.useState(0);
		const containerRef = React.useRef<HTMLDivElement | null>(null);
		const setContainerRef = React.useCallback(
			(element: HTMLDivElement | null) => {
				containerRef.current = element;
				const forwardedCleanup = assignRef(forwardedRef, element);

				if (element) {
					return () => {
						containerRef.current = null;
						if (typeof forwardedCleanup === 'function') {
							forwardedCleanup();
						} else {
							assignRef(forwardedRef, null);
						}
					};
				}

				return forwardedCleanup;
			},
			[forwardedRef]
		);
		const inputRef = React.useRef<HTMLInputElement>(null);
		useHotkeys(
			'escape',
			onClose,
			{
				enableOnFormTags: ['input'],
				ignoreEventWhen: () => !elementIsFocused(inputRef.current)
			},
			[onClose]
		);
		useHotkeys(
			'return',
			() => onSelectResult(selectedResult),
			{
				enableOnFormTags: ['input'],
				ignoreEventWhen: () => !elementIsFocused(inputRef.current)
			},
			[onSelectResult, selectedResult]
		);
		useHotkeys(
			'up',
			() =>
				setSelectedResult(value =>
					value === 0 ? results.length - 1 : value - 1
				),
			{
				enableOnFormTags: ['input'],
				ignoreEventWhen: () => !elementIsFocused(inputRef.current)
			},
			[results.length]
		);
		useHotkeys(
			'down',
			() =>
				setSelectedResult(value =>
					value === results.length - 1 ? 0 : value + 1
				),
			{
				enableOnFormTags: ['input'],
				ignoreEventWhen: () => !elementIsFocused(inputRef.current)
			},
			[results.length]
		);

		React.useEffect(() => {
			// Automatically focus the search input on mount.
			//
			// This timeout is needed to avoid stealing focus too early. If this
			// component is mounted in reaction to a hotkey, the input will receive the
			// hotkey input.

			const timeout = window.setTimeout(() => {
				if (containerRef.current) {
					containerRef.current.querySelector('input')?.focus();
				}
			}, 0);

			return () => window.clearTimeout(timeout);
		}, []);

		return (
			<div className="fuzzy-finder" ref={setContainerRef}>
				<Card>
					<div className="search">
						<TextInput
							onChange={event => onChangeSearch(event.target.value)}
							ref={inputRef}
							value={search}
						>
							{prompt}
						</TextInput>
						<IconButton
							icon={<IconX />}
							iconOnly
							label="Close"
							onClick={onClose}
							tooltipPosition="bottom"
						/>
					</div>
					<div
						className={classnames('results', {
							'has-results': results.length > 0
						})}
					>
						{search.length > 0 && results.length === 0 && (
							<div className="no-results">{noResultsText}</div>
						)}
						{search.length > 0 && results.length > 0 && (
							<ol>
								{results.map(({action, ...props}, index) => (
									<li
										className="fuzzy-finder-result-row"
										key={`${props.heading}:${index}`}
									>
										<FuzzyFinderResult
											{...props}
											onClick={() => onSelectResult(index)}
											selected={index === selectedResult}
										/>
										{action && (
											<button
												aria-label={action.label}
												aria-busy={action.loading || undefined}
												className="fuzzy-finder-result-action"
												disabled={action.disabled || action.loading}
												onClick={event => {
													event.stopPropagation();
													if (action.disabled || action.loading) {
														return;
													}
													action.onClick();
												}}
												type="button"
											>
												{action.loading ? (
													<span className="tw-btn__spin" aria-hidden />
												) : (
													<IconTool />
												)}
											</button>
										)}
									</li>
								))}
							</ol>
						)}
					</div>
				</Card>
			</div>
		);
	}
);

FuzzyFinder.displayName = 'FuzzyFinder';
