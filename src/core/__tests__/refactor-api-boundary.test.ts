import * as Core from '../index';
import type {RefactorPlanApplyRequest} from '../bindings/RefactorPlanApplyRequest';

describe('refactor review API boundary', () => {
	it('does not publish runtime-state constructors or mutators from core', () => {
		for (const name of [
			'StoreCoreProjectHost',
			'ProjectScopedCoreProjectHost',
			'applyModelCommit',
			'refactorRuntimeState',
			'recordRefactorExternalSession',
			'clearRefactorExternalSession',
			'setRefactorProviderStateForStory',
			'reconcileRefactorSemanticProvider',
			'useRefactorRuntimeWriter',
			'RefactorRuntimeWriterContext'
		]) {
			expect(Core).not.toHaveProperty(name);
		}
	});

	it('keeps apply input limited to plan identity, revision, and selection', () => {
		const request: RefactorPlanApplyRequest = {
			expectedProjectRevision: 4,
			planId: 'plan-1',
			selection: {type: 'all'}
		};

		expect(Object.keys(request).sort()).toEqual([
			'expectedProjectRevision',
			'planId',
			'selection'
		]);
	});
});
