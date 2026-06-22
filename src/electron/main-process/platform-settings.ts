import type {
	NativeLinkHandlingMode,
	NativePlatformSettings,
	NativePlatformSettingsUpdate
} from '../shared';
import {AppPrefName, getAppPref, setAppPref} from './app-prefs';

export const defaultBackupCadenceMinutes = 20;
export const defaultBackupReminderDays = 7;
export const defaultBackupRetentionLimit = 10;
export const defaultCacheCleanupDays = 3;

type NativeAppPlatformSettings = Omit<
	NativePlatformSettings,
	'backupFolderPath' | 'storyLibraryFolderPath'
>;

function numberPref(
	name: AppPrefName,
	fallback: number,
	options: {max: number; min: number}
) {
	const value = getAppPref(name);
	const parsed =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value)
				: NaN;

	if (!Number.isFinite(parsed)) {
		return fallback;
	}

	return Math.max(options.min, Math.min(options.max, Math.round(parsed)));
}

function booleanPref(name: AppPrefName, fallback: boolean) {
	const value = getAppPref(name);

	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'string') {
		if (value.toLowerCase() === 'true') {
			return true;
		}

		if (value.toLowerCase() === 'false') {
			return false;
		}
	}

	return fallback;
}

function stringPref(name: AppPrefName) {
	const value = getAppPref(name);

	return typeof value === 'string' ? value : '';
}

export function linkHandlingMode(): NativeLinkHandlingMode {
	return getAppPref('linkHandlingMode') === 'block' ? 'block' : 'system';
}

export function backupCadenceMinutes() {
	return numberPref('backupCadenceMinutes', defaultBackupCadenceMinutes, {
		max: 24 * 60,
		min: 5
	});
}

export function backupCadenceMs() {
	return backupCadenceMinutes() * 60 * 1000;
}

export function backupReminderDays() {
	return numberPref('backupReminderDays', defaultBackupReminderDays, {
		max: 365,
		min: 1
	});
}

export function backupRetentionLimit() {
	return numberPref('backupRetentionLimit', defaultBackupRetentionLimit, {
		max: 500,
		min: 1
	});
}

export function backupLastReviewedTime() {
	return numberPref('backupLastReviewedTime', 0, {
		max: Number.MAX_SAFE_INTEGER,
		min: 0
	});
}

export function cacheCleanupDays() {
	const minutes = numberPref(
		'scratchFileCleanupAge',
		defaultCacheCleanupDays * 24 * 60,
		{
			max: 365 * 24 * 60,
			min: 60
		}
	);

	return Math.max(1, Math.round(minutes / (24 * 60)));
}

export function fullscreenPersistenceEnabled() {
	return booleanPref('fullscreenPersistence', true);
}

export function lastWindowFullscreen() {
	return booleanPref('lastWindowFullscreen', false);
}

export function nativeAppPlatformSettings(): NativeAppPlatformSettings {
	return {
		backupCadenceMinutes: backupCadenceMinutes(),
		backupLastReviewedTime: backupLastReviewedTime(),
		backupReminderDays: backupReminderDays(),
		backupRetentionLimit: backupRetentionLimit(),
		cacheCleanupDays: cacheCleanupDays(),
		externalEditorCommand: stringPref('externalEditorCommand'),
		fullscreenPersistence: fullscreenPersistenceEnabled(),
		lastWindowFullscreen: lastWindowFullscreen(),
		linkHandlingMode: linkHandlingMode()
	};
}

export async function updateNativeAppPlatformSettings(
	settings: NativePlatformSettingsUpdate
) {
	const updates: Array<Promise<void>> = [];

	if (settings.backupCadenceMinutes !== undefined) {
		updates.push(
			setAppPref(
				'backupCadenceMinutes',
				Math.max(
					5,
					Math.min(24 * 60, Math.round(settings.backupCadenceMinutes))
				)
			)
		);
	}

	if (settings.backupLastReviewedTime !== undefined) {
		updates.push(
			setAppPref(
				'backupLastReviewedTime',
				Math.max(0, Math.round(settings.backupLastReviewedTime))
			)
		);
	}

	if (settings.backupReminderDays !== undefined) {
		updates.push(
			setAppPref(
				'backupReminderDays',
				Math.max(1, Math.min(365, Math.round(settings.backupReminderDays)))
			)
		);
	}

	if (settings.backupRetentionLimit !== undefined) {
		updates.push(
			setAppPref(
				'backupRetentionLimit',
				Math.max(1, Math.min(500, Math.round(settings.backupRetentionLimit)))
			)
		);
	}

	if (settings.cacheCleanupDays !== undefined) {
		const days = Math.max(
			1,
			Math.min(365, Math.round(settings.cacheCleanupDays))
		);

		updates.push(setAppPref('scratchFileCleanupAge', days * 24 * 60));
	}

	if (settings.externalEditorCommand !== undefined) {
		updates.push(
			setAppPref('externalEditorCommand', settings.externalEditorCommand.trim())
		);
	}

	if (settings.fullscreenPersistence !== undefined) {
		updates.push(
			setAppPref('fullscreenPersistence', settings.fullscreenPersistence)
		);
	}

	if (settings.lastWindowFullscreen !== undefined) {
		updates.push(
			setAppPref('lastWindowFullscreen', settings.lastWindowFullscreen)
		);
	}

	if (settings.linkHandlingMode !== undefined) {
		updates.push(
			setAppPref(
				'linkHandlingMode',
				settings.linkHandlingMode === 'block' ? 'block' : 'system'
			)
		);
	}

	await Promise.all(updates);

	return nativeAppPlatformSettings();
}
