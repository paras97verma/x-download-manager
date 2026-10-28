# X Download Manager (XDM)

> **Blazingly fast, native cross-platform Download Accelerator & Manager for macOS, Windows, and Linux — built in Rust.**
> Inspired by **Internet Download Manager (IDM)** and **Free Download Manager (FDM)**.

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
   - Every verified push/merge to `main` runs `cargo fmt`, `cargo clippy`, `cargo test`, and `npm run build`, then builds and publishes version-typed `.dmg` (macOS), `.exe`/`.msi` (Windows), `.deb`/`.AppImage`/`.rpm` (Linux), and packaged browser extensions.

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

# 5. Build native OS installer (.dmg / .exe / .msi / .deb / .AppImage)
npm run tauri build
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

Made with ❤️ by ~peivee
