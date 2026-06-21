import * as React from 'react';
import {
	IconAlertOctagon,
	IconAlertTriangle,
	IconArrowBackUp,
	IconArrowUpRight,
	IconBinaryTree,
	IconBook,
	IconBox,
	IconBraces,
	IconBug,
	IconCheck,
	IconChevronDown,
	IconChevronRight,
	IconCircle,
	IconCircleCheck,
	IconCircleDashed,
	IconCircleDot,
	IconCommand,
	IconComponents,
	IconDatabase,
	IconDots,
	IconEyeglass,
	IconFileCode,
	IconFileText,
	IconFiles,
	IconFocus2,
	IconFolder,
	IconGitBranch,
	IconGridDots,
	IconHome,
	IconInfoCircle,
	IconLayoutBottombarCollapse,
	IconLayoutBottombarExpand,
	IconLayoutColumns,
	IconLayoutSidebarLeftCollapse,
	IconLayoutSidebarLeftExpand,
	IconLayoutSidebarRightCollapse,
	IconLayoutSidebarRightExpand,
	IconListDetails,
	IconLink,
	IconMinus,
	IconPackgeExport,
	IconPhoto,
	IconPlayerPlay,
	IconPlus,
	IconPuzzle,
	IconRefresh,
	IconRocket,
	IconSettings,
	IconTag,
	IconTags,
	IconTerminal2,
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
	'arrow-back-up': IconArrowBackUp,
	'arrow-up-right': IconArrowUpRight,
	'binary-tree': IconBinaryTree,
	book: IconBook,
	box: IconBox,
	braces: IconBraces,
	bug: IconBug,
	check: IconCheck,
	'chevron-down': IconChevronDown,
	'chevron-right': IconChevronRight,
	circle: IconCircle,
	'circle-check': IconCircleCheck,
	'circle-dashed': IconCircleDashed,
	'circle-dot': IconCircleDot,
	command: IconCommand,
	components: IconComponents,
	database: IconDatabase,
	dots: IconDots,
	eyeglass: IconEyeglass,
	'file-code': IconFileCode,
	'file-text': IconFileText,
	files: IconFiles,
	'focus-2': IconFocus2,
	folder: IconFolder,
	'git-branch': IconGitBranch,
	'grid-dots': IconGridDots,
	home: IconHome,
	'info-circle': IconInfoCircle,
	'layout-bottombar-collapse': IconLayoutBottombarCollapse,
	'layout-bottombar-expand': IconLayoutBottombarExpand,
	'layout-columns': IconLayoutColumns,
	'layout-sidebar-left-collapse': IconLayoutSidebarLeftCollapse,
	'layout-sidebar-left-expand': IconLayoutSidebarLeftExpand,
	'layout-sidebar-right-collapse': IconLayoutSidebarRightCollapse,
	'layout-sidebar-right-expand': IconLayoutSidebarRightExpand,
	'list-details': IconListDetails,
	link: IconLink,
	minus: IconMinus,
	// @tabler/icons 1.x ships this export with the historical misspelling.
	'package-export': IconPackgeExport,
	photo: IconPhoto,
	'player-play': IconPlayerPlay,
	plus: IconPlus,
	'point-filled': IconCircleDot,
	puzzle: IconPuzzle,
	refresh: IconRefresh,
	rocket: IconRocket,
	settings: IconSettings,
	tag: IconTag,
	tags: IconTags,
	'terminal-2': IconTerminal2,
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
