import type {CoreDiagnostic} from './bindings/CoreDiagnostic';
import type {CoreQuickFix} from './bindings/CoreQuickFix';
import type {StoryCommand} from './bindings/StoryCommand';
import {createPassageCommand, updatePassageTextCommand} from './index';
import type {CoreProjectHost} from './project-host';
import type {Story} from '../store/stories';

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

function linkTextToPassage(text: string, targetName: string) {
	const separator = text.trim() === '' ? '' : '\n';

	return `${text}${separator}[[${targetName}]]`;
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

	return {
		apply: () => {
			if (enabled && start && target) {
				void host
					.queryPassageDocumentAsync(story.id, start.id)
					.then(document =>
						host.applyStoryCommand(
							updatePassageTextCommand(
								story.id,
								start.id,
								linkTextToPassage(document.text, target.name)
							)
						)
					);
			}
		},
		command: quickFix.command,
		enabled,
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
