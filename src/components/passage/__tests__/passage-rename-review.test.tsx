import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import type {RefactorPlanDetailPage} from '../../../core/bindings/RefactorPlanDetailPage';
import type {RefactorPlanSummary} from '../../../core/bindings/RefactorPlanSummary';
import {fakeStory} from '../../../test-util';
import {
	PassageRenameReview,
	PassageRenameReviewProps
} from '../passage-rename-review';

describe('<PassageRenameReview>', () => {
	const story = fakeStory(1);
	const summary: RefactorPlanSummary = {
		affectedEntityCount: 1,
		changeCount: 2,
		coverage: 'standard-links-only',
		expiresAtEpochMs: 0,
		firstDetailCursor: {planDigest: 'digest', planId: 'plan', position: 0},
		operationKind: 'rename-passage',
		planDigest: 'digest',
		planId: 'plan',
		projectRevision: 4,
		selectionCapabilities: {
			all: true,
			exclusions: false,
			groups: false,
			only: false
		},
		validationFailures: []
	};
	const page: RefactorPlanDetailPage = {
		changes: [
			{
				affectedEntity: {
					entityId: story.passages[0].id,
					kind: 'passage' as const,
					storyId: story.id
				},
				after: {type: 'passageName' as const, value: 'Renamed'},
				before: {
					type: 'passageName' as const,
					value: story.passages[0].name
				},
				changeId: 'one',
				dependencies: [],
				description: 'Rename passage',
				groupId: 'group',
				kind: 'rename-passage' as const,
				location: {
					revision: 1,
					sourceId: story.passages[0].id,
					sourceKind: 'passage' as const,
					span: {
						encoding: 'utf16-code-units' as const,
						end: 7,
						start: 1
					},
					storyId: story.id
				}
			}
		],
		nextCursor: {
			planDigest: 'digest',
			planId: 'plan',
			position: 1
		}
	};

	function props(
		overrides: Partial<PassageRenameReviewProps> = {}
	): PassageRenameReviewProps {
		return {
			afterName: 'Renamed',
			applying: false,
			cursor: summary.firstDetailCursor,
			onApply: jest.fn(),
			onClose: jest.fn(),
			onNextPage: jest.fn(),
			onPreviousPage: jest.fn(),
			onRetry: jest.fn(),
			page,
			passage: story.passages[0],
			showPreviousPage: false,
			story,
			summary,
			...overrides
		};
	}

	it('renders route-owned DTOs without a project-host provider', async () => {
		const viewProps = props();
		render(<PassageRenameReview {...viewProps} />);
		expect(
			screen.getByRole('heading', {name: story.passages[0].name})
		).toBeInTheDocument();
		expect(screen.getByText('1–7')).toBeInTheDocument();
		expect(
			screen.getByText('components.renamePassageReview.standardLinksOnly')
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.renamePassageReview.apply'
			})
		);
		expect(viewProps.onApply).toHaveBeenCalledTimes(1);
		expect(await axe(document.body)).toHaveNoViolations();
	});

	it('does not claim modality and leaves the editor focusable', () => {
		render(
			<>
				<button>Editor control</button>
				<PassageRenameReview {...props()} />
			</>
		);
		const dialog = screen.getByRole('dialog', {
			name: 'components.renamePassageReview.title'
		});
		expect(dialog).not.toHaveAttribute('aria-modal');
		const editorControl = screen.getByRole('button', {name: 'Editor control'});
		editorControl.focus();
		expect(editorControl).toHaveFocus();
	});

	it('keeps Apply disabled until the current detail page is rendered', () => {
		const {rerender} = render(
			<PassageRenameReview {...props({page: undefined})} />
		);
		expect(
			screen.getByRole('button', {
				name: 'components.renamePassageReview.apply'
			})
		).toBeDisabled();
		rerender(<PassageRenameReview {...props()} />);
		expect(
			screen.getByRole('button', {
				name: 'components.renamePassageReview.apply'
			})
		).toBeEnabled();
	});

	it('emits paging, retry, and Escape intents without owning lifecycle work', () => {
		const viewProps = props({
			error: {code: 'stale-project-revision', message: 'Changed'},
			showPreviousPage: true
		});
		render(<PassageRenameReview {...viewProps} />);
		fireEvent.click(screen.getByRole('button', {name: 'common.next'}));
		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.renamePassageReview.previous'
			})
		);
		fireEvent.click(
			screen.getByRole('button', {
				name: 'components.renamePassageReview.retry'
			})
		);
		fireEvent.keyDown(document, {key: 'Escape'});
		expect(viewProps.onNextPage).toHaveBeenCalledTimes(1);
		expect(viewProps.onPreviousPage).toHaveBeenCalledTimes(1);
		expect(viewProps.onRetry).toHaveBeenCalledTimes(1);
		expect(viewProps.onClose).toHaveBeenCalledTimes(1);
	});
});
