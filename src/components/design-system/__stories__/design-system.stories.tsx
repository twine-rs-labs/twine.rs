import * as React from 'react';
import {
	Badge,
	Button,
	Checkbox,
	IconButton,
	Input,
	Panel,
	PassageNode,
	SegmentedControl,
	Select,
	Switch,
	Tag
} from '..';

const main = {title: 'Design System/Primitives'};
export default main;

export const Specimen: React.FC = () => {
	const [mode, setMode] = React.useState('text');
	const [format, setFormat] = React.useState('harlowe');
	const [snap, setSnap] = React.useState(true);
	const [matchCase, setMatchCase] = React.useState(false);

	return (
		<div
			style={{
				background: 'var(--bg-app)',
				color: 'var(--text-body)',
				display: 'grid',
				fontFamily: 'var(--font-ui)',
				gap: 16,
				padding: 20
			}}
		>
			<Panel
				actions={<IconButton icon="refresh" label="Recheck" size="sm" />}
				count={4}
				icon="components"
				pad
				title="Forms"
			>
				<div style={{display: 'flex', flexWrap: 'wrap', gap: 10}}>
					<Button icon="package-export" variant="primary">
						Export HTML
					</Button>
					<Button icon="plus">New Passage</Button>
					<Button icon="trash" variant="danger">
						Delete
					</Button>
					<IconButton icon="command" label="Command palette" solid />
					<Input icon="search" kbd="Cmd K" placeholder="Filter contents" />
					<Select
						onChange={setFormat}
						options={[
							{label: 'Harlowe 3.3', value: 'harlowe'},
							{label: 'SugarCube 2.36', value: 'sugarcube'}
						]}
						value={format}
					/>
					<SegmentedControl
						onChange={setMode}
						options={[
							{value: 'text', label: 'Text', icon: 'file-text'},
							{value: 'graph', label: 'Graph', icon: 'binary-tree'},
							{value: 'split', label: 'Split', icon: 'layout-columns'}
						]}
						value={mode}
					/>
					<Switch checked={snap} label="Snap to grid" onChange={setSnap} />
					<Checkbox
						checked={matchCase}
						label="Match Case"
						onChange={setMatchCase}
					/>
				</div>
			</Panel>
			<Panel icon="tag" pad title="Feedback">
				<div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
					<Badge icon="unlink" tone="error">
						3 broken
					</Badge>
					<Badge dot tone="saved">
						Saved Layout
					</Badge>
					<Badge mono>v3.3.7</Badge>
					<Tag color="green">forest</Tag>
					<Tag color="purple" onRemove={() => undefined}>
						night
					</Tag>
				</div>
			</Panel>
			<Panel icon="binary-tree" pad title="Data">
				<PassageNode
					accent="red"
					broken={1}
					excerpt="The path forks. Two ways lead onward into the dark."
					links={3}
					selected
					start
					tags={['green', 'purple']}
					title="Forest Entrance"
				/>
			</Panel>
		</div>
	);
};
