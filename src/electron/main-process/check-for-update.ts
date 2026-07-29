import {dialog} from 'electron';
import {version as appVersion} from '../../../package.json';
import {gt} from 'semver';
import {i18n} from './locales';
import {openExternalUrl} from './external-url';

const updateUrlEnvVar = 'TWINE_RS_UPDATE_URL';

function redactedUrlForLog(value: string) {
	let parsed: URL;

	try {
		parsed = new URL(value);
	} catch {
		return '[invalid URL]';
	}

	if (parsed.origin === 'null') {
		return '[URL with opaque origin]';
	}

	return `${parsed.origin}${parsed.pathname === '/' ? '/' : '/[redacted]'}`;
}

interface VersionResponse {
	/**
	 * Build number, format yyyymmdd. Not used since 2.4.
	 */
	buildNumber: string;
	/**
	 * URL to send users to do for the update.
	 */
	url: string;
	/**
	 * Latest Twine RS version number, eg. '0.1.1'.
	 */
	version: string;
}

export async function checkForUpdate() {
	const checkUrl = process.env[updateUrlEnvVar];

	if (!checkUrl) {
		console.log(
			`${updateUrlEnvVar} is not set, skipping application update check`
		);
		dialog.showMessageBox({
			message: i18n.t('electron.updateCheck.unavailable'),
			type: 'info'
		});
		return;
	}

	console.log(
		`Checking for application update at ${redactedUrlForLog(checkUrl)}`
	);

	try {
		const {url, version} = (await (
			await globalThis.fetch(checkUrl)
		).json()) as unknown as VersionResponse;

		console.log(`Received version ${version}, url ${redactedUrlForLog(url)}`);

		if (gt(version, appVersion)) {
			const {response} = await dialog.showMessageBox({
				buttons: [
					i18n.t('electron.updateCheck.download'),
					i18n.t('common.cancel')
				],
				defaultId: 0,
				icon: 'info',
				message: i18n.t('electron.updateCheck.updateAvailable')
			});

			if (response === 0) {
				await openExternalUrl(url);
			}
		} else {
			dialog.showMessageBox({
				message: i18n.t('electron.updateCheck.upToDate'),
				type: 'info'
			});
		}
	} catch (error) {
		dialog.showErrorBox(
			i18n.t('electron.updateCheck.error'),
			(error as Error).message
		);
	}
}
