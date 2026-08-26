export type StoryEditRevealMode = 'graph' | 'text';

const REVEAL_TIMEOUT_MS = 10_000;
const MAX_PENDING_REVEALS = 32;

type PendingReveal = {
	armed: boolean;
	deadline: number;
	applied: boolean;
	reject: (error: Error) => void;
	rollback?: () => void;
	resolve: () => void;
	timeout: ReturnType<typeof setTimeout>;
};

const pendingReveals = new Map<string, PendingReveal>();

export function storyEditRevealUrl(
	storyId: string,
	mode: StoryEditRevealMode,
	passageId: string,
	requestId?: string
) {
	const query = new URLSearchParams({mode, passage: passageId});
	if (requestId) query.set('revealRequest', requestId);
	return `/stories/${encodeURIComponent(storyId)}?${query.toString()}`;
}

export function registerStoryEditReveal(
	requestId: string,
	absoluteDeadline = Date.now() + REVEAL_TIMEOUT_MS
): Promise<void> {
	if (!requestId || requestId.length > 128) {
		throw new Error('The reveal request is invalid.');
	}
	if (pendingReveals.has(requestId)) {
		throw new Error('The reveal request is already pending.');
	}
	if (pendingReveals.size >= MAX_PENDING_REVEALS) {
		throw new Error('The editor has too many pending reveal requests.');
	}
	if (
		!Number.isSafeInteger(absoluteDeadline) ||
		absoluteDeadline <= Date.now()
	) {
		throw new Error('The reveal request has expired.');
	}
	const deadline = Math.min(absoluteDeadline, Date.now() + REVEAL_TIMEOUT_MS);
	return new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(
			() => {
				rejectStoryEditReveal(
					requestId,
					new Error('The editor did not apply the reveal request in time.')
				);
			},
			Math.max(0, deadline - Date.now())
		);
		pendingReveals.set(requestId, {
			armed: false,
			deadline,
			applied: false,
			reject,
			resolve,
			timeout
		});
	});
}

/**
 * Registers the compensating action before a route begins a correlated write.
 * The action is deliberately inert until the route has issued every setter.
 */
export function registerStoryEditRevealRollback(
	requestId: string,
	rollback: () => void
) {
	const pending = pendingReveals.get(requestId);
	if (!pending || pending.rollback) return false;
	pending.rollback = rollback;
	return true;
}

export function armStoryEditRevealRollback(requestId: string) {
	const pending = pendingReveals.get(requestId);
	if (!pending || !pending.rollback) return false;
	// Set this first: hasStoryEditReveal() may synchronously discover that the
	// deadline crossed between route writes and this arm boundary.
	pending.armed = true;
	return hasStoryEditReveal(requestId);
}

export function hasStoryEditReveal(requestId: string) {
	const pending = pendingReveals.get(requestId);
	if (!pending) return false;
	if (pending.applied) return true;
	if (pending.deadline > Date.now()) return true;
	rejectStoryEditReveal(
		requestId,
		new Error('The reveal request has expired.')
	);
	return false;
}

export function isStoryEditRevealApplied(requestId: string) {
	return pendingReveals.get(requestId)?.applied === true;
}

export function settleStoryEditReveal(requestId: string) {
	const pending = pendingReveals.get(requestId);
	if (!pending || !pending.armed || !hasStoryEditReveal(requestId))
		return false;
	if (!pending.applied) {
		pending.applied = true;
		// Once the route has acknowledged its committed state, the authoritative
		// owner/main terminal result—not this local apply lease—decides whether to
		// finalize or compensate it.
		clearTimeout(pending.timeout);
		pending.resolve();
	}
	return true;
}

/** The owner calls this only after the authoritative terminal success reply. */
export function finalizeStoryEditReveal(requestId: string) {
	const pending = pendingReveals.get(requestId);
	if (!pending || !pending.applied) return false;
	clearTimeout(pending.timeout);
	pendingReveals.delete(requestId);
	return true;
}

export function rejectStoryEditReveal(requestId: string, error: Error) {
	const pending = pendingReveals.get(requestId);
	if (!pending) return false;
	clearTimeout(pending.timeout);
	pendingReveals.delete(requestId);
	if (pending.armed) {
		try {
			pending.rollback?.();
		} catch (rollbackError) {
			console.error(
				'Could not roll back an expired editor reveal.',
				rollbackError
			);
		}
	}
	if (!pending.applied) pending.reject(error);
	return true;
}
