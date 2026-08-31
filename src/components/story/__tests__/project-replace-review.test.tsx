import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {RefactorPlanDetailPage} from '../../../core/bindings/RefactorPlanDetailPage';
import type {RefactorPlanSummary} from '../../../core/bindings/RefactorPlanSummary';
import {
	ProjectReplaceReview,
	type ProjectReplaceReviewProps
} from '../project-replace-review';

describe('<ProjectReplaceReview>', () => {
	const summary: RefactorPlanSummary = {
		affectedEntityCount: 1,
		changeCount: 2,
		coverage: 'complete',
		expiresAtEpochMs: 0,
		firstDetailCursor: {planDigest: 'digest', planId: 'plan', position: 0},
		operationKind: 'project-replace',
		planDigest: 'digest',
		planId: 'plan',
		projectRevision: 4,
		selectionCapabilities: {
			all: true,
			exclusions: true,
			groups: true,
			only: false
		},
		validationFailures: []
	};
	const page: RefactorPlanDetailPage = {
		changes: [
			{
				affectedEntity: {
					entityId: 'passage',
					kind: 'passage',
					storyId: 'story'
				},
				after: {type: 'text', value: 'after'},
				before: {type: 'text', value: 'before'},
				changeId: 'one',
				dependencies: [],
				description: 'Ungrouped',
				groupId: null,
				kind: 'text-edit',
				location: null
			},
			{
				affectedEntity: {
					entityId: 'passage',
					kind: 'passage',
					storyId: 'story'
				},
				after: {type: 'text', value: 'after'},
				before: {type: 'text', value: 'before'},
				changeId: 'two',
				dependencies: [],
				description: 'Grouped',
				groupId: 'rename',
				kind: 'text-edit',
				location: null
			}
		],
		nextCursor: null
	};
	function props(
		overrides: Partial<ProjectReplaceReviewProps> = {}
	): ProjectReplaceReviewProps {
		return {
			applying: false,
			cursor: summary.firstDetailCursor,
			excludedChangeIds: new Set(),
			onApply: jest.fn(),
			onClose: jest.fn(),
			onNextPage: jest.fn(),
			onPreviousPage: jest.fn(),
			onRetry: jest.fn(),
			onToggleChange: jest.fn(),
			page,
			showPreviousPage: false,
			summary,
			...overrides
		};
	}
	it('allows excluding only ungrouped visible changes', () => {
		const viewProps = props();
		render(<ProjectReplaceReview {...viewProps} />);
		const [ungrouped, grouped] = screen.getAllByRole('checkbox');
		expect(ungrouped).toBeEnabled();
		expect(grouped).toBeDisabled();
		fireEvent.click(ungrouped);
		expect(viewProps.onToggleChange).toHaveBeenCalledWith('one');
	});
	it('gates Apply for validation failures and current-page loading', () => {
		const {rerender} = render(
			<ProjectReplaceReview {...props({page: undefined})} />
		);
		expect(
			screen.getByRole('button', {
				name: 'components.projectReplaceReview.apply'
			})
		).toBeDisabled();
		rerender(
			<ProjectReplaceReview
				{...props({summary: {...summary, validationFailures: ['invalid']}})}
			/>
		);
		expect(
			screen.getByRole('button', {
				name: 'components.projectReplaceReview.apply'
			})
		).toBeDisabled();
	});
});
