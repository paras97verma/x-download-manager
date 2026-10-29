# X Download Manager (XDM)

> **Blazingly fast, native cross-platform Download Accelerator & Manager for macOS, Windows, and Linux — built in Rust.**
> Inspired by **Internet Download Manager (IDM)** and **Free Download Manager (FDM)**.

[![GitHub Release](https://img.shields.io/github/v/release/paras97verma/x-download-manager?style=flat-square&color=blue)](https://github.com/paras97verma/x-download-manager/releases/latest)
[![CI/CD Build](https://img.shields.io/github/actions/workflow/status/paras97verma/x-download-manager/release.yml?branch=main&style=flat-square&label=build)](https://github.com/paras97verma/x-download-manager/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## 📥 Downloads

Get the latest verified build for your operating system and browser:

### Desktop Installers

| Operating System | Architecture | Package Format | Download Link (v1.0.0) | Latest Release |
| :--- | :--- | :--- | :--- | :--- |
| **macOS** | Universal (Apple Silicon & Intel) | `.pkg` Installer | [⬇️ **Download for macOS (.pkg)**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/X-Download-Manager_1.0.0_universal.pkg) | [Latest Release](https://github.com/paras97verma/x-download-manager/releases/latest) |
| **macOS** | Universal (Apple Silicon & Intel) | `.dmg` Installer | [⬇️ **Download for macOS (.dmg)**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/x-download-manager_1.0.0_universal.dmg) | [Latest Release](https://github.com/paras97verma/x-download-manager/releases/latest) |
| **Windows** | 64-bit (x64) | `.exe` (NSIS Installer) | [⬇️ **Download for Windows (.exe)**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/x-download-manager_1.0.0_x64-setup.exe) | [Latest Release](https://github.com/paras97verma/x-download-manager/releases/latest) |
| **Windows** | 64-bit (x64) | `.msi` (WiX Installer) | [⬇️ **Download for Windows (.msi)**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/x-download-manager_1.0.0_x64_en-US.msi) | [Latest Release](https://github.com/paras97verma/x-download-manager/releases/latest) |
| **Linux** | 64-bit (x86_64) | `.AppImage` (Universal) | [⬇️ **Download for Linux (.AppImage)**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/x-download-manager_1.0.0_amd64.AppImage) | [Latest Release](https://github.com/paras97verma/x-download-manager/releases/latest) |
| **Linux (Debian/Ubuntu)** | 64-bit (x86_64) | `.deb` Package | [⬇️ **Download for Ubuntu/Debian (.deb)**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/x-download-manager_1.0.0_amd64.deb) | [Latest Release](https://github.com/paras97verma/x-download-manager/releases/latest) |
| **Linux (Fedora/RHEL)** | 64-bit (x86_64) | `.rpm` Package | [⬇️ **Download for Fedora/RHEL (.rpm)**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/x-download-manager-1.0.0-1.x86_64.rpm) | [Latest Release](https://github.com/paras97verma/x-download-manager/releases/latest) |

> 📦 **All Releases & Checksums**: View all versions, release notes, and build artifacts on the **[GitHub Releases Page](https://github.com/paras97verma/x-download-manager/releases)**.

---

### Browser Extensions

X Download Manager seamlessly intercepts download links, streaming video/audio, and authentication cookies from all major browsers:

| Browser | Supported Browsers | Direct Download (v1.0.0) | Manual Installation |
| :--- | :--- | :--- | :--- |
| **Chromium** | Chrome, Arc, Dia, Brave, Edge, Opera, Opera GX, Vivaldi, Thorium, Ungoogled Chromium, Yandex | [⬇️ **`xdm-extension-chromium.zip`**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/xdm-extension-chromium.zip) | `chrome://extensions` → Enable *Developer mode* → *Load unpacked* |
| **Firefox** | Mozilla Firefox, Zen Browser, LibreWolf, Waterfox, Floorp | [⬇️ **`xdm-extension-firefox.xpi`**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/xdm-extension-firefox.xpi) | Click to install in Firefox/Zen, or load via `about:debugging` |
| **Safari / WebKit** | Apple Safari (macOS), Orion Browser | [⬇️ **`xdm-extension-safari.zip`**](https://github.com/paras97verma/x-download-manager/releases/download/v1.0.0/xdm-extension-safari.zip) | Safari Settings → Advanced → Show Develop menu → Develop → Allow Unsigned Extensions → Add Temporary Extension... |

---

## 🛡️ Security & Installation Guide (macOS Gatekeeper & Windows SmartScreen)

X Download Manager is 100% free, open-source, and privacy-respecting software built directly from source code on GitHub Actions. Because open-source projects do not use expensive proprietary commercial certificates ($100–$1,000/year), macOS and Windows will display standard one-time security prompts when you run the downloaded installer for the first time.

Follow these simple instructions to open and run X Download Manager:

### 🍎 macOS (Gatekeeper / "Unidentified Developer")

When opening `X Download Manager.app` or mounting the `.dmg` on macOS Sonoma, Ventura, Sequoia, or later, Apple Gatekeeper may show:
> *"X Download Manager" can't be opened because Apple cannot check it for malicious software.* or *"blocked from use because it is not from an identified developer"*.

**Option 1: Quick Override in System Settings (Recommended)**
1. Try opening the app once. If the dialog appears, click **Done**.
2. Open **System Settings** → **Privacy & Security**.
3. Scroll down to the **Security** section where you will see:
   > *"X Download Manager" was blocked from use because it is not from an identified developer.*
4. Click **Open Anyway** and enter your Mac password or Touch ID.

**Option 2: Finder Right-Click (Control-Click)**
1. Move `X Download Manager.app` to your `/Applications` folder.
2. Hold down the **Control (`Ctrl`)** key and **right-click** `X Download Manager.app`.
3. Select **Open** from the menu.
4. Click **Open** in the confirmation dialog.

**Option 3: One-line Terminal Command (Permanent)**
If you prefer running a command, remove the macOS browser download quarantine bit once:
```bash
xattr -cr "/Applications/X Download Manager.app"
```
*After this, the app opens instantly on normal double-click with zero prompts.*

---

### 🪟 Windows (Microsoft Defender SmartScreen / "Untrusted App")

When launching `x-download-manager_1.0.0_x64-setup.exe` or `.msi`, Microsoft Defender SmartScreen may display:
> *Windows protected your PC: Microsoft Defender SmartScreen prevented an unrecognized app from starting.*

**Option 1: Run Anyway via SmartScreen Dialog (Recommended)**
1. On the blue SmartScreen window, click **More info** (under the description text).
2. Click the **Run anyway** button that appears in the bottom right corner.

**Option 2: Unblock via File Properties**
1. Right-click the downloaded `.exe` or `.msi` file and select **Properties**.
2. On the **General** tab, look at the bottom section under **Security**.
3. Check the **Unblock** box and click **Apply** → **OK**.
4. Double-click to launch the installer normally.

**Option 3: PowerShell One-Liner**
In PowerShell, run:
```powershell
Unblock-File -Path "$HOME\Downloads\x-download-manager_*.exe"
```

---

### 🔑 For Maintainers: Automatic Code Signing with Secrets

If you own an Apple Developer Program subscription or Windows Authenticode Certificate (PFX), you can add them to your GitHub repository secrets to automatically produce fully notarized and EV-signed binaries on every release:

- **macOS (Notarization & Gatekeeper bypass)**:
  - `APPLE_CERTIFICATE`: Base64-encoded Apple Developer ID Application `.p12` certificate.
  - `APPLE_CERTIFICATE_PASSWORD`: Password for the `.p12` certificate.
  - `APPLE_SIGNING_IDENTITY`: e.g. `Developer ID Application: Your Name (TEAM_ID)`.
  - `APPLE_ID`: Your Apple ID email.
  - `APPLE_PASSWORD`: App-specific password generated from [appleid.apple.com](https://appleid.apple.com).
  - `APPLE_TEAM_ID`: Your 10-character Apple Team ID.

- **Windows (SmartScreen reputation)**:
  - `WINDOWS_CERTIFICATE`: Base64-encoded Code Signing `.pfx` certificate.
  - `WINDOWS_CERTIFICATE_PASSWORD`: Password for the `.pfx` certificate.

---

## Key Highlights

1. **Multi-Threaded Dynamic HTTP/HTTPS Segmentation (Up to 32 Threads)**
   - Probes remote servers via `HEAD` and `GET Range: bytes=0-0` to detect `206 Partial Content` support.
   - Splits files into up to **32 simultaneous byte-range threads** writing directly to pre-allocated disk offsets.
   - Implements **IDM-style Dynamic Segment Work-Stealing**: when a fast thread finishes its chunk early, it automatically splits the largest remaining active segment.
2. **BitTorrent & Magnet Protocol Engine**
   - Full `.torrent` and `magnet:?xt=urn:btih:...` support with Mainline DHT, Peer Exchange (PEX), Local Peer Discovery (LPD), and UDP/HTTP trackers.
   - Selective file priority (`High`, `Normal`, `Skip`), Sequential Piece downloading (stream video while downloading), and automatic seeding ratio limits.
3. **FTP / FTPS / SFTP & Authenticated File-Sharing Sites (`Usersdrive`, `1fichier`, `MediaFire`)**
   - Built-in **Site Logins & Auth Vault** supporting wildcard host patterns (`*.usersdrive.com`, `*.1fichier.com`, `ftp.myserver.org`).
   - Automatic 2-step form/cookie resolution for **Usersdrive** links (`https://usersdrive.com/<id>.html`) and seamless browser session cookie passthrough.
4. **Automatic Cross-Browser Extension Suite (Chromium, Firefox, Safari)**
   - Ships with bundled WebExtensions for **Google Chrome, Brave, Microsoft Edge, Opera, Vivaldi, Mozilla Firefox, and Apple Safari**.
   - On first launch, XDM automatically detects all installed browsers on macOS, Windows, and Linux and registers its **Native Messaging Host (`com.peivee.xdm.json`)** + **Local IPC Server (`127.0.0.1:45678`)**.
   - Enable, disable, or reinstall extensions per browser directly inside XDM's **Browser Extensions** manager.
5. **Automated GitHub Actions CI/CD Release Pipeline**
   - Every verified push/merge to `main` runs `cargo fmt`, `cargo clippy`, `cargo test`, and `npm run build`, then builds and publishes version-typed `.dmg`/`.pkg` (macOS), `.exe`/`.msi` (Windows), `.deb`/`.AppImage`/`.rpm` (Linux), and packaged browser extensions.

---

## Quick Start & Building from Source

### Prerequisites
- **Rust** (`1.78+` via `rustup`)
- **Node.js** (`20+`)
- Platform WebView libraries (macOS Xcode CLT, Windows WebView2, or Linux `libwebkit2gtk-4.1-dev`)

### Commands
```bash
# 1. Install frontend dependencies
npm install

# 2. Run Rust backend unit tests
cargo test --workspace

# 3. Package Chromium, Firefox, and Safari browser extensions
npm run package:extensions

# 4. Launch X Download Manager in development mode
npm run tauri dev

# 5. Build native OS installer (.dmg / .pkg / .exe / .msi / .deb / .AppImage)
npm run tauri build
# (On macOS) package .pkg component installer:
npm run package:pkg
```

---

## Installing the Browser Extensions Manually (If Needed)

While X Download Manager automatically registers the Native Messaging Host for detected browsers on startup, you can also load the unpacked or packaged extensions directly:

- **Chrome / Brave / Edge / Opera / Vivaldi**:
  1. Open `chrome://extensions` and enable **Developer mode**.
  2. Click **Load unpacked** and select `extensions/chromium` (or drag-and-drop `xdm-extension-chromium.zip`).
- **Mozilla Firefox**:
  1. Open `about:debugging#/runtime/this-firefox`.
  2. Click **Load Temporary Add-on...** and select `extensions/firefox/manifest.json` (or install `xdm-extension-firefox.xpi`).
- **Apple Safari (macOS)**:
  1. Open `extensions/safari/macos-wrapper` in Xcode (or run `xcrun safari-web-extension-converter extensions/safari`).
  2. Enable **Allow Unsigned Extensions** in Safari's Develop menu and check **X Download Manager** in **Safari → Settings → Extensions**.

---

## 🤝 Community & Contributing

We welcome contributions from the community! Please review our guidelines before opening a Pull Request:
- [Contributing Guide](.github/CONTRIBUTING.md)
- [Code of Conduct](.github/CODE_OF_CONDUCT.md)
- [Security Policy](.github/SECURITY.md)
- [Architecture Overview](ARCHITECTURE.md)
- [License (MIT)](LICENSE)

---

Made with ❤️ by ~peivee
