export interface RefactorReviewModelSnapshot {
	encodedBytes: number;
	pageCount: number;
	summaryCount: number;
}

/**
 * Bounded frontend ownership for the M1 refactor review surface. It holds only
 * the DTOs the user has opened, never canonical Rust changes or plan payloads.
 */
export class RefactorReviewModel {
	private page: unknown;
	private summary: unknown;
	private planIdentity: {planDigest: string; planId: string} | undefined;

	capturePage(cursor: {planDigest: string; planId: string}, page: unknown) {
		if (
			!this.planIdentity ||
			this.planIdentity.planId !== cursor.planId ||
			this.planIdentity.planDigest !== cursor.planDigest
		) {
			return false;
		}
		this.page = page;
		return true;
	}

	captureSummary(summary: unknown) {
		const candidate = summary as {
			planDigest?: unknown;
			planId?: unknown;
		};
		if (
			typeof candidate.planId !== 'string' ||
			typeof candidate.planDigest !== 'string'
		) {
			this.close();
			return false;
		}
		if (
			this.planIdentity?.planId !== candidate.planId ||
			this.planIdentity.planDigest !== candidate.planDigest
		) {
			this.page = undefined;
		}
		this.planIdentity = {
			planDigest: candidate.planDigest,
			planId: candidate.planId
		};
		this.summary = summary;
		return true;
	}

	close() {
		this.page = undefined;
		this.summary = undefined;
		this.planIdentity = undefined;
	}

	snapshot(): RefactorReviewModelSnapshot {
		const values = [this.summary, this.page];
		return {
			encodedBytes: values.reduce<number>(
				(total, value) =>
					total +
					(value === undefined
						? 0
						: new TextEncoder().encode(JSON.stringify(value)).byteLength),
				0
			),
			pageCount: this.page === undefined ? 0 : 1,
			summaryCount: this.summary === undefined ? 0 : 1
		};
	}
}
