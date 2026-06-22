import * as React from 'react';
import {ErrorMessage} from '../components/error';
import {Button, Badge} from '../components/design-system';
import type {BadgeTone} from '../components/design-system';
import type {CoreStoryIndex} from '../core';
import './story-preview-frame.css';

export interface StoryPreviewDebugMetric {
	icon: string;
	label: string;
	tone?: BadgeTone;
	value: React.ReactNode;
}

export interface StoryPreviewFrameProps {
	debugMetrics?: StoryPreviewDebugMetric[];
	error?: Error;
	html?: string;
	missingStoryMessage: string;
	onOpenBuild?: () => void;
	onRevealGraph?: () => void;
	onRevealSource?: () => void;
	onTestFromStart?: () => void;
	startPassageName?: string;
	storyExists: boolean;
	storyName?: string;
	targetLabel?: string;
	title: string;
}

function byteLength(source: string) {
	return new Blob([source]).size;
}

function diagnosticTone(index: CoreStoryIndex): BadgeTone {
	if (index.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
		return 'error';
	}

	if (index.diagnostics.some(diagnostic => diagnostic.severity === 'warning')) {
		return 'warn';
	}

	return 'saved';
}

export function storyPreviewDebugMetrics(
	index: CoreStoryIndex | undefined
): StoryPreviewDebugMetric[] {
	if (!index) {
		return [];
	}

	const missingAssets = index.assetInventory.filter(asset => asset.missing).length;

	return [
		{
			icon: 'files',
			label: 'passages',
			value: index.graph.passages
		},
		{
			icon: 'link',
			label: 'links',
			tone: 'link',
			value: index.graph.resolvedLinks
		},
		{
			icon: 'unlink',
			label: 'broken',
			tone: index.graph.brokenLinks > 0 ? 'error' : 'neutral',
			value: index.graph.brokenLinks
		},
		{
			icon: 'photo',
			label: missingAssets > 0 ? 'missing assets' : 'assets',
			tone: missingAssets > 0 ? 'warn' : 'neutral',
			value:
				missingAssets > 0
					? `${missingAssets}/${index.assetInventory.length}`
					: index.assetInventory.length
		},
		{
			icon:
				index.diagnostics.length > 0 ? 'alert-triangle' : 'circle-check',
			label: 'diagnostics',
			tone: index.diagnostics.length > 0 ? diagnosticTone(index) : 'saved',
			value: index.diagnostics.length
		}
	];
}

export const StoryPreviewFrame: React.FC<StoryPreviewFrameProps> = props => {
	const {
		debugMetrics = [],
		error,
		html,
		missingStoryMessage,
		onOpenBuild,
		onRevealGraph,
		onRevealSource,
		onTestFromStart,
		startPassageName,
		storyExists,
		storyName,
		targetLabel,
		title
	} = props;
	const storyDataCount = html?.match(/<tw-storydata\b/g)?.length ?? 0;

	if (error) {
		return <ErrorMessage>{error.message}</ErrorMessage>;
	}

	if (!storyExists) {
		return <ErrorMessage>{missingStoryMessage}</ErrorMessage>;
	}

	return (
		<main className="story-preview-route">
			<div className="story-preview-route__debug">
				<div className="story-preview-route__debug-main">
					<Badge icon="player-play" tone="build">
						{targetLabel ?? 'Preview'}
					</Badge>
					<span className="story-preview-route__story-name">
						{storyName ?? title}
					</span>
					{startPassageName && (
						<Badge icon="rocket" tone="saved">
							Start: {startPassageName}
						</Badge>
					)}
					{html && (
						<Badge
							icon="database"
							mono
							tone={storyDataCount === 1 ? 'saved' : 'warn'}
						>
							{byteLength(html)} bytes · {storyDataCount} story data
						</Badge>
					)}
					{debugMetrics.map(metric => (
						<Badge
							icon={metric.icon}
							key={`${metric.label}:${metric.value}`}
							mono
							tone={metric.tone ?? 'neutral'}
							title={`${metric.value} ${metric.label}`}
						>
							{metric.value} {metric.label}
						</Badge>
					))}
				</div>
				<div className="story-preview-route__debug-actions">
					<Button
						disabled={!onTestFromStart}
						icon="tool"
						onClick={onTestFromStart}
						size="sm"
						variant="primary"
					>
						Test From Start
					</Button>
					<Button
						disabled={!onRevealSource}
						icon="file-text"
						onClick={onRevealSource}
						size="sm"
					>
						Source
					</Button>
					<Button
						disabled={!onRevealGraph}
						icon="binary-tree"
						onClick={onRevealGraph}
						size="sm"
					>
						Graph
					</Button>
					<Button
						disabled={!onOpenBuild}
						icon="package"
						onClick={onOpenBuild}
						size="sm"
					>
						Build
					</Button>
				</div>
			</div>
			{html ? (
				<iframe
					className="story-preview-route__frame"
					srcDoc={html}
					title={title}
				/>
			) : (
				<div className="story-preview-route__loading" role="status">
					Loading story...
				</div>
			)}
		</main>
	);
};
