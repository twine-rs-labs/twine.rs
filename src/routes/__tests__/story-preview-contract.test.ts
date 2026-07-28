import {
	createStoryPreviewPassageLookup,
	initialStoryPreviewRuntimeModel,
	instrumentPreviewHtml,
	normalizeStoryPreviewBridgeMessage,
	reduceStoryPreviewRuntime,
	resolveRuntimePassage,
	STORY_PREVIEW_BRIDGE_LIMITS,
	STORY_PREVIEW_BRIDGE_SOURCE,
	STORY_PREVIEW_RUNTIME_LOG_LIMIT
} from '../story-preview-contract';
import {runtimeLogTone} from '../story-preview-debug';

function lastPostedState(postMessage: jest.SpyInstance) {
	return postMessage.mock.calls
		.map(([message]) => message)
		.filter(message => message?.type === 'state')
		.at(-1);
}

describe('instrumented runtime passage detection', () => {
	it('uses bounded Harlowe session identity and never guesses from rendered text', () => {
		document.body.innerHTML = `
			<tw-storydata format="Harlowe" startnode="1">
				<tw-passagedata pid="1" name="Start">''Hello''</tw-passagedata>
				<tw-passagedata pid="2" name="Second">Hello</tw-passagedata>
			</tw-storydata>
			<tw-story><tw-passage><strong>Hello</strong></tw-passage></tw-story>
		`;
		sessionStorage.clear();
		const postMessage = jest
			.spyOn(window, 'postMessage')
			.mockImplementation(() => undefined);
		const instrumented = instrumentPreviewHtml(
			'<html><head></head><body></body></html>',
			'session-1'
		);
		const script = /<script>([\s\S]*?)<\/script>/.exec(instrumented)?.[1];

		expect(script).toBeDefined();
		window.eval(script!);
		(window as any).__twineRsPreviewDebug.captureState();
		expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();

		sessionStorage.setItem(
			'Saved Session',
			JSON.stringify([{passage: 'Start'}, 'Second'])
		);
		(window as any).__twineRsPreviewDebug.captureState();
		expect(lastPostedState(postMessage)?.currentPassage).toEqual({
			name: 'Second',
			source: 'Harlowe session'
		});

		sessionStorage.setItem('Saved Session', 'x'.repeat(1024 * 1024 + 1));
		(window as any).__twineRsPreviewDebug.captureState();
		expect(lastPostedState(postMessage)?.currentPassage).toBeUndefined();

		postMessage.mockRestore();
		sessionStorage.clear();
	});
});

describe('normalizeStoryPreviewBridgeMessage()', () => {
	it('copies valid console messages into the bounded contract', () => {
		const args = ['hello', 'preview'];
		const normalized = normalizeStoryPreviewBridgeMessage({
			args,
			level: 'warn',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time: 10,
			type: 'console'
		});

		expect(normalized).toEqual({
			args,
			level: 'warn',
			sessionId: 'session-1',
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time: 10,
			type: 'console'
		});
		expect(normalized?.args).not.toBe(args);
	});

	it.each([
		['a non-object', 'message'],
		[
			'an oversized session ID',
			{
				args: [],
				level: 'log',
				sessionId: 's'.repeat(STORY_PREVIEW_BRIDGE_LIMITS.sessionIdLength + 1),
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				type: 'console'
			}
		],
		[
			'an oversized log argument',
			{
				args: ['a'.repeat(STORY_PREVIEW_BRIDGE_LIMITS.logArgumentLength + 1)],
				level: 'log',
				sessionId: 'session-1',
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				type: 'console'
			}
		],
		[
			'a malformed viewport',
			{
				sessionId: 'session-1',
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				type: 'state',
				viewport: {height: 'large', width: 800}
			}
		]
	])('rejects %s', (_label, message) => {
		expect(normalizeStoryPreviewBridgeMessage(message)).toBeUndefined();
	});
});

describe('story preview runtime state', () => {
	const passages = [
		{id: 'start-id', localId: '1', name: 'Start'},
		{id: 'second-id', localId: '2', name: 'Second'}
	];
	const lookup = createStoryPreviewPassageLookup(passages);

	it.each([
		[{id: 'second-id'}, 'second-id'],
		[{localId: '2'}, 'second-id'],
		[{name: 'Second'}, 'second-id']
	])('resolves known passage references', (runtimePassage, expectedId) => {
		expect(resolveRuntimePassage(runtimePassage, lookup)?.id).toBe(expectedId);
	});

	it('does not promote an unknown raw ID into a stable passage ID', () => {
		expect(
			resolveRuntimePassage(
				{id: 'forged', name: 'Unknown', source: 'runtime'},
				lookup
			)
		).toEqual({
			id: undefined,
			localId: undefined,
			name: 'Unknown',
			rawName: 'Unknown',
			source: 'runtime'
		});
	});

	it('caps logs while preserving newest-first ordering and stable IDs', () => {
		let model = initialStoryPreviewRuntimeModel(true);

		for (let index = 0; index < STORY_PREVIEW_RUNTIME_LOG_LIMIT + 2; index++) {
			model = reduceStoryPreviewRuntime(model, {
				message: {
					args: [`log-${index}`],
					level: 'log',
					sessionId: 'session-1',
					source: STORY_PREVIEW_BRIDGE_SOURCE,
					time: 10,
					type: 'console'
				},
				now: 10,
				passages: lookup,
				type: 'message'
			});
		}

		expect(model.logs).toHaveLength(STORY_PREVIEW_RUNTIME_LOG_LIMIT);
		expect(model.logs[0]).toMatchObject({
			id: `10:${STORY_PREVIEW_RUNTIME_LOG_LIMIT + 1}`,
			message: `log-${STORY_PREVIEW_RUNTIME_LOG_LIMIT + 1}`
		});
		expect(model.logs.at(-1)?.message).toBe('log-2');
	});

	it('orders console levels and runtime failures with the correct error tone', () => {
		let model = initialStoryPreviewRuntimeModel(true);
		const messages = [
			{args: ['plain'], level: 'log', type: 'console'},
			{args: ['details'], level: 'info', type: 'console'},
			{args: ['warning'], level: 'warn', type: 'console'},
			{args: ['console failure'], level: 'error', type: 'console'},
			{
				level: 'error',
				message: 'Unhandled rejection: rejected',
				type: 'runtime-error'
			},
			{
				level: 'error',
				message: 'Runtime error: thrown',
				type: 'runtime-error'
			}
		] as const;

		for (const [index, message] of messages.entries()) {
			const normalized = normalizeStoryPreviewBridgeMessage({
				...message,
				sessionId: 'session-1',
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				time: index + 1
			});

			expect(normalized).toBeDefined();
			model = reduceStoryPreviewRuntime(model, {
				message: normalized!,
				now: index + 1,
				passages: lookup,
				type: 'message'
			});
		}

		expect(model.logs.map(log => [log.level, log.message])).toEqual([
			['error', 'Runtime error: thrown'],
			['error', 'Unhandled rejection: rejected'],
			['error', 'console failure'],
			['warn', 'warning'],
			['info', 'details'],
			['log', 'plain']
		]);
		expect(runtimeLogTone(model.logs)).toBe('error');
	});

	it('resets runtime observation and logs for a replacement or reload', () => {
		const populated = reduceStoryPreviewRuntime(
			initialStoryPreviewRuntimeModel(true),
			{
				message: {
					args: ['log'],
					level: 'warn',
					sessionId: 'session-1',
					source: STORY_PREVIEW_BRIDGE_SOURCE,
					type: 'console'
				},
				now: 10,
				passages: lookup,
				type: 'message'
			}
		);

		expect(
			reduceStoryPreviewRuntime(populated, {
				hasContent: true,
				type: 'reset'
			})
		).toEqual(initialStoryPreviewRuntimeModel(true));
	});
});
