/** Reports preview-launch failures for actions that do not have inline status UI. */
export function reportStoryLaunchError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);

	console.error('Could not open story preview.', error);
	window.alert(`Could not open story preview (${message}).`);
}
