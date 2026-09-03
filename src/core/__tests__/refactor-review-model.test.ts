import {RefactorReviewModel} from '../refactor-review-model';

describe('RefactorReviewModel', () => {
	it('owns only opened DTOs and releases them on close', () => {
		const model = new RefactorReviewModel();
		model.captureSummary({planDigest: 'digest', planId: 'plan', changes: 2});
		model.capturePage(
			{planDigest: 'digest', planId: 'plan'},
			{changes: [{changeId: 'one'}]}
		);
		expect(model.snapshot()).toEqual({
			encodedBytes: expect.any(Number),
			pageCount: 1,
			summaryCount: 1
		});
		expect(model.snapshot().encodedBytes).toBeGreaterThan(0);
		model.close();
		expect(model.snapshot()).toEqual({
			encodedBytes: 0,
			pageCount: 0,
			summaryCount: 0
		});
	});

	it('retains pages only for the current summary identity', () => {
		const model = new RefactorReviewModel();
		model.captureSummary({planDigest: 'digest-a', planId: 'plan-a'});
		expect(
			model.capturePage(
				{planDigest: 'digest-a', planId: 'plan-a'},
				{changes: ['a']}
			)
		).toBe(true);
		model.captureSummary({planDigest: 'digest-b', planId: 'plan-b'});
		expect(model.snapshot()).toEqual({
			encodedBytes: expect.any(Number),
			pageCount: 0,
			summaryCount: 1
		});
		expect(
			model.capturePage(
				{planDigest: 'digest-a', planId: 'plan-a'},
				{changes: ['stale']}
			)
		).toBe(false);
		expect(model.snapshot().pageCount).toBe(0);
	});
});
