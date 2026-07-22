import {saveJson} from '../save-json';
import {TwineElectronWindow} from '../../../../electron/shared';

describe('saveJson()', () => {
	afterEach(() => delete (window as TwineElectronWindow).twineElectron);

	it('returns the save acknowledgement from the twineElectron global', async () => {
		const saveJsonBridge = jest.fn(async () => undefined);
		const mockObject = {mock: true};

		(window as any).twineElectron = {
			saveJson: saveJsonBridge
		};

		await saveJson('test.json', mockObject);
		expect(saveJsonBridge.mock.calls).toEqual([['test.json', mockObject]]);
	});

	it('throws an error if twineElectron.saveJson is undefined', () => {
		expect(() => saveJson('test.json', {})).toThrow();
	});
});
