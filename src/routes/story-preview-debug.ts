import type * as React from 'react';
import type {BadgeTone} from '../components/design-system/badge';
import type {CoreStorySummary} from '../core';
import type {
	StoryPreviewRuntimeLogEntry,
	StoryPreviewRuntimePassage
} from './story-preview-contract';

export * from './story-preview-contract';

export interface StoryPreviewDebugMetric {
	icon: string;
	label: string;
	tone?: BadgeTone;
	value: React.ReactNode;
}

function diagnosticTone(summary: CoreStorySummary): BadgeTone {
	if (summary.errorCount > 0) {
		return 'error';
	}

	if (summary.warningCount > 0) {
		return 'warn';
	}

	return 'saved';
}

export function storyPreviewDebugMetrics(
	summary: CoreStorySummary | undefined
): StoryPreviewDebugMetric[] {
	if (!summary) {
		return [];
	}

	const missingAssets = summary.missingAssetCount;

	return [
		{
			icon: 'files',
			label: 'passages',
			value: summary.graph.passages
		},
		{
			icon: 'link',
			label: 'links',
			tone: 'link',
			value: summary.graph.resolvedLinks
		},
		{
			icon: 'unlink',
			label: 'broken',
			tone: summary.graph.brokenLinks > 0 ? 'error' : 'neutral',
			value: summary.graph.brokenLinks
		},
		{
			icon: 'photo',
			label: missingAssets > 0 ? 'missing assets' : 'assets',
			tone: missingAssets > 0 ? 'warn' : 'neutral',
			value:
				missingAssets > 0
					? `${missingAssets}/${summary.assetCount}`
					: summary.assetCount
		},
		{
			icon: summary.diagnosticCount > 0 ? 'alert-triangle' : 'circle-check',
			label: 'diagnostics',
			tone: summary.diagnosticCount > 0 ? diagnosticTone(summary) : 'saved',
			value: summary.diagnosticCount
		}
	];
}

export function runtimePassageLabel(
	passage: StoryPreviewRuntimePassage | undefined,
	startPassageName: string | undefined
) {
	if (passage?.name) {
		return `Current: ${passage.name}`;
	}

	if (startPassageName) {
		return `Current: ${startPassageName}`;
	}

	return 'Current: waiting';
}

export function runtimeLogTone(logs: StoryPreviewRuntimeLogEntry[]): BadgeTone {
	if (logs.some(log => log.level === 'error')) {
		return 'error';
	}

	if (logs.some(log => log.level === 'warn')) {
		return 'warn';
	}

	return logs.length > 0 ? 'link' : 'neutral';
}
