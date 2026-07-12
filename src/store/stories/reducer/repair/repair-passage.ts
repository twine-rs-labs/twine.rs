import {v4 as uuid} from '@lukeed/uuid';
import {passageDefaults} from '../../defaults';
import {Passage, PassageWithText, Story} from '../../stories.types';

function logRepair(
	passage: Passage,
	propName: keyof Passage,
	repairedValue: any,
	detail?: string
) {
	let message =
		`Repairing passage (name: "${passage.name}", id: ${passage.id}): ` +
		`setting ${propName} to ${repairedValue}, was ${passage[propName]}`;

	if (detail) {
		message += ` (${detail})`;
	}

	console.info(message);
}

export function repairPassage<P extends Passage>(
	passage: P,
	parentStory: Story
): P {
	const completeDefaults = passageDefaults();
	const passageDefs: Partial<PassageWithText> =
		'text' in passage
			? completeDefaults
			: Object.fromEntries(
					Object.entries(completeDefaults).filter(([key]) => key !== 'text')
				);
	const repairs: Partial<PassageWithText> = {};

	// Give the passage an ID if it has none.

	if (typeof passage.id !== 'string' || passage.id === '') {
		const newId = uuid();

		logRepair(passage, 'id', newId, 'was undefined or empty string');
		repairs.id = newId;
	}

	// Apply default properties to the passage.

	for (const key in passageDefs) {
		const defKey = key as keyof PassageWithText;
		const value = passageDefs[defKey];
		const current = (passage as unknown as PassageWithText)[defKey];

		if (
			(typeof value === 'number' && !Number.isFinite(current)) ||
			typeof value !== typeof current
		) {
			logRepair(passage, defKey as keyof Passage, value);
			(repairs as Record<string, unknown>)[defKey] = value;
		}
	}

	// Make passage coordinates 0 or greater.

	for (const pos of ['left', 'top']) {
		const posKey = pos as keyof Passage;

		if (
			typeof passage[posKey] === 'number' &&
			(passage[posKey] as number) < 0
		) {
			logRepair(passage, posKey, 0, 'was negative');
			(repairs[posKey] as Passage[typeof posKey]) = 0;
		}
	}

	// Make passage dimensions 5 or greater.

	for (const dim of ['height', 'width']) {
		const dimKey = dim as keyof Passage;

		if (
			typeof passage[dimKey] === 'number' &&
			(passage[dimKey] as number) < 5
		) {
			logRepair(passage, dimKey, 0, 'was less than 5');
			(repairs[dimKey] as Passage[typeof dimKey]) = 5;
		}
	}

	// Repair story property if it doesn't point to the parent story.

	if (passage.story !== parentStory.id) {
		logRepair(passage, 'story', parentStory.id, "didn't match parent story");
		repairs.story = parentStory.id;
	}

	// Repair ID conflicts with any other passage in the story.

	if (
		parentStory.passages.some(otherPassage => {
			if (otherPassage === passage) {
				return false;
			}

			return otherPassage.id === passage.id;
		})
	) {
		const newId = uuid();

		logRepair(
			passage,
			'id',
			newId,
			'conflicted with another passage in the story'
		);
		repairs.id = newId;
	}

	if (Object.keys(repairs).length > 0) {
		return {...passage, ...repairs} as P;
	}

	return passage;
}
