import {Extension} from '@codemirror/state';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {oneDark} from '@codemirror/theme-one-dark';
import {EditorView} from '@codemirror/view';
import {tags} from '@lezer/highlight';
import {CodeEditorThemePreference} from '../../../store/prefs';

type ComputedAppTheme = 'dark' | 'light';

const sourceHighlightStyle = HighlightStyle.define([
	{tag: tags.keyword, color: 'var(--source-editor-syntax-keyword)'},
	{tag: tags.controlKeyword, color: 'var(--source-editor-syntax-keyword)'},
	{
		tag: [tags.operatorKeyword, tags.definitionKeyword],
		color: 'var(--source-editor-syntax-keyword)'
	},
	{
		tag: [tags.string, tags.special(tags.string), tags.character],
		color: 'var(--source-editor-syntax-string)'
	},
	{
		tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null],
		color: 'var(--source-editor-syntax-constant)'
	},
	{
		tag: [tags.atom, tags.literal, tags.unit],
		color: 'var(--source-editor-syntax-constant)'
	},
	{
		tag: [tags.variableName, tags.self, tags.name],
		color: 'var(--source-editor-syntax-variable)'
	},
	{
		tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
		color: 'var(--source-editor-syntax-function)'
	},
	{
		tag: [tags.propertyName, tags.attributeName, tags.labelName],
		color: 'var(--source-editor-syntax-property)'
	},
	{
		tag: [tags.className, tags.typeName, tags.namespace],
		color: 'var(--source-editor-syntax-type)'
	},
	{
		tag: [tags.tagName, tags.macroName],
		color: 'var(--source-editor-syntax-tag)'
	},
	{
		tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
		color: 'var(--source-editor-syntax-comment)',
		fontStyle: 'italic'
	},
	{
		tag: [tags.heading, tags.strong],
		color: 'var(--source-editor-syntax-heading)',
		fontWeight: '600'
	},
	{tag: tags.emphasis, fontStyle: 'italic'},
	{
		tag: [tags.link, tags.url],
		color: 'var(--source-editor-syntax-link)',
		textDecoration: 'underline'
	},
	{
		tag: tags.invalid,
		color: 'var(--source-editor-syntax-invalid)'
	}
]);

const sharedTwineVars = {
	'--source-editor-active-line-border': 'var(--acc-blue)',
	'--source-editor-bracket-bg': 'var(--sem-link-soft)',
	'--source-editor-bracket-fg': 'var(--tx-1)',
	'--source-editor-bracket-outline': 'var(--sem-link)',
	'--source-editor-broken-link': 'var(--sem-error)',
	'--source-editor-diagnostic-bg':
		'color-mix(in oklab, var(--sem-error-soft) 46%, transparent)',
	'--source-editor-diagnostic-border':
		'color-mix(in oklab, var(--sem-error) 42%, transparent)',
	'--source-editor-diagnostic-marker-bg': 'var(--sem-error-soft)',
	'--source-editor-link': 'var(--sem-link)',
	'--source-editor-link-underline': 'var(--sem-link-soft)',
	'--source-editor-macro': 'var(--sem-var)',
	'--source-editor-search-bg': 'var(--sem-warn-soft)',
	'--source-editor-search-outline': 'var(--sem-warn)',
	'--source-editor-selection-bg': 'var(--sel-wash)',
	'--source-editor-selection-match-bg': 'var(--sem-link-soft)',
	'--source-editor-self-link': 'var(--sem-saved)',
	'--source-editor-self-link-bg': 'var(--sem-saved-soft)',
	'--source-editor-syntax-comment': 'var(--tx-4)',
	'--source-editor-syntax-constant': 'var(--sem-var)',
	'--source-editor-syntax-function': 'var(--sem-link)',
	'--source-editor-syntax-heading': 'var(--tx-1)',
	'--source-editor-syntax-invalid': 'var(--sem-error)',
	'--source-editor-syntax-keyword': 'var(--sem-build)',
	'--source-editor-syntax-link': 'var(--sem-link)',
	'--source-editor-syntax-property': 'var(--sem-tag)',
	'--source-editor-syntax-string': 'var(--sem-saved)',
	'--source-editor-syntax-tag': 'var(--sem-tag)',
	'--source-editor-syntax-type': 'var(--sem-var)',
	'--source-editor-syntax-variable': 'var(--tx-2)',
	'--source-editor-tag': 'var(--sem-tag)',
	'--source-editor-tag-bg': 'var(--sem-tag-soft)',
	'--source-editor-tooltip-bg': 'var(--bg-pop)',
	'--source-editor-tooltip-border': 'var(--line-2)',
	'--source-editor-tooltip-fg': 'var(--tx-2)',
	'--source-editor-tooltip-selected-bg': 'var(--sem-link-soft)',
	'--source-editor-tooltip-selected-fg': 'var(--tx-1)',
	'--source-editor-variable': 'var(--sem-var)',
	'--source-editor-variable-bg': 'var(--sem-var-soft)'
};

const twineVars = {
	...sharedTwineVars,
	// Token-driven so the adaptive theme's active line flips with light/dark:
	// --sel-line deepens to blue ink on paper, stays bright blue on ink.
	'--source-editor-active-line-bg':
		'color-mix(in oklab, var(--sel-line) 12%, transparent)',
	'--source-editor-active-line-gutter-bg': 'var(--ink-3)',
	'--source-editor-bg': 'var(--ink-3)',
	'--source-editor-fg': 'var(--tx-2)',
	'--source-editor-gutter-bg': 'var(--ink-2)',
	'--source-editor-gutter-border': 'var(--line-1)',
	'--source-editor-gutter-fg': 'var(--tx-4)',
	'--source-editor-placeholder': 'var(--tx-4)',
	'--source-editor-special-char': 'var(--sem-var)'
};

const oneDarkVars = {
	...sharedTwineVars,
	'--source-editor-active-line-bg': '#2c313c',
	'--source-editor-active-line-border': '#528bff',
	'--source-editor-active-line-gutter-bg': '#2c313c',
	'--source-editor-bg': '#282c34',
	'--source-editor-bracket-bg': '#3b4048',
	'--source-editor-bracket-fg': '#abb2bf',
	'--source-editor-bracket-outline': '#528bff',
	'--source-editor-broken-link': '#e06c75',
	'--source-editor-diagnostic-bg': 'rgb(224 108 117 / 0.16)',
	'--source-editor-diagnostic-border': 'rgb(224 108 117 / 0.5)',
	'--source-editor-diagnostic-marker-bg': 'rgb(224 108 117 / 0.18)',
	'--source-editor-fg': '#abb2bf',
	'--source-editor-gutter-bg': '#21252b',
	'--source-editor-gutter-border': '#181a1f',
	'--source-editor-gutter-fg': '#7d8799',
	'--source-editor-link': '#61afef',
	'--source-editor-link-underline': 'rgb(97 175 239 / 0.35)',
	'--source-editor-macro': '#c678dd',
	'--source-editor-placeholder': '#7d8799',
	'--source-editor-search-bg': 'rgb(229 192 123 / 0.24)',
	'--source-editor-search-outline': '#e5c07b',
	'--source-editor-selection-bg': '#3e4451',
	'--source-editor-selection-match-bg': 'rgb(86 182 194 / 0.2)',
	'--source-editor-self-link': '#98c379',
	'--source-editor-self-link-bg': 'rgb(152 195 121 / 0.16)',
	'--source-editor-special-char': '#d19a66',
	'--source-editor-syntax-comment': '#7d8799',
	'--source-editor-syntax-constant': '#d19a66',
	'--source-editor-syntax-function': '#61afef',
	'--source-editor-syntax-heading': '#e5c07b',
	'--source-editor-syntax-invalid': '#e06c75',
	'--source-editor-syntax-keyword': '#c678dd',
	'--source-editor-syntax-link': '#56b6c2',
	'--source-editor-syntax-property': '#e5c07b',
	'--source-editor-syntax-string': '#98c379',
	'--source-editor-syntax-tag': '#e06c75',
	'--source-editor-syntax-type': '#e5c07b',
	'--source-editor-syntax-variable': '#abb2bf',
	'--source-editor-tag': '#e5c07b',
	'--source-editor-tag-bg': 'rgb(229 192 123 / 0.16)',
	'--source-editor-tooltip-bg': '#21252b',
	'--source-editor-tooltip-border': '#3b4048',
	'--source-editor-tooltip-fg': '#abb2bf',
	'--source-editor-tooltip-selected-bg': '#2c313c',
	'--source-editor-tooltip-selected-fg': '#d7dae0',
	'--source-editor-variable': '#e5c07b',
	'--source-editor-variable-bg': 'rgb(229 192 123 / 0.14)'
};

const solarizedLightVars = {
	...sharedTwineVars,
	'--source-editor-active-line-bg': '#eee8d5',
	'--source-editor-active-line-border': '#268bd2',
	'--source-editor-active-line-gutter-bg': '#eee8d5',
	'--source-editor-bg': '#fdf6e3',
	'--source-editor-bracket-bg': '#eee8d5',
	'--source-editor-bracket-fg': '#073642',
	'--source-editor-bracket-outline': '#268bd2',
	'--source-editor-broken-link': '#dc322f',
	'--source-editor-diagnostic-bg': 'rgb(220 50 47 / 0.13)',
	'--source-editor-diagnostic-border': 'rgb(220 50 47 / 0.45)',
	'--source-editor-diagnostic-marker-bg': 'rgb(220 50 47 / 0.12)',
	'--source-editor-fg': '#586e75',
	'--source-editor-gutter-bg': '#eee8d5',
	'--source-editor-gutter-border': '#d9cfad',
	'--source-editor-gutter-fg': '#93a1a1',
	'--source-editor-link': '#268bd2',
	'--source-editor-link-underline': 'rgb(38 139 210 / 0.28)',
	'--source-editor-macro': '#6c71c4',
	'--source-editor-placeholder': '#93a1a1',
	'--source-editor-search-bg': 'rgb(181 137 0 / 0.2)',
	'--source-editor-search-outline': '#b58900',
	'--source-editor-selection-bg': '#dfe9e4',
	'--source-editor-selection-match-bg': 'rgb(42 161 152 / 0.18)',
	'--source-editor-self-link': '#859900',
	'--source-editor-self-link-bg': 'rgb(133 153 0 / 0.13)',
	'--source-editor-special-char': '#cb4b16',
	'--source-editor-syntax-comment': '#93a1a1',
	'--source-editor-syntax-constant': '#cb4b16',
	'--source-editor-syntax-function': '#268bd2',
	'--source-editor-syntax-heading': '#b58900',
	'--source-editor-syntax-invalid': '#dc322f',
	'--source-editor-syntax-keyword': '#859900',
	'--source-editor-syntax-link': '#2aa198',
	'--source-editor-syntax-property': '#b58900',
	'--source-editor-syntax-string': '#2aa198',
	'--source-editor-syntax-tag': '#268bd2',
	'--source-editor-syntax-type': '#b58900',
	'--source-editor-syntax-variable': '#586e75',
	'--source-editor-tag': '#b58900',
	'--source-editor-tag-bg': 'rgb(181 137 0 / 0.12)',
	'--source-editor-tooltip-bg': '#fdf6e3',
	'--source-editor-tooltip-border': '#d9cfad',
	'--source-editor-tooltip-fg': '#586e75',
	'--source-editor-tooltip-selected-bg': '#eee8d5',
	'--source-editor-tooltip-selected-fg': '#073642',
	'--source-editor-variable': '#b58900',
	'--source-editor-variable-bg': 'rgb(181 137 0 / 0.12)'
};

const solarizedDarkVars = {
	...solarizedLightVars,
	'--source-editor-active-line-bg': '#073642',
	'--source-editor-active-line-gutter-bg': '#073642',
	'--source-editor-bg': '#002b36',
	'--source-editor-bracket-bg': '#073642',
	'--source-editor-bracket-fg': '#eee8d5',
	'--source-editor-fg': '#93a1a1',
	'--source-editor-gutter-bg': '#073642',
	'--source-editor-gutter-border': '#0b3d4a',
	'--source-editor-gutter-fg': '#586e75',
	'--source-editor-placeholder': '#586e75',
	'--source-editor-selection-bg': '#174652',
	'--source-editor-tooltip-bg': '#073642',
	'--source-editor-tooltip-border': '#0b3d4a',
	'--source-editor-tooltip-fg': '#93a1a1',
	'--source-editor-tooltip-selected-bg': '#0b3d4a',
	'--source-editor-tooltip-selected-fg': '#eee8d5'
};

const highContrastVars = {
	...sharedTwineVars,
	'--source-editor-active-line-bg': '#1d1d1d',
	'--source-editor-active-line-border': '#ffd84d',
	'--source-editor-active-line-gutter-bg': '#1d1d1d',
	'--source-editor-bg': '#000000',
	'--source-editor-bracket-bg': '#1d2c42',
	'--source-editor-bracket-fg': '#ffffff',
	'--source-editor-bracket-outline': '#6bb6ff',
	'--source-editor-broken-link': '#ff6b7a',
	'--source-editor-diagnostic-bg': 'rgb(255 107 122 / 0.22)',
	'--source-editor-diagnostic-border': '#ff6b7a',
	'--source-editor-diagnostic-marker-bg': '#330b12',
	'--source-editor-fg': '#ffffff',
	'--source-editor-gutter-bg': '#101010',
	'--source-editor-gutter-border': '#4f4f4f',
	'--source-editor-gutter-fg': '#d5d5d5',
	'--source-editor-link': '#6bb6ff',
	'--source-editor-link-underline': '#6bb6ff',
	'--source-editor-macro': '#ff9dff',
	'--source-editor-placeholder': '#c5c5c5',
	'--source-editor-search-bg': '#4a3b00',
	'--source-editor-search-outline': '#ffd84d',
	'--source-editor-selection-bg': '#174f8f',
	'--source-editor-selection-match-bg': '#273d5f',
	'--source-editor-self-link': '#8dff8d',
	'--source-editor-self-link-bg': '#103c10',
	'--source-editor-special-char': '#ffd84d',
	'--source-editor-syntax-comment': '#d5d5d5',
	'--source-editor-syntax-constant': '#ffd84d',
	'--source-editor-syntax-function': '#6bb6ff',
	'--source-editor-syntax-heading': '#ffd84d',
	'--source-editor-syntax-invalid': '#ff6b7a',
	'--source-editor-syntax-keyword': '#ff9dff',
	'--source-editor-syntax-link': '#6ffff6',
	'--source-editor-syntax-property': '#ffd84d',
	'--source-editor-syntax-string': '#8dff8d',
	'--source-editor-syntax-tag': '#ff9d7a',
	'--source-editor-syntax-type': '#ffd84d',
	'--source-editor-syntax-variable': '#ffffff',
	'--source-editor-tag': '#ffd84d',
	'--source-editor-tag-bg': '#3a3005',
	'--source-editor-tooltip-bg': '#101010',
	'--source-editor-tooltip-border': '#6bb6ff',
	'--source-editor-tooltip-fg': '#ffffff',
	'--source-editor-tooltip-selected-bg': '#174f8f',
	'--source-editor-tooltip-selected-fg': '#ffffff',
	'--source-editor-variable': '#ffd84d',
	'--source-editor-variable-bg': '#3a3005'
};

function themeVariables(
	vars: Record<string, string>,
	dark: boolean
): Extension {
	return EditorView.theme(
		{
			'&': vars,
			'&.cm-editor': {
				backgroundColor: 'var(--source-editor-bg)',
				color: 'var(--source-editor-fg)'
			},
			'&.cm-focused .cm-cursor': {
				borderLeftColor: 'var(--source-editor-active-line-border)'
			}
		},
		{dark}
	);
}

function customTheme(vars: Record<string, string>, dark: boolean): Extension {
	return [themeVariables(vars, dark), syntaxHighlighting(sourceHighlightStyle)];
}

export function sourceEditorThemeExtension(
	theme: CodeEditorThemePreference,
	appTheme: ComputedAppTheme
): Extension {
	switch (theme) {
		case 'one-dark':
			return [themeVariables(oneDarkVars, true), oneDark];
		case 'solarized-light':
			return customTheme(solarizedLightVars, false);
		case 'solarized-dark':
			return customTheme(solarizedDarkVars, true);
		case 'high-contrast':
			return customTheme(highContrastVars, true);
		case 'twine':
			return customTheme(twineVars, appTheme === 'dark');
	}
}
