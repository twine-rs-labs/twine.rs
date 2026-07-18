import * as React from 'react';
import {ButtonBar} from '../../../components/container/button-bar';
import {IconButton} from '../../../components/control/icon-button';
import {MenuButton} from '../../../components/control/menu-button';
import {
	Button,
	Checkbox,
	Input,
	Select,
	TablerIcon
} from '../../../components/design-system';
import type {
	NativeEditorFindOptions,
	NativeEditorHost,
	NativeEditorToolbarProps
} from '../native-editor/types';
import {harloweMacroDefinitions} from './parser';
import {
	harloweAlignmentWrapper,
	harloweColour,
	harloweInputBoxSource,
	harloweLinkWrapper,
	harloweVisitComparison,
	type HarloweAlignment,
	type HarloweLinkAction,
	type HarloweRevealBehavior,
	type HarloweWrapper
} from './toolbar-source';
import './harlowe-toolbar.css';

type Panel =
	| 'align'
	| 'borders'
	| 'collapse'
	| 'colour'
	| 'columns'
	| 'find'
	| 'hook'
	| 'if'
	| 'input'
	| 'link'
	| 'macros'
	| 'preferences'
	| 'rotate'
	| 'styles'
	| 'value';

function icon(name: string) {
	return <TablerIcon icon={name} />;
}

function quoted(value: string) {
	return JSON.stringify(value);
}

export function wrapNativeEditorSelections(
	editor: NativeEditorHost,
	{after, before, placeholder = 'Your Text Here'}: HarloweWrapper
) {
	const snapshot = editor.getSnapshot();
	const sorted = snapshot.selections
		.map((selection, index) => ({
			from: Math.min(selection.anchor, selection.head),
			index,
			reversed: selection.anchor > selection.head,
			to: Math.max(selection.anchor, selection.head)
		}))
		.sort((left, right) => left.from - right.from || left.to - right.to);
	const edits: Array<{from: number; insert: string; to: number}> = [];
	const nextSelections: Array<{anchor: number; head: number}> = [];
	let offset = 0;

	for (const selection of sorted) {
		const selected = snapshot.document.slice(selection.from, selection.to);
		const inner = selected || placeholder;
		const insert = `${before}${inner}${after}`;
		const from = selection.from + offset + before.length;
		const to = from + inner.length;

		edits.push({from: selection.from, insert, to: selection.to});
		nextSelections[selection.index] = selection.reversed
			? {anchor: to, head: from}
			: {anchor: from, head: to};
		offset += insert.length - (selection.to - selection.from);
	}

	editor.applyEdits(edits, nextSelections, snapshot.mainSelectionIndex);
	editor.focus();
}

function insertTemplate(
	editor: NativeEditorHost,
	template: string,
	selection?: {from: number; to: number}
) {
	wrapNativeEditorSelections(editor, {
		after: template.slice(selection?.to ?? template.length),
		before: template.slice(0, selection?.from ?? template.length),
		placeholder: selection ? template.slice(selection.from, selection.to) : ''
	});
}

const exclusiveStyleGroups = [
	{
		label: 'Underlines and strikes',
		options: [
			'none',
			'underline',
			'double-underline',
			'wavy-underline',
			'strike',
			'double-strike',
			'wavy-strike'
		]
	},
	{
		label: 'Superscript and subscript',
		options: ['none', 'superscript', 'subscript']
	},
	{
		label: 'Outlines',
		options: [
			'none',
			'outline',
			'shadow',
			'emboss',
			'blur',
			'blurrier',
			'smear'
		]
	},
	{label: 'Letter spacing', options: ['none', 'condense', 'expand']},
	{
		label: 'Flips and stretches',
		options: ['none', 'mirror', 'upside-down', 'tall', 'flat']
	},
	{
		label: 'Animations',
		options: [
			'none',
			'blink',
			'fade-in-out',
			'rumble',
			'shudder',
			'sway',
			'buoy',
			'fidget'
		]
	}
] as const;

const macroDefinitions = Object.values(harloweMacroDefinitions)
	.filter(
		(definition, index, all) =>
			all.findIndex(candidate => candidate.name === definition.name) === index
	)
	.sort(
		(left, right) =>
			(left.category ?? '').localeCompare(right.category ?? '') ||
			left.name.localeCompare(right.name)
	);

function cssColour(colour: string, opacity: number) {
	const red = Number.parseInt(colour.slice(1, 3), 16);
	const green = Number.parseInt(colour.slice(3, 5), 16);
	const blue = Number.parseInt(colour.slice(5, 7), 16);

	return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function textStylePreview(styles: string[]): React.CSSProperties {
	const transforms: string[] = [];
	const result: React.CSSProperties = {};

	for (const style of styles) {
		switch (style) {
			case 'bold':
				result.fontWeight = 'bold';
				break;
			case 'italic':
				result.fontStyle = 'italic';
				break;
			case 'mark':
				result.background = 'yellow';
				result.color = 'black';
				break;
			case 'underline':
				result.textDecoration = 'underline';
				break;
			case 'double-underline':
				result.textDecoration = 'underline double';
				break;
			case 'wavy-underline':
				result.textDecoration = 'underline wavy';
				break;
			case 'strike':
				result.textDecoration = 'line-through';
				break;
			case 'double-strike':
				result.textDecoration = 'line-through double';
				break;
			case 'wavy-strike':
				result.textDecoration = 'line-through wavy';
				break;
			case 'superscript':
				result.fontSize = '0.75em';
				result.verticalAlign = 'super';
				break;
			case 'subscript':
				result.fontSize = '0.75em';
				result.verticalAlign = 'sub';
				break;
			case 'outline':
				result.textShadow =
					'-1px -1px currentColor, 1px -1px currentColor, -1px 1px currentColor, 1px 1px currentColor';
				result.color = 'black';
				break;
			case 'shadow':
				result.textShadow = '0.12em 0.12em 0.08em #777';
				break;
			case 'emboss':
				result.textShadow = '-1px -1px #fff, 1px 1px #555';
				break;
			case 'blur':
				result.filter = 'blur(1px)';
				break;
			case 'blurrier':
				result.filter = 'blur(2px)';
				break;
			case 'smear':
				result.textShadow = '0.15em 0 currentColor, 0.3em 0 currentColor';
				break;
			case 'condense':
				result.letterSpacing = '-0.08em';
				break;
			case 'expand':
				result.letterSpacing = '0.12em';
				break;
			case 'mirror':
				transforms.push('scaleX(-1)');
				break;
			case 'upside-down':
				transforms.push('scaleY(-1)');
				break;
			case 'tall':
				transforms.push('scaleY(1.5)');
				break;
			case 'flat':
				transforms.push('scaleY(0.5)');
				break;
		}
	}

	if (transforms.length) {
		result.display = 'inline-block';
		result.transform = transforms.join(' ');
	}

	return result;
}

function Preview({
	children,
	className = '',
	label,
	style
}: {
	children: React.ReactNode;
	className?: string;
	label: string;
	style?: React.CSSProperties;
}) {
	return (
		<div
			aria-label={label}
			className={`harlowe-native-preview ${className}`.trim()}
			style={style}
		>
			{children}
		</div>
	);
}

function PanelShell({
	children,
	label,
	onClose
}: {
	children: React.ReactNode;
	label: string;
	onClose: () => void;
}) {
	return (
		<section aria-label={label} className="harlowe-native-panel" role="dialog">
			<header>
				<strong>{label}</strong>
				<IconButton
					icon={icon('x')}
					iconOnly
					label={`Close ${label}`}
					onClick={onClose}
				/>
			</header>
			<div className="harlowe-native-panel-body">{children}</div>
		</section>
	);
}

function StylesPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [fontVariants, setFontVariants] = React.useState<string[]>(['bold']);
	const [exclusiveStyles, setExclusiveStyles] = React.useState(
		exclusiveStyleGroups.map(() => 'none')
	);
	const [wholeRemainder, setWholeRemainder] = React.useState(false);
	const styles = [
		...fontVariants,
		...exclusiveStyles.filter(style => style !== 'none')
	];
	const animation = exclusiveStyles[5];

	return (
		<PanelShell label="More Styles" onClose={onClose}>
			<Preview
				className={
					animation === 'none' ? '' : `harlowe-native-preview--${animation}`
				}
				label="Text style preview"
			>
				<span style={textStylePreview(styles)}>Example text preview</span>
			</Preview>
			<strong>Font variants</strong>
			<div className="harlowe-native-option-grid">
				{['bold', 'italic', 'mark'].map(style => (
					<Checkbox
						checked={fontVariants.includes(style)}
						key={style}
						label={style}
						onChange={checked =>
							setFontVariants(current =>
								checked
									? [...current, style]
									: current.filter(item => item !== style)
							)
						}
					/>
				))}
			</div>
			{exclusiveStyleGroups.map((group, index) => (
				<Select
					ariaLabel={group.label}
					key={group.label}
					onChange={value =>
						setExclusiveStyles(current =>
							current.map((style, styleIndex) =>
								styleIndex === index ? value : style
							)
						)
					}
					options={[...group.options]}
					value={exclusiveStyles[index]}
				/>
			))}
			<Checkbox
				checked={wholeRemainder}
				label="Affect the entire remainder of the passage or hook"
				onChange={setWholeRemainder}
			/>
			<PanelActions
				disabled={styles.length === 0}
				onApply={() => {
					wrapNativeEditorSelections(editor, {
						after: wholeRemainder ? '' : ']',
						before: `(text-style:${styles.map(quoted).join(',')})${
							wholeRemainder ? '[=\n' : '['
						}`,
						placeholder: 'Styled Text'
					});
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function ColourPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [angle, setAngle] = React.useState(0);
	const [background, setBackground] = React.useState('#000000');
	const [backgroundOpacity, setBackgroundOpacity] = React.useState(1);
	const [backgroundMode, setBackgroundMode] = React.useState('default');
	const [scope, setScope] = React.useState('hook');
	const [text, setText] = React.useState('#ffffff');
	const [textOpacity, setTextOpacity] = React.useState(1);
	const [textEnabled, setTextEnabled] = React.useState(true);
	const [stops, setStops] = React.useState([
		{colour: '#000000', opacity: 1, position: 0},
		{colour: '#ffffff', opacity: 1, position: 1}
	]);
	const backgroundChanger =
		backgroundMode === 'flat'
			? `(bg:${harloweColour(background, backgroundOpacity)})`
			: backgroundMode === 'gradient'
				? `(bg:(gradient:${angle},${[...stops]
						.sort((left, right) => left.position - right.position)
						.map(
							stop =>
								`${stop.position},${harloweColour(stop.colour, stop.opacity)}`
						)
						.join(',')}))`
				: '';
	const changers = [
		textEnabled ? `(text-colour:${harloweColour(text, textOpacity)})` : '',
		backgroundChanger
	].filter(Boolean);
	const previewBackground =
		backgroundMode === 'gradient'
			? `linear-gradient(${angle}deg, ${[...stops]
					.sort((left, right) => left.position - right.position)
					.map(
						stop =>
							`${cssColour(stop.colour, stop.opacity)} ${stop.position * 100}%`
					)
					.join(', ')})`
			: backgroundMode === 'flat'
				? cssColour(background, backgroundOpacity)
				: undefined;

	return (
		<PanelShell label="Colours" onClose={onClose}>
			<Preview
				label="Colour preview"
				style={{
					background: previewBackground,
					color: textEnabled ? cssColour(text, textOpacity) : undefined
				}}
			>
				<span>Example text preview</span>
			</Preview>
			<div className="harlowe-native-field-row">
				<Checkbox
					checked={textEnabled}
					label="Text colour"
					onChange={setTextEnabled}
				/>
				<input
					aria-label="Text colour"
					disabled={!textEnabled}
					onChange={event => setText(event.target.value)}
					type="color"
					value={text}
				/>
				<Input
					aria-label="Text opacity"
					disabled={!textEnabled}
					max={1}
					min={0}
					onChange={event => setTextOpacity(+event.target.value)}
					step={0.05}
					type="range"
					value={textOpacity}
				/>
			</div>
			<div className="harlowe-native-field-row">
				<Select
					ariaLabel="Background"
					onChange={setBackgroundMode}
					options={[
						{label: 'Default background', value: 'default'},
						{label: 'Flat colour', value: 'flat'},
						{label: 'Linear gradient', value: 'gradient'}
					]}
					value={backgroundMode}
				/>
				<input
					aria-label="Background colour"
					disabled={backgroundMode === 'default'}
					onChange={event => setBackground(event.target.value)}
					type="color"
					value={background}
				/>
				<Input
					aria-label="Background opacity"
					disabled={backgroundMode !== 'flat'}
					max={1}
					min={0}
					onChange={event => setBackgroundOpacity(+event.target.value)}
					step={0.05}
					type="range"
					value={backgroundOpacity}
				/>
			</div>
			{backgroundMode === 'gradient' && (
				<>
					<Input
						label="Angle"
						max={359}
						min={0}
						onChange={event => setAngle(+event.target.value)}
						type="number"
						value={angle}
					/>
					{stops.map((stop, index) => (
						<div className="harlowe-native-field-row" key={index}>
							<strong>Stop {index + 1}</strong>
							<input
								aria-label={`Gradient stop ${index + 1} colour`}
								onChange={event =>
									setStops(current =>
										current.map((item, itemIndex) =>
											itemIndex === index
												? {...item, colour: event.target.value}
												: item
										)
									)
								}
								type="color"
								value={stop.colour}
							/>
							<Input
								aria-label={`Gradient stop ${index + 1} position`}
								max={1}
								min={0}
								onChange={event =>
									setStops(current =>
										current.map((item, itemIndex) =>
											itemIndex === index
												? {...item, position: +event.target.value}
												: item
										)
									)
								}
								step={0.01}
								type="number"
								value={stop.position}
							/>
							<Input
								aria-label={`Gradient stop ${index + 1} opacity`}
								max={1}
								min={0}
								onChange={event =>
									setStops(current =>
										current.map((item, itemIndex) =>
											itemIndex === index
												? {...item, opacity: +event.target.value}
												: item
										)
									)
								}
								step={0.05}
								type="range"
								value={stop.opacity}
							/>
							<Button
								disabled={stops.length <= 2}
								onClick={() =>
									setStops(current =>
										current.filter((_, itemIndex) => itemIndex !== index)
									)
								}
								size="sm"
							>
								Remove
							</Button>
						</div>
					))}
					<Button
						onClick={() =>
							setStops(current => [
								...current,
								{colour: '#ffffff', opacity: 1, position: 0.5}
							])
						}
						size="sm"
					>
						Add colour stop
					</Button>
				</>
			)}
			<Select
				ariaLabel="Colour scope"
				onChange={setScope}
				options={[
					{label: 'The attached hook', value: 'hook'},
					{
						label: 'The remainder of the passage or hook',
						value: 'remainder'
					},
					{label: 'The entire passage', value: 'passage'},
					{label: 'The entire page', value: 'page'}
				]}
				value={scope}
			/>
			<PanelActions
				disabled={
					changers.length === 0 ||
					(backgroundMode === 'gradient' && stops.length < 2)
				}
				onApply={() => {
					const changer = changers.join('+');

					if (scope === 'passage' || scope === 'page') {
						insertTemplate(editor, `(enchant:?${scope},${changer})`);
					} else {
						wrapNativeEditorSelections(editor, {
							after: scope === 'remainder' ? '' : ']',
							before: `${changer}${scope === 'remainder' ? '[=\n' : '['}`,
							placeholder: 'Coloured Text'
						});
					}
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function BordersPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [scope, setScope] = React.useState('hook');
	const [sides, setSides] = React.useState(() =>
		['Top', 'Right', 'Bottom', 'Left'].map(name => ({
			colour: '#ffffff',
			name,
			opacity: 1,
			size: 1,
			style: 'none'
		}))
	);

	function updateSide(
		index: number,
		key: 'colour' | 'opacity' | 'size' | 'style',
		value: string | number
	) {
		setSides(current =>
			current.map((side, sideIndex) =>
				sideIndex === index ? {...side, [key]: value} : side
			)
		);
	}

	function fourValues<T>(values: T[]) {
		const result = [...values];

		if (result[3] === result[1]) {
			result.pop();
		}
		if (result[2] === result[0]) {
			result.pop();
		}
		if (result[1] === result[0]) {
			result.pop();
		}

		return result;
	}

	return (
		<PanelShell label="Borders" onClose={onClose}>
			<Preview
				label="Border preview"
				style={{
					borderColor: sides
						.map(side => cssColour(side.colour, side.opacity))
						.join(' '),
					borderStyle: sides.map(side => side.style).join(' '),
					borderWidth: sides.map(side => `${side.size * 2}px`).join(' ')
				}}
			>
				<span>Example border preview</span>
			</Preview>
			<div className="harlowe-native-border-grid">
				{sides.map((side, index) => (
					<React.Fragment key={side.name}>
						<strong>{side.name}</strong>
						<Select
							ariaLabel={`${side.name} border style`}
							onChange={value => updateSide(index, 'style', value)}
							options={[
								'none',
								'dotted',
								'dashed',
								'solid',
								'double',
								'groove',
								'ridge',
								'inset',
								'outset'
							]}
							value={side.style}
						/>
						<Input
							aria-label={`${side.name} border size`}
							min={0.1}
							onChange={event => updateSide(index, 'size', +event.target.value)}
							step={0.1}
							type="number"
							value={side.size}
						/>
						<input
							aria-label={`${side.name} border colour`}
							onChange={event =>
								updateSide(index, 'colour', event.target.value)
							}
							type="color"
							value={side.colour}
						/>
						<Input
							aria-label={`${side.name} border opacity`}
							max={1}
							min={0}
							onChange={event =>
								updateSide(index, 'opacity', +event.target.value)
							}
							step={0.05}
							type="range"
							value={side.opacity}
						/>
					</React.Fragment>
				))}
			</div>
			<Select
				ariaLabel="Border scope"
				onChange={setScope}
				options={[
					{label: 'The attached hook', value: 'hook'},
					{
						label: 'The remainder of the passage or hook',
						value: 'remainder'
					},
					{label: 'The entire passage', value: 'passage'}
				]}
				value={scope}
			/>
			<PanelActions
				disabled={sides.every(side => side.style === 'none')}
				onApply={() => {
					const changers = [
						`(b4r:${fourValues(sides.map(side => quoted(side.style))).join(
							','
						)})`,
						`(b4r-size:${fourValues(sides.map(side => side.size)).join(',')})`,
						`(b4r-colour:${fourValues(
							sides.map(side => harloweColour(side.colour, side.opacity))
						).join(',')})`
					];
					const changer = changers.join('+');

					if (scope === 'passage') {
						insertTemplate(editor, `(enchant:?passage,${changer})`);
					} else {
						wrapNativeEditorSelections(editor, {
							after: scope === 'remainder' ? '' : ']',
							before: `${changer}${scope === 'remainder' ? '[=\n' : '['}`,
							placeholder: 'Bordered Text'
						});
					}
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function RotatePanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [x, setX] = React.useState(0);
	const [y, setY] = React.useState(0);
	const [z, setZ] = React.useState(0);
	const [wholeRemainder, setWholeRemainder] = React.useState(false);

	return (
		<PanelShell label="Rotated text" onClose={onClose}>
			<Preview label="Rotation preview">
				<span
					style={{
						transform: `${
							x || y ? 'perspective(50vw) ' : ''
						}rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`
					}}
				>
					Rotated text preview
				</span>
			</Preview>
			{[
				['X', x, setX],
				['Y', y, setY],
				['Z', z, setZ]
			].map(([axis, value, setter]) => (
				<Input
					key={axis as string}
					label={`Rotation (${axis} axis)`}
					max={359}
					min={0}
					onChange={event =>
						(setter as React.Dispatch<React.SetStateAction<number>>)(
							+event.target.value
						)
					}
					type="number"
					value={value as number}
				/>
			))}
			<Checkbox
				checked={wholeRemainder}
				label="Affect the entire remainder of the passage or hook"
				onChange={setWholeRemainder}
			/>
			<PanelActions
				disabled={!x && !y && !z}
				onApply={() => {
					const changers = [
						x ? `(text-rotate-x:${x})` : '',
						y ? `(text-rotate-y:${y})` : '',
						z ? `(text-rotate-z:${z})` : ''
					].filter(Boolean);

					wrapNativeEditorSelections(editor, {
						after: wholeRemainder ? '' : ']',
						before: `${changers.join('+')}${wholeRemainder ? '[=\n' : '['}`,
						placeholder: 'Rotated Text'
					});
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function AlignPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [alignment, setAlignment] = React.useState<HarloweAlignment>('left');
	const [placement, setPlacement] = React.useState(0);
	const [remainder, setRemainder] = React.useState(false);
	const [width, setWidth] = React.useState(5);

	return (
		<PanelShell label="Alignment" onClose={onClose}>
			<Preview label="Alignment preview">
				<span
					style={{
						marginLeft: `${(1 - width / 10) * placement * 10}%`,
						marginRight: `${(1 - width / 10) * (10 - placement) * 10}%`,
						textAlign: alignment === 'center' ? 'center' : alignment,
						width: `${width * 10}%`
					}}
				>
					You can apply left, center and right alignment to your passage text,
					as well as adjust the margins and width.
				</span>
			</Preview>
			<Select
				ariaLabel="Alignment"
				onChange={value => setAlignment(value as HarloweAlignment)}
				options={['left', 'center', 'justify', 'right']}
				value={alignment}
			/>
			<Input
				label="Placement (0 left, 10 right)"
				max={10}
				min={0}
				onChange={event => setPlacement(+event.target.value)}
				type="range"
				value={placement}
			/>
			<Input
				label="Width"
				max={10}
				min={1}
				onChange={event => setWidth(+event.target.value)}
				type="range"
				value={width}
			/>
			<Checkbox
				checked={remainder}
				label="Affect the entire remainder of the passage"
				onChange={setRemainder}
			/>
			<PanelActions
				onApply={() => {
					wrapNativeEditorSelections(
						editor,
						harloweAlignmentWrapper({
							alignment,
							placement,
							remainder,
							width
						})
					);
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function ColumnsPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [count, setCount] = React.useState(1);
	const [columns, setColumns] = React.useState(() =>
		Array.from({length: 6}, () => ({left: 1, right: 1, width: 1}))
	);

	function updateColumn(
		index: number,
		key: 'left' | 'right' | 'width',
		value: number
	) {
		setColumns(current =>
			current.map((column, columnIndex) =>
				columnIndex === index ? {...column, [key]: value} : column
			)
		);
	}

	return (
		<PanelShell label="Columns" onClose={onClose}>
			<Preview
				className="harlowe-native-columns-preview"
				label="Columns preview"
			>
				{columns.slice(0, count).map((column, index) => (
					<span
						key={index}
						style={{
							flex: `${column.width} 1 0`,
							marginLeft: `${column.left}%`,
							marginRight: `${column.right}%`
						}}
					>
						Column {index + 1}
					</span>
				))}
			</Preview>
			<Input
				label="Columns"
				max={6}
				min={1}
				onChange={event => setCount(+event.target.value)}
				type="number"
				value={count}
			/>
			<div className="harlowe-native-columns-grid">
				{columns.slice(0, count).map((column, index) => (
					<React.Fragment key={index}>
						<strong>Column {index + 1}</strong>
						<Input
							aria-label={`Column ${index + 1} left margin`}
							max={9}
							min={0}
							onChange={event =>
								updateColumn(index, 'left', +event.target.value)
							}
							type="number"
							value={column.left}
						/>
						<Input
							aria-label={`Column ${index + 1} width`}
							max={9}
							min={1}
							onChange={event =>
								updateColumn(index, 'width', +event.target.value)
							}
							type="number"
							value={column.width}
						/>
						<Input
							aria-label={`Column ${index + 1} right margin`}
							max={9}
							min={0}
							onChange={event =>
								updateColumn(index, 'right', +event.target.value)
							}
							type="number"
							value={column.right}
						/>
					</React.Fragment>
				))}
			</div>
			<PanelActions
				onApply={() => {
					const template = `${Array.from(
						{length: count},
						(_, index) =>
							`\n${'='.repeat(columns[index].left)}${'|'.repeat(
								columns[index].width
							)}${'='.repeat(columns[index].right)}\nColumn ${index + 1}`
					).join('')}${count > 1 ? '\n|==|' : ''}`;

					insertTemplate(editor, template);
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function CollapsePanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [remainder, setRemainder] = React.useState(false);

	return (
		<PanelShell label="Collapse Whitespace" onClose={onClose}>
			<p>
				Collapsing markup hides line breaks and reduces consecutive spaces
				in-game.
			</p>
			<Checkbox
				checked={remainder}
				label="Collapse the remainder of the passage"
				onChange={setRemainder}
			/>
			<PanelActions
				onApply={() => {
					wrapNativeEditorSelections(editor, {
						after: remainder ? '' : '}',
						before: remainder ? '{=\n' : '{',
						placeholder: 'Collapsed Text'
					});
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function LinkPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const snapshot = editor.getSnapshot();
	const selection = snapshot.selections[0];
	const selected = selection
		? snapshot.document.slice(
				Math.min(selection.anchor, selection.head),
				Math.max(selection.anchor, selection.head)
			)
		: '';
	const [passage, setPassage] = React.useState('');
	const [action, setAction] = React.useState<HarloweLinkAction>('goto');
	const [clickPage, setClickPage] = React.useState(false);
	const [text, setText] = React.useState(selected || '');
	const [arrivingTransition, setArrivingTransition] = React.useState('');
	const [departingTransition, setDepartingTransition] = React.useState('');
	const [revealedTransition, setRevealedTransition] = React.useState('');
	const [transitionTime, setTransitionTime] = React.useState(0.8);
	const [revealBehavior, setRevealBehavior] =
		React.useState<HarloweRevealBehavior>('link');
	const [remainder, setRemainder] = React.useState(false);
	const [cycleOptions, setCycleOptions] = React.useState(
		'Second option\nThird option'
	);
	const [cycleEnd, setCycleEnd] = React.useState<'loop' | 'remove' | 'unlink'>(
		'loop'
	);
	const [previewGeneration, replayPreview] = React.useReducer(
		generation => generation + 1,
		0
	);
	const transitionOptions = [
		{label: 'Default transition', value: ''},
		'instant',
		'dissolve',
		'blur',
		'rumble',
		'shudder',
		'pulse',
		'zoom',
		'flicker',
		'slide-left',
		'slide-right',
		'slide-up',
		'slide-down',
		'fade-left',
		'fade-right',
		'fade-up',
		'fade-down'
	];

	return (
		<PanelShell label="Link" onClose={onClose}>
			{action !== 'cycle' && (
				<button
					aria-label="Replay transition preview"
					className="harlowe-native-preview harlowe-native-transition-preview"
					onClick={replayPreview}
					type="button"
				>
					{action === 'reveal' ? (
						<span
							className={`harlowe-native-transition harlowe-native-transition--${
								revealedTransition || 'default'
							}`}
							key={`${previewGeneration}:${revealedTransition}:${transitionTime}`}
							style={{animationDuration: `${transitionTime}s`}}
						>
							Revealed Text
						</span>
					) : (
						<>
							<span
								className={`harlowe-native-transition harlowe-native-transition--depart harlowe-native-transition--${
									departingTransition || 'default'
								}`}
								key={`depart:${previewGeneration}:${departingTransition}:${transitionTime}`}
								style={{animationDuration: `${transitionTime}s`}}
							>
								Departing Text
							</span>
							<span
								className={`harlowe-native-transition harlowe-native-transition--${
									arrivingTransition || 'default'
								}`}
								key={`arrive:${previewGeneration}:${arrivingTransition}:${transitionTime}`}
								style={{animationDuration: `${transitionTime}s`}}
							>
								Arriving Text
							</span>
						</>
					)}
				</button>
			)}
			<Input
				block
				label="Link text"
				onChange={event => setText(event.target.value)}
				value={text}
			/>
			<Checkbox
				checked={clickPage}
				label="Allow the entire page to be clicked"
				onChange={setClickPage}
			/>
			<Select
				ariaLabel="Link action"
				onChange={value => setAction(value as HarloweLinkAction)}
				options={[
					{label: 'Go to a passage', value: 'goto'},
					{label: 'Undo the current turn', value: 'undo'},
					{label: 'Reveal prose', value: 'reveal'},
					{label: 'Cycle through link text', value: 'cycle'}
				]}
				value={action}
			/>
			{action === 'goto' && (
				<Input
					block
					label="Go to passage"
					onChange={event => setPassage(event.target.value)}
					value={passage}
				/>
			)}
			{(action === 'goto' || action === 'undo') && (
				<div className="harlowe-native-field-row">
					<Select
						ariaLabel="Departing transition"
						onChange={setDepartingTransition}
						options={transitionOptions}
						value={departingTransition}
					/>
					<Select
						ariaLabel="Arriving transition"
						onChange={setArrivingTransition}
						options={transitionOptions}
						value={arrivingTransition}
					/>
				</div>
			)}
			{action === 'reveal' && (
				<>
					<Select
						ariaLabel="Reveal extent"
						onChange={value => setRemainder(value === 'remainder')}
						options={[
							{label: 'An attached hook', value: 'hook'},
							{
								label: 'The remainder of the passage',
								value: 'remainder'
							}
						]}
						value={remainder ? 'remainder' : 'hook'}
					/>
					<Select
						ariaLabel="Reveal behavior"
						disabled={clickPage}
						onChange={value =>
							setRevealBehavior(value as HarloweRevealBehavior)
						}
						options={[
							{
								label: "Remove the link's own text",
								value: 'link'
							},
							{
								label: "Unlink the link's own text",
								value: 'link-reveal'
							},
							{
								label: 'Re-run the hook each click',
								value: 'link-rerun'
							},
							{
								label: 'Repeat the hook each click',
								value: 'link-repeat'
							}
						]}
						value={revealBehavior}
					/>
					<Select
						ariaLabel="Revealed text transition"
						onChange={setRevealedTransition}
						options={transitionOptions}
						value={revealedTransition}
					/>
				</>
			)}
			{action === 'cycle' && (
				<>
					<label>
						Alternative link text, one per line
						<textarea
							onChange={event => setCycleOptions(event.target.value)}
							value={cycleOptions}
						/>
					</label>
					<Select
						ariaLabel="Upon reaching the end"
						onChange={value =>
							setCycleEnd(value as 'loop' | 'remove' | 'unlink')
						}
						options={[
							{label: 'Loop to the start', value: 'loop'},
							{label: 'Remove the link', value: 'remove'},
							{label: 'Unlink the link', value: 'unlink'}
						]}
						value={cycleEnd}
					/>
				</>
			)}
			{action !== 'cycle' && (
				<Input
					label="Transition time (seconds)"
					max={999}
					min={0}
					onChange={event => setTransitionTime(+event.target.value)}
					step={0.1}
					type="number"
					value={transitionTime}
				/>
			)}
			<PanelActions
				disabled={
					(!clickPage && !text) ||
					(action === 'goto' && !passage) ||
					(action === 'cycle' &&
						(clickPage ||
							cycleOptions.split('\n').length === 0 ||
							!cycleOptions.split('\n').every(Boolean)))
				}
				onApply={() => {
					wrapNativeEditorSelections(
						editor,
						harloweLinkWrapper({
							action,
							arrivingTransition,
							clickPage,
							cycleEnd,
							cycleOptions: cycleOptions.split('\n'),
							departingTransition,
							passage,
							remainder,
							revealBehavior,
							revealedTransition,
							text,
							transitionTime
						})
					);
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function IfPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [mode, setMode] = React.useState('visits');
	const [comparison, setComparison] = React.useState('exactly');
	const [namedCount, setNamedCount] = React.useState(1);
	const [visitCount, setVisitCount] = React.useState(0);
	const [delay, setDelay] = React.useState(2);
	const [elseIf, setElseIf] = React.useState(false);
	const [name, setName] = React.useState('');
	const [operator, setOperator] = React.useState('is');
	const [parity, setParity] = React.useState('even');
	const [remainder, setRemainder] = React.useState(false);
	const [temporary, setTemporary] = React.useState(false);
	const [value, setValue] = React.useState('0');
	const [variable, setVariable] = React.useState('');

	function changer() {
		let macro = 'if';
		let expression = '';

		switch (mode) {
			case 'delay':
				macro = 'after';
				expression = `${delay}s`;
				break;
			case 'more':
				macro = 'more';
				break;
			case 'parity':
				expression = `visits is an ${parity}`;
				break;
			case 'passage':
				expression = harloweVisitComparison(
					`(history: where its name contains ${quoted(name)})'s length`,
					comparison,
					namedCount
				);
				break;
			case 'tag':
				expression = harloweVisitComparison(
					`(history: where (passage:it)'s tags contains ${quoted(
						name
					)})'s length`,
					comparison,
					namedCount
				);
				break;
			case 'variable':
				expression = `${temporary ? '_' : '$'}${variable} ${
					{
						'is greater than': '>',
						'is less than': '<'
					}[operator] ?? operator
				} ${value}`;
				break;
			default:
				expression = harloweVisitComparison('visits', comparison, visitCount);
		}

		const source = `(${macro}:${expression})`;

		if (!elseIf) {
			return source;
		}

		return macro === 'if' ? `(else-if:${expression})` : `${source}+(else:)`;
	}

	const valid =
		(mode !== 'passage' && mode !== 'tag' && mode !== 'variable') ||
		(mode === 'variable'
			? /^[A-Za-z_]\w*$/.test(variable) && !!value.trim()
			: !!name);

	return (
		<PanelShell label="If" onClose={onClose}>
			<p>
				<strong>Only show prose if this condition is met:</strong>
			</p>
			<Select
				ariaLabel="Condition"
				block
				onChange={setMode}
				options={[
					{label: 'Visits to this passage', value: 'visits'},
					{label: 'Even or odd visits', value: 'parity'},
					{label: 'Time after entering', value: 'delay'},
					{label: 'Visits to a named passage', value: 'passage'},
					{label: 'Visits to passages with a tag', value: 'tag'},
					{label: 'No interactable elements remain', value: 'more'},
					{label: 'Compare a variable with a value', value: 'variable'}
				]}
				value={mode}
			/>
			{(mode === 'visits' || mode === 'passage' || mode === 'tag') && (
				<div className="harlowe-native-field-row">
					{mode !== 'visits' && (
						<Input
							label={mode === 'passage' ? 'Passage name' : 'Tag name'}
							onChange={event => setName(event.target.value)}
							value={name}
						/>
					)}
					<Select
						ariaLabel="Comparison"
						onChange={setComparison}
						options={[
							'exactly',
							'at most',
							'at least',
							'anything but',
							'a multiple of'
						]}
						value={comparison}
					/>
					<Input
						label="Times"
						max={999}
						min={mode === 'visits' ? 0 : 1}
						onChange={event =>
							mode === 'visits'
								? setVisitCount(+event.target.value)
								: setNamedCount(+event.target.value)
						}
						type="number"
						value={mode === 'visits' ? visitCount : namedCount}
					/>
				</div>
			)}
			{mode === 'parity' && (
				<Select
					ariaLabel="Visit parity"
					onChange={setParity}
					options={['even', 'odd']}
					value={parity}
				/>
			)}
			{mode === 'delay' && (
				<Input
					label="Seconds"
					max={999}
					min={1}
					onChange={event => setDelay(+event.target.value)}
					type="number"
					value={delay}
				/>
			)}
			{mode === 'variable' && (
				<>
					<div className="harlowe-native-field-row">
						<Select
							ariaLabel="Variable scope"
							onChange={value => setTemporary(value === '_')}
							options={[
								{label: 'Story variable $', value: '$'},
								{label: 'Temporary variable _', value: '_'}
							]}
							value={temporary ? '_' : '$'}
						/>
						<Input
							label="Variable name"
							onChange={event => setVariable(event.target.value)}
							value={variable}
						/>
						<Select
							ariaLabel="Variable comparison"
							onChange={setOperator}
							options={[
								'is',
								'is not',
								'is greater than',
								'is less than',
								'contains',
								'is in'
							]}
							value={operator}
						/>
					</div>
					<Input
						block
						label="Harlowe value expression"
						mono
						onChange={event => setValue(event.target.value)}
						value={value}
					/>
				</>
			)}
			<div className="harlowe-native-option-grid">
				<Checkbox
					checked={elseIf}
					label="Only if the previous conditional hook was not fulfilled"
					onChange={setElseIf}
				/>
				<Checkbox
					checked={remainder}
					label="Affect the entire remainder of the passage or hook"
					onChange={setRemainder}
				/>
			</div>
			<PanelActions
				disabled={!valid}
				onApply={() => {
					wrapNativeEditorSelections(editor, {
						after: remainder ? '' : ']',
						before: `${changer()}${remainder ? '[=\n' : '['}`,
						placeholder: 'Conditional Text'
					});
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function InputPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [initial, setInitial] = React.useState('');
	const [kind, setKind] = React.useState('text box');
	const [label, setLabel] = React.useState('Checkbox');
	const [options, setOptions] = React.useState('First option\nSecond option');
	const [placement, setPlacement] = React.useState(5);
	const [rows, setRows] = React.useState(3);
	const [temporary, setTemporary] = React.useState(false);
	const [variable, setVariable] = React.useState('');
	const [width, setWidth] = React.useState(5);
	const optionLines = options.split('\n');

	function source() {
		const binding = variable.trim()
			? `${temporary ? '_' : '$'}${variable.trim()}`
			: undefined;

		switch (kind) {
			case 'dropdown':
				return `(dropdown:${binding ? `2bind ${binding},` : ''}${options
					.split('\n')
					.map(quoted)
					.join(',')})`;
			case 'checkbox':
				return `(checkbox:2bind ${binding},${quoted(label)})`;
			case 'dialog':
				return `(dialog:${binding ? `bind ${binding},` : ''}${quoted(
					initial
				)},${options.split('\n').filter(Boolean).map(quoted).join(',')})`;
			case 'force text box':
				return harloweInputBoxSource({
					binding,
					forced: true,
					initialText: initial,
					placement,
					rows,
					width
				});
			default:
				return harloweInputBoxSource({
					binding,
					forced: false,
					initialText: initial,
					placement,
					rows,
					width
				});
		}
	}

	return (
		<PanelShell label="Input" onClose={onClose}>
			{(kind === 'text box' || kind === 'force text box') && (
				<Preview label="Input box preview">
					<textarea
						aria-label="Sample input box"
						defaultValue="You can type sample text into this preview box."
						rows={rows}
						style={{
							marginLeft: `${(1 - width / 10) * placement * 10}%`,
							marginRight: `${(1 - width / 10) * (10 - placement) * 10}%`,
							width: `${width * 10}%`
						}}
					/>
				</Preview>
			)}
			<Select
				ariaLabel="Input type"
				onChange={setKind}
				options={[
					'text box',
					'force text box',
					'dropdown',
					'checkbox',
					'dialog'
				]}
				value={kind}
			/>
			<div className="harlowe-native-field-row">
				<Select
					ariaLabel="Bound variable scope"
					onChange={value => setTemporary(value === '_')}
					options={[
						{label: 'Story variable $', value: '$'},
						{label: 'Temporary variable _', value: '_'}
					]}
					value={temporary ? '_' : '$'}
				/>
				<Input
					label="Bound variable (optional)"
					mono
					onChange={event => setVariable(event.target.value)}
					value={variable}
				/>
			</div>
			{(kind === 'text box' || kind === 'force text box') && (
				<div className="harlowe-native-field-row">
					<Input
						label="Placement"
						max={10}
						min={0}
						onChange={event => setPlacement(+event.target.value)}
						type="range"
						value={placement}
					/>
					<Input
						label="Width"
						max={10}
						min={1}
						onChange={event => setWidth(+event.target.value)}
						type="range"
						value={width}
					/>
					<Input
						label="Rows"
						max={9}
						min={1}
						onChange={event => setRows(+event.target.value)}
						type="number"
						value={rows}
					/>
				</div>
			)}
			{(kind === 'text box' ||
				kind === 'force text box' ||
				kind === 'dialog') && (
				<Input
					block
					label={kind === 'dialog' ? 'Dialog text' : 'Initial text'}
					onChange={event => setInitial(event.target.value)}
					value={initial}
				/>
			)}
			{(kind === 'dropdown' || kind === 'dialog') && (
				<label>
					{kind === 'dialog'
						? 'Dialog link options, one per line'
						: 'Options, one per line'}
					<textarea
						onChange={event => setOptions(event.target.value)}
						value={options}
					/>
				</label>
			)}
			{kind === 'checkbox' && (
				<Input
					block
					label="Checkbox label"
					onChange={event => setLabel(event.target.value)}
					value={label}
				/>
			)}
			<PanelActions
				disabled={
					(!!variable && !/^[A-Za-z_]\w*$/.test(variable)) ||
					(kind === 'checkbox' && !variable) ||
					(kind === 'force text box' && !initial) ||
					(kind === 'dropdown' && !optionLines.some(Boolean)) ||
					(kind === 'dialog' &&
						(optionLines.length === 0 || !optionLines.every(Boolean)))
				}
				onApply={() => {
					insertTemplate(editor, source());
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function HookPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [name, setName] = React.useState('');

	return (
		<PanelShell label="Hook" onClose={onClose}>
			<Input
				block
				label="Hook name (optional)"
				onChange={event => setName(event.target.value)}
				value={name}
			/>
			{name &&
				(['link', 'page', 'passage', 'sidebar'].includes(name.toLowerCase()) ? (
					<p role="alert">This name is reserved by Harlowe.</p>
				) : (
					<p>
						Refer to this hook as <code>?{name}</code>.
					</p>
				))}
			<PanelActions
				disabled={!!name && !/^[A-Za-z_]\w*$/.test(name)}
				onApply={() => {
					wrapNativeEditorSelections(editor, {
						after: ']',
						before: name ? `|${name}>[` : '[',
						placeholder: 'Hook Text'
					});
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function ValuePanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [booleanValue, setBooleanValue] = React.useState('false');
	const [colour, setColour] = React.useState('#ffffff');
	const [colourOpacity, setColourOpacity] = React.useState(1);
	const [expression, setExpression] = React.useState('0');
	const [items, setItems] = React.useState('"first"\n"second"');
	const [mapItems, setMapItems] = React.useState('name = "Ada"\nscore = 0');
	const [maximum, setMaximum] = React.useState(10);
	const [minimum, setMinimum] = React.useState(0);
	const [numberValue, setNumberValue] = React.useState('0');
	const [otherTemporary, setOtherTemporary] = React.useState(false);
	const [otherVariable, setOtherVariable] = React.useState('');
	const [temporary, setTemporary] = React.useState(false);
	const [textValue, setTextValue] = React.useState('');
	const [type, setType] = React.useState('coded expression');
	const [variable, setVariable] = React.useState('score');

	function valueSource() {
		const valueItems = items.split('\n').filter(Boolean);

		switch (type) {
			case 'text string':
				return quoted(textValue);
			case 'number':
				return numberValue;
			case 'Boolean value':
				return booleanValue;
			case 'colour':
				return harloweColour(colour, colourOpacity);
			case 'array':
				return `(a:${valueItems.join(',')})`;
			case 'datamap': {
				const pairs = mapItems
					.split('\n')
					.filter(Boolean)
					.map(row => {
						const separator = row.indexOf('=');

						if (separator === -1) {
							return '';
						}

						return `${quoted(row.slice(0, separator).trim())},${row
							.slice(separator + 1)
							.trim()}`;
					});

				return `(dm:${pairs.join(',')})`;
			}
			case 'randomly chosen value':
				return `(either:${valueItems.join(',')})`;
			case 'random number':
				return `(random:${minimum},${maximum})`;
			case 'itself + value':
				return `it + ${expression}`;
			case 'variable + value':
				return `${otherTemporary ? '_' : '$'}${otherVariable} + ${expression}`;
			default:
				return expression;
		}
	}

	const value = valueSource();
	const valid =
		/^[A-Za-z_]\w*$/.test(variable) &&
		!!value.trim() &&
		(type !== 'array' && type !== 'randomly chosen value'
			? true
			: items.split('\n').filter(Boolean).length > 0) &&
		(type !== 'datamap'
			? true
			: mapItems
					.split('\n')
					.filter(Boolean)
					.every(row => row.includes('=') && row.split('=')[0].trim())) &&
		(type !== 'variable + value' || /^[A-Za-z_]\w*$/.test(otherVariable));

	return (
		<PanelShell label="Value" onClose={onClose}>
			<Input
				block
				label="Variable name"
				onChange={event => setVariable(event.target.value)}
				value={variable}
			/>
			<Select
				ariaLabel="Value type"
				block
				onChange={setType}
				options={[
					'text string',
					'number',
					'Boolean value',
					'colour',
					'array',
					'datamap',
					'randomly chosen value',
					'random number',
					'itself + value',
					'variable + value',
					'coded expression'
				]}
				value={type}
			/>
			{type === 'text string' && (
				<Input
					block
					label="Text"
					onChange={event => setTextValue(event.target.value)}
					value={textValue}
				/>
			)}
			{type === 'number' && (
				<Input
					block
					label="Number"
					mono
					onChange={event => setNumberValue(event.target.value)}
					value={numberValue}
				/>
			)}
			{type === 'Boolean value' && (
				<Select
					ariaLabel="Boolean value"
					onChange={setBooleanValue}
					options={['false', 'true']}
					value={booleanValue}
				/>
			)}
			{type === 'colour' && (
				<div className="harlowe-native-field-row">
					<input
						aria-label="Colour"
						onChange={event => setColour(event.target.value)}
						type="color"
						value={colour}
					/>
					<Input
						aria-label="Colour opacity"
						max={1}
						min={0}
						onChange={event => setColourOpacity(+event.target.value)}
						step={0.05}
						type="range"
						value={colourOpacity}
					/>
				</div>
			)}
			{(type === 'array' || type === 'randomly chosen value') && (
				<label>
					Harlowe values, one expression per line
					<textarea
						onChange={event => setItems(event.target.value)}
						value={items}
					/>
				</label>
			)}
			{type === 'datamap' && (
				<label>
					Data names and Harlowe values, one <code>name = value</code> pair per
					line
					<textarea
						onChange={event => setMapItems(event.target.value)}
						value={mapItems}
					/>
				</label>
			)}
			{type === 'random number' && (
				<div className="harlowe-native-field-row">
					<Input
						label="From"
						onChange={event => setMinimum(+event.target.value)}
						type="number"
						value={minimum}
					/>
					<Input
						label="To"
						onChange={event => setMaximum(+event.target.value)}
						type="number"
						value={maximum}
					/>
				</div>
			)}
			{type === 'variable + value' && (
				<div className="harlowe-native-field-row">
					<Select
						ariaLabel="Other variable scope"
						onChange={value => setOtherTemporary(value === '_')}
						options={[
							{label: 'Story variable $', value: '$'},
							{label: 'Temporary variable _', value: '_'}
						]}
						value={otherTemporary ? '_' : '$'}
					/>
					<Input
						label="Other variable"
						onChange={event => setOtherVariable(event.target.value)}
						value={otherVariable}
					/>
				</div>
			)}
			{(type === 'coded expression' ||
				type === 'itself + value' ||
				type === 'variable + value') && (
				<Input
					block
					label={
						type === 'coded expression' ? 'Harlowe expression' : 'Value to add'
					}
					mono
					onChange={event => setExpression(event.target.value)}
					value={expression}
				/>
			)}
			<Checkbox
				checked={temporary}
				label="Temporary variable"
				onChange={setTemporary}
			/>
			<PanelActions
				disabled={!valid}
				onApply={() => {
					insertTemplate(
						editor,
						`(set: ${temporary ? '_' : '$'}${variable} to ${value})`
					);
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function MacroPanel({
	editor,
	onClose
}: {
	editor: NativeEditorHost;
	onClose: () => void;
}) {
	const [name, setName] = React.useState('print');
	const definition = macroDefinitions.find(item => item.name === name);

	return (
		<PanelShell label="List All Macros" onClose={onClose}>
			<Select
				ariaLabel="Macro"
				block
				onChange={setName}
				options={macroDefinitions.map(item => ({
					label: `${item.name} — ${item.returnType}`,
					value: item.name
				}))}
				value={name}
			/>
			{definition && (
				<div className="harlowe-native-macro-help">
					<code>
						({definition.name}:{definition.sig}) → {definition.returnType}
					</code>
					<p>{definition.abstract}</p>
					<a
						href={`https://twine2.neocities.org/#${definition.anchor}`}
						rel="noopener noreferrer"
						target="_blank"
					>
						Open documentation
					</a>
				</div>
			)}
			<PanelActions
				onApply={() => {
					insertTemplate(editor, `(${name}:Your Code Here)`, {
						from: name.length + 2,
						to: name.length + 16
					});
					onClose();
				}}
				onClose={onClose}
			/>
		</PanelShell>
	);
}

function PreferencesPanel({
	onChange,
	onClose,
	preferences
}: {
	onChange: NativeEditorToolbarProps['onChangePreferences'];
	onClose: () => void;
	preferences: NativeEditorToolbarProps['preferences'];
}) {
	return (
		<PanelShell label="Harlowe Editor Preferences" onClose={onClose}>
			<Checkbox
				checked={preferences.completionsForMacros}
				label="Complete macro names"
				onChange={value =>
					onChange({...preferences, completionsForMacros: value})
				}
			/>
			<Checkbox
				checked={preferences.completionsForKeywords}
				label="Complete keywords"
				onChange={value =>
					onChange({...preferences, completionsForKeywords: value})
				}
			/>
			<Checkbox
				checked={preferences.codeUsesCodeFont}
				label="Macro code uses the Code Editor Font"
				onChange={value => onChange({...preferences, codeUsesCodeFont: value})}
			/>
		</PanelShell>
	);
}

function FindPanel({
	controller,
	editor,
	onClose
}: Pick<NativeEditorToolbarProps, 'controller' | 'editor'> & {
	onClose: () => void;
}) {
	const selected = editor.getSnapshot().selections[0];
	const initialQuery = selected
		? editor
				.getSnapshot()
				.document.slice(
					Math.min(selected.anchor, selected.head),
					Math.max(selected.anchor, selected.head)
				)
		: '';
	const [matchCase, setMatchCase] = React.useState(false);
	const [query, setQuery] = React.useState(initialQuery);
	const [replacement, setReplacement] = React.useState('');
	const [scope, setScope] =
		React.useState<NativeEditorFindOptions['scope']>('everywhere');
	const [useRegExp, setUseRegExp] = React.useState(false);
	const [result, setResult] = React.useState(() => controller.getFindResult());
	const options = React.useMemo(
		() => ({matchCase, query, scope, useRegExp}),
		[matchCase, query, scope, useRegExp]
	);
	React.useEffect(() => {
		setResult(controller.find(options));
	}, [controller, options]);
	React.useEffect(
		() => controller.subscribe(() => setResult(controller.getFindResult())),
		[controller]
	);
	React.useEffect(() => () => controller.clearFind(), [controller]);

	return (
		<PanelShell
			label="Find and Replace"
			onClose={() => {
				controller.clearFind();
				onClose();
			}}
		>
			<Input
				block
				invalid={result.invalidPattern}
				label="Find"
				mono={useRegExp}
				onChange={event => setQuery(event.target.value)}
				value={query}
			/>
			<Input
				block
				label="Replace"
				mono={useRegExp}
				onChange={event => setReplacement(event.target.value)}
				value={replacement}
			/>
			<div className="harlowe-native-field-row">
				<Checkbox
					checked={matchCase}
					label="Match case"
					onChange={setMatchCase}
				/>
				<Checkbox
					checked={useRegExp}
					label="Regular expression"
					onChange={setUseRegExp}
				/>
				<Select
					ariaLabel="Find scope"
					onChange={value =>
						setScope(value as NativeEditorFindOptions['scope'])
					}
					options={[
						{label: 'Everywhere', value: 'everywhere'},
						{label: 'Only in prose', value: 'prose'},
						{label: 'Only in code', value: 'code'},
						{label: 'Only in selection', value: 'selection'}
					]}
					value={scope}
				/>
			</div>
			<p aria-live="polite">
				{result.count
					? `${result.index + 1} of ${result.count} results`
					: 'No results'}
			</p>
			<div className="harlowe-native-panel-actions">
				<Button
					disabled={!result.count}
					onClick={() => setResult(controller.findNext(-1))}
					size="sm"
				>
					Previous
				</Button>
				<Button
					disabled={!result.count}
					onClick={() => setResult(controller.findNext(1))}
					size="sm"
				>
					Next
				</Button>
				<Button
					disabled={!result.count}
					onClick={() => setResult(controller.replaceCurrent(replacement))}
					size="sm"
				>
					Replace
				</Button>
				<Button
					disabled={!result.count}
					onClick={() => setResult(controller.replaceAll(replacement))}
					size="sm"
				>
					Replace All
				</Button>
			</div>
		</PanelShell>
	);
}

function PanelActions({
	disabled,
	onApply,
	onClose
}: {
	disabled?: boolean;
	onApply: () => void;
	onClose: () => void;
}) {
	return (
		<div className="harlowe-native-panel-actions">
			<Button onClick={onClose} size="sm">
				Cancel
			</Button>
			<Button disabled={disabled} onClick={onApply} size="sm" variant="primary">
				Apply
			</Button>
		</div>
	);
}

export const HarloweToolbar: React.FC<NativeEditorToolbarProps> = ({
	controller,
	editor,
	onChangePreferences,
	preferences
}) => {
	const [panel, setPanel] = React.useState<Panel>();
	const [, refresh] = React.useReducer(value => value + 1, 0);
	const closePanel = React.useCallback(() => setPanel(undefined), []);

	React.useEffect(
		() =>
			controller.subscribe(() => {
				if (controller.takeRequestedPanel() === 'find') {
					setPanel('find');
				}
				refresh();
			}),
		[controller]
	);

	function wrap(before: string, after: string, placeholder: string) {
		wrapNativeEditorSelections(editor, {after, before, placeholder});
	}

	// The shared menu closes from a document-level click listener. Defer editor
	// mutations until that click has finished so the menu teardown cannot
	// interrupt CodeMirror's selection transaction.
	function wrapFromMenu(before: string, after: string, placeholder: string) {
		window.setTimeout(() => wrap(before, after, placeholder), 0);
	}

	function verbatim() {
		const snapshot = editor.getSnapshot();
		let longest = 0;

		for (const selection of snapshot.selections) {
			for (const match of snapshot.document
				.slice(
					Math.min(selection.anchor, selection.head),
					Math.max(selection.anchor, selection.head)
				)
				.matchAll(/`+/g)) {
				longest = Math.max(longest, match[0].length);
			}
		}

		const delimiter = '`'.repeat(longest + 1);

		wrap(delimiter, delimiter, 'Verbatim Text');
	}

	const panelProps = {editor, onClose: closePanel};

	return (
		<>
			<div
				aria-label="Harlowe editor toolbar"
				className="story-format-toolbar harlowe-native-toolbar"
				role="toolbar"
			>
				<ButtonBar>
					<MenuButton
						icon={icon('typography')}
						items={[
							{
								label: 'Bold [Ctrl+B]',
								onClick: () => wrapFromMenu("''", "''", 'Bold Text')
							},
							{
								label: 'Italic [Ctrl+I]',
								onClick: () => wrapFromMenu('//', '//', 'Italic Text')
							},
							{
								label: 'Strikethrough [Ctrl+-]',
								onClick: () => wrapFromMenu('~~', '~~', 'Strikethrough Text')
							},
							{
								label: 'Superscript [Ctrl+.]',
								onClick: () => wrapFromMenu('^^', '^^', 'Superscript Text')
							},
							{separator: true},
							{label: 'More Styles…', onClick: () => setPanel('styles')}
						]}
						label="Styles"
					/>
					<IconButton
						icon={icon('palette')}
						label="Colours"
						onClick={() => setPanel('colour')}
					/>
					<IconButton
						icon={icon('border-style')}
						label="Borders"
						onClick={() => setPanel('borders')}
					/>
					<IconButton
						icon={icon('rotate')}
						label="Rotated text"
						onClick={() => setPanel('rotate')}
					/>
					<MenuButton
						icon={icon('list')}
						items={[
							{
								label: 'Bulleted List Item',
								onClick: () => wrapFromMenu('\n* ', '', '')
							},
							{
								label: 'Numbered List Item',
								onClick: () => wrapFromMenu('\n0. ', '', '')
							},
							{
								label: 'Heading',
								onClick: () => wrapFromMenu('\n#', '', 'Heading Text')
							},
							{
								label: 'Horizontal Rule',
								onClick: () => wrapFromMenu('\n---\n', '', '')
							}
						]}
						label="List and line items"
					/>
					<MenuButton
						icon={icon('layout-columns')}
						items={[
							{label: 'Alignment', onClick: () => setPanel('align')},
							{label: 'Columns', onClick: () => setPanel('columns')}
						]}
						label="Alignment and columns"
					/>
					<IconButton
						icon={<strong>{'{}'}</strong>}
						label="Collapse Whitespace (In-Game)"
						onClick={() => setPanel('collapse')}
					/>
					<IconButton
						icon={<span>Vb</span>}
						label="Verbatim (Ignore All Markup Inside)"
						onClick={verbatim}
					/>
					<IconButton
						icon={<strong>{'<!--'}</strong>}
						label="HTML Comments (Not Run In-Game)"
						onClick={() => wrap('<!--', '-->', 'Comment Text')}
					/>
					<MenuButton
						icon={<span>(Macro:)</span>}
						items={[
							{label: 'Link…', onClick: () => setPanel('link')},
							{label: 'If…', onClick: () => setPanel('if')},
							{label: 'Input…', onClick: () => setPanel('input')},
							{label: 'Hook…', onClick: () => setPanel('hook')},
							{label: 'Value…', onClick: () => setPanel('value')},
							{
								label: 'List All Macros…',
								onClick: () => setPanel('macros')
							}
						]}
						label="Macros"
					/>
					<IconButton
						ariaChecked={controller.proofreading}
						icon={icon('eye')}
						label="Proofreading View (dim all code except strings)"
						onClick={() => controller.setProofreading(!controller.proofreading)}
						role="switch"
						selectable
						selected={controller.proofreading}
					/>
					<IconButton
						ariaChecked={preferences.codingTooltips}
						icon={icon('message')}
						label="Coding Tooltips (when the cursor rests on code structures)"
						onClick={() =>
							onChangePreferences({
								...preferences,
								codingTooltips: !preferences.codingTooltips
							})
						}
						role="switch"
						selectable
						selected={preferences.codingTooltips}
					/>
					<IconButton
						icon={icon('search')}
						label="Find and Replace"
						onClick={() => setPanel('find')}
					/>
					<IconButton
						icon={<strong>?</strong>}
						label="Show Manual (opens a new tab)"
						onClick={() =>
							window.open(
								'https://twine2.neocities.org/',
								'Harlowe Documentation',
								'noopener,noreferrer'
							)
						}
					/>
					<IconButton
						icon={icon('settings')}
						label="Editor Preferences"
						onClick={() => setPanel('preferences')}
					/>
				</ButtonBar>
			</div>
			{panel === 'styles' && <StylesPanel {...panelProps} />}
			{panel === 'colour' && <ColourPanel {...panelProps} />}
			{panel === 'borders' && <BordersPanel {...panelProps} />}
			{panel === 'rotate' && <RotatePanel {...panelProps} />}
			{panel === 'align' && <AlignPanel {...panelProps} />}
			{panel === 'columns' && <ColumnsPanel {...panelProps} />}
			{panel === 'collapse' && <CollapsePanel {...panelProps} />}
			{panel === 'link' && <LinkPanel {...panelProps} />}
			{panel === 'if' && <IfPanel {...panelProps} />}
			{panel === 'input' && <InputPanel {...panelProps} />}
			{panel === 'hook' && <HookPanel {...panelProps} />}
			{panel === 'value' && <ValuePanel {...panelProps} />}
			{panel === 'macros' && <MacroPanel {...panelProps} />}
			{panel === 'preferences' && (
				<PreferencesPanel
					onChange={onChangePreferences}
					onClose={closePanel}
					preferences={preferences}
				/>
			)}
			{panel === 'find' && (
				<FindPanel
					controller={controller}
					editor={editor}
					onClose={closePanel}
				/>
			)}
		</>
	);
};
