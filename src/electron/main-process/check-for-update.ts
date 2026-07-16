import {dialog, shell} from 'electron';
import {version as appVersion} from '../../../package.json';
import {gt} from 'semver';
import {i18n} from './locales';

const updateUrlEnvVar = 'TWINE_RS_UPDATE_URL';

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
			message: i18n.t('electron.updateCheck.upToDate'),
			type: 'info'
		});
		return;
	}

	console.log(`Checking for application update at ${checkUrl}`);

	try {
		const {url, version} = (await (
			await globalThis.fetch(checkUrl)
		).json()) as unknown as VersionResponse;

		console.log(`Received version ${version}, url ${url}`);

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
				shell.openExternal(url);
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
