import * as React from 'react';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import {MenuButton} from '../../components/control/menu-button';
import type {SourceEditorHandle} from '../../components/control/source-editor';
import {usePrefsContext} from '../../store/prefs';
import {useComputedTheme} from '../../store/prefs/use-computed-theme';
import {registerPerformanceRetainedObject} from '../../util/performance-memory-owners';
import type {AdaptedLegacyEditorIntegration} from '../../util/story-format';
import {
	createLegacyEditorFacade,
	createReadOnlyLegacyEditorFacade
} from '../../util/story-format/legacy-editor/legacy-editor-facade';
import {
	type LegacyToolbarCommandReference,
	type ValidatedLegacyToolbarDescriptor,
	validateToolbarDescriptors
} from '../../util/story-format/legacy-editor/toolbar-descriptors';

export interface StoryFormatToolbarProps {
	editor: SourceEditorHandle;
	integration: AdaptedLegacyEditorIntegration;
	onFailure: (feature: 'command' | 'toolbar', error: Error) => void;
}

function normalizedError(error: unknown) {
	return error instanceof Error ? error : new Error(String(error));
}

function formatIcon(source: string, label: string) {
	return <img alt="" aria-hidden src={source} title={label} />;
}

export const StoryFormatToolbar: React.FC<StoryFormatToolbarProps> = ({
	editor,
	integration,
	onFailure
}) => {
	const appTheme = useComputedTheme();
	const {prefs} = usePrefsContext();
	const [descriptors, setDescriptors] = React.useState<
		ValidatedLegacyToolbarDescriptor[]
	>([]);
	const [disabledCommands, setDisabledCommands] = React.useState(
		() => new Set<string>()
	);
	const serializedDescriptors = React.useRef('');
	const commands = integration.codeMirror.commands ?? {};
	const toolbarFactory = integration.codeMirror.toolbar;
	const commandScope = integration.key;
	const readOnlyFacade = React.useMemo(
		() => createReadOnlyLegacyEditorFacade(editor),
		[editor]
	);
	const commandFacade = React.useMemo(
		() => createLegacyEditorFacade(editor),
		[editor]
	);

	React.useEffect(() => {
		registerPerformanceRetainedObject('legacyToolbarFacade', readOnlyFacade);
		registerPerformanceRetainedObject('legacyToolbarFacade', commandFacade);
	}, [commandFacade, readOnlyFacade]);

	React.useEffect(() => {
		setDisabledCommands(new Set());
	}, [integration.key]);

	const refresh = React.useCallback(() => {
		if (!toolbarFactory) {
			setDescriptors([]);
			return;
		}

		try {
			const nextDescriptors = validateToolbarDescriptors(
				toolbarFactory(readOnlyFacade, {
					appTheme,
					foregroundColor: appTheme === 'dark' ? '#f5f5f5' : '#171717',
					locale: prefs.locale
				}),
				{
					commandNames: Object.keys(commands),
					commandScope
				}
			);
			const serialized = JSON.stringify(nextDescriptors);

			if (serialized !== serializedDescriptors.current) {
				serializedDescriptors.current = serialized;
				registerPerformanceRetainedObject(
					'legacyToolbarDescriptorSet',
					nextDescriptors
				);
				setDescriptors(nextDescriptors);
			}
		} catch (error) {
			serializedDescriptors.current = '';
			setDescriptors([]);
			onFailure('toolbar', normalizedError(error));
		}
	}, [
		appTheme,
		commandScope,
		commands,
		onFailure,
		prefs.locale,
		readOnlyFacade,
		toolbarFactory
	]);

	React.useEffect(() => {
		return editor.subscribe(refresh);
	}, [editor, refresh]);

	const execute = React.useCallback(
		(reference: LegacyToolbarCommandReference) => {
			if (
				reference.scope !== commandScope ||
				disabledCommands.has(reference.name)
			) {
				return;
			}

			try {
				commands[reference.name](commandFacade);
				editor.focus();
			} catch (error) {
				setDisabledCommands(current => {
					const next = new Set(current);

					next.add(reference.name);
					return next;
				});
				onFailure('command', normalizedError(error));
			}
		},
		[commandFacade, commandScope, commands, disabledCommands, editor, onFailure]
	);

	if (descriptors.length === 0) {
		return null;
	}

	return (
		<div
			aria-label={`${integration.formatName} editor toolbar`}
			className="story-format-toolbar"
			role="toolbar"
		>
			<ButtonBar>
				{descriptors.map((descriptor, index) => {
					if (descriptor.type === 'button') {
						return (
							<IconButton
								disabled={
									descriptor.disabled ||
									disabledCommands.has(descriptor.command.name)
								}
								icon={formatIcon(descriptor.icon!, descriptor.label)}
								iconOnly={descriptor.iconOnly}
								key={`${descriptor.label}-${index}`}
								label={descriptor.label}
								onClick={() => execute(descriptor.command)}
							/>
						);
					}

					return (
						<MenuButton
							disabled={descriptor.disabled}
							icon={formatIcon(descriptor.icon, descriptor.label)}
							iconOnly={descriptor.iconOnly}
							items={descriptor.items.map(item =>
								item.type === 'separator'
									? {separator: true as const}
									: {
											disabled:
												item.disabled ||
												disabledCommands.has(item.command.name),
											label: item.label,
											onClick: () => execute(item.command)
										}
							)}
							key={`${descriptor.label}-${index}`}
							label={descriptor.label}
						/>
					);
				})}
			</ButtonBar>
		</div>
	);
};
