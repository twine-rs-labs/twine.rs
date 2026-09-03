import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton, PromptPopover} from '../design-system';
import {Passage, Story} from '../../store/stories';

const DisabledRenamePassageButton: React.FC = () => {
	const {t} = useTranslation();

	return <IconButton disabled icon="writing" label={t('common.rename')} />;
};

export interface EnabledRenamePassageButtonProps {
	onRename: (value: string) => void;
	passage: Passage;
	story: Story;
}

export interface PassageRenamePromptProps {
	anchor?: HTMLElement | null;
	onCancel: () => void;
	onRename: (value: string) => void;
	open: boolean;
	passage: Passage;
	story: Story;
}

export const PassageRenamePrompt: React.FC<PassageRenamePromptProps> = ({
	anchor,
	onCancel,
	onRename,
	open,
	passage,
	story
}) => {
	const [newName, setNewName] = React.useState(passage.name);
	const {t} = useTranslation();

	React.useEffect(() => {
		if (open) setNewName(passage.name);
	}, [open, passage.id, passage.name]);

	function validate(name: string) {
		if (name.trim() === '') {
			return {
				message: t('components.renamePassageButton.emptyName'),
				valid: false
			};
		}

		if (story.passages.some(p => p.id !== passage.id && p.name === name)) {
			return {
				message: t('components.renamePassageButton.nameAlreadyUsed'),
				valid: false
			};
		}

		return {valid: true};
	}

	return (
		<PromptPopover
			anchor={anchor}
			cancelLabel={t('common.cancel')}
			confirmLabel={t('common.save')}
			onCancel={onCancel}
			onChange={setNewName}
			onSubmit={onRename}
			open={open}
			prompt={t('common.renamePrompt', {name: passage.name})}
			validate={validate}
			value={newName}
		/>
	);
};

export const EnabledRenamePassageButton: React.FC<
	EnabledRenamePassageButtonProps
> = props => {
	const {onRename, passage, story} = props;
	const [open, setOpen] = React.useState(false);
	const buttonRef = React.useRef<HTMLButtonElement | null>(null);
	const {t} = useTranslation();

	return (
		<span className="tw-prompt-icon">
			<IconButton
				icon="writing"
				label={t('common.rename')}
				onClick={() => setOpen(value => !value)}
				ref={buttonRef}
			/>
			<PassageRenamePrompt
				anchor={buttonRef.current}
				onCancel={() => {
					setOpen(false);
					window.requestAnimationFrame(() => buttonRef.current?.focus());
				}}
				onRename={value => {
					onRename(value);
					setOpen(false);
				}}
				open={open}
				passage={passage}
				story={story}
			/>
		</span>
	);
};

export interface RenamePassageButtonProps extends Omit<
	EnabledRenamePassageButtonProps,
	'passage'
> {
	disabled?: boolean;
	passage?: Passage;
}

export const RenamePassageButton: React.FC<
	RenamePassageButtonProps
> = props => {
	if (!props.disabled && props.passage) {
		return (
			<EnabledRenamePassageButton
				{...(props as EnabledRenamePassageButtonProps)}
			/>
		);
	}

	return <DisabledRenamePassageButton />;
};
