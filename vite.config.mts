import react from '@vitejs/plugin-react-swc';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import {defineConfig} from 'vite';
import checker from 'vite-plugin-checker';
import {nodePolyfills} from 'vite-plugin-node-polyfills';
import {VitePWA} from 'vite-plugin-pwa';
import packageJson from './package.json';

const base = './';

export default defineConfig({
	base,
	build: {
		outDir: 'dist/web',
		target: browserslistToEsbuild(['>0.2%', 'not dead', 'not op_mini all'])
	},
	define: {
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
		nodePolyfills(
			// We only need a `global` injected, for CodeMirror.
			{include: [], globals: {global: true}}
		),
		react(),
		VitePWA({
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
			includeAssets: ['locales/**', 'pwa/**', 'story-formats/**'],
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,woff,woff2}']
			}
		})
	],
	server: {
		open: true
	},
	worker: {
		format: 'es'
	}
});
