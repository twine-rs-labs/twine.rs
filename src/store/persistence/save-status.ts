import * as React from 'react';

export type StorySaveStatus =
	| {
			kind: 'error';
			error: Error;
			revision?: number;
			sessionId?: string;
	  }
	| {kind: 'idle'}
	| {
			kind: 'saved';
			revision?: number;
			savedAt: number;
			sessionId?: string;
	  };

let currentStatus: StorySaveStatus = {kind: 'idle'};
const listeners = new Set<(status: StorySaveStatus) => void>();

export function publishStorySaveStatus(status: StorySaveStatus) {
	currentStatus = status;
	listeners.forEach(listener => listener(status));
}

export function useStorySaveStatus() {
	const [status, setStatus] = React.useState(currentStatus);

	React.useEffect(() => {
		listeners.add(setStatus);

		return () => {
			listeners.delete(setStatus);
		};
	}, []);

	return status;
}
