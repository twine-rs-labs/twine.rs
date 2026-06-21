/* Shared fake project: "The Lighthouse" — an interactive-fiction sample.
   Exposes window.TWINE_DATA used by every workbench screen. */
(function () {
	const TAGS = {
		intro: 'blue', shore: 'teal', lighthouse: 'yellow',
		keeper: 'purple', sea: 'cyan', ending: 'green',
		flashback: 'orange', danger: 'red'
	};

	// A hand-authored neighborhood shown in the graph viewport.
	const passages = [
		{ id: 1, name: 'Arrival', x: 60, y: 200, tags: ['intro'], links: 2, broken: 0, start: true,
			excerpt: 'The ferry pulls away. Salt wind, a gravel path, and the lighthouse waiting on the bluff.' },
		{ id: 2, name: 'The Gravel Path', x: 300, y: 120, tags: ['shore'], links: 3, broken: 0,
			excerpt: 'Two ruts wind uphill. A gull watches from a leaning fencepost.' },
		{ id: 3, name: 'Tide Pools', x: 300, y: 300, tags: ['shore','sea'], links: 2, broken: 1,
			excerpt: 'Anemones close as your shadow falls. Something glints beneath the water.' },
		{ id: 4, name: 'The Keeper\u2019s Door', x: 560, y: 90, tags: ['lighthouse','keeper'], links: 4, broken: 0,
			excerpt: 'Red paint, blistered by sun. A brass knocker shaped like a fish.' },
		{ id: 5, name: 'Below the Bluff', x: 560, y: 320, tags: ['sea','danger'], links: 2, broken: 0,
			excerpt: 'The rocks are slick. Spray needles your face with every wave.' },
		{ id: 6, name: 'The Lamp Room', x: 820, y: 70, tags: ['lighthouse'], links: 3, broken: 0,
			excerpt: 'The great lens throws fractured light across the walls like a slow kaleidoscope.' },
		{ id: 7, name: 'Marian\u2019s Letters', x: 820, y: 220, tags: ['keeper','flashback'], links: 2, broken: 0,
			excerpt: 'Bundled in oilcloth. The ink has run, but a date survives: October, 1931.' },
		{ id: 8, name: 'The Storm Breaks', x: 820, y: 380, tags: ['sea','danger'], links: 3, broken: 0,
			excerpt: 'Thunder folds the sky shut. The lamp gutters, then steadies.' },
		{ id: 9, name: 'What the Light Kept', x: 1080, y: 150, tags: ['ending'], links: 0, broken: 0,
			excerpt: 'You understand, finally, why the keeper never left.' },
		{ id: 10, name: 'The Long Dark', x: 1080, y: 320, tags: ['ending','danger'], links: 0, broken: 0,
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

	// Source lines for the open passage (Arrival).
	const source = [
		':: Arrival {"position":"60,200","size":"100,100"} #intro',
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
	];

	// Big-project stats shown in the Contents view / status bar.
	const stats = {
		passages: 12483, words: 248917, characters: 1488203, links: 31402,
		broken: 37, orphans: 4, tags: 28, variables: 116, assets: 53
	};

	window.TWINE_DATA = { TAGS, passages, edges, tree, source, stats };
})();
