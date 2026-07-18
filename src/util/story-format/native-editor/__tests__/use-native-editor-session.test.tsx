import {renderHook, waitFor} from '@testing-library/react';
import type {NativeEditorIntegration} from '../../editor-integration';
import type {
	NativeEditorController,
	NativeEditorProvider,
	NativeEditorSession,
	NativeEditorSessionContext
} from '../types';
import {useNativeEditorSession} from '../use-native-editor-session';

const preferences = {
	codeUsesCodeFont: true,
	codingTooltips: true,
	completionsForKeywords: true,
	completionsForMacros: true
};

function context(
	passageNames: string[] = ['Start']
): NativeEditorSessionContext {
	return {
		passageNames,
		preferences,
		tagNames: ['chapter']
	};
}

function integration(
	loadProvider: NativeEditorIntegration['loadProvider']
): NativeEditorIntegration {
	return {
		dialect: {family: 'test', id: 'test-1', version: '1'},
		formatId: 'format-id',
		key: 'native:test-1',
		loadProvider,
		ownsSyntax: true,
		type: 'native'
	};
}

function session(dispose: jest.Mock): NativeEditorSession {
	return {
		controller: {} as NativeEditorController,
		dispose,
		extensions: [],
		key: 'session',
		ownsSyntax: true,
		useCodeFont: false
	};
}

describe('useNativeEditorSession()', () => {
	it('creates isolated sessions, refreshes context, and disposes each lifetime', async () => {
		const firstDispose = jest.fn();
		const secondDispose = jest.fn();
		const createSession = jest
			.fn<NativeEditorSession, [NativeEditorSessionContext]>()
			.mockReturnValueOnce(session(firstDispose))
			.mockReturnValueOnce(session(secondDispose));
		const provider: NativeEditorProvider = {
			createSession,
			dialect: {family: 'test', id: 'test-1', version: '1'}
		};
		const resolved = integration(
			jest.fn().mockResolvedValue({default: provider})
		);
		const {rerender, result, unmount} = renderHook(
			({names}) => useNativeEditorSession(resolved, context(names)),
			{initialProps: {names: ['Start']}}
		);

		expect(result.current.loading).toBe(true);
		await waitFor(() => expect(result.current.session).toBeDefined());
		expect(createSession).toHaveBeenLastCalledWith(
			expect.objectContaining({passageNames: ['Start']})
		);

		rerender({names: ['Start', 'Hallway']});
		await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
		expect(firstDispose).toHaveBeenCalledTimes(1);
		expect(createSession).toHaveBeenLastCalledWith(
			expect.objectContaining({passageNames: ['Start', 'Hallway']})
		);

		unmount();
		expect(secondDispose).toHaveBeenCalledTimes(1);
	});

	it('contains provider-load failures as state', async () => {
		const failure = new Error('provider failed');
		const resolved = integration(jest.fn().mockRejectedValue(failure));
		const {result} = renderHook(() =>
			useNativeEditorSession(resolved, context())
		);

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.error).toBe(failure);
		expect(result.current.session).toBeUndefined();
	});
});
