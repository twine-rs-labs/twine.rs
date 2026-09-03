import type {CoreDiagnostic} from './bindings/CoreDiagnostic';
import type {CoreQuickFixApplicability} from './bindings/CoreQuickFixApplicability';

/**
 * Pure presentation metadata for a Rust-owned diagnostic fix descriptor.
 *
 * This boundary intentionally cannot mutate the story. Automatic fixes are
 * materialized into canonical plans by Rust and manual fixes remain visible
 * until a deterministic materializer exists for them.
 */
export interface RegisteredQuickFixDescription {
	applicability: CoreQuickFixApplicability;
	command: string;
	title: string;
}

export function quickFixDescriptionsForDiagnostic(
	diagnostic: CoreDiagnostic
): RegisteredQuickFixDescription[] {
	return diagnostic.quickFixes.map(quickFix => ({
		applicability: quickFix.applicability,
		command: quickFix.command,
		title: quickFix.title
	}));
}
