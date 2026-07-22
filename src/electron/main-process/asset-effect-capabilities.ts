import {randomUUID} from 'crypto';
import {resolve} from 'path';

export const assetEffectCapabilityTtlMs = 12 * 60 * 60 * 1000;
export const assetEffectFailedLookupLimit = 5;
export const assetEffectFailedLookupWindowMs = 10_000;
export const assetEffectFailedLookupBlockMs = 30_000;
export const maxRenewedAssetEffectCapabilities = 1000;

type AssetEffectDirection = 'redo' | 'undo';
type AssetEffectSender = {
	on?: (
		event: 'did-start-navigation' | 'render-process-gone',
		listener: (...args: any[]) => void
	) => unknown;
	once?: (event: 'destroyed', listener: () => void) => unknown;
	removeListener?: (
		event: 'destroyed' | 'did-start-navigation' | 'render-process-gone',
		listener: (...args: any[]) => void
	) => unknown;
};
type AssetEffectEvent = {sender?: AssetEffectSender};
type AssetEffectCleanup = (
	journalToken: string,
	rootPath: string
) => Promise<void> | void;

interface AssetEffectGrant {
	expectedDirection: AssetEffectDirection;
	expiresAt: number;
	inFlight: boolean;
	journalToken: string;
	rootPath: string;
	timer?: ReturnType<typeof setTimeout>;
}

interface AssetEffectSenderState {
	blockedUntil: number;
	closed: boolean;
	failedLookups: number;
	failureWindowStartedAt: number;
	grants: Map<string, AssetEffectGrant>;
	destroyedListener?: () => void;
	navigationListener?: (navigation: {
		isMainFrame?: boolean;
		isSameDocument?: boolean;
	}) => void;
	processGoneListener?: () => void;
}

interface AssetEffectRendererSession {
	sender: AssetEffectSender;
	state: AssetEffectSenderState;
}

interface AssetEffectCapabilityRegistryOptions {
	cleanup: AssetEffectCleanup;
	now?: () => number;
	randomToken?: () => string;
	ttlMs?: number;
}

function oppositeDirection(direction: AssetEffectDirection) {
	return direction === 'undo' ? 'redo' : 'undo';
}

/**
 * Keeps asset journals private to main while issuing short-lived, rotating
 * capabilities to the renderer that created them.
 */
export function createAssetEffectCapabilityRegistry({
	cleanup,
	now = Date.now,
	randomToken = randomUUID,
	ttlMs = assetEffectCapabilityTtlMs
}: AssetEffectCapabilityRegistryOptions) {
	const states = new WeakMap<object, AssetEffectSenderState>();

	function cleanupGrant(grant: AssetEffectGrant) {
		void Promise.resolve(cleanup(grant.journalToken, grant.rootPath)).catch(
			() => undefined
		);
	}

	function removeGrant(
		state: AssetEffectSenderState,
		capability: string,
		grant: AssetEffectGrant,
		cleanupJournal: boolean
	) {
		if (state.grants.get(capability) !== grant) {
			return;
		}

		state.grants.delete(capability);
		if (grant.timer) {
			clearTimeout(grant.timer);
			grant.timer = undefined;
		}
		if (cleanupJournal) {
			cleanupGrant(grant);
		}
	}

	function scheduleExpiration(
		state: AssetEffectSenderState,
		capability: string,
		grant: AssetEffectGrant
	) {
		const remainingMs = Math.max(0, grant.expiresAt - now());

		grant.timer = setTimeout(() => {
			removeGrant(state, capability, grant, true);
		}, remainingMs);
		grant.timer.unref?.();
	}

	function closeSenderSession(
		sender: AssetEffectSender,
		state: AssetEffectSenderState
	) {
		if (state.closed) {
			return;
		}

		state.closed = true;
		if (state.destroyedListener) {
			sender.removeListener?.('destroyed', state.destroyedListener);
		}
		if (state.processGoneListener) {
			sender.removeListener?.('render-process-gone', state.processGoneListener);
		}
		if (state.navigationListener) {
			sender.removeListener?.('did-start-navigation', state.navigationListener);
		}
		if (states.get(sender) === state) {
			states.delete(sender);
		}
		for (const [capability, grant] of state.grants) {
			if (grant.inFlight) {
				if (grant.timer) {
					clearTimeout(grant.timer);
					grant.timer = undefined;
				}
			} else {
				removeGrant(state, capability, grant, true);
			}
		}
	}

	function rendererSession(
		event: AssetEffectEvent
	): AssetEffectRendererSession {
		const sender =
			event?.sender ??
			(process.env.NODE_ENV === 'test' && event && typeof event === 'object'
				? (event as AssetEffectSender)
				: undefined);

		if (!sender || typeof sender !== 'object') {
			throw new Error('Asset effect access requires a trusted renderer.');
		}

		let state = states.get(sender);

		if (!state) {
			const createdState: AssetEffectSenderState = {
				blockedUntil: 0,
				closed: false,
				failedLookups: 0,
				failureWindowStartedAt: now(),
				grants: new Map()
			};

			createdState.destroyedListener = () =>
				closeSenderSession(sender, createdState);
			createdState.processGoneListener = () =>
				closeSenderSession(sender, createdState);
			createdState.navigationListener = navigation => {
				if (navigation.isMainFrame && !navigation.isSameDocument) {
					closeSenderSession(sender, createdState);
				}
			};
			state = createdState;
			states.set(sender, state);
			sender.once?.('destroyed', createdState.destroyedListener);
			sender.on?.('render-process-gone', createdState.processGoneListener);
			sender.on?.('did-start-navigation', createdState.navigationListener);
		}

		return {sender, state};
	}

	function activeSessionState(session: AssetEffectRendererSession) {
		if (session.state.closed) {
			throw new Error('Asset effect renderer session has ended.');
		}

		return session.state;
	}

	function recordFailedLookup(state: AssetEffectSenderState) {
		const timestamp = now();

		if (timestamp < state.blockedUntil) {
			return true;
		}
		if (
			timestamp - state.failureWindowStartedAt >=
			assetEffectFailedLookupWindowMs
		) {
			state.failedLookups = 0;
			state.failureWindowStartedAt = timestamp;
		}

		state.failedLookups++;
		if (state.failedLookups >= assetEffectFailedLookupLimit) {
			state.blockedUntil = timestamp + assetEffectFailedLookupBlockMs;
			return true;
		}

		return false;
	}

	function rejectFailedLookup(state: AssetEffectSenderState): never {
		if (recordFailedLookup(state)) {
			throw new Error('Too many invalid asset effect capability attempts.');
		}

		throw new Error('Unknown or expired asset effect capability.');
	}

	function resetFailedLookups(state: AssetEffectSenderState) {
		state.blockedUntil = 0;
		state.failedLookups = 0;
		state.failureWindowStartedAt = now();
	}

	function issue(
		state: AssetEffectSenderState,
		journalToken: string,
		rootPath: string,
		expectedDirection: AssetEffectDirection
	) {
		let capability = randomToken();

		while (state.grants.has(capability)) {
			capability = randomToken();
		}

		const grant: AssetEffectGrant = {
			expectedDirection,
			expiresAt: now() + ttlMs,
			inFlight: false,
			journalToken,
			rootPath: resolve(rootPath)
		};

		state.grants.set(capability, grant);
		scheduleExpiration(state, capability, grant);
		return capability;
	}

	function claim(
		session: AssetEffectRendererSession,
		capability: string,
		direction?: AssetEffectDirection
	) {
		const state = activeSessionState(session);
		const timestamp = now();

		if (timestamp < state.blockedUntil) {
			rejectFailedLookup(state);
		}
		if (typeof capability !== 'string') {
			rejectFailedLookup(state);
		}

		const grant = state.grants.get(capability);

		if (!grant || grant.inFlight) {
			rejectFailedLookup(state);
		}
		if (grant.expiresAt <= timestamp) {
			removeGrant(state, capability, grant, true);
			rejectFailedLookup(state);
		}
		if (direction && grant.expectedDirection !== direction) {
			rejectFailedLookup(state);
		}

		resetFailedLookups(state);
		grant.inFlight = true;
		if (grant.timer) {
			clearTimeout(grant.timer);
			grant.timer = undefined;
		}
		return {capability, grant, state};
	}

	function restoreClaim(
		state: AssetEffectSenderState,
		capability: string,
		grant: AssetEffectGrant
	) {
		grant.inFlight = false;
		grant.expiresAt = now() + ttlMs;
		scheduleExpiration(state, capability, grant);
	}

	return {
		capture(event: AssetEffectEvent) {
			return rendererSession(event);
		},
		isClosed(session: AssetEffectRendererSession) {
			return session.state.closed;
		},

		async apply(
			event: AssetEffectEvent,
			capability: string,
			direction: AssetEffectDirection,
			operation: (
				journalToken: string,
				rootPath: string,
				direction: AssetEffectDirection
			) => Promise<void> | void
		) {
			const session = rendererSession(event);

			if (direction !== 'redo' && direction !== 'undo') {
				const state = activeSessionState(session);

				rejectFailedLookup(state);
			}

			const {grant, state} = claim(session, capability, direction);

			try {
				await operation(grant.journalToken, grant.rootPath, direction);
			} catch (error) {
				if (state.closed) {
					removeGrant(state, capability, grant, true);
				} else {
					restoreClaim(state, capability, grant);
				}
				throw error;
			}

			if (state.closed) {
				try {
					await operation(
						grant.journalToken,
						grant.rootPath,
						oppositeDirection(direction)
					);
				} catch (compensationError) {
					removeGrant(state, capability, grant, false);
					throw new Error(
						`Asset effect renderer session ended and native compensation failed: ${compensationError}`
					);
				}
				removeGrant(state, capability, grant, true);
				throw new Error(
					'Asset effect renderer session ended during the operation.'
				);
			}
			removeGrant(state, capability, grant, false);
			return issue(
				state,
				grant.journalToken,
				grant.rootPath,
				oppositeDirection(direction)
			);
		},

		async discard(
			event: AssetEffectEvent,
			capability: string,
			operation: (
				journalToken: string,
				rootPath: string
			) => Promise<void> | void
		) {
			const session = rendererSession(event);
			const {grant, state} = claim(session, capability);

			try {
				await operation(grant.journalToken, grant.rootPath);
			} catch (error) {
				if (state.closed) {
					removeGrant(state, capability, grant, true);
				} else {
					restoreClaim(state, capability, grant);
				}
				throw error;
			}

			removeGrant(state, capability, grant, false);
			if (state.closed) {
				throw new Error(
					'Asset effect renderer session ended during the operation.'
				);
			}
		},

		grant(
			session: AssetEffectRendererSession,
			journalToken: string,
			rootPath: string
		) {
			if (typeof journalToken !== 'string' || journalToken.length === 0) {
				throw new Error('Asset effect journal token is invalid.');
			}

			if (session.state.closed) {
				cleanupGrant({
					expectedDirection: 'undo',
					expiresAt: now(),
					inFlight: false,
					journalToken,
					rootPath: resolve(rootPath)
				});
				throw new Error('Asset effect renderer session has ended.');
			}

			return issue(session.state, journalToken, rootPath, 'undo');
		},

		renew(event: AssetEffectEvent, capabilities: string[]) {
			const session = rendererSession(event);
			const state = activeSessionState(session);

			if (
				!Array.isArray(capabilities) ||
				capabilities.length > maxRenewedAssetEffectCapabilities
			) {
				rejectFailedLookup(state);
			}

			const timestamp = now();
			const uniqueCapabilities = [...new Set(capabilities)];
			const grants: Array<{
				capability: string;
				grant: AssetEffectGrant;
			}> = [];
			const rejectedCapabilities: string[] = [];

			for (const capability of uniqueCapabilities) {
				if (typeof capability !== 'string') {
					rejectFailedLookup(state);
				}
				const grant = state.grants.get(capability);

				if (!grant || grant.expiresAt <= timestamp) {
					if (grant && !grant.inFlight) {
						removeGrant(state, capability, grant, true);
					}
					rejectedCapabilities.push(capability);
					continue;
				}
				grants.push({capability, grant});
			}

			if (rejectedCapabilities.length === 0) {
				resetFailedLookups(state);
			}
			for (const {capability, grant} of grants) {
				if (grant.inFlight) {
					continue;
				}
				if (grant.timer) {
					clearTimeout(grant.timer);
				}
				grant.expiresAt = timestamp + ttlMs;
				scheduleExpiration(state, capability, grant);
			}
			if (rejectedCapabilities.length > 0 && recordFailedLookup(state)) {
				throw new Error('Too many invalid asset effect capability attempts.');
			}

			return rejectedCapabilities;
		},

		revokeRoot(event: AssetEffectEvent, rootPath: string) {
			if (!event?.sender && process.env.NODE_ENV === 'test') {
				return;
			}

			const state = activeSessionState(rendererSession(event));
			const absoluteRootPath = resolve(rootPath);

			for (const [capability, grant] of state.grants) {
				if (grant.rootPath === absoluteRootPath) {
					removeGrant(state, capability, grant, true);
				}
			}
		}
	};
}
