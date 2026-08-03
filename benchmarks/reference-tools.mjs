import {createHash} from 'node:crypto';
import {baselineCandidateErrors} from './performance-tools.mjs';

export const performanceReferenceSchemaVersion = 1;

function canonicalValue(value) {
	if (Array.isArray(value)) {
		return value.map(canonicalValue);
	}

	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map(key => [key, canonicalValue(value[key])])
		);
	}

	return value;
}

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function objectSha256(value) {
	return sha256(JSON.stringify(canonicalValue(value)));
}

function normalizedInvariants(assertions = []) {
	const byName = new Map();

	for (const assertion of assertions) {
		const current = byName.get(assertion.name) ?? {
			name: assertion.name,
			occurrences: 0,
			passed: true
		};
		current.occurrences += 1;
		current.passed = current.passed && assertion.passed === true;
		byName.set(assertion.name, current);
	}

	const checks = [...byName.values()].sort((left, right) =>
		left.name.localeCompare(right.name)
	);

	return {
		checks,
		failed: checks.filter(check => !check.passed).length,
		passed: checks.filter(check => check.passed).length,
		total: checks.length
	};
}

function normalizedEvaluationChecks(checks = []) {
	return checks
		.filter(check => check.kind !== 'invariant')
		.map(check =>
			Object.fromEntries(
				[
					'actual',
					'baseline',
					'blocking',
					'kind',
					'limit',
					'name',
					'passed',
					'status'
				]
					.filter(key => check[key] !== undefined)
					.map(key => [key, check[key]])
			)
		)
		.sort(
			(left, right) =>
				left.kind.localeCompare(right.kind) ||
				left.name.localeCompare(right.name)
		);
}

function normalizedPhases(phases = {}) {
	return Object.fromEntries(
		Object.entries(phases)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, phase]) => [
				name,
				{
					finishedAt: phase.finishedAt,
					startedAt: phase.startedAt,
					status: phase.status
				}
			])
	);
}

export function createPerformanceReferenceSummary(
	report,
	{budgets, sourceReportFile, sourceReportSha256}
) {
	if (
		!budgets ||
		typeof budgets !== 'object' ||
		Array.isArray(budgets) ||
		!budgets.metrics ||
		typeof budgets.metrics !== 'object' ||
		Array.isArray(budgets.metrics)
	) {
		throw new TypeError(
			'createPerformanceReferenceSummary requires performance budgets.'
		);
	}

	const limitations = [];
	const phaseProvenanceVerified = [
		'git-revision-stable-across-phases',
		'git-dirty-state-stable-across-phases'
	].every(name =>
		report.assertions?.some(
			assertion => assertion.name === name && assertion.passed === true
		)
	);
	const cleanRevision =
		report.environment?.git?.dirty === false &&
		typeof report.environment.git.revision === 'string' &&
		report.environment.git.revision.length > 0 &&
		phaseProvenanceVerified;
	const evaluationPassed = report.evaluation?.passed === true;
	const strictBaselineErrors = baselineCandidateErrors(report, budgets, {
		requireClean: true
	});
	const baselineEligible = strictBaselineErrors.length === 0;

	if (report.environment?.git?.dirty) {
		limitations.push(
			'The source report was captured from a dirty worktree. This snapshot is historical performance evidence, not proof of clean-commit reproducibility.'
		);
	} else if (!cleanRevision) {
		limitations.push(
			'The source report has no phase-stable, verified clean Git revision. This snapshot is historical performance evidence, not proof of clean-commit reproducibility.'
		);
	}
	if (!evaluationPassed) {
		limitations.push(
			'The source report failed a blocking regression gate. It is normalized evidence, not eligible for baseline acceptance or replacement.'
		);
	} else if (cleanRevision && !baselineEligible) {
		limitations.push(
			`The source report does not satisfy strict baseline acceptance: ${strictBaselineErrors.join(
				' '
			)}`
		);
	}

	return {
		aggregates: report.aggregates,
		baselineEligible,
		classification: cleanRevision
			? baselineEligible
				? 'clean-commit-baseline'
				: evaluationPassed
					? 'clean-commit-ineligible-evidence'
					: 'clean-commit-failed-gate-evidence'
			: 'historical-initial-baseline',
		createdAt: report.createdAt,
		environment: report.environment,
		evaluation: {
			baselineStatus: report.evaluation?.baselineStatus,
			checks: normalizedEvaluationChecks(report.evaluation?.checks),
			passed: report.evaluation?.passed
		},
		fixture: {
			...report.fixture,
			manifestSha256: objectSha256(report.fixture)
		},
		invariants: normalizedInvariants(report.assertions),
		kind: 'twine-electron-performance-reference',
		provenance: {
			budgetsSha256: objectSha256(report.budgets),
			limitations,
			sourceReport: {
				file: sourceReportFile,
				sha256: sourceReportSha256,
				tracked: false
			}
		},
		run: {
			phase: report.phase,
			phases: normalizedPhases(report.phases),
			smoke: report.smoke,
			testStatus: report.test?.status
		},
		schemaVersion: performanceReferenceSchemaVersion
	};
}
