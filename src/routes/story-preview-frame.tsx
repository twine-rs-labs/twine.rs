import * as React from 'react';
import {ErrorMessage} from '../components/error';
import {Button, Badge, SegmentedControl} from '../components/design-system';
import {
	instrumentPreviewHtml,
	isBridgeMessage,
	resolveRuntimePassage,
	runtimeLogTone,
	runtimePassageLabel
} from './story-preview-debug';
import type {
	StoryPreviewDebugMetric,
	StoryPreviewPassageRef,
	StoryPreviewRuntimeLogEntry,
	StoryPreviewRuntimeState,
	StoryPreviewViewportPreset
} from './story-preview-debug';
import './story-preview-frame.css';

export interface StoryPreviewFrameProps {
	debugMetrics?: StoryPreviewDebugMetric[];
	error?: Error;
	html?: string;
	missingStoryMessage: string;
	onOpenBuild?: () => void;
	onRevealGraph?: (passageId?: string) => void;
	onRevealSource?: (passageId?: string) => void;
	onTestCurrentPassage?: (passageId: string) => void;
	onTestFromStart?: () => void;
	passages?: StoryPreviewPassageRef[];
	startPassageName?: string;
	storyExists: boolean;
	storyName?: string;
	targetLabel?: string;
	title: string;
}

function byteLength(source: string) {
	return new Blob([source]).size;
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
		onTestCurrentPassage,
		onTestFromStart,
		passages = [],
		startPassageName,
		storyExists,
		storyName,
		targetLabel,
		title
	} = props;
	const [reloadKey, setReloadKey] = React.useState(0);
	const [runtimeLogs, setRuntimeLogs] = React.useState<
		StoryPreviewRuntimeLogEntry[]
	>([]);
	const [runtimeState, setRuntimeState] =
		React.useState<StoryPreviewRuntimeState>({
			status: html ? 'waiting' : 'idle'
		});
	const [viewportPreset, setViewportPreset] =
		React.useState<StoryPreviewViewportPreset>('fit');
	const bridgeSessionId = React.useMemo(
		() => `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		[html]
	);
	const instrumentedHtml = React.useMemo(
		() => (html ? instrumentPreviewHtml(html, bridgeSessionId) : undefined),
		[bridgeSessionId, html]
	);
	const storyDataCount = html?.match(/<tw-storydata\b/g)?.length ?? 0;
	const currentPassage = runtimeState.currentPassage;
	const currentPassageId = currentPassage?.id;
	const latestLog = runtimeLogs[0];
	const runtimeViewport = runtimeState.viewport;

	React.useEffect(() => {
		setRuntimeLogs([]);
		setRuntimeState({status: html ? 'waiting' : 'idle'});
	}, [html, reloadKey]);

	React.useEffect(() => {
		function handleMessage(event: MessageEvent) {
			const {data} = event;

			if (!isBridgeMessage(data) || data.sessionId !== bridgeSessionId) {
				return;
			}

			if (data.type === 'state') {
				setRuntimeState({
					currentPassage: resolveRuntimePassage(data.currentPassage, passages),
					lastSeenAt: data.time ?? Date.now(),
					status: 'observed',
					viewport: data.viewport
				});
				return;
			}

			setRuntimeLogs(currentLogs => {
				const message =
					data.type === 'runtime-error'
						? (data.message ?? 'Runtime error')
						: (data.args?.join(' ') ?? '');

				return [
					{
						id: `${data.time ?? Date.now()}:${currentLogs.length}`,
						level: data.level ?? 'error',
						message,
						time: data.time ?? Date.now()
					},
					...currentLogs
				].slice(0, 12);
			});
		}

		window.addEventListener('message', handleMessage);

		return () => window.removeEventListener('message', handleMessage);
	}, [bridgeSessionId, passages]);

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
						disabled={!currentPassageId || !onTestCurrentPassage}
						icon="player-play"
						onClick={() =>
							currentPassageId && onTestCurrentPassage?.(currentPassageId)
						}
						size="sm"
						variant="primary"
					>
						Test Current
					</Button>
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
						onClick={() => onRevealSource?.(currentPassageId)}
						size="sm"
					>
						Source
					</Button>
					<Button
						disabled={!onRevealGraph}
						icon="binary-tree"
						onClick={() => onRevealGraph?.(currentPassageId)}
						size="sm"
					>
						Graph
					</Button>
					<Button
						disabled={!html}
						icon="refresh"
						onClick={() => setReloadKey(current => current + 1)}
						size="sm"
					>
						Reload
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
			{html && (
				<div className="story-preview-route__runtime">
					<div className="story-preview-route__runtime-main">
						<Badge
							icon={currentPassageId ? 'focus-2' : 'circle-dashed'}
							tone={currentPassageId ? 'saved' : 'generated'}
							title={currentPassage?.source}
						>
							{runtimePassageLabel(currentPassage, startPassageName)}
						</Badge>
						<Badge icon="resize" mono tone="neutral">
							{runtimeViewport
								? `${runtimeViewport.width} x ${runtimeViewport.height}`
								: runtimeState.status === 'waiting'
									? 'runtime waiting'
									: 'runtime idle'}
						</Badge>
						<Badge
							icon="terminal-2"
							mono
							tone={runtimeLogTone(runtimeLogs)}
							title={latestLog?.message}
						>
							{runtimeLogs.length} logs
						</Badge>
						{latestLog && (
							<span
								className="story-preview-route__latest-log"
								data-level={latestLog.level}
							>
								{latestLog.message}
							</span>
						)}
					</div>
					<SegmentedControl
						className="story-preview-route__viewport-control"
						onChange={value =>
							setViewportPreset(value as StoryPreviewViewportPreset)
						}
						options={[
							{icon: 'arrows-diagonal', label: 'Fit', value: 'fit'},
							{icon: 'layout-grid', label: 'Desktop', value: 'desktop'},
							{icon: 'layout-columns', label: 'Tablet', value: 'tablet'},
							{icon: 'resize', label: 'Phone', value: 'phone'}
						]}
						size="sm"
						value={viewportPreset}
					/>
				</div>
			)}
			{html ? (
				<div
					className="story-preview-route__frame-shell"
					data-viewport={viewportPreset}
				>
					<iframe
						className="story-preview-route__frame"
						key={`${bridgeSessionId}:${reloadKey}`}
						srcDoc={instrumentedHtml}
						title={title}
					/>
				</div>
			) : (
				<div className="story-preview-route__loading" role="status">
					Loading story...
				</div>
			)}
		</main>
	);
};
