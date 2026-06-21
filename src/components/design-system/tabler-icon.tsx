import * as React from 'react';
import {
	IconAlertOctagon,
	IconAlertTriangle,
	IconArrowUpRight,
	IconBinaryTree,
	IconCheck,
	IconChevronDown,
	IconCircle,
	IconCommand,
	IconComponents,
	IconFileText,
	IconFiles,
	IconFocus2,
	IconGridDots,
	IconInfoCircle,
	IconLayoutColumns,
	IconLink,
	IconMinus,
	IconPackgeExport,
	IconPhoto,
	IconPlayerPlay,
	IconPlus,
	IconRefresh,
	IconRocket,
	IconTag,
	IconTags,
	IconTool,
	IconTrash,
	IconUnlink,
	IconVariable,
	IconWriting,
	IconX
} from '@tabler/icons';

export interface TablerIconProps {
	className?: string;
	icon: string;
	size?: number | string;
	stroke?: number | string;
}

const iconRegistry: Record<string, typeof IconCircle> = {
	'alert-octagon': IconAlertOctagon,
	'alert-triangle': IconAlertTriangle,
	'arrow-up-right': IconArrowUpRight,
	'binary-tree': IconBinaryTree,
	check: IconCheck,
	'chevron-down': IconChevronDown,
	circle: IconCircle,
	command: IconCommand,
	components: IconComponents,
	'file-text': IconFileText,
	files: IconFiles,
	'focus-2': IconFocus2,
	'grid-dots': IconGridDots,
	'info-circle': IconInfoCircle,
	'layout-columns': IconLayoutColumns,
	link: IconLink,
	minus: IconMinus,
	// @tabler/icons 1.x ships this export with the historical misspelling.
	'package-export': IconPackgeExport,
	photo: IconPhoto,
	'player-play': IconPlayerPlay,
	plus: IconPlus,
	refresh: IconRefresh,
	rocket: IconRocket,
	tag: IconTag,
	tags: IconTags,
	tool: IconTool,
	trash: IconTrash,
	unlink: IconUnlink,
	variable: IconVariable,
	writing: IconWriting,
	x: IconX
};

export const TablerIcon: React.FC<TablerIconProps> = ({
	className,
	icon,
	size = '1em',
	stroke = 1.75
}) => {
	const Icon = iconRegistry[icon] ?? IconCircle;

	return (
		<Icon
			aria-hidden
			className={className}
			data-icon-name={icon}
			focusable="false"
			size={size}
			stroke={stroke}
		/>
	);
};
