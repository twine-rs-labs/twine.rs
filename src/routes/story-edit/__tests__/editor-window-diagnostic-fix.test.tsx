import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import {emptyStoryIndex} from '../../../core';
import type {CoreDiagnostic} from '../../../core/bindings/CoreDiagnostic';
import {
	fakeLoadedStoryFormat,
	FakeStateProvider,
	fakeStory,
	LocationInspector
} from '../../../test-util';
import {EditorWindow} from '../editor-window';

function automaticDiagnostic(
	passageId: string,
	code: string,
	target: string,
	start: number
): CoreDiagnostic {
	return {
		code,
		end: start + target.length,
		line: 1,
		message: `Broken link to "${target}"`,
		passageId,
		quickFixes: [
			{
				applicability: 'automatic',
				command: `create-passage:${target}`,
				title: `Create "${target}"`
			}
		],
		severity: 'warning',
		sourceId: `passage:${passageId}`,
		start
	};
}

describe('<EditorWindow> diagnostic fixes', () => {
	it('routes the exact second contextual diagnostic without mutating', async () => {
		const story = fakeStory();
		const passage = story.passages[0];
		const format = fakeLoadedStoryFormat();
		const first = automaticDiagnostic(
			passage.id,
			'broken-link',
			'First Missing',
			0
		);
		const second = automaticDiagnostic(
			passage.id,
			'broken-link',
			'Second Missing',
			20
		);

		story.storyFormat = format.name;
		story.storyFormatVersion = format.version;
		passage.text = '[[First Missing]] and [[Second Missing]]';
		render(
			<MemoryRouter>
				<FakeStateProvider stories={[story]} storyFormats={[format]}>
					<EditorWindow
						active
						index={{
							...emptyStoryIndex(story.id),
							diagnostics: [first, second]
						}}
						onClose={jest.fn()}
						onFocus={jest.fn()}
						selection={{
							assetReferences: [],
							backlinkCount: 0,
							backlinks: [],
							brokenLinks: [
								{
									broken: true,
									self: false,
									sourceId: passage.id,
									sourceName: passage.name,
									targetId: null,
									targetName: 'First Missing'
								},
								{
									broken: true,
									self: false,
									sourceId: passage.id,
									sourceName: passage.name,
									targetId: null,
									targetName: 'Second Missing'
								}
							],
							diagnostics: [first, second],
							linkFacts: [],
							links: [],
							passage,
							passageNames: story.passages.map(candidate => candidate.name),
							sourceId: passage.id,
							wordCount: 4
						}}
						spec={{kind: 'passage', passageId: passage.id}}
						story={story}
					/>
					<LocationInspector />
				</FakeStateProvider>
			</MemoryRouter>
		);

		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Review Create "Second Missing"'
			})
		);
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				`/stories/${story.id}/diagnostics`
			)
		);
		expect(
			JSON.parse(
				screen.getByTestId('location').getAttribute('data-state') ?? '{}'
			)
		).toMatchObject({
			diagnosticFixReview: {
				diagnosticId: expect.stringContaining('Second Missing'),
				quickFixCommand: 'create-passage:Second Missing'
			}
		});
	});
});
