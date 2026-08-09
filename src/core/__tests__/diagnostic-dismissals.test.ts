import {diagnosticIdentity} from '../diagnostic-dismissals';

describe('diagnosticIdentity', () => {
	it('matches the Rust JSON identity contract', () => {
		expect(
			diagnosticIdentity({
				code: 'code"',
				end: 9,
				line: 1,
				message: 'Quoted "line"\nnext',
				passageId: null,
				quickFixes: [],
				severity: 'info',
				sourceId: 'story\\source',
				start: 3
			})
		).toBe('["code\\"","story\\\\source",null,3,9,"Quoted \\"line\\"\\nnext"]');
	});
});
