import * as React from 'react';

export interface ProjectStoryHydration {
	passageTextLoaded: boolean;
	revision: number;
	rootPath?: string;
}

const hydrationByStory = new Map<string, ProjectStoryHydration>();
const listeners = new Set<() => void>();
let revision = 0;

function notify() {
	revision++;

	for (const listener of listeners) {
		listener();
	}
}

export function markProjectStoryHydration(
	storyId: string,
	hydration: Omit<ProjectStoryHydration, 'revision'>
) {
	const next = {...hydration, revision: revision + 1};
	const previous = hydrationByStory.get(storyId);

	if (
		previous?.passageTextLoaded === next.passageTextLoaded &&
		previous.rootPath === next.rootPath
	) {
		return;
	}

	hydrationByStory.set(storyId, next);
	notify();
}

export function projectStoryHydration(storyId: string | undefined) {
	return storyId ? hydrationByStory.get(storyId) : undefined;
}

export function subscribeProjectStoryHydration(listener: () => void) {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}

export function useProjectStoryHydration(storyId: string | undefined) {
	const [currentRevision, setCurrentRevision] = React.useState(revision);

	React.useEffect(
		() => subscribeProjectStoryHydration(() => setCurrentRevision(revision)),
		[]
	);

	return React.useMemo(
		() => projectStoryHydration(storyId),
		[currentRevision, storyId]
	);
}
