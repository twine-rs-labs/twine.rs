## Browser validation

- For ad-hoc real-browser navigation, inspection, snapshots, screenshots,
  console checks, and network checks, use the repository-local CLI:

  `npm run browser:cli -- <arguments>`

- For deterministic acceptance and regression validation, use the existing
  Playwright Test commands:

  - `npm run e2e`
  - `npm run e2e:pwa`
  - `npm run e2e:electron:packaged`

- Do not invoke
  `$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh`
  in this repository. That wrapper requests the separate
  `@playwright/cli` package through `npx --package`, even though this
  repository already provides `playwright cli`.

- Do not treat interactive CLI inspection and repository acceptance specs as
  interchangeable. Use the mode required by the task, and run the relevant
  acceptance spec after exploratory validation when appropriate.

- Do not use `npx --package ...` as an availability probe in the restricted
  sandbox. Check the existing CLI without network access:

  `test -x node_modules/.bin/playwright &&
 node_modules/.bin/playwright cli --help`

- Do not install or update browser tooling unless the local CLI is unavailable
  or the task explicitly requires a newer standalone CLI.
