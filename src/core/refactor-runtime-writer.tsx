import * as React from 'react';
import type {RefactorExternalPrecondition} from './bindings/RefactorExternalPrecondition';
import type {RefactorSemanticProviderDescriptor} from './refactor-runtime';

/** Trusted integration capability; intentionally not re-exported by core/index. */
export interface RefactorRuntimeWriter {
	clearExternalSession(
		storyIds: readonly string[],
		sessionInstanceId: string
	): Promise<void>;
	recordExternalSession(
		storyIds: readonly string[],
		state: RefactorExternalPrecondition
	): Promise<void>;
	registerSemanticProvider(
		storyId: string,
		descriptor: RefactorSemanticProviderDescriptor
	): Promise<() => Promise<void>>;
}

export const RefactorRuntimeWriterContext = React.createContext<
	RefactorRuntimeWriter | undefined
>(undefined);

export function useRefactorRuntimeWriter() {
	const writer = React.useContext(RefactorRuntimeWriterContext);

	if (!writer) {
		throw new Error(
			'useRefactorRuntimeWriter must be used within a CoreProjectHostProvider.'
		);
	}

	return writer;
}
