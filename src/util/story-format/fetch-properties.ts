import jsonp from 'jsonp';
import {TwineElectronWindow} from '../../electron/shared';
import {StoryFormatProperties} from '../../store/story-formats';
import {isElectronRenderer} from '../is-electron';

let requestQueue = Promise.resolve();

/**
 * Fetches a story format's properties via JSONP. If multiple requests are made
 * at once, they will be queued by this function.
 */
export async function fetchStoryFormatProperties(
	url: string,
	timeout = 2000
): Promise<StoryFormatProperties> {
	const electronLoader = isElectronRenderer()
		? (window as TwineElectronWindow).twineElectron?.loadStoryFormatProperties
		: undefined;

	if (electronLoader) {
		return electronLoader(url, timeout);
	}

	return new Promise(
		(resolve, reject) =>
			(requestQueue = requestQueue.then(
				() =>
					new Promise(resolveQueue => {
						jsonp(url, {timeout, name: 'storyFormat'}, (err, data) => {
							if (err) {
								reject(err);
							} else {
								resolve(data);
							}

							resolveQueue();
						});
					})
			))
	);
}
