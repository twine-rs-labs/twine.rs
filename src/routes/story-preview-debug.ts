import type * as React from 'react';
import type {BadgeTone} from '../components/design-system';
import type {CoreStoryIndex} from '../core';

export const STORY_PREVIEW_BRIDGE_SOURCE = 'twine.rs.preview.bridge';

export interface StoryPreviewDebugMetric {
	icon: string;
	label: string;
	tone?: BadgeTone;
	value: React.ReactNode;
}

export interface StoryPreviewPassageRef {
	id: string;
	localId: string;
	name: string;
}

export interface StoryPreviewRuntimePassage {
	id?: string;
	localId?: string;
	name?: string;
	rawName?: string;
	source?: string;
}

export interface StoryPreviewRuntimeViewport {
	hash?: string;
	height: number;
	scrollX?: number;
	scrollY?: number;
	width: number;
}

export interface StoryPreviewRuntimeState {
	currentPassage?: StoryPreviewRuntimePassage;
	lastSeenAt?: number;
	status: 'idle' | 'observed' | 'waiting';
	viewport?: StoryPreviewRuntimeViewport;
}

export interface StoryPreviewRuntimeLogEntry {
	id: string;
	level: 'error' | 'info' | 'log' | 'warn';
	message: string;
	time: number;
}

export type StoryPreviewViewportPreset = 'desktop' | 'fit' | 'phone' | 'tablet';

export interface StoryPreviewBridgeMessage {
	args?: string[];
	currentPassage?: StoryPreviewRuntimePassage;
	level?: StoryPreviewRuntimeLogEntry['level'];
	message?: string;
	sessionId: string;
	source: typeof STORY_PREVIEW_BRIDGE_SOURCE;
	time?: number;
	type: 'console' | 'runtime-error' | 'state';
	viewport?: StoryPreviewRuntimeViewport;
}

export function storyPreviewPassages(
	story:
		| {
				passages: Array<{id: string; name: string}>;
		  }
		| undefined
): StoryPreviewPassageRef[] {
	return (
		story?.passages.map((passage, index) => ({
			id: passage.id,
			localId: String(index + 1),
			name: passage.name
		})) ?? []
	);
}

function bridgeScript(sessionId: string) {
	return `
<script>
(function () {
	var SOURCE = ${JSON.stringify(STORY_PREVIEW_BRIDGE_SOURCE)};
	var SESSION = ${JSON.stringify(sessionId)};
	var pendingState = 0;

	function serialize(value) {
		try {
			if (value instanceof Error) {
				return value.name + ': ' + value.message;
			}

			if (typeof value === 'string') {
				return value;
			}

			if (value === undefined) {
				return 'undefined';
			}

			return JSON.stringify(value);
		} catch (error) {
			return String(value);
		}
	}

	function post(type, payload) {
		try {
			parent.postMessage(Object.assign({
				source: SOURCE,
				sessionId: SESSION,
				time: Date.now(),
				type: type
			}, payload || {}), '*');
		} catch (error) {}
	}

	function visible(element) {
		if (!element || element.closest('tw-storydata')) {
			return false;
		}

		var rect = element.getBoundingClientRect();
		var style = getComputedStyle(element);

		return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
	}

	function mapPassageElement(pid) {
		var storyData = document.querySelector('tw-storydata');

		if (!storyData || !pid) {
			return null;
		}

		var passages = storyData.querySelectorAll('tw-passagedata');

		for (var index = 0; index < passages.length; index++) {
			if (passages[index].getAttribute('pid') === String(pid)) {
				return passages[index];
			}
		}

		return null;
	}

	function firstValue(values) {
		for (var index = 0; index < values.length; index++) {
			if (values[index] !== undefined && values[index] !== null && String(values[index]).length > 0) {
				return String(values[index]);
			}
		}

		return undefined;
	}

	function passageFromElement(element, source) {
		var localId = firstValue([
			element.getAttribute('pid'),
			element.getAttribute('data-pid'),
			element.getAttribute('data-passage-id')
		]);
		var name = firstValue([
			element.getAttribute('name'),
			element.getAttribute('passage'),
			element.getAttribute('data-passage-name'),
			element.getAttribute('data-passage')
		]);
		var storyDataPassage = localId ? mapPassageElement(localId) : null;

		return {
			localId: localId,
			name: name || (storyDataPassage ? storyDataPassage.getAttribute('name') : undefined),
			source: source
		};
	}

	function readRuntimePassage() {
		try {
			if (window.passage) {
				return {
					localId: firstValue([window.passage.id, window.passage.pid]),
					name: firstValue([window.passage.name, window.passage.title]),
					source: 'runtime'
				};
			}
		} catch (error) {}

		try {
			if (window.State && window.State.passage) {
				return {name: String(window.State.passage), source: 'runtime'};
			}
		} catch (error) {}

		try {
			if (window.state && window.state.passage) {
				return {name: String(window.state.passage), source: 'runtime'};
			}
		} catch (error) {}

		var selects = document.querySelectorAll('select');

		for (var selectIndex = 0; selectIndex < selects.length; selectIndex++) {
			var select = selects[selectIndex];
			var selectedTurn = select.options ? select.options[select.selectedIndex] : null;
			var selectedTurnText = selectedTurn ? selectedTurn.textContent : '';
			var selectedTurnMatch = selectedTurnText ? selectedTurnText.match(/^\\s*\\d+\\s*:\\s*(.+?)\\s*$/) : null;

			if (selectedTurnMatch) {
				return {name: selectedTurnMatch[1], source: 'runtime turn'};
			}
		}

		var selectors = [
			'[data-current-passage]',
			'.passage[data-passage-name]',
			'.passage[data-passage]',
			'[data-passage-name]',
			'tw-passage[name]',
			'tw-passage[passage]',
			'#passages .passage',
			'#passage',
			'tw-passage',
			'.passage'
		];

		for (var index = 0; index < selectors.length; index++) {
			var element = document.querySelector(selectors[index]);

			if (visible(element)) {
				var passage = passageFromElement(element, selectors[index]);

				if (passage.localId || passage.name) {
					return passage;
				}
			}
		}

		var storyData = document.querySelector('tw-storydata');
		var startLocalId = storyData ? storyData.getAttribute('startnode') : null;
		var startPassage = mapPassageElement(startLocalId);

		if (startPassage) {
			return passageFromElement(startPassage, 'storydata startnode');
		}

		return undefined;
	}

	function captureState() {
		pendingState = 0;
		post('state', {
			currentPassage: readRuntimePassage(),
			viewport: {
				hash: location.hash,
				height: innerHeight,
				scrollX: scrollX,
				scrollY: scrollY,
				width: innerWidth
			}
		});
	}

	function queueState() {
		clearTimeout(pendingState);
		pendingState = setTimeout(captureState, 50);
	}

	function queueStateAfterRuntimeTick() {
		queueState();
		setTimeout(captureState, 250);
	}

	['log', 'info', 'warn', 'error'].forEach(function (level) {
		var original = console[level];

		if (typeof original !== 'function') {
			return;
		}

		console[level] = function () {
			var args = Array.prototype.slice.call(arguments).map(serialize);
			post('console', {args: args, level: level});
			return original.apply(console, arguments);
		};
	});

	window.addEventListener('error', function (event) {
		post('runtime-error', {
			level: 'error',
			message: event.message || 'Runtime error'
		});
	});

	window.addEventListener('unhandledrejection', function (event) {
		post('runtime-error', {
			level: 'error',
			message: serialize(event.reason || 'Unhandled rejection')
		});
	});

	function attachObservers() {
		if (document.body) {
			new MutationObserver(queueState).observe(document.body, {
				attributes: true,
				childList: true,
				subtree: true
			});
		}

		document.addEventListener('change', queueState, true);
		document.addEventListener('click', queueStateAfterRuntimeTick, true);
		window.addEventListener('hashchange', queueState);
		window.addEventListener('popstate', queueState);
		window.addEventListener('resize', queueState);
		captureState();
	}

	window.__twineRsPreviewDebug = {captureState: captureState};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', attachObservers, {once: true});
	} else {
		attachObservers();
	}

	window.addEventListener('load', queueState);
})();
</script>`;
}

export function instrumentPreviewHtml(html: string, sessionId: string) {
	const script = bridgeScript(sessionId);

	if (/<head(\s[^>]*)?>/i.test(html)) {
		return html.replace(/<head(\s[^>]*)?>/i, match => `${match}${script}`);
	}

	if (/<html(\s[^>]*)?>/i.test(html)) {
		return html.replace(/<html(\s[^>]*)?>/i, match => `${match}${script}`);
	}

	return `${script}${html}`;
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

	const missingAssets = index.assetInventory.filter(
		asset => asset.missing
	).length;

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
			icon: index.diagnostics.length > 0 ? 'alert-triangle' : 'circle-check',
			label: 'diagnostics',
			tone: index.diagnostics.length > 0 ? diagnosticTone(index) : 'saved',
			value: index.diagnostics.length
		}
	];
}

export function isBridgeMessage(
	data: unknown
): data is StoryPreviewBridgeMessage {
	if (!data || typeof data !== 'object') {
		return false;
	}

	const candidate = data as Partial<StoryPreviewBridgeMessage>;

	return (
		candidate.source === STORY_PREVIEW_BRIDGE_SOURCE &&
		typeof candidate.sessionId === 'string' &&
		(candidate.type === 'console' ||
			candidate.type === 'runtime-error' ||
			candidate.type === 'state')
	);
}

export function resolveRuntimePassage(
	raw: StoryPreviewRuntimePassage | undefined,
	passages: StoryPreviewPassageRef[]
): StoryPreviewRuntimePassage | undefined {
	if (!raw) {
		return undefined;
	}

	const rawName = raw.name;
	const normalizedName = raw.name?.trim();
	const localId = raw.localId?.trim();
	const id = raw.id?.trim();
	const match =
		(id ? passages.find(passage => passage.id === id) : undefined) ??
		(localId
			? passages.find(passage => passage.localId === localId)
			: undefined) ??
		(normalizedName
			? passages.find(passage => passage.name === normalizedName)
			: undefined);

	return {
		id: match?.id ?? id,
		localId: match?.localId ?? localId,
		name: match?.name ?? normalizedName,
		rawName,
		source: raw.source
	};
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
