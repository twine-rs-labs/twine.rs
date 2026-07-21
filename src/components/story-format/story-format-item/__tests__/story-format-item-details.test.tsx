import {render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {StoryFormat} from '../../../../store/story-formats';
import {
	fakeFailedStoryFormat,
	fakeLoadedStoryFormat,
	fakePendingStoryFormat,
	fakeUnloadedStoryFormat
} from '../../../../test-util';
import {
	StoryFormatItemDetails,
	StoryFormatItemDetailsProps
} from '../story-format-item-details';

describe('<StoryFormatItemDetails>', () => {
	function renderComponent(props?: Partial<StoryFormatItemDetailsProps>) {
		return render(
			<StoryFormatItemDetails format={fakeLoadedStoryFormat()} {...props} />
		);
	}

	it('displays a loading message if the format is unloaded', () => {
		renderComponent({format: fakeUnloadedStoryFormat()});
		expect(
			screen.getByText('components.storyFormatItem.loadingFormat')
		).toBeInTheDocument();
	});

	it('displays a loading message if the format is loading', () => {
		renderComponent({format: fakePendingStoryFormat()});
		expect(
			screen.getByText('components.storyFormatItem.loadingFormat')
		).toBeInTheDocument();
	});

	it('displays an error message if the format failed to load', () => {
		renderComponent({format: fakeFailedStoryFormat()});
		expect(
			screen.getByText('components.storyFormatItem.loadError')
		).toBeInTheDocument();
	});

	describe('when the format is loaded', () => {
		let format: StoryFormat;

		beforeEach(() => {
			format = fakeLoadedStoryFormat();
			renderComponent({format});
		});

		it('displays the format author', () =>
			expect(
				screen.getByText('components.storyFormatItem.author')
			).toBeInTheDocument());

		it('displays the format description', () =>
			expect(
				screen.getByText((format as any).properties.description)
			).toBeInTheDocument());

		it('displays the format license', () =>
			expect(
				screen.getByText('components.storyFormatItem.license')
			).toBeInTheDocument());

		it('displays M6 capability badges', () => {
			expect(screen.getByText('Exporter')).toBeInTheDocument();
			expect(screen.getByText('Publish safe')).toBeInTheDocument();
		});
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});

	it('renders manifest metadata as text instead of executable HTML', () => {
		const format = fakeLoadedStoryFormat();

		if (format.loadState !== 'loaded') {
			throw new Error('Expected a loaded format fixture.');
		}
		format.properties.author = '<img src=x onerror=alert(1)>';
		format.properties.description = '<script>globalThis.pwned = true</script>';
		const {container} = renderComponent({format});

		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('img')).toBeNull();
		expect(container).toHaveTextContent(
			'<script>globalThis.pwned = true</script>'
		);
	});
});
