import type {CoreDiagnostic} from '../../../core/bindings/CoreDiagnostic';
import {diagnosticIdentity} from '../../../core';
import {
	contextualDiagnosticQuickFixes,
	diagnosticFixReviewNavigationState,
	diagnosticFixReviewTargetFromState
} from '../diagnostic-fix-navigation';

function diagnostic(code: string, command: string): CoreDiagnostic {
	return {
		code,
		end: code.length,
		line: 1,
		message: `${code} message`,
		passageId: 'passage',
		quickFixes: [
			{
				applicability: 'automatic',
				command,
				title: `Fix ${code}`
			}
		],
		severity: 'warning',
		sourceId: 'passage:passage',
		start: 0
	};
}

describe('diagnostic fix navigation', () => {
	it('keeps each contextual action paired with its exact diagnostic identity', () => {
		const first = diagnostic('first', 'create-passage:First');
		const second = diagnostic('second', 'create-passage:Second');
		const targets = contextualDiagnosticQuickFixes([first, second]);

		expect(targets).toEqual([
			{
				action: expect.objectContaining({command: 'create-passage:First'}),
				diagnostic: first
			},
			{
				action: expect.objectContaining({command: 'create-passage:Second'}),
				diagnostic: second
			}
		]);
		expect(
			diagnosticFixReviewTargetFromState(
				diagnosticFixReviewNavigationState(
					targets[1].diagnostic,
					targets[1].action.command
				)
			)
		).toEqual({
			diagnosticId: diagnosticIdentity(second),
			quickFixCommand: 'create-passage:Second'
		});
	});

	it('rejects malformed transient route state', () => {
		expect(
			diagnosticFixReviewTargetFromState({
				diagnosticFixReview: {diagnosticId: 'first'}
			})
		).toBeUndefined();
	});
});
