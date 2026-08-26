import {
	armStoryEditRevealRollback,
	finalizeStoryEditReveal,
	hasStoryEditReveal,
	registerStoryEditReveal,
	registerStoryEditRevealRollback,
	rejectStoryEditReveal,
	settleStoryEditReveal
} from '../story-edit-reveal';

describe('story edit reveal lifecycle', () => {
	afterEach(() => jest.useRealTimers());

	it('rolls back an applied request when terminal acknowledgement fails', async () => {
		const rollback = jest.fn();
		const applied = registerStoryEditReveal('applied-then-rejected');
		expect(
			registerStoryEditRevealRollback('applied-then-rejected', rollback)
		).toBe(true);
		expect(armStoryEditRevealRollback('applied-then-rejected')).toBe(true);
		expect(settleStoryEditReveal('applied-then-rejected')).toBe(true);
		await expect(applied).resolves.toBeUndefined();

		expect(
			rejectStoryEditReveal(
				'applied-then-rejected',
				new Error('terminal report rejected')
			)
		).toBe(true);
		expect(rollback).toHaveBeenCalledTimes(1);
	});

	it('finalizes an applied request so a later failure cannot roll it back', async () => {
		const rollback = jest.fn();
		const applied = registerStoryEditReveal('terminal-success');
		registerStoryEditRevealRollback('terminal-success', rollback);
		armStoryEditRevealRollback('terminal-success');
		settleStoryEditReveal('terminal-success');
		await expect(applied).resolves.toBeUndefined();

		expect(finalizeStoryEditReveal('terminal-success')).toBe(true);
		expect(
			rejectStoryEditReveal('terminal-success', new Error('late cancellation'))
		).toBe(false);
		expect(rollback).not.toHaveBeenCalled();
	});

	it('arms before checking expiry so the route writes are compensated', async () => {
		jest.useFakeTimers();
		const now = Date.now();
		const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
		const rollback = jest.fn();
		const applied = registerStoryEditReveal('expire-at-arm', now + 10);
		const rejected = expect(applied).rejects.toThrow('expired');
		registerStoryEditRevealRollback('expire-at-arm', rollback);
		clock.mockReturnValue(now + 10);
		expect(armStoryEditRevealRollback('expire-at-arm')).toBe(false);
		expect(rollback).toHaveBeenCalledTimes(1);
		expect(hasStoryEditReveal('expire-at-arm')).toBe(false);
		await rejected;
		clock.mockRestore();
	});
});
