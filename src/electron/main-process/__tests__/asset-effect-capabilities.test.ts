import {resolve} from 'path';
import {
	assetEffectCapabilityTtlMs,
	assetEffectFailedLookupLimit,
	createAssetEffectCapabilityRegistry
} from '../asset-effect-capabilities';

describe('asset effect capabilities', () => {
	function testRegistry(cleanup = jest.fn().mockResolvedValue(undefined)) {
		let token = 0;
		const registry = createAssetEffectCapabilityRegistry({
			cleanup,
			randomToken: () => `capability-${++token}`
		});

		return {cleanup, registry};
	}

	function sender() {
		return {on: jest.fn(), once: jest.fn(), removeListener: jest.fn()};
	}

	it('binds capabilities to the issuing renderer and project root', async () => {
		const {registry} = testRegistry();
		const owner = sender();
		const stranger = sender();
		const operation = jest.fn().mockResolvedValue(undefined);
		const capability = registry.grant(
			registry.capture({sender: owner}),
			'journal-1',
			'/projects/story.twine.rs'
		);

		await expect(
			registry.apply({sender: stranger}, capability, 'undo', operation)
		).rejects.toThrow('Unknown or expired');
		expect(operation).not.toHaveBeenCalled();

		await expect(
			registry.apply({sender: owner}, capability, 'undo', operation)
		).resolves.toBe('capability-2');
		expect(operation).toHaveBeenCalledWith(
			'journal-1',
			resolve('/projects/story.twine.rs'),
			'undo'
		);
	});

	it('rotates successful one-shot capabilities and enforces effect order', async () => {
		const {registry} = testRegistry();
		const owner = sender();
		const operation = jest.fn().mockResolvedValue(undefined);
		const first = registry.grant(
			registry.capture({sender: owner}),
			'journal-2',
			'/projects/story.twine.rs'
		);
		const second = await registry.apply(
			{sender: owner},
			first,
			'undo',
			operation
		);

		await expect(
			registry.apply({sender: owner}, first, 'undo', operation)
		).rejects.toThrow('Unknown or expired');
		await expect(
			registry.apply({sender: owner}, second, 'undo', operation)
		).rejects.toThrow('Unknown or expired');
		await expect(
			registry.apply({sender: owner}, second, 'redo', operation)
		).resolves.toBe('capability-3');
	});

	it('restores a claimed capability when the journal operation fails', async () => {
		const {registry} = testRegistry();
		const owner = sender();
		const capability = registry.grant(
			registry.capture({sender: owner}),
			'journal-3',
			'/projects/story.twine.rs'
		);

		await expect(
			registry.apply({sender: owner}, capability, 'undo', async () => {
				throw new Error('journal failed');
			})
		).rejects.toThrow('journal failed');
		await expect(
			registry.apply({sender: owner}, capability, 'undo', async () => undefined)
		).resolves.toBe('capability-2');
	});

	it('expires abandoned capabilities and removes their journals', async () => {
		jest.useFakeTimers();
		try {
			const {cleanup, registry} = testRegistry();
			const owner = sender();

			registry.grant(
				registry.capture({sender: owner}),
				'journal-4',
				'/projects/story.twine.rs'
			);
			await jest.advanceTimersByTimeAsync(assetEffectCapabilityTtlMs);

			expect(cleanup).toHaveBeenCalledWith(
				'journal-4',
				resolve('/projects/story.twine.rs')
			);
		} finally {
			jest.useRealTimers();
		}
	});

	it('cleans capabilities when their renderer is destroyed', () => {
		const {cleanup, registry} = testRegistry();
		const owner = sender();

		registry.grant(
			registry.capture({sender: owner}),
			'journal-5',
			'/projects/story.twine.rs'
		);
		expect(owner.once).toHaveBeenCalledWith('destroyed', expect.any(Function));

		owner.once.mock.calls[0][1]();
		expect(cleanup).toHaveBeenCalledWith(
			'journal-5',
			resolve('/projects/story.twine.rs')
		);
	});

	it.each(['render-process-gone', 'did-start-navigation'] as const)(
		'ends the capability session on %s',
		async lifecycleEvent => {
			const {cleanup, registry} = testRegistry();
			const owner = sender();
			const capability = registry.grant(
				registry.capture({sender: owner}),
				'journal-session',
				'/projects/story.twine.rs'
			);
			const listener = owner.on.mock.calls.find(
				call => call[0] === lifecycleEvent
			)?.[1];

			expect(listener).toEqual(expect.any(Function));
			if (lifecycleEvent === 'did-start-navigation') {
				listener({isMainFrame: true, isSameDocument: false});
			} else {
				listener();
			}

			expect(cleanup).toHaveBeenCalledWith(
				'journal-session',
				resolve('/projects/story.twine.rs')
			);
			expect(owner.removeListener.mock.calls.map(call => call[0])).toEqual(
				expect.arrayContaining([
					'destroyed',
					'did-start-navigation',
					'render-process-gone'
				])
			);
			await expect(
				registry.apply(
					{sender: owner},
					capability,
					'undo',
					async () => undefined
				)
			).rejects.toThrow('Unknown or expired');
		}
	);

	it('defers teardown cleanup until an in-flight effect settles', async () => {
		const {cleanup, registry} = testRegistry();
		const owner = sender();
		const capability = registry.grant(
			registry.capture({sender: owner}),
			'journal-pending',
			'/projects/story.twine.rs'
		);
		let finishOperation!: () => void;
		const operation = new Promise<void>(resolveOperation => {
			finishOperation = resolveOperation;
		});
		const directions: string[] = [];
		const applying = registry.apply(
			{sender: owner},
			capability,
			'undo',
			(_journalToken, _rootPath, direction) => {
				directions.push(direction);
				return operation;
			}
		);

		await Promise.resolve();
		owner.on.mock.calls.find(call => call[0] === 'render-process-gone')?.[1]();
		expect(cleanup).not.toHaveBeenCalled();

		finishOperation();
		await expect(applying).rejects.toThrow('session ended during');
		expect(cleanup).toHaveBeenCalledWith(
			'journal-pending',
			resolve('/projects/story.twine.rs')
		);
		expect(directions).toEqual(['undo', 'redo']);
	});

	it('rejects and cleans a journal prepared by an ended renderer session', () => {
		const {cleanup, registry} = testRegistry();
		const owner = sender();
		const session = registry.capture({sender: owner});
		const navigation = owner.on.mock.calls.find(
			call => call[0] === 'did-start-navigation'
		)?.[1];

		navigation!({isMainFrame: true, isSameDocument: false});
		expect(() =>
			registry.grant(
				session,
				'journal-after-navigation',
				'/projects/story.twine.rs'
			)
		).toThrow('session has ended');
		expect(cleanup).toHaveBeenCalledWith(
			'journal-after-navigation',
			resolve('/projects/story.twine.rs')
		);
	});

	it('renews live capabilities before their expiry', async () => {
		jest.useFakeTimers();
		try {
			const {cleanup, registry} = testRegistry();
			const owner = sender();
			const capability = registry.grant(
				registry.capture({sender: owner}),
				'journal-renewed',
				'/projects/story.twine.rs'
			);

			await jest.advanceTimersByTimeAsync(assetEffectCapabilityTtlMs / 2);
			registry.renew({sender: owner}, [capability]);
			await jest.advanceTimersByTimeAsync(assetEffectCapabilityTtlMs / 2 + 1);
			expect(cleanup).not.toHaveBeenCalled();

			await jest.advanceTimersByTimeAsync(assetEffectCapabilityTtlMs / 2);
			expect(cleanup).toHaveBeenCalledWith(
				'journal-renewed',
				resolve('/projects/story.twine.rs')
			);
		} finally {
			jest.useRealTimers();
		}
	});

	it('renews valid capabilities while returning stale ones for reconciliation', () => {
		const {registry} = testRegistry();
		const owner = sender();
		const session = registry.capture({sender: owner});
		const stale = registry.grant(
			session,
			'journal-stale',
			'/projects/deleted.twine.rs'
		);
		const active = registry.grant(
			session,
			'journal-active',
			'/projects/active.twine.rs'
		);

		registry.revokeRoot({sender: owner}, '/projects/deleted.twine.rs');
		expect(registry.renew({sender: owner}, [stale, active])).toEqual([stale]);
	});

	it('rate-limits repeated failed lookups per renderer', async () => {
		const {registry} = testRegistry();
		const attacker = sender();
		const operation = jest.fn();

		for (let index = 1; index < assetEffectFailedLookupLimit; index++) {
			await expect(
				registry.apply(
					{sender: attacker},
					`invalid-${index}`,
					'undo',
					operation
				)
			).rejects.toThrow('Unknown or expired');
		}

		await expect(
			registry.apply({sender: attacker}, 'invalid-limit', 'undo', operation)
		).rejects.toThrow('Too many invalid');
		await expect(
			registry.apply({sender: attacker}, 'invalid-blocked', 'undo', operation)
		).rejects.toThrow('Too many invalid');
		expect(operation).not.toHaveBeenCalled();
	});
});
