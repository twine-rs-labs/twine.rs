import type {CoreDiagnostic} from './bindings/CoreDiagnostic';
import type {CoreQuickFix} from './bindings/CoreQuickFix';
import type {StoryCommand} from './bindings/StoryCommand';
import {createPassageCommand, updatePassageTextCommand} from './index';
import type {CoreProjectHost} from './project-host';
import type {Passage, Story} from '../store/stories';

export interface RegisteredQuickFixAction {
	apply: () => void;
	command: string;
	enabled: boolean;
	prompt?: string;
	storyCommand?: StoryCommand;
	title: string;
}

function linkedPassage(story: Story, diagnostic: CoreDiagnostic) {
	if (!diagnostic.passageId) {
		return;
	}

	return story.passages.find(passage => passage.id === diagnostic.passageId);
}

function startPassage(story: Story) {
	return story.passages.find(passage => passage.id === story.startPassage);
}

function linkTextToPassage(start: Passage, target: Passage) {
	const separator = start.text.trim() === '' ? '' : '\n';

	return `${start.text}${separator}[[${target.name}]]`;
}

function createPassageQuickFix(
	host: CoreProjectHost,
	story: Story,
	quickFix: CoreQuickFix
): RegisteredQuickFixAction | undefined {
	const prefix = 'create-passage:';

	if (!quickFix.command.startsWith(prefix)) {
		return;
	}

	const name = quickFix.command.slice(prefix.length);
	const enabled =
		name.trim() !== '' &&
		!story.passages.some(passage => passage.name === name);
	const storyCommand = enabled
		? createPassageCommand(story.id, {name})
		: undefined;

	return {
		apply: () => {
			if (storyCommand) {
				host.applyStoryCommand(storyCommand);
			}
		},
		command: quickFix.command,
		enabled,
		storyCommand,
		title: quickFix.title
	};
}

function linkFromStartQuickFix(
	host: CoreProjectHost,
	story: Story,
	diagnostic: CoreDiagnostic,
	quickFix: CoreQuickFix
): RegisteredQuickFixAction | undefined {
	if (quickFix.command !== 'link-from-start') {
		return;
	}

	const start = startPassage(story);
	const target = linkedPassage(story, diagnostic);
	const enabled = !!start && !!target && start.id !== target.id;
	const storyCommand =
		enabled && start && target
			? updatePassageTextCommand(
					story.id,
					start.id,
					linkTextToPassage(start, target)
				)
			: undefined;

	return {
		apply: () => {
			if (storyCommand) {
				host.applyStoryCommand(storyCommand);
			}
		},
		command: quickFix.command,
		enabled,
		storyCommand,
		title: quickFix.title
	};
}

export function quickFixActionForDiagnostic(
	host: CoreProjectHost,
	story: Story,
	diagnostic: CoreDiagnostic,
	quickFix: CoreQuickFix
): RegisteredQuickFixAction {
	return (
		createPassageQuickFix(host, story, quickFix) ??
		linkFromStartQuickFix(host, story, diagnostic, quickFix) ?? {
			apply: () => {},
			command: quickFix.command,
			enabled: false,
			title: quickFix.title
		}
	);
}

export function quickFixActionsForDiagnostic(
	host: CoreProjectHost,
	story: Story,
	diagnostic: CoreDiagnostic
) {
	return diagnostic.quickFixes.map(quickFix =>
		quickFixActionForDiagnostic(host, story, diagnostic, quickFix)
	);
}
