import * as React from 'react';
import type {NativeEditorIntegration} from '../editor-integration';
import type {NativeEditorSession, NativeEditorSessionContext} from './types';

export interface NativeEditorSessionState {
	error?: Error;
	loading: boolean;
	session?: NativeEditorSession;
}

export function useNativeEditorSession(
	integration: NativeEditorIntegration | undefined,
	context: NativeEditorSessionContext
): NativeEditorSessionState {
	const [state, setState] = React.useState<NativeEditorSessionState>({
		loading: !!integration
	});
	const passageNamesKey = context.passageNames.join('\u0000');
	const tagNamesKey = context.tagNames.join('\u0000');
	const preferencesKey = JSON.stringify(context.preferences);
	const stableContext = React.useMemo(
		() => ({
			passageNames: [...context.passageNames],
			preferences: {...context.preferences},
			tagNames: [...context.tagNames]
		}),
		[passageNamesKey, preferencesKey, tagNamesKey]
	);

	React.useEffect(() => {
		let active = true;
		let currentSession: NativeEditorSession | undefined;

		if (!integration) {
			setState({loading: false});
			return;
		}

		setState({loading: true});
		void integration
			.loadProvider()
			.then(module => {
				if (!active) {
					return;
				}

				currentSession = module.default.createSession(stableContext);
				setState({loading: false, session: currentSession});
			})
			.catch(error => {
				if (active) {
					setState({
						error: error instanceof Error ? error : new Error(String(error)),
						loading: false
					});
				}
			});

		return () => {
			active = false;
			currentSession?.dispose?.();
		};
	}, [integration, stableContext]);

	return state;
}
