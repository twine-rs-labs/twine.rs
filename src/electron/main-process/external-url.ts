import {shell} from 'electron';

export function validatedExternalUrl(value: string) {
	let parsed: URL;

	try {
		parsed = new URL(value);
	} catch {
		throw new Error('Blocked invalid external URL.');
	}

	if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
		throw new Error('Blocked unsafe external URL.');
	}

	return parsed.toString();
}

export async function openExternalUrl(value: string) {
	await shell.openExternal(validatedExternalUrl(value));
}
