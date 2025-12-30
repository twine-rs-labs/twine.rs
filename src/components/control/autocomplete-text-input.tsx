import * as React from 'react';
import {TextInput, TextInputProps} from './text-input';

// Invisible separator used to detect datalist selection
const DATALIST_SELECTION_MARKER = '\u2063';

export interface AutocompleteMetadata {
	autocompleted: boolean;
}

export interface AutocompleteTextInputProps
	extends Omit<TextInputProps, 'onChange'> {
	completions: string[];
	id: string;
	onChange?: (
		event: React.ChangeEvent<HTMLInputElement>,
		metadata?: AutocompleteMetadata
	) => void;
}

export const AutocompleteTextInput = React.forwardRef<
	HTMLInputElement,
	AutocompleteTextInputProps
>((props, ref) => {
	const datalistId = `${props.id}-datalist`;

	function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
		const target = event.target;

		if (target.value.endsWith(DATALIST_SELECTION_MARKER)) {
			// User selected from datalist. Strip the marker and notify with metadata.

			target.value = target.value.slice(0, -1);
			props.onChange?.(event, {autocompleted: true});
			return;
		}

		props.onChange?.(event);
	}

	function handleInput(event: React.FormEvent<HTMLInputElement>) {
		const target = event.target as HTMLInputElement;

		if (target.value.endsWith(DATALIST_SELECTION_MARKER)) {
			props.onInput?.(event);
			return;
		}

		if (
			target.value === '' ||
			!(event.nativeEvent as InputEvent).data ||
			target.selectionStart !== target.selectionEnd ||
			target.selectionStart !== target.value.length
		) {
			// If...
			//  - the field is now blank
			//  - the user entered a non-printable character (like pressed an arrow key)
			//  - the cursor isn't at the end of the field
			// ... don't try to autocomplete anything.

			return;
		}

		// Only autocomplete with exactly one match. Multiple matches would fill
		// the input with the first match and prevent the datalist dropdown from
		// showing all available options.

		const matches = props.completions.filter(completion =>
			completion.toLowerCase().startsWith(target.value.toLowerCase())
		);

		if (matches.length === 1) {
			// Set the input value to the match and select the part the user
			// didn't enter.

			const originalValue = target.value;

			target.value = matches[0];
			target.setSelectionRange(originalValue.length, matches[0].length);
		}

		props.onInput?.(event);
	}

	return (
		<>
			<TextInput
				list={datalistId}
				onChange={handleChange}
				onInput={handleInput}
				ref={ref}
				{...props}
			/>
			<datalist id={datalistId}>
				{props.completions.map(completion => (
					<option
						key={completion}
						value={completion + DATALIST_SELECTION_MARKER}
					/>
				))}
			</datalist>
		</>
	);
});
