import {TwineElectronWindow} from '../../../electron/shared';

export function saveJson(filename: string, data: any): Promise<void> {
	const {twineElectron} = window as TwineElectronWindow;

	if (!twineElectron) {
		throw new Error('Electron bridge is not present on window.');
	}

	return twineElectron.saveJson(filename, data);
}
