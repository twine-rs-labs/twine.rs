import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {DiagnosticFixReviewProps} from '../diagnostic-fix-review';
import {DiagnosticFixReview} from '../diagnostic-fix-review';

describe('<DiagnosticFixReview>', () => {
	const summary = {
		affectedEntityCount: 1,
		changeCount: 1,
		coverage: 'deterministic-safe-fixes',
		expiresAtEpochMs: Date.now() + 60_000,
		firstDetailCursor: {planDigest: 'digest', planId: 'plan', position: 0},
		operationKind: 'diagnostic-fixes',
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
	const page = {
		changes: [
			{
				affectedEntity: {
					entityId: 'passage',
					kind: 'passage' as const,
					storyId: 'story'
				},
				after: {type: 'passageName' as const, value: 'Missing'},
				before: null,
				changeId: 'one',
				dependencies: [],
				description: 'Create passage "Missing"',
				groupId: null,
				kind: 'add-passage' as const,
				location: null
			}
		],
		nextCursor: null
	};

	function props(
		overrides: Partial<DiagnosticFixReviewProps> = {}
	): DiagnosticFixReviewProps {
		return {
			applying: false,
			cursor: summary.firstDetailCursor,
			onApply: jest.fn(),
			onClose: jest.fn(),
			onNextPage: jest.fn(),
			onPreviousPage: jest.fn(),
			onRetry: jest.fn(),
			page,
			paging: false,
			showPreviousPage: false,
			summary,
			...overrides
		};
	}

	it('shows the immutable change detail and applies only by explicit intent', () => {
		const viewProps = props();
		render(<DiagnosticFixReview {...viewProps} />);
		expect(
			screen.getByRole('dialog', {name: 'Review Diagnostic Fixes'})
		).toBeInTheDocument();
		expect(screen.getByText('Create passage "Missing"')).toBeInTheDocument();
		expect(screen.getByText('deterministic-safe-fixes')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', {name: 'Apply Fixes'}));
		expect(viewProps.onApply).toHaveBeenCalledTimes(1);
	});

	it('gates apply until details load and while validation fails', () => {
		const {rerender} = render(
			<DiagnosticFixReview {...props({page: undefined})} />
		);
		expect(screen.getByRole('button', {name: 'Apply Fixes'})).toBeDisabled();
		rerender(
			<DiagnosticFixReview
				{...props({summary: {...summary, validationFailures: ['invalid']}})}
			/>
		);
		expect(screen.getByRole('button', {name: 'Apply Fixes'})).toBeDisabled();
	});

	it('disables paging and apply while a page request is in flight', () => {
		render(
			<DiagnosticFixReview
				{...props({
					page: {
						...page,
						nextCursor: {
							planDigest: 'digest',
							planId: 'plan',
							position: 1
						}
					},
					paging: true,
					showPreviousPage: true
				})}
			/>
		);

		expect(screen.getByRole('button', {name: 'Previous'})).toBeDisabled();
		expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
		expect(screen.getByRole('button', {name: 'Apply Fixes'})).toBeDisabled();
	});
});
