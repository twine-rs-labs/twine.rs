import * as React from 'react';
import * as prefs from './prefs';
import * as stories from './stories';
import * as storyFormats from './story-formats';
import {persistenceQuitCoordinator} from './persistence-quit-coordinator';
import type {TwineElectronWindow} from '../../../electron/shared';

type ElectronBridge = NonNullable<TwineElectronWindow['twineElectron']>;

export function registerPersistenceQuitHandlers(bridge?: ElectronBridge) {
	if (!bridge) {
		return;
	}

	bridge.onPersistenceQuitRequested(nonce => {
		void persistenceQuitCoordinator.prepare(nonce).then(
			() => bridge.completePersistenceQuit(nonce),
			error =>
				bridge.completePersistenceQuit(
					nonce,
					error instanceof Error ? error.message : String(error)
				)
		);
	});
	bridge.onPersistenceQuitCancelled(nonce => {
		persistenceQuitCoordinator.cancel(nonce);
	});
	bridge.rendererPersistenceReady();
}

registerPersistenceQuitHandlers(
	typeof window === 'undefined'
		? undefined
		: (window as TwineElectronWindow).twineElectron
);

export function useElectronIpcPersistence() {
	return React.useMemo(
		() => ({
			prefs: {
				canReduceAction: (action: Parameters<typeof prefs.saveMiddleware>[1]) =>
					!prefs.isPersistenceAffectingAction(action) ||
					persistenceQuitCoordinator.allowsPersistenceMutation(),
				load: prefs.load,
				saveMiddleware: prefs.saveMiddleware
			},
			stories: {
				canReduceAction: (
					action: Parameters<typeof stories.saveMiddleware>[1]
				) =>
					!stories.isPersistenceAffectingAction(action) ||
					persistenceQuitCoordinator.allowsPersistenceMutation(),
				load: stories.load,
				saveMiddleware: stories.saveMiddleware
			},
			storyFormats: {
				canReduceAction: (
					action: Parameters<typeof storyFormats.saveMiddleware>[1]
				) =>
					!storyFormats.isPersistenceAffectingAction(action) ||
					persistenceQuitCoordinator.allowsPersistenceMutation(),
				load: storyFormats.load,
				saveMiddleware: storyFormats.saveMiddleware
			}
		}),
		[]
	);
}
