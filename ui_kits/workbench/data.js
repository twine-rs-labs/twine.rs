/* Shared fake project: "The Lighthouse" — an interactive-fiction sample.
   Exposes window.TWINE_DATA used by every workbench screen.

   NOTE: every passage x/y is a multiple of GRID (25) so passages land
   exactly on the background grid dots. This is the alignment the real app
   was missing (it snapped to 26px while drawing a 25px grid). */
(function () {
	const GRID = 25;

	const TAGS = {
		intro: 'blue', shore: 'teal', lighthouse: 'yellow',
		keeper: 'purple', sea: 'cyan', ending: 'green',
		flashback: 'orange', danger: 'red'
	};

	// A hand-authored neighborhood shown in the graph viewport.
	// Coordinates are world-space, all multiples of 25.
	const passages = [
		{ id: 1, name: 'Arrival', x: 75, y: 275, tags: ['intro'], links: 2, broken: 0, start: true,
			excerpt: 'The ferry pulls away. Salt wind, a gravel path, and the lighthouse waiting on the bluff.' },
		{ id: 2, name: 'The Gravel Path', x: 350, y: 150, tags: ['shore'], links: 3, broken: 0,
			excerpt: 'Two ruts wind uphill. A gull watches from a leaning fencepost.' },
		{ id: 3, name: 'Tide Pools', x: 350, y: 400, tags: ['shore','sea'], links: 2, broken: 1,
			excerpt: 'Anemones close as your shadow falls. Something glints beneath the water.' },
		{ id: 4, name: 'The Keeper\u2019s Door', x: 650, y: 100, tags: ['lighthouse','keeper'], links: 4, broken: 0,
			excerpt: 'Red paint, blistered by sun. A brass knocker shaped like a fish.' },
		{ id: 5, name: 'Below the Bluff', x: 650, y: 425, tags: ['sea','danger'], links: 2, broken: 0,
			excerpt: 'The rocks are slick. Spray needles your face with every wave.' },
		{ id: 6, name: 'The Lamp Room', x: 950, y: 75, tags: ['lighthouse'], links: 3, broken: 0,
			excerpt: 'The great lens throws fractured light across the walls like a slow kaleidoscope.' },
		{ id: 7, name: 'Marian\u2019s Letters', x: 950, y: 275, tags: ['keeper','flashback'], links: 2, broken: 0,
			excerpt: 'Bundled in oilcloth. The ink has run, but a date survives: October, 1931.' },
		{ id: 8, name: 'The Storm Breaks', x: 950, y: 475, tags: ['sea','danger'], links: 3, broken: 0,
			excerpt: 'Thunder folds the sky shut. The lamp gutters, then steadies.' },
		{ id: 9, name: 'What the Light Kept', x: 1250, y: 175, tags: ['ending'], links: 0, broken: 0,
			excerpt: 'You understand, finally, why the keeper never left.' },
		{ id: 10, name: 'The Long Dark', x: 1250, y: 425, tags: ['ending','danger'], links: 0, broken: 0,
			excerpt: 'The sea takes what it is owed. The light goes out.' }
	];

	const edges = [
		[1,2],[1,3],[2,4],[2,5],[3,5],[4,6],[4,7],[5,8],[6,9],[7,9],[8,9],[8,10],[6,7]
	];

	// File tree for Text mode.
	const tree = [
		{ type: 'file', name: 'twine.toml', icon: 'settings', depth: 0 },
		{ type: 'file', name: 'story.twee', icon: 'file-text', depth: 0 },
		{ type: 'dir', name: 'passages', icon: 'folder', depth: 0, open: true },
		{ type: 'file', name: 'arrival.twee', icon: 'file-text', depth: 1, dirty: true },
		{ type: 'dir', name: 'shore', icon: 'folder', depth: 1, open: true },
		{ type: 'file', name: 'gravel-path.twee', icon: 'file-text', depth: 2 },
		{ type: 'file', name: 'tide-pools.twee', icon: 'file-text', depth: 2, broken: true },
		{ type: 'dir', name: 'lighthouse', icon: 'folder', depth: 1, open: false },
		{ type: 'dir', name: 'scripts', icon: 'folder', depth: 0, open: true },
		{ type: 'file', name: 'story.js', icon: 'braces', depth: 1 },
		{ type: 'dir', name: 'styles', icon: 'folder', depth: 0, open: true },
		{ type: 'file', name: 'story.css', icon: 'hash', depth: 1 },
		{ type: 'dir', name: 'assets', icon: 'folder', depth: 0, open: false },
		{ type: 'dir', name: '.twine', icon: 'folder', depth: 0, open: false }
	];

	// ---- Editable buffers, keyed by a stable buffer id. ------------------
	// A passage buffer, the story JavaScript, and the story Stylesheet.
	// The Stylesheet & JavaScript are STORY-level (one each) — never per
	// passage. The dock enforces that.
	const passageSource = {
		1: [
			':: Arrival {"position":"75,275","size":"100,100"} #intro',
			'',
			'The ferry pulls away behind you, its engine fading into the',
			'grey hush of the water. Ahead, a [[gravel path->The Gravel Path]]',
			'climbs the bluff toward the lighthouse.',
			'',
			'(set: $arrived to true)',
			'(if: $visitedBefore)[You have stood here once before. ]',
			'',
			'You could start up the path, or pick your way down to the',
			'[[tide pools below->Tide Pools]] while the light still holds.',
			'',
			'<!-- TODO: foreshadow the keeper -->'
		],
		2: [
			':: The Gravel Path {"position":"350,150","size":"100,100"} #shore',
			'',
			'The ruts are deep here, cut by a century of cart wheels.',
			'A gull watches you from a [[leaning fencepost->Below the Bluff]].',
			'',
			'(if: $arrived)[The salt is already in your hair.]',
			'',
			'Ahead: the [[keeper\u2019s door->The Keeper\u2019s Door]].'
		],
		4: [
			':: The Keeper\u2019s Door {"position":"650,100","size":"100,100"} #lighthouse #keeper',
			'',
			'Red paint, blistered by sun. A brass knocker shaped like a fish.',
			'',
			'[[Knock->The Lamp Room]]',
			'[[Read the letters wedged in the frame->Marian\u2019s Letters]]'
		]
	};

	// Story JavaScript (one buffer, story-wide).
	const storyJs = [
		'// story.js — runs once before the story starts',
		'window.Story = window.Story || {};',
		'',
		'Story.format = "Harlowe 3.3";',
		'',
		'Story.onStart = function () {',
		'\tconst seen = JSON.parse(localStorage.getItem("seen") || "[]");',
		'\tif (seen.includes("Arrival")) {',
		'\t\tState.variables.visitedBefore = true;',
		'\t}',
		'};',
		'',
		'Macro.add("tide", {',
		'\thandler() {',
		'\t\tconst depth = this.args[0] ?? 0;',
		'\t\treturn this.output.append(`The water is ${depth}m deep.`);',
		'\t}',
		'});'
	];

	// Story Stylesheet (one buffer, story-wide).
	const storyCss = [
		'/* story.css — themes the published story */',
		':root {',
		'\t--paper: #f4efe6;',
		'\t--ink: #1b1714;',
		'\t--sea: #2c5d74;',
		'}',
		'',
		'tw-story {',
		'\tbackground: var(--paper);',
		'\tcolor: var(--ink);',
		'\tfont-family: "Iowan Old Style", Georgia, serif;',
		'\tline-height: 1.62;',
		'}',
		'',
		'tw-link { color: var(--sea); border-bottom: 1px solid currentColor; }',
		'tw-link:hover { background: var(--sea); color: var(--paper); }'
	];

	// Big-project stats shown in the Contents view / status bar.
	const stats = {
		passages: 12483, words: 248917, characters: 1488203, links: 31402,
		broken: 37, orphans: 4, tags: 28, variables: 116, assets: 53
	};

	window.TWINE_DATA = {
		GRID, TAGS, passages, edges, tree,
		passageSource, storyJs, storyCss, stats,
		format: 'Harlowe 3.3'
	};
})();
