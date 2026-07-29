import react from '@vitejs/plugin-react-swc';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import path from 'node:path';
import {defineConfig} from 'vite';
import checker from 'vite-plugin-checker';
import {VitePWA, type VitePWAOptions} from 'vite-plugin-pwa';
import packageJson from './package.json';

const base = './';
type ManifestTransform = NonNullable<
	NonNullable<VitePWAOptions['workbox']>['manifestTransforms']
>[number];
const sortPrecacheManifest: ManifestTransform = manifestEntries => ({
	manifest: manifestEntries
		.filter(
			entry =>
				!/(?:^|\/)story-preview(?:-[^/]+)?\.(?:css|html|js)$/.test(entry.url)
		)
		.sort((left, right) =>
			left.url < right.url ? -1 : left.url > right.url ? 1 : 0
		)
});

const removePreviewPwaTags = {
	apply: 'build' as const,
	enforce: 'post' as const,
	name: 'remove-desktop-preview-pwa-tags',
	transformIndexHtml: {
		order: 'post' as const,
		handler(html: string, context: {path: string}) {
			if (!context.path.endsWith('/story-preview.html')) {
				return html;
			}

			return html
				.replace(/<link rel="manifest" href="[^"]*manifest\.webmanifest">/g, '')
				.replace(
					/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g,
					''
				);
		}
	}
};

export default defineConfig({
	base,
	build: {
		outDir: 'dist/web',
		rollupOptions: {
			input: {
				index: path.resolve(import.meta.dirname, 'index.html'),
				'story-preview': path.resolve(import.meta.dirname, 'story-preview.html')
			}
		},
		target: browserslistToEsbuild(['>0.2%', 'not dead', 'not op_mini all'])
	},
	define: {
		global: 'globalThis',
		// Make app name and version available to code.
		// https://stackoverflow.com/a/74860417/7569568
		'process.env.BASE_URL': JSON.stringify(base),
		'process.env.VITE_APP_NAME': JSON.stringify(packageJson.productName),
		'process.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
		'process.env.VITE_TWINE_COMPATIBILITY_VERSION': JSON.stringify(
			packageJson.twineCompatibilityVersion
		)
	},
	plugins: [
		checker({
			eslint: {lintCommand: 'eslint "src/**/*.{ts,tsx}"'},
			overlay: {
				initialIsOpen: false
			},
			typescript: true
		}),
		react(),
		VitePWA({
			includeManifestIcons: false,
			manifest: {
				name: packageJson.productName,
				short_name: packageJson.productName,
				icons: [
					{
						src: './icons/pwa.png',
						sizes: '1024x1024',
						type: 'image/png'
					},
					{
						src: './icons/pwa-maskable.png',
						purpose: 'maskable',
						sizes: '1024x1024',
						type: 'image/png'
					}
				]
			},
			registerType: 'autoUpdate',
			workbox: {
				globPatterns: [
					'**/*.{js,css,html,svg,woff,woff2,json,md,png,wasm}',
					'**/LICENSE'
				],
				// Configuring this replaces Workbox's defaults, so retain its
				// tracking parameters alongside the story-format JSONP callback.
				ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^callback$/],
				manifestTransforms: [sortPrecacheManifest],
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
			}
		}),
		removePreviewPwaTags
	],
	server: {
		open: true
	},
	worker: {
		format: 'es'
	}
});
