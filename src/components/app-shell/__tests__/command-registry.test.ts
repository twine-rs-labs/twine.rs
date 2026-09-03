import {
	composeAppCommands,
	validateCommandContribution
} from '../command-registry';

function command(id: string, extra = {}) {
	return {group: 'Toolbar' as const, id, label: id, run: jest.fn(), ...extra};
}

describe('command registry', () => {
	it('requires stable namespaced contribution ids and rejects duplicates', () => {
		expect(() =>
			validateCommandContribution({
				commands: [command('rename')],
				owner: 'story-edit'
			})
		).toThrow('namespaced');
		expect(() =>
			composeAppCommands(
				[],
				[
					{commands: [command('story-edit.rename')], owner: 'one'},
					{commands: [command('story-edit.rename')], owner: 'two'}
				]
			)
		).toThrow('Duplicate command id');
	});

	it('rejects normalized shortcut collisions', () => {
		expect(() =>
			composeAppCommands(
				[],
				[
					{
						commands: [command('story-edit.one', {shortcut: 'Ctrl K'})],
						owner: 'one'
					},
					{
						commands: [command('story-edit.two', {shortcut: 'ctrlk'})],
						owner: 'two'
					}
				]
			)
		).toThrow('Duplicate command shortcut');
	});

	it('rejects executable keybinding collisions and never exposes sort metadata', () => {
		expect(() =>
			composeAppCommands(
				[],
				[
					{
						commands: [
							command('story-edit.one', {
								keybinding: {key: 'j', primaryKey: true}
							})
						],
						owner: 'one'
					},
					{
						commands: [
							command('story-edit.two', {
								keybinding: {key: 'J', primaryKey: true}
							})
						],
						owner: 'two'
					}
				]
			)
		).toThrow('Duplicate command keybinding');
		expect(
			Object.keys(composeAppCommands([command('nav.one')], [])[0])
		).not.toContain('__index');
	});

	it('reserves the command palette keybinding across validation and composition', () => {
		for (const keybinding of [
			{key: 'k', primaryKey: true},
			{key: 'K', metaKey: true},
			{ctrlKey: true, key: 'k'}
		]) {
			expect(() =>
				validateCommandContribution({
					commands: [command('story-edit.palette-collision', {keybinding})],
					owner: 'route'
				})
			).toThrow('Reserved command keybinding');
		}
		expect(() =>
			composeAppCommands(
				[
					command('nav.palette-collision', {
						keybinding: {key: 'k', primaryKey: true}
					})
				],
				[]
			)
		).toThrow('Reserved command keybinding');
	});

	it('rejects primary-key collisions on either supported platform', () => {
		expect(() =>
			composeAppCommands(
				[],
				[
					{
						commands: [
							command('story-edit.primary', {
								keybinding: {key: 'j', primaryKey: true}
							})
						],
						owner: 'primary'
					},
					{
						commands: [
							command('story-edit.meta', {
								keybinding: {key: 'j', metaKey: true}
							})
						],
						owner: 'meta'
					}
				]
			)
		).toThrow('Duplicate command keybinding');
		expect(() =>
			composeAppCommands(
				[],
				[
					{
						commands: [
							command('story-edit.primary', {
								keybinding: {key: 'j', primaryKey: true}
							})
						],
						owner: 'primary'
					},
					{
						commands: [
							command('story-edit.control', {
								keybinding: {ctrlKey: true, key: 'j'}
							})
						],
						owner: 'control'
					}
				]
			)
		).toThrow('Duplicate command keybinding');
	});

	it('orders priority then explicit order while retaining unspecified list order', () => {
		const commands = composeAppCommands(
			[command('nav.first'), command('nav.second')],
			[
				{
					commands: [
						command('story-edit.low', {priority: 1}),
						command('story-edit.high-late', {priority: 2, order: 2}),
						command('story-edit.high-first', {priority: 2, order: 1})
					],
					owner: 'story-edit'
				}
			]
		);

		expect(commands.map(candidate => candidate.id)).toEqual([
			'story-edit.high-first',
			'story-edit.high-late',
			'story-edit.low',
			'nav.first',
			'nav.second'
		]);
	});
});
