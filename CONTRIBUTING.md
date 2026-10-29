# Contributing to X Download Manager

Thank you for your interest in contributing to **X Download Manager**!

---

## 🛠️ Development Setup

### Prerequisites
- **Rust Stable** (with `rustfmt` and `clippy`): [rustup.rs](https://rustup.rs)
- **Node.js 20+** and `npm`
- **Tauri Prerequisites**: See [Tauri Prerequisites Guide](https://v2.tauri.app/start/prerequisites/) for your OS:
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - Windows: Visual Studio C++ Build Tools & WebView2

### Initializing the Project
```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/x-download-manager.git
cd x-download-manager

# 2. Install frontend dependencies
npm install

# 3. Enable local pre-commit hooks
git config core.hooksPath .githooks

# 4. Start the app in development mode
npm run tauri dev
```

---

## 🧪 Testing & Quality Gates

All contributions must pass the local and CI verification quality gates:

```bash
# 1. Run all Rust integration tests
cargo test --manifest-path src-tauri/Cargo.toml --all-targets

# 2. Run Clippy static analysis
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# 3. Check code formatting
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

# 4. Run TypeScript typecheck
npm run typecheck

# 5. Build WebExtensions
bash ./scripts/package-extensions.sh
```

---

## 🌿 Branching & Submitting Pull Requests

1. **Do not commit directly to `main`**:
   Direct commits to `main` are disabled. Always create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```
2. Commit with concise, descriptive messages (e.g. `feat: add segmented buffer optimization`, `fix: handle expired 1fichier tokens`).
3. Push to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
4. Open a Pull Request against `paras97verma/x-download-manager:main`.
5. Ensure the automated CI check (`Run All Integration Tests, Linter, Typescript & Extension Checks`) passes on your PR.

---

## 📜 Code of Conduct
Please review our [Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project, you agree to abide by its terms.

