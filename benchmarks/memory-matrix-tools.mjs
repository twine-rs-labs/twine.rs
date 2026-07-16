const matrixSizes = [100, 10_000, 50_000];
const primaryMetric = 'memory.private.projectBearingMiB';

export function selectLatestMemoryMatrixReports(
	candidates,
	{requireClean = false} = {}
) {
	const cohorts = new Map();

	for (const candidate of candidates) {
		const {report} = candidate;
		const git = report.environment?.git;

		if (
			report.phase !== 'startup' ||
			report.smoke ||
			report.test?.status !== 'passed' ||
			report.evaluation?.passed !== true ||
			report.environment?.metricContracts?.memoryAttribution !== 1 ||
			!matrixSizes.includes(report.fixture?.passageCount) ||
			typeof git?.revision !== 'string' ||
			typeof git?.dirty !== 'boolean' ||
			(requireClean && git.dirty !== false)
		) {
			continue;
		}
		const key = JSON.stringify([
			report.environment?.fingerprint,
			git.revision,
			git.dirty
		]);
		const cohort = cohorts.get(key) ?? new Map();
		const size = report.fixture.passageCount;
		const existing = cohort.get(size);

		if (!existing || report.createdAt > existing.report.createdAt) {
			cohort.set(size, candidate);
		}
		cohorts.set(key, cohort);
	}

	const complete = [...cohorts.values()]
		.filter(cohort => matrixSizes.every(size => cohort.has(size)))
		.map(cohort => {
			const inputs = matrixSizes.map(size => cohort.get(size));
			const oldestCreatedAt = inputs.reduce(
				(oldest, input) =>
					oldest < input.report.createdAt ? oldest : input.report.createdAt,
				inputs[0].report.createdAt
			);

			return {inputs, oldestCreatedAt};
		})
		.sort((left, right) =>
			right.oldestCreatedAt.localeCompare(left.oldestCreatedAt)
		);

	if (!complete[0]) {
		throw new Error(
			'No complete same-revision 100/10k/50k startup cohort was found.'
		);
	}

	return complete[0].inputs;
}

function metric(report, name, stat = 'p50') {
	return report.aggregates?.[name]?.[stat];
}

function finiteMetric(report, name, stat = 'p50') {
	const value = metric(report, name, stat);

	return Number.isFinite(value) ? value : undefined;
}

function metricMap(report, prefix) {
	return Object.fromEntries(
		Object.keys(report.aggregates ?? {})
			.filter(name => name.startsWith(prefix))
			.map(name => [name.slice(prefix.length), finiteMetric(report, name)])
			.filter(([, value]) => value !== undefined)
	);
}

function profile(report, sourceFile) {
	const median = finiteMetric(report, primaryMetric);
	const minimum = finiteMetric(report, primaryMetric, 'min');
	const maximum = finiteMetric(report, primaryMetric, 'max');
	const repeatabilityLimitMiB = Math.max(32, (median ?? 0) * 0.1);
	const spreadMiB =
		minimum === undefined || maximum === undefined
			? undefined
			: maximum - minimum;

	return {
		blinkAllocatedMiB: finiteMetric(report, 'memory.blink.allocatedMiB'),
		footprintCategoriesMiB: metricMap(report, 'footprint.category.'),
		footprintProcessesMiB: metricMap(report, 'footprint.process.'),
		footprintTotalMiB: finiteMetric(report, 'footprint.totalMiB'),
		knownOwnerMiB: finiteMetric(report, 'memory.private.knownOwnerMiB'),
		mainHeapMiB: finiteMetric(report, 'memory.heap.mainUsedMiB'),
		mainPrivateMiB: finiteMetric(report, 'memory.private.mainMiB'),
		passageCount: report.fixture.passageCount,
		projectBearingPrivateMiB: median,
		rendererHeapMiB: finiteMetric(report, 'memory.heap.rendererUsedMiB'),
		rendererPrivateMiB: finiteMetric(report, 'memory.private.rendererMiB'),
		repeatability: {
			limitMiB: repeatabilityLimitMiB,
			passed: spreadMiB !== undefined && spreadMiB <= repeatabilityLimitMiB,
			sampleCount: report.aggregates?.[primaryMetric]?.count,
			spreadMiB
		},
		sourceFile,
		workerWasmMiB: finiteMetric(report, 'memory.owner.workerWasmLinearMiB')
	};
}

export function createMemoryMatrix(
	reports,
	{requireClean = false, sourceFiles = []} = {}
) {
	if (reports.length !== matrixSizes.length) {
		throw new Error(
			`Memory matrix requires ${matrixSizes.length} startup reports.`
		);
	}

	const orderedInputs = reports
		.map((report, index) => ({report, sourceFile: sourceFiles[index]}))
		.sort(
			(left, right) =>
				left.report.fixture.passageCount - right.report.fixture.passageCount
		);
	const ordered = orderedInputs.map(input => input.report);
	const actualSizes = ordered.map(report => report.fixture?.passageCount);

	if (JSON.stringify(actualSizes) !== JSON.stringify(matrixSizes)) {
		throw new Error(
			`Memory matrix requires passage sizes ${matrixSizes.join(', ')}.`
		);
	}

	const revisions = new Set(
		ordered.map(report => report.environment?.git?.revision)
	);
	const dirtyStates = new Set(
		ordered.map(report => report.environment?.git?.dirty)
	);
	const fingerprints = new Set(
		ordered.map(report => report.environment?.fingerprint)
	);

	if (revisions.size !== 1 || [...revisions][0] === undefined) {
		throw new Error('Memory matrix reports must use one Git revision.');
	}
	if (dirtyStates.size !== 1 || ![true, false].includes([...dirtyStates][0])) {
		throw new Error(
			'Memory matrix reports must use one recorded Git dirty state.'
		);
	}
	if (requireClean && [...dirtyStates][0] !== false) {
		throw new Error(
			'Memory matrix reports must come from a clean Git revision.'
		);
	}
	if (fingerprints.size !== 1 || [...fingerprints][0] === undefined) {
		throw new Error('Memory matrix reports must use one machine fingerprint.');
	}

	for (const report of ordered) {
		if (
			report.kind !== 'twine-electron-performance' ||
			report.phase !== 'startup' ||
			report.smoke ||
			report.test?.status !== 'passed' ||
			report.evaluation?.passed !== true
		) {
			throw new Error(
				'Memory matrix requires passing, non-smoke startup reports.'
			);
		}
		if (report.environment?.metricContracts?.memoryAttribution !== 1) {
			throw new Error('Memory matrix requires memory attribution contract 1.');
		}
		if ((report.aggregates?.[primaryMetric]?.count ?? 0) < 3) {
			throw new Error(
				`Memory matrix requires at least three ${primaryMetric} samples per size.`
			);
		}
	}

	const profiles = orderedInputs.map(input =>
		profile(input.report, input.sourceFile)
	);
	if (
		profiles.some(
			item =>
				!Number.isFinite(item.projectBearingPrivateMiB) ||
				!Number.isFinite(item.knownOwnerMiB)
		)
	) {
		throw new Error(
			'Memory matrix reports are missing private-memory metrics.'
		);
	}
	const small = profiles[0];
	const large = profiles[2];
	const privateGrowthMiB =
		large.projectBearingPrivateMiB - small.projectBearingPrivateMiB;
	const knownOwnerGrowthMiB = large.knownOwnerMiB - small.knownOwnerMiB;
	const knownOwnerGrowthShare =
		privateGrowthMiB > 0 ? knownOwnerGrowthMiB / privateGrowthMiB : undefined;
	const repeatable = profiles.every(item => item.repeatability.passed);
	const growthWarrantsOptimization = repeatable && privateGrowthMiB >= 128;
	const logicalAttributionSufficient =
		knownOwnerGrowthShare !== undefined && knownOwnerGrowthShare >= 0.8;
	const footprintMeasurementsAvailable = profiles.every(item =>
		Number.isFinite(item.footprintTotalMiB)
	);
	const footprintCategoryNames = new Set(
		profiles.flatMap(item => Object.keys(item.footprintCategoriesMiB))
	);
	const allFootprintCategoryGrowthMiB = [...footprintCategoryNames].map(
		name => ({
			growthMiB:
				(large.footprintCategoriesMiB[name] ?? 0) -
				(small.footprintCategoriesMiB[name] ?? 0),
			name
		})
	);
	const footprintCategoryGrowthMiB = allFootprintCategoryGrowthMiB
		.filter(item => item.growthMiB > 0)
		.sort((left, right) => right.growthMiB - left.growthMiB);
	const footprintGrowthMiB = footprintMeasurementsAvailable
		? large.footprintTotalMiB - small.footprintTotalMiB
		: undefined;
	const footprintCategoryCoverage =
		footprintGrowthMiB > 0
			? allFootprintCategoryGrowthMiB.reduce(
					(total, item) => total + item.growthMiB,
					0
				) / footprintGrowthMiB
			: undefined;
	const footprintAttributionAvailable =
		footprintCategoryCoverage !== undefined && footprintCategoryCoverage >= 0.8;
	const attributionSufficient =
		logicalAttributionSufficient || footprintAttributionAvailable;

	return {
		createdAt: new Date().toISOString(),
		decision: {
			attributionSufficient,
			footprintAttributionAvailable,
			growthWarrantsOptimization,
			logicalAttributionSufficient,
			recommendation: !repeatable
				? 'repeat-and-stabilize-memory-matrix'
				: !growthWarrantsOptimization
					? 'hold-current-memory-design'
					: footprintAttributionAvailable
						? 'optimize-largest-footprint-category'
						: logicalAttributionSufficient
							? 'optimize-largest-attributed-owner'
							: 'deepen-native-memory-attribution',
			repeatable
		},
		environment: {
			fingerprint: [...fingerprints][0],
			git: {
				dirty: [...dirtyStates][0],
				revision: [...revisions][0]
			},
			metricContracts: {
				memory: 3,
				memoryAttribution: 1,
				...(footprintAttributionAvailable ? {memoryFootprint: 1} : {})
			}
		},
		footprint: footprintAttributionAvailable
			? {
					categoryCoverage: footprintCategoryCoverage,
					categoryGrowthMiB: footprintCategoryGrowthMiB,
					growth100To50kMiB: footprintGrowthMiB
				}
			: undefined,
		growth: {
			knownOwnerGrowthMiB,
			knownOwnerGrowthShare,
			privateGrowth100To50kMiB: privateGrowthMiB,
			privateGrowthPer10kPassagesMiB:
				(privateGrowthMiB / (50_000 - 100)) * 10_000
		},
		kind: 'twine-electron-memory-matrix',
		profiles,
		schemaVersion: 1
	};
}
