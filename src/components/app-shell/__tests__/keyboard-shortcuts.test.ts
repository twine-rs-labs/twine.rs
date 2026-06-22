import {commandIdForKeyboardEvent, shortcutLabel} from '../keyboard-shortcuts';

describe('keyboard shortcuts', () => {
	it('labels default shortcuts with Command on macOS', () => {
		expect(shortcutLabel('build.play', 'default', 'mac')).toBe('⌘ Enter');
		expect(shortcutLabel('build.test', 'default', 'mac')).toBe('⌘ ⇧ Enter');
		expect(shortcutLabel('build.screen', 'default', 'mac')).toBe('⌘ ⌥ B');
	});

	it('labels default shortcuts with Ctrl off macOS', () => {
		expect(shortcutLabel('build.play', 'default', 'other')).toBe('Ctrl Enter');
		expect(shortcutLabel('build.test', 'default', 'other')).toBe(
			'Ctrl Shift Enter'
		);
		expect(shortcutLabel('build.screen', 'default', 'other')).toBe(
			'Ctrl Alt B'
		);
	});

	it('matches default shortcuts with Command on macOS', () => {
		expect(
			commandIdForKeyboardEvent(
				new KeyboardEvent('keydown', {key: 'Enter', metaKey: true}),
				'default',
				'mac'
			)
		).toBe('build.play');
		expect(
			commandIdForKeyboardEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					metaKey: true,
					shiftKey: true
				}),
				'default',
				'mac'
			)
		).toBe('build.test');
	});

	it('matches default shortcuts with Ctrl off macOS', () => {
		expect(
			commandIdForKeyboardEvent(
				new KeyboardEvent('keydown', {ctrlKey: true, key: 'Enter'}),
				'default',
				'other'
			)
		).toBe('build.play');
	});

	it('keeps Emacs shortcuts on Ctrl even on macOS', () => {
		expect(shortcutLabel('build.play', 'emacs', 'mac')).toBe('Ctrl P');
		expect(
			commandIdForKeyboardEvent(
				new KeyboardEvent('keydown', {ctrlKey: true, key: 'p'}),
				'emacs',
				'mac'
			)
		).toBe('build.play');
		expect(
			commandIdForKeyboardEvent(
				new KeyboardEvent('keydown', {key: 'p', metaKey: true}),
				'emacs',
				'mac'
			)
		).toBeUndefined();
	});
});
