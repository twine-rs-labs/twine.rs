import * as React from 'react';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import {Badge, Input, TablerIcon} from '../design-system';
import {
	AppCommand,
	commandIsDisabled,
	commandMatches
} from './command-registry';

export interface CommandPaletteProps {
	commands: AppCommand[];
	resolveCommand: (id: string) => AppCommand | undefined;
	onClose: () => void;
	open: boolean;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
	commands,
	resolveCommand,
	onClose,
	open
}) => {
	const [query, setQuery] = React.useState('');
	const [activeIndex, setActiveIndex] = React.useState(0);
	const inputRef = React.useRef<HTMLInputElement>(null);
	const paletteRef = React.useRef<HTMLDivElement>(null);
	const restoreFocusRef = React.useRef<HTMLElement | null>(null);
	if (open && !restoreFocusRef.current) {
		const activeElement = document.activeElement;
		restoreFocusRef.current =
			activeElement instanceof HTMLElement ? activeElement : null;
	}
	const filteredCommands = React.useMemo(
		() => commands.filter(command => commandMatches(command, query)),
		[commands, query]
	);

	React.useEffect(() => {
		if (open) {
			setQuery('');
			setActiveIndex(0);
			window.requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	React.useEffect(() => {
		if (!open) return;
		const palette = paletteRef.current;
		return () => {
			const activeElement = document.activeElement;
			if (
				activeElement === document.body ||
				activeElement === document.documentElement ||
				(activeElement instanceof Node && palette?.contains(activeElement))
			) {
				restoreFocusRef.current?.focus();
			}
			restoreFocusRef.current = null;
		};
	}, [open]);

	React.useEffect(() => {
		setActiveIndex(index =>
			Math.min(index, Math.max(filteredCommands.length - 1, 0))
		);
	}, [filteredCommands.length]);

	if (!open) {
		return null;
	}

	function runCommand(rendered: AppCommand) {
		const command = resolveCommand(rendered.id);
		if (
			!command ||
			commandIsDisabled(command) ||
			command.contextKey !== rendered.contextKey
		) {
			return;
		}

		const focusOrigin = restoreFocusRef.current;
		onClose();
		void Promise.resolve(
			command.run({
				restoreFocus: () => {
					window.requestAnimationFrame(() => {
						window.requestAnimationFrame(() => {
							if (focusOrigin?.isConnected) focusOrigin.focus();
						});
					});
				}
			})
		);
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setActiveIndex(index =>
				Math.min(index + 1, Math.max(filteredCommands.length - 1, 0))
			);
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			setActiveIndex(index => Math.max(index - 1, 0));
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();

			const command = filteredCommands[activeIndex];

			if (command) {
				runCommand(command);
			}
		}
	}

	return (
		<div
			className="app-cp__scrim"
			onMouseDown={event => {
				event.preventDefault();
				onClose();
			}}
		>
			<FocusTrap
				focusTrapOptions={{
					allowOutsideClick: true,
					clickOutsideDeactivates: false,
					onDeactivate: onClose,
					returnFocusOnDeactivate: false
				}}
			>
				<div
					aria-modal="true"
					className="app-cp"
					onMouseDown={event => event.stopPropagation()}
					ref={paletteRef}
					role="dialog"
				>
					<div className="app-cp__search">
						<TablerIcon icon="command" />
						<Input
							aria-label="Command"
							block
							onChange={event => setQuery(event.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Command"
							ref={inputRef}
							value={query}
						/>
					</div>
					<div className="app-cp__list" role="listbox">
						{filteredCommands.map((command, index) => (
							<button
								aria-selected={index === activeIndex}
								className={classNames(
									'app-cp__row',
									index === activeIndex && 'app-cp__row--active'
								)}
								disabled={commandIsDisabled(command)}
								key={command.id}
								onMouseEnter={() => setActiveIndex(index)}
								onClick={() => runCommand(command)}
								role="option"
								type="button"
							>
								<span className="app-cp__icon">
									<TablerIcon icon={command.icon ?? 'circle'} />
								</span>
								<span className="app-cp__main">
									<span className="app-cp__label">{command.label}</span>
									<span className="app-cp__group">{command.group}</span>
									{command.disabledReason && (
										<span className="app-cp__reason">
											{command.disabledReason}
										</span>
									)}
								</span>
								{command.shortcut && (
									<Badge mono tone="neutral">
										{command.shortcut}
									</Badge>
								)}
							</button>
						))}
						{filteredCommands.length === 0 && (
							<div className="app-cp__empty">No commands</div>
						)}
					</div>
				</div>
			</FocusTrap>
		</div>
	);
};
