import type {CoreStorySummary} from '../../core';
import {storyPreviewDebugMetrics} from '../story-preview-debug';

function summary(overrides: Partial<CoreStorySummary> = {}): CoreStorySummary {
	return {
		assetCount: 1,
		characterCount: 0,
		diagnosticCount: 1,
		errorCount: 0,
		graph: {
			brokenLinks: 0,
			emptyPassages: 0,
			links: 1,
			orphanPassages: 0,
			passages: 1,
			resolvedLinks: 1,
			selfLinks: 0,
			taggedPassages: 0,
			unreachablePassages: 0
		},
		missingAssetCount: 0,
		passageCount: 1,
		revision: 1,
		storyId: 'story',
		tagCount: 0,
		warningCount: 1,
		wordCount: 0,
		...overrides
	};
}

describe('storyPreviewDebugMetrics', () => {
	it('uses singular labels for counts of one', () => {
		expect(
			storyPreviewDebugMetrics(summary()).map(metric => metric.label)
		).toEqual(['passage', 'link', 'broken', 'asset', 'diagnostic']);
	});

	it('uses plural labels for zero and multiple counts', () => {
		const multiple = summary({
			assetCount: 2,
			diagnosticCount: 0,
			graph: {...summary().graph, passages: 2, resolvedLinks: 0},
			warningCount: 0
		});

		expect(
			storyPreviewDebugMetrics(multiple).map(metric => metric.label)
		).toEqual(['passages', 'links', 'broken', 'assets', 'diagnostics']);
	});
});
