import {TwineElectronWindow} from '../../../electron/shared';
import {trackPersistence} from './persistence-quit-coordinator';

export function saveJson(filename: string, data: any): Promise<void> {
	const {twineElectron} = window as TwineElectronWindow;

	if (!twineElectron) {
		throw new Error('Electron bridge is not present on window.');
	}

	return trackPersistence(twineElectron.saveJson(filename, data));
}
