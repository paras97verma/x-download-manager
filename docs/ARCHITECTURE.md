# ByteX Download Manager — System Architecture & Implementation Plan

## 1. Executive Overview

**ByteX Download Manager** is a native, cross-platform desktop download accelerator and manager for **macOS, Windows, and Linux**, built in **Rust** (using **Tauri v2**, **Tokio**, **Reqwest**, **Librqbit / Custom BitTorrent Engine**, and **SuppaFTP**) paired with a high-performance **React 18 + TypeScript + Tailwind CSS** desktop interface inspired by **Internet Download Manager (IDM)** and **Free Download Manager (FDM)**.

The application ships with bundled **WebExtensions for Chromium (Chrome, Brave, Edge, Opera, Vivaldi), Firefox, and Safari**, a **Native Messaging Host binary (`xdm-native-host`)**, and an embedded **Local IPC/HTTP Bridge (`127.0.0.1:45678`)**. Upon installation or first launch, ByteX detects installed browsers and registers the Native Messaging manifests and browser extension policies. Users can manage browser integration directly from the app.

## 2. Core System Architecture

```
+-----------------------------------------------------------------------------------+
|                           BROWSER EXTENSIONS (MV3 / WebExt)                       |
|  +-----------------------+  +-----------------------+  +-----------------------+  |
|  | Chromium Extension    |  | Firefox Extension     |  | Safari WebExtension   |  |
|  | (Chrome/Edge/Brave)   |  | (Gecko / Manifest V3) |  | (macOS App Extension) |  |
|  +-----------+-----------+  +-----------+-----------+  +-----------+-----------+  |
|              |                          |                          |              |
|              +--------------------------+--------------------------+              |
|                                         |                                         |
|         1. Intercepts Downloads, Cookies, Referer, User-Agent, Auth Tokens        |
|         2. Communicates via Native Messaging (`xdm-native-host`) OR               |
|            Localhost REST/WebSocket Bridge (`http://127.0.0.1:45678/api/v1`)      |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                      BYTEX DOWNLOAD MANAGER — RUST CORE (`src-tauri`)             |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | IPC & Native Bridge Layer (`src-tauri/src/browser/`)                        |  |
|  | - Local Axum/Tokio HTTP & WebSocket Server (`127.0.0.1:45678`)              |  |
|  | - Native Messaging Host STDIO Handler (`com.peivee.xdm.native`)             |  |
|  | - Cross-Platform Browser Detector & Auto-Installer (Registry / Plist / JSON)|  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
|  +------------------------+ +------------------------+ +-----------------------+  |
|  | Multi-Thread HTTP/S    | | BitTorrent & Magnet    | | FTP/FTPS & File Host  |  |
|  | Engine (`engine/http`) | | Engine (`engine/bt`)   | | Auth (`engine/ftp`)   |  |
|  | - Dynamic Range Chunks | | - .torrent & magnet:?  | | - FTP / FTPS   |  |
|  | - Up to 32 Threads     | | - DHT, PEX, Trackers   | | - Usersdrive, Mega,   |  |
|  | - Dynamic Work Stealing| | - Sequential Streaming | |   1fichier, MediaFire |  |
|  | - Pause/Resume State   | | - Seed Ratio Limits    | | - Cookie & Session    |  |
|  | - Token-Bucket Limiter | | - Piece Visualizer     | |   Form / Bearer Auth  |  |
|  +------------------------+ +------------------------+ +-----------------------+  |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Queue Scheduler, Speed Limiter & Persistence (`scheduler/`, `config/`)      |  |
|  | - IDM-Style Queues (Main Queue, Scheduled Night Queue, Torrent Queue)       |  |
|  | - Global & Per-Download Bandwidth Throttling (Token Bucket Algorithm)       |  |
|  | - Auto-Categorization (Compressed, Documents, Music, Programs, Video)       |  |
|  | - Post-Download Actions (Checksum SHA-256/MD5, Antivirus Scan, Shutdown)    |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               MODERN DESKTOP UI (IDM + FDM Inspired React/TS Frontend)            |
|  - Top Action Ribbon: Add URL, Add Torrent, Resume, Pause, Stop All, Scheduler,   |
|    Speed Limiter Toggle, Browser Extensions Manager, Full Settings Dialog         |
|  - Left Sidebar: Smart Categories, Status Filters, Active Queues, Site Logins     |
|  - Main Data Grid & Inspector: Real-time Speed Sparkline, 32-Thread Chunk Map,    |
|    BitTorrent Peers/Trackers/Files Tabs, HTTP Header & FTP Handshake Log          |
|  - Footer: Global Transfer Telemetry + "Made with ❤️ by ~peivee"                  |
+-----------------------------------------------------------------------------------+

```

## 3. Subsystem Design & Technical Specifications

### 3.1 Multi-Threaded Segmented HTTP/HTTPS Engine (`src-tauri/src/engine/http.rs`)

* **Capability Probe (`HEAD` / `GET bytes=0-0`)**: Inspects `Accept-Ranges: bytes`, `Content-Length`, `Content-Disposition`, and `ETag` / `Last-Modified` headers.

* **Dynamic Segment Allocation & Work Stealing**: Splits files into `N` concurrent byte ranges (configurable from `1` to `32` threads, default `16` like IDM). Each worker runs as an independent Tokio task writing directly to pre-allocated file offsets (or segment `.part` regions) with zero memory bloat. When a fast worker finishes its chunk early, it dynamically splits the largest remaining active segment in half (IDM-style dynamic segmentation).

* **Resilient State Persistence**: Saves byte-exact segment progress every 500 ms to `<filename>.xdm.state` so interrupted downloads resume cleanly across application restarts or network drops.

* **Token-Bucket Bandwidth Limiter**: Enforces global and per-task speed limits down to millisecond granularity.

### 3.2 BitTorrent & Magnet Engine (`src-tauri/src/engine/torrent.rs`)

* **Protocol Support**: Parses `.torrent` bencoded metainfo files and `magnet:?xt=urn:btih:...` URIs.

* **Peer & Tracker Subsystems**: Supports HTTP/UDP trackers, Mainline DHT, Peer Exchange (PEX), Local Peer Discovery (LPD), and uTP/TCP peer connections.

* **Granular Control**: Selective file priority within multi-file torrents, sequential piece downloading (for media previewing), configurable listening port, UPnP/NAT-PMP port mapping, encryption mode, and automatic seeding cutoff at target share ratio or seeding time.

### 3.3 FTP/FTPS & Authenticated File-Sharing Resolver (`src-tauri/src/engine/ftp_auth.rs`)

* **FTP Protocol Handler**: Supports FTP/FTPS transfers with byte-offset resumption. SFTP is not supported by this build.

* **Authenticated File-Sharing Resolver**:

  * **Usersdrive (`usersdrive.com`)**, **1fichier**, **MediaFire**, and generic HTTP Basic/Bearer/Cookie authentication.

  * Works in two ways:

    1. **Browser Session Passthrough**: When a user initiates a download in Chromium, Firefox, or Safari after logging into a site or solving a gate, the ByteX browser extension captures the applicable browser cookies, `Referer`, and `User-Agent` and hands them to ByteX's worker threads.

    2. **Built-in Saved Site Logins (`SiteCredential`)**: Users can store host patterns with HTTP Basic credentials, Bearer tokens, cookies, or FTP/FTPS credentials. Matching entries are applied automatically when a download is added. For Usersdrive links (`https://usersdrive.com/<id>.html`), the resolver can use saved or browser-forwarded cookies and parse the available XFileSharing form fields to extract a direct CDN URL.

### 3.4 Cross-Browser Extension Suite & Automatic Installer (`src-tauri/src/browser/mod.rs` & `extensions/`)

* **Supported Browsers**:

  * **Chromium Family**: Google Chrome, Microsoft Edge, Brave Browser, Opera, Vivaldi, Chromium.

  * **Gecko Family**: Mozilla Firefox, LibreWolf, Waterfox.

  * **WebKit Family**: Apple Safari (via macOS Safari Web Extension wrapper).

* **Automatic Detection & Registration**:

  * On startup (and on-demand via the **Browser Extensions** UI modal), ByteX scans standard OS paths (`Applications` / `~/Library/Application Support` on macOS, Registry `HKCU\Software\Google\Chrome\NativeMessagingHosts` & `Extensions` on Windows, `~/.config/.../NativeMessagingHosts` & `/usr/share/.../extensions` on Linux).

  * Writes the platform-specific Native Messaging Host manifest (`com.peivee.xdm.json`) pointing to the installed app executable and installs browser extension policies where supported.

  * Users can toggle **Enable / Disable / Install / Reinstall** per browser directly from ByteX's UI, as well as configure intercepted file extensions (`ZIP, RAR, 7Z, EXE, DMG, DEB, ISO, MP4, MKV, MP3, PDF, TORRENT...`), minimum file size threshold, and bypass modifier keys (`Alt` / `Option`).

### 3.5 GitHub Actions Verification & Multi-OS Release Pipeline (`.github/workflows/release.yml`)

* Triggered automatically on push/merge to `main` (or version tags `v*.*.*`).

* **Stage 1 — Verification Gate**: Runs `cargo fmt --check`, `cargo clippy`, `cargo test` (unit tests for HTTP chunking, Usersdrive resolver, torrent parser, native messaging), `npm run typecheck`, `npm run build`, and packages all three browser extensions (`chromium`, `firefox`, `safari`).

* **Stage 2 — Semantic Version Computation**: Reads `Cargo.toml` / `tauri.conf.json` version and git history to create a typed release tag (e.g., `v1.0.0-stable` / `v1.0.0`).

* **Stage 3 — Cross-Platform Native Matrix Build**:

  * `macos-latest` (Universal `aarch64-apple-darwin` + `x86_64-apple-darwin`) -> `.dmg`, `.pkg`, and `.app.tar.gz`

  * `windows-latest` (`x86_64-pc-windows-msvc`) -> `.exe` (NSIS setup) and `.msi` (WiX installer)

  * `ubuntu-22.04` (`x86_64-unknown-linux-gnu`) -> `.deb`, `.AppImage`, and `.rpm`

* **Stage 4 — GitHub Release Publishing**: Publishes a version-typed GitHub Release containing the native OS installers alongside `bytex-extension-chromium.zip`, `bytex-extension-firefox.xpi`, and `bytex-extension-safari.zip`.

## 4. Repository Directory Structure

```
x-download-manager/
├── .github/
│   └── workflows/
│       └── release.yml                  # CI/CD verification + DMG/PKG/EXE/Linux + Extensions release
├── Cargo.toml                           # Workspace Cargo manifest
├── package.json                         # Frontend & Tauri CLI build configuration
├── tsconfig.json                        # TypeScript strict configuration
├── vite.config.ts                       # Vite bundler configuration
├── tailwind.config.js                   # Tailwind CSS theme (IDM/FDM dark/light palette)
├── index.html                           # Application entry HTML
├── src/                                 # React + TypeScript Frontend (IDM + FDM UI)
│   ├── main.tsx
│   ├── App.tsx                          # Main shell, ribbon toolbar, categories, footer
│   ├── types/
│   │   └── xdm.ts                       # Full TypeScript contracts matching Rust structs
│   ├── services/
│   │   └── tauriBridge.ts               # Tauri invoke/event bridge with fallback simulation
│   └── components/
│       ├── Toolbar.tsx                  # IDM/FDM top action bar
│       ├── Sidebar.tsx                  # Categories, Queues, Torrents, Filters
│       ├── DownloadTable.tsx            # Multi-column sortable download list
│       ├── SegmentInspector.tsx         # Live 32-thread chunk visualizer, peers, FTP log
│       ├── AddDownloadModal.tsx         # Add URL / FTP / Usersdrive / Magnet / Torrent modal
│       ├── BrowserExtensionsModal.tsx   # Manage Chrome/Firefox/Safari auto-install & status
│       ├── SettingsModal.tsx            # 8-tab comprehensive professional Settings dialog
│       └── SchedulerModal.tsx           # Queue & bandwidth schedule manager
├── src-tauri/                           # Rust Native Backend
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                      # Entry point & CLI / Native Messaging dispatcher
│       ├── lib.rs                       # Tauri commands, state management, event emitter
│       ├── config/
│       │   └── mod.rs                   # Settings, Site Logins, Categories, Persistence
│       ├── engine/
│       │   ├── mod.rs                   # Unified DownloadManager orchestrator
│       │   ├── http.rs                  # Multi-threaded HTTP/S segmented downloader
│       │   ├── torrent.rs               # BitTorrent & Magnet protocol engine
│       │   └── ftp_auth.rs              # FTP/FTPS & Usersdrive/File-host resolver
│       ├── browser/
│       │   ├── mod.rs                   # Browser detection, extension installer, Native Host
│       │   └── ipc_server.rs            # Localhost 127.0.0.1:45678 HTTP/WS server
│       └── scheduler/
│           └── mod.rs                   # Queue processor & token-bucket speed limiter
├── extensions/                          # Cross-Browser Extensions Source
│   ├── chromium/                        # Chrome, Edge, Brave, Opera, Vivaldi (MV3)
│   │   ├── manifest.json
│   │   ├── background.js
│   │   ├── content.js
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── styles.css
│   ├── firefox/                         # Mozilla Firefox / Gecko WebExtension
│   │   ├── manifest.json
│   │   ├── background.js
│   │   ├── content.js
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── styles.css
│   └── safari/                          # Apple Safari WebExtension + macOS Xcode Wrapper
│       ├── manifest.json
│       ├── background.js
│       ├── content.js
│       ├── popup.html
│       ├── popup.js
│       ├── styles.css
│       └── macos-wrapper/
│           ├── project.yml              # XcodeGen specification for Safari App Extension
│           └── SafariWebExtensionHandler.swift
└── scripts/
    └── package-extensions.sh            # Script to build & package all browser extensions

```
