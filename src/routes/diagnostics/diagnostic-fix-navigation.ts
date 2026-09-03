import type {CoreDiagnostic} from '../../core/bindings/CoreDiagnostic';
import {
	quickFixDescriptionsForDiagnostic,
	type RegisteredQuickFixDescription
} from '../../core/quick-fix-registry';
import {diagnosticIdentity} from '../../core';

export interface DiagnosticFixReviewNavigationTarget {
	diagnosticId: string;
	quickFixCommand: string;
}

export interface ContextualDiagnosticQuickFix {
	action: RegisteredQuickFixDescription;
	diagnostic: CoreDiagnostic;
}

interface DiagnosticsNavigationState {
	diagnosticFixReview: DiagnosticFixReviewNavigationTarget;
}

export function contextualDiagnosticQuickFixes(
	diagnostics: readonly CoreDiagnostic[]
): ContextualDiagnosticQuickFix[] {
	return diagnostics.flatMap(diagnostic =>
		quickFixDescriptionsForDiagnostic(diagnostic).map(action => ({
			action,
			diagnostic
		}))
	);
}

export function diagnosticFixReviewNavigationState(
	diagnostic: CoreDiagnostic,
	quickFixCommand: string
): DiagnosticsNavigationState {
	return {
		diagnosticFixReview: {
			diagnosticId: diagnosticIdentity(diagnostic),
			quickFixCommand
		}
	};
}

export function diagnosticFixReviewTargetFromState(
	state: unknown
): DiagnosticFixReviewNavigationTarget | undefined {
	if (
		!state ||
		typeof state !== 'object' ||
		!('diagnosticFixReview' in state)
	) {
		return undefined;
	}

	const target = state.diagnosticFixReview;

	if (
		!target ||
		typeof target !== 'object' ||
		!('diagnosticId' in target) ||
		!('quickFixCommand' in target) ||
		typeof target.diagnosticId !== 'string' ||
		typeof target.quickFixCommand !== 'string'
	) {
		return undefined;
	}

	return {
		diagnosticId: target.diagnosticId,
		quickFixCommand: target.quickFixCommand
	};
}
