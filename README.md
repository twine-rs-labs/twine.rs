# twine.rs

Rust-first exploration of a faster, directory-native Twine editor.

This work begins from [TwineJS](https://github.com/klembot/twinejs), the browser and Electron version of [Twine](https://twinery.org) created by Chris Klimas and maintained with many contributors. `twine.rs` keeps that project close for reference, compatibility, and respect for the existing Twine ecosystem while exploring a new Rust-centered architecture.

This repository currently contains:

- The upstream TwineJS codebase for reference and parity work.
- A Rust workspace skeleton under `crates/`.
- Benchmark fixture tooling under `benchmarks/`.
- Planning and design references under `docs/reference/` and `docs/design-system/`.

## Current Focus

Pre-M0 setup: preserve the TwineJS baseline, build out the Rust core safely, and keep the new UI/design work referenceable without cluttering the root.

## License

The upstream TwineJS code is licensed under GPL-3.0. This repository currently preserves that license; see `LICENSE` for the full text.

Original upstream README: `docs/reference/UPSTREAM_TWINEJS_README.md`

## Useful Commands

```sh
npm install
npm run lint
npm run build:web
cargo test --workspace
cargo run -q -p twine_cli -- benchmarks/fixtures/generated/story-50000.story.json
```

## References

- Original TwineJS README: `docs/reference/UPSTREAM_TWINEJS_README.md`
- Upstream TwineJS project docs and GitHub config: `docs/reference/upstream/`
- Rust port feasibility: `docs/reference/RUST_PORT_FEASIBILITY.md`
- Stack strategy: `docs/reference/TWINE_RS_STACK_STRATEGY.md`
- UI document: `docs/reference/TWINE_RS_UI_DOCUMENT.md`
- Milestones and enhancement catalogue: `docs/reference/TWINE_RS_MILESTONES.md`
- Design system: `docs/design-system/`
