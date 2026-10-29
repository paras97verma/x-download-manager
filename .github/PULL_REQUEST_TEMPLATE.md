## Description
<!-- Briefly describe the changes introduced in this PR. -->

## Related Issue
<!-- Link any related issues here (e.g. Fixes #123, Closes #456). -->

## Type of Change
- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] ⚡ Performance improvement
- [ ] 📝 Documentation update
- [ ] 🎨 Code refactoring / UI styling
- [ ] 🔒 Security hardening

## Pre-Merge Verification Checklist
Before submitting this Pull Request, please ensure you have tested and verified your changes:
- [ ] Ran all Rust integration tests: `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`
- [ ] Ran Clippy with zero warnings: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] Verified Rust code formatting: `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [ ] Verified TypeScript static types: `npm run typecheck`
- [ ] Tested the build locally: `npm run build`
- [ ] Verified on your platform (macOS / Windows / Linux)
