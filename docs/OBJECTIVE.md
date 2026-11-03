# PROJECT: Universal Cross-Platform Download Manager

## ROLE AND OBJECTIVE

Act as a principal software architect, senior Rust engineer, Tauri specialist, browser-extension engineer, networking engineer, BitTorrent engineer, and application security engineer.

Design and build a production-grade, feature-rich download manager for Windows, macOS, and Linux, comparable to and exceeding IDM, Free Download Manager, and XDM.

The application must combine universal browser integration, advanced download management, torrent support, media streaming, scheduling, queues, parallel downloading, and secure credential management.

**MANDATORY: Begin with repository inspection, research, feasibility analysis, and technical planning. Do not immediately implement code.**

First inspect the existing repository, understand its architecture, research official APIs, evaluate dependencies, and prepare a detailed technical implementation plan.

Present the complete plan and wait for my explicit approval before writing implementation code.

---

# 1. TECHNOLOGY STACK

Use the following preferred technologies:

- Core language: Rust.
- Desktop framework: Tauri 2.x.
- Frontend: React and TypeScript.
- Styling: Tailwind CSS or an equivalent maintainable design system.
- Async runtime: Tokio.
- Database: SQLite.
- Database access: SQLx or an equivalent maintained library.
- HTTP networking: A maintained asynchronous Rust HTTP client.
- Torrent engine: Evaluate librqbit and other maintained Rust implementations.
- Browser extensions: TypeScript and WebExtensions APIs.
- Native communication: Native Messaging and Safari-specific application-extension messaging.
- Credential storage: OS-native secure credential facilities.
- Media streaming: Local HTTP streaming server with byte-range support.

Use a modular architecture with independently testable components.

Do not reinvent mature networking or torrent protocols unnecessarily.

---

# 2. DOWNLOAD ENGINE AND PROTOCOL SUPPORT

Create a unified Rust download engine that manages all supported downloads through a common job-management interface.

Supported protocols:

- HTTP.
- HTTPS.
- FTP.
- FTPS, where supported safely.
- SFTP, if implemented as a separate protocol.
- BitTorrent.
- Magnet links.
- Direct torrent files.
- Browser-originated downloads.

Support:

- Multiple simultaneous downloads.
- Configurable parallel connections per download.
- Segmented downloading.
- Pause and resume.
- Retry and recovery.
- Download priorities.
- Custom queues.
- Scheduling.
- Download speed limits.
- Upload limits for torrents.
- Progress and ETA.
- Persistent download state.
- Crash recovery.
- Disk-space checks.
- Filename collision handling.
- Temporary files.
- Atomic file finalization.
- Integrity verification.
- Download history.
- Categories and filters.

The engine must operate independently of the Tauri frontend.

---

# 3. GLOBAL PARALLEL DOWNLOAD MANAGEMENT

Implement an independently configurable limit for the number of simultaneous downloads.

The user must be able to configure how many separate downloads can run concurrently.

Examples:

- 1 simultaneous download.
- 2 simultaneous downloads.
- 5 simultaneous downloads.
- 10 simultaneous downloads.
- A configurable higher limit, subject to system resources.

Provide a global setting for maximum concurrent downloads.

Also support per-queue concurrency limits and per-host concurrency limits.

The scheduler and download engine must enforce these limits centrally.

Downloads waiting for a concurrency slot must remain queued without losing their state.

Changing the global concurrency limit must safely update the running scheduler.

Do not confuse the number of simultaneous files with the number of connections used by an individual file.

---

# 4. PER-DOWNLOAD THREAD AND CONNECTION MANAGEMENT

Implement configurable parallel connections for every individual download.

**Default: 8 threads/connections per download.**

**Maximum configurable value: 20 threads/connections per download.**

Allow the user to change this setting globally and override it individually for each download.

Provide a per-download control to:

- Increase the number of connections.
- Decrease the number of connections.
- Set a specific number between 1 and 20.
- Restore the default value of 8.
- View the actual number of active connections.
- View segment-level progress where applicable.

The global default must be 8, with a hard configurable upper limit of 20 unless the user explicitly changes the application-wide maximum through advanced settings.

## Segmented download implementation

For HTTP/HTTPS:

- Detect whether the server supports byte-range requests.
- Validate the Accept-Ranges header where present.
- Verify actual Range and Content-Range responses.
- Use HEAD or another safe capability probe when appropriate.
- Do not trust headers alone; validate actual range behavior.
- Use ETag or Last-Modified validators to detect changed resources.
- Divide files into appropriate segments.
- Download segments concurrently.
- Track segment progress independently.
- Merge segments safely.
- Verify the final file.
- Handle server-side connection limits.
- Reduce parallelism when servers reject excessive connections.
- Retry failed segments without corrupting completed segments.

Do not force segmented downloading when it is unsupported.

For non-resumable servers:

- Use a single connection.
- Clearly indicate that parallel segmented downloading is unavailable.
- Keep the requested thread preference for possible future retries.
- Explain why the effective connection count is lower than the configured value.

For FTP and other protocols:

- Investigate whether parallel ranged downloading is supported by the selected protocol and server.
- Implement parallel transfers only when safe and verified.

For BitTorrent:

- Use the torrent engine's peer connections, piece scheduling, and internal concurrency controls.
- Do not incorrectly translate the HTTP thread count into a fixed number of torrent peers.
- Expose appropriate torrent-specific connection and peer settings separately.

## Per-download settings

Every download must have its own effective configuration, including:

- Preferred connections: default 8.
- Maximum connections: 20.
- Segmented downloading enabled/disabled.
- Speed limit.
- Priority.
- Queue assignment.
- Destination.
- Retry policy.

Clearly distinguish preferred settings from the actual connections currently being used.

Changing the connection count during an active download must be supported where safe. Apply changes without corrupting partial data or unnecessarily restarting the download.

---

# 5. CUSTOM DOWNLOAD QUEUES

Implement a complete custom queue-management system.

Users must be able to create any number of queues.

Example default queues:

- Main Queue.
- High Priority.
- Low Priority.
- Scheduled Queue.
- Night Queue.
- Music Queue.
- Video Queue.
- Software Queue.
- Torrent Queue.

Users must be able to:

- Create queues.
- Rename queues.
- Delete queues.
- Set queue priorities.
- Set maximum simultaneous downloads per queue.
- Set preferred download connections per queue.
- Set speed limits per queue.
- Set scheduled operating hours.
- Set automatic start/stop rules.
- Reorder queues.
- Move downloads between queues.
- Pause or resume an entire queue.
- Start or stop a queue.
- Schedule an entire queue.
- Configure queue-specific download directories where appropriate.

Deleting a queue must not silently delete its downloads. Ask the user where to move the associated jobs.

Provide sensible default queues while allowing complete customization.

A download must belong to an identifiable queue or an explicitly defined unqueued state.

---

# 6. RIGHT-CLICK CONTEXT MENU AND QUEUE REASSIGNMENT

Implement a comprehensive context menu for every download in the download list.

When the user right-clicks a download, provide relevant actions:

- Start.
- Pause.
- Resume.
- Cancel.
- Retry.
- Move to Queue.
- Schedule.
- Change Priority.
- Change Threads/Connections.
- Change Speed Limit.
- Open File.
- Open Containing Folder.
- Copy Download URL.
- View Details.
- Remove from List.
- Delete Downloaded File.
- Play While Downloading, when supported.

## Move to Queue

The Move to Queue menu must display all available queues.

The user should be able to select any queue and move the selected download into it.

This functionality must work for:

- Queued downloads.
- Scheduled downloads.
- Currently downloading files.
- Paused downloads.
- Failed downloads, where retry is possible.

The application must update queue membership atomically and synchronize the scheduler.

Moving a download between queues must respect the destination queue's:

- Concurrency limits.
- Priority.
- Speed limits.
- Scheduling rules.
- Connection preferences.

Do not duplicate a download job or create a second download merely because the user changes its queue.

---

# 7. SAFE QUEUE REASSIGNMENT AND SCHEDULING OF ACTIVE DOWNLOADS

This requirement is particularly important.

The user must be able to move a currently downloading file into another queue or schedule it while it is downloading.

Before performing the operation, the engine must determine whether the download can safely resume.

## Case A: Resumable download

If the server supports reliable resume:

1. Safely pause the current download.
2. Persist completed segments and resume metadata.
3. Save ETag, Last-Modified, and other required validators.
4. Release its active connections.
5. Update its queue assignment or schedule.
6. Preserve downloaded bytes.
7. Resume later from the verified offset or completed segments.
8. Verify resource identity before continuing.

The user must not lose already downloaded data.

The operation should be seamless, without unnecessary restart.

## Case B: Non-resumable download

If the server does not support reliable resume, do not silently pause or restart the download.

When the user attempts to move it to a queue or schedule it, show a confirmation dialogue.

Example:

**"This download does not support resuming."**

"Moving this download to another queue or scheduling it will stop the current transfer. When it starts again, the file must be downloaded from the beginning. Your currently downloaded progress may be lost."

Provide explicit choices:

- Continue Downloading: Cancel the requested operation and keep downloading.
- Move and Restart: Confirm the operation and restart from the beginning when the destination queue or schedule allows.
- Cancel: Close the dialogue without changing anything.

Clearly display the amount of data that would be lost.

Never silently discard partial data.

Preserve partial files or diagnostic data safely where practical, but never treat an incomplete non-resumable file as a valid resume point.

Require explicit user confirmation before restarting.

## Case C: Resume capability is unknown

If the application cannot establish whether a download can resume:

- Treat it as potentially non-resumable.
- Do not silently stop it.
- Explain the uncertainty.
- Offer safe choices.
- Allow the user to continue downloading without modification.

## Case D: Queue destination can start immediately

If moving a download to a different queue does not require pausing or restarting because the destination queue has an available slot, the application may update queue assignment without interruption when safe.

However, all concurrency and scheduling rules must remain consistent.

Do not interrupt a healthy transfer unnecessarily.

---

# 8. INTELLIGENT DOWNLOAD SCHEDULER

Implement a complete scheduler for ordinary downloads, queues, and torrents.

Features:

- Start at a specified date and time.
- Daily schedules.
- Weekly schedules.
- Recurring schedules.
- Schedule individual downloads.
- Schedule entire queues.
- Pause at specified times.
- Resume at specified times.
- Schedule torrent seeding.
- Configure speed limits by schedule.
- Set maximum simultaneous downloads.
- Configure per-host limits.
- Configure preferred parallel connections.
- Network availability rules.
- Optional battery and metered-network rules.
- Optional shutdown or sleep after queue completion, with explicit confirmation and OS support.

Provide:

- Scheduler calendar.
- Daily and weekly views.
- Active schedule list.
- Next scheduled action.
- Edit and delete schedule.
- Time-zone-aware execution.
- Persistent schedules across application restarts and system reboots.

The scheduler must operate in the Rust backend even when the frontend is closed.

Handle missed schedules, sleep, clock changes, and application restarts predictably.

Use the safe resumability rules defined in Section 7 when scheduling an active download.

---

# 9. UNIVERSAL BROWSER INTEGRATION CENTER

Create a dedicated Browser Integration Center.

Automatically detect supported installed browsers.

Chromium-based:

- Chrome.
- Edge.
- Brave.
- Opera.
- Vivaldi.
- Other compatible browsers.

Firefox-based:

- Firefox.
- Firefox ESR.
- Compatible derivatives where supported.

Safari:

- Safari on macOS.

For each browser display:

- Browser name and version.
- Installation status.
- Extension installation status.
- Extension enabled status, where obtainable.
- Native messaging registration.
- Application connectivity.
- Last successful communication.
- Compatibility.
- Required permissions.
- Troubleshooting information.

Integration states:

1. Not installed.
2. Detected.
3. Extension missing.
4. Extension disabled.
5. Extension enabled.
6. Native host missing.
7. Application unreachable.
8. Successfully integrated.
9. Update required.
10. Integration error.

Provide actions to install, enable, disable, test, repair, and diagnose integration.

Do not report successful integration merely because a browser executable exists.

Do not modify browser profiles without user consent.

---

# 10. UNIVERSAL DOWNLOAD INTERCEPTION

Make the download manager the default destination for eligible browser downloads.

Intercept all eligible downloadable file types, regardless of extension or MIME type.

Examples:

- EXE, MSI, DMG, PKG.
- ZIP, RAR, 7Z, TAR.
- PDF and documents.
- MP3, WAV, FLAC.
- MP4, MKV, AVI, MOV.
- Images.
- ISO.
- APK.
- Unknown extensions.
- Dynamically generated files.
- Authenticated downloads.
- Direct download links.

Do not maintain a restrictive file-extension whitelist as the default.

Investigate the earliest supported interception mechanism for every browser.

Do not wait until the browser has downloaded the entire file before attempting handoff.

Do not claim that browser APIs permit pre-network interception when they do not.

The handoff must:

1. Detect the browser download.
2. Collect available metadata.
3. Contact the native application.
4. Validate the request.
5. Persist the job.
6. Receive durable acceptance.
7. Stop the browser download only when a safe replacement strategy exists.
8. Start the desktop download.
9. Synchronize handoff status.
10. Notify the user.

If handoff fails, preserve browser fallback whenever possible.

Support automatic interception, confirmation mode, and disabled mode.

Provide domain exclusions, file-type rules, minimum size settings, and browser-specific preferences.

---

# 11. DOWNLOAD HANDOFF NOTIFICATIONS

The extension must inform the user about every important handoff event.

Statuses:

- Download detected.
- Handoff in progress.
- Handoff accepted.
- Browser download stopped.
- Desktop download started.
- Handoff failed.
- Browser fallback active.
- Authentication required.
- Download completed.
- Download failed.

Example notifications:

- "Download intercepted. Transferring to Download Manager..."
- "Successfully handed over. Downloading in the application."
- "Handoff failed. Browser download will continue."
- "This server does not support resume. Confirm before restarting."

Provide browser popup notifications and desktop notifications.

Allow clicking a notification to open the corresponding download.

Group notifications for multiple downloads.

Persist handoff state so extension restarts do not lose status.

Never claim a successful handoff until the application has durably accepted the request.

---

# 12. AUTHENTICATION AND SESSION PRESERVATION

Reproduce the original browser request as accurately as browser APIs legitimately allow.

Collect available:

- Original URL.
- Final URL.
- HTTP method.
- POST body, if exposed.
- Referrer.
- User-Agent where appropriate.
- Relevant headers.
- Cookies.
- Authorization information.
- Content-Disposition.
- Browser metadata.
- Redirect information.
- Session context.

Do not assume every browser exposes all request information.

Use a priority-based strategy:

1. Reproduce the original request.
2. Transfer legitimately accessible cookies and headers securely.
3. Reuse browser-provided request context where possible.
4. Request browser-assisted authentication.
5. Use a controlled fallback.

Never bypass browser security restrictions.

Never log credentials, cookies, authorization headers, or sensitive signed URLs.

Use secure storage and expiration policies.

---

# 13. HTML RESPONSE DETECTION AND RECOVERY

Detect HTML responses returned instead of actual requested files.

Possible causes:

- Login pages.
- Expired sessions.
- Expired signed URLs.
- Security challenges.
- Access denied.
- Hotlink protection.
- Referrer restrictions.
- POST-based downloads.
- Redirect failures.
- FTP gateway pages.
- Server errors.

Validate:

- HTTP status.
- Content-Type.
- Content-Disposition.
- Filename.
- Expected file type.
- Magic bytes.
- Actual downloaded content.

Never silently save an HTML login or error page with a ZIP, PDF, MP4, or EXE extension.

Recovery process:

1. Detect the unexpected response.
2. Stop treating it as a successful file.
3. Preserve diagnostic information.
4. Identify the probable reason.
5. Attempt safe authentication recovery.
6. Ask the user to authenticate in the original browser if necessary.
7. Retry using updated session information.
8. Preserve the original browser fallback whenever possible.

Evaluate browser-assisted streaming or controlled temporary downloads for cases that cannot be reproduced through a native HTTP request.

Never buffer an entire large file in extension memory.

---

# 14. FTP CREDENTIAL MANAGER

Create a dedicated credential manager for FTP and other supported remote protocols.

Support saving:

- Protocol.
- Hostname.
- Port.
- Username.
- Password or secure credential reference.
- Remote directory.
- Display name.
- Anonymous login setting.
- Connection preferences.

Features:

- Add.
- Edit.
- Delete.
- Test connection.
- Automatic credential matching.
- Multiple accounts on the same server.
- Reuse credentials.
- Authentication prompts.

Never store plaintext passwords in SQLite.

Use:

- Windows Credential Manager.
- macOS Keychain.
- Linux Secret Service/libsecret.

Never send credentials to unrelated redirected hosts.

Warn users about insecure FTP connections.

Treat FTP, FTPS, and SFTP as separate protocols.

---

# 15. BITTORRENT ENGINE

Implement first-class torrent support.

Evaluate librqbit and other maintained Rust torrent engines.

Support:

- Magnet links.
- Torrent files.
- HTTP/HTTPS-hosted torrent files.
- Multi-file torrents.
- Selective file downloads.
- Pause and resume.
- Torrent queues.
- Seeding.
- Upload/download limits.
- Peer and seed counts.
- Trackers.
- Ratios.
- Priorities.
- Persistent state.
- Fast resume.
- Integrity checking.
- DHT.
- PEX.
- UDP and HTTP trackers.
- Private torrents.
- IPv4 and IPv6 where supported.

Integrate torrents into the same dashboard, queue system, and scheduler.

Provide separate torrent-specific peer and connection settings.

Do not interpret HTTP thread settings as torrent peer counts.

Make seeding and upload behavior transparent and configurable.

---

# 16. PROGRESSIVE MEDIA STREAMING

Allow audio and video to play while downloading.

Support, where technically possible:

- HTTP.
- HTTPS.
- FTP.
- FTPS/SFTP where implemented.
- BitTorrent.

Examples:

- MP3.
- AAC.
- FLAC.
- WAV.
- MP4.
- WebM.
- MKV.
- Other supported media formats.

Implement a local streaming server.

Requirements:

- Play available downloaded data.
- Show playback progress.
- Support seeking when the required bytes are available or can be prioritized.
- Prioritize required bytes.
- Support HTTP Range requests.
- Handle temporarily unavailable ranges.
- Continue downloading in the background.
- Avoid reading incomplete data as complete.
- Clean up streaming resources safely.

For torrents, prioritize pieces needed for playback and seeking.

For sequential HTTP downloads, play the contiguous downloaded portion when the media format permits.

Handle media-container constraints, including MP4 metadata that may reside near the end of the file.

Provide an internal or external media player.

Streaming must never corrupt the underlying download.

Do not require transcoding by default.

---

# 17. DOWNLOAD USER INTERFACE

Create a polished, modern desktop interface.

Main sections:

1. All Downloads.
2. Active Downloads.
3. Queued Downloads.
4. Scheduled Downloads.
5. Paused Downloads.
6. Completed Downloads.
7. Failed Downloads.
8. Torrents.
9. Media Streaming.
10. Browser Integrations.
11. FTP Credentials.
12. Download History.
13. Settings.

Every download entry should show:

- Filename.
- File type.
- Source.
- File size.
- Downloaded bytes.
- Progress.
- Speed.
- ETA.
- Status.
- Protocol.
- Queue.
- Priority.
- Effective connections.
- Configured connections.
- Destination.
- Start time.

Provide a detailed download view showing:

- Download URL.
- Connection information.
- Safe request diagnostics.
- Resume capability.
- Active segment information.
- Segment progress.
- Server response details.
- Retry history.
- Error diagnostics.
- Torrent peer information.

## Context menus

Every download must have a right-click context menu with relevant actions:

- Start.
- Pause.
- Resume.
- Cancel.
- Retry.
- Move to Queue.
- Schedule.
- Change Priority.
- Change Threads.
- Change Speed Limit.
- Open File.
- Open Containing Folder.
- Copy URL.
- View Details.
- Remove.
- Delete File.
- Play While Downloading.

The Move to Queue action must list every available custom queue.

Allow reassignment while downloading, subject to the resumability and confirmation rules in Section 7.

Support multi-select and bulk operations.

Keep the interface responsive with hundreds of jobs.

---

# 18. GLOBAL AND INDIVIDUAL SETTINGS

Provide global defaults and per-download overrides.

Important global settings:

- Maximum simultaneous downloads.
- Default threads per download: 8.
- Maximum threads per download: 20.
- Default queue.
- Default download directory.
- Default retry policy.
- Default speed limit.
- Segmented downloading.
- Automatic browser interception.
- Browser notification preferences.
- Media player preference.
- Torrent seeding policy.

Individual download settings must override global defaults without changing other jobs.

Show which settings are inherited and which have been customized.

When global settings change, apply them safely to future downloads and allow users to choose whether active downloads should inherit changes.

---

# 19. SYSTEM TRAY AND BACKGROUND OPERATION

Implement:

- Minimize to tray.
- Continue downloads after closing the main window.
- Start on system login with consent.
- Background notifications.
- Restore application from tray.
- Pause all.
- Resume all.
- Show active download count.
- Safe application exit.

Do not terminate download workers when the frontend closes.

Handle shutdown and application termination gracefully.

---

# 20. NATIVE COMMUNICATION AND EXTENSION ARCHITECTURE

Chromium:

- Manifest V3.
- Chrome, Edge, Brave, Opera, Vivaldi where compatible.
- Native Messaging.

Firefox:

- Current WebExtensions APIs.
- Native Messaging.

Safari:

- Safari Web Extension.
- Containing macOS application.
- Native application-extension messaging.
- Apple signing and packaging.

Implement:

- Versioned message protocol.
- Request IDs.
- Acknowledgements.
- Durable job acceptance.
- Duplicate detection.
- Timeouts.
- Retries.
- Status synchronization.
- Health checks.
- Protocol version negotiation.
- Message validation.
- Reconnection after extension restarts.

Do not assume identical browser capabilities.


---

# 20A. PRODUCTION-GRADE BROWSER EXTENSION: PRIMARY BRIDGE

The browser extension is the primary bridge between the user's browser and the desktop download engine. Treat it as a first-class product component, not a thin URL-forwarding script.

Build a reliable, actively intelligent, observable, recoverable extension system for Chromium, Firefox, and Safari. The extension must coordinate browser events, collect only legitimately available request context, negotiate safe handoff, communicate durably with the native application, and preserve the browser's original download whenever handoff is uncertain.

**Reliability principle:** No software can promise that a browser extension will never fail. Engineer for graceful degradation, automatic recovery, duplicate-safe delivery, transparent status, and zero silent data loss. A failed or uncertain handoff must never leave the user with neither a browser download nor a valid desktop download.

## 20A.1 Separate extension architecture

Use a modular TypeScript codebase with shared business logic and browser-specific adapters. Do not force all browsers into an identical implementation where their APIs differ.

Recommended logical modules:

- **Browser adapter:** wraps browser-specific APIs and exposes a normalized capability interface.
- **Download observer:** detects browser downloads as early as the browser permits.
- **Navigation and link observer:** identifies likely downloadable navigation, direct links, and user-initiated download actions without intercepting ordinary browsing unnecessarily.
- **Request-context collector:** gathers permitted URL, method, referrer, headers, filename, tab, frame, initiator, cookie/session hints, and other available metadata.
- **Handoff coordinator:** owns the handoff state machine and makes the cancel/continue decision.
- **Native bridge client:** handles Native Messaging or the Safari-specific bridge.
- **Durable outbox:** retains pending messages and handoff state across service-worker, extension, and browser restarts.
- **Policy engine:** applies user preferences, exclusions, file rules, privacy settings, and per-site decisions.
- **Download classifier:** estimates whether an event is a file download, media navigation, ordinary page navigation, blob download, or unsupported case.
- **Authentication recovery coordinator:** requests browser-assisted recovery when the desktop engine cannot reproduce the request.
- **Notification and popup controller:** displays accurate status and actionable errors.
- **Diagnostics and telemetry:** provides local, privacy-preserving health and troubleshooting information.
- **Migration and update manager:** safely upgrades extension storage and protocol compatibility.
- **Browser-specific adapters:** Chromium MV3, Firefox WebExtensions, and Safari Web Extension implementations.

Keep core logic browser-independent. Isolate browser-specific API calls behind adapters and document every capability difference.

## 20A.2 Manifest, permissions, and store compliance

Create and maintain separate, correctly configured manifests/build targets where browser requirements differ.

- Use Manifest V3 for Chromium browsers.
- Use the current supported WebExtensions model for Firefox.
- Build Safari as a Safari Web Extension inside its containing macOS application, using Apple's supported extension and messaging model.
- Request the minimum permissions required for the selected features.
- Explain each permission in user-facing language and request optional permissions only when the user enables the related feature.
- Avoid broad host permissions where optional host permissions or per-site grants are sufficient.
- Do not request access to all browsing data merely for convenience.
- Do not inject scripts into every page by default.
- Do not use remote hosted executable code or violate browser extension-store policies.
- Keep the extension compatible with browser review, signing, update, and distribution requirements.
- Maintain a permission/capability matrix for each browser and release.

The extension must continue to provide useful functionality when optional permissions are denied. Show the affected capability and a clear way to grant permission later; never silently pretend it is enabled.

## 20A.3 Early and comprehensive download detection

Use the earliest reliable browser-supported events and APIs for each browser. Combine appropriate mechanisms instead of depending on one fragile event.

Evaluate and implement, where supported:

- Browser download lifecycle APIs, including creation, change, interruption, completion, and cancellation events.
- Navigation and request observation APIs for identifying download-triggering responses.
- User-initiated link context-menu actions such as **Download with Download Manager**.
- Context-menu actions for selected links, images, audio, and video where browser APIs permit.
- Page-level detection for dynamically created download links and Blob/Object URL downloads, only where permitted and without collecting unrelated page content.
- Tab, frame, initiator, and navigation metadata to associate an event with its originating action.
- Browser-specific download interception and redirect behavior.

Detection must cover ordinary and unfamiliar file types. Do not use a restrictive extension or MIME whitelist. Use response disposition, MIME hints, URL patterns, filename hints, browser download events, and user intent as signals rather than absolute truth.

Do not mistake normal HTML navigation, streamed media playback, or an ordinary page load for a file download. Use conservative classification and allow the user to explicitly send a link to the manager when automatic classification is ambiguous.

For every browser, document the exact point at which the extension can observe a download and whether the browser may already have started transferring bytes. Do not claim pre-network interception unless the relevant browser API genuinely guarantees it.

## 20A.4 Smart download classification and policy engine

Implement a deterministic, explainable policy engine. It should consider:

- Browser and browser version.
- Current integration health.
- User's global interception mode.
- Per-browser settings.
- Per-domain allow/deny rules.
- Per-file-type rules, including unknown types.
- Minimum file-size preferences when size is known.
- Private/incognito mode and the user's explicit permission for it.
- Whether the download is user initiated.
- Whether the URL is a direct resource, a redirect, a blob URL, a data URL, or a generated resource.
- Whether required request data is available.
- Whether the desktop application is reachable.
- Whether the native bridge protocol is compatible.
- Whether the destination queue and disk are available.
- Whether a safe replacement transfer can be established.
- Whether the user has selected confirmation mode.

Provide three clear modes:

1. **Automatic:** attempt handoff for eligible downloads, but cancel the browser transfer only after the safety conditions below are satisfied.
2. **Ask before handoff:** show a prompt with the best available filename, source, size, and transfer limitations.
3. **Browser only:** observe nothing beyond what is needed for explicitly requested extension actions; do not automatically hand off.

Support temporary per-download decisions, domain exclusions, allowlists, and a one-click **Always use manager for this site** option. Explain why a decision was made in the extension popup or event details.

Do not silently override the user's policy.

## 20A.5 Handoff state machine and cancellation safety

Implement a formal, persisted state machine. At minimum:

`DETECTED → CLASSIFIED → CONTEXT_COLLECTED → BRIDGE_CONNECTING → SUBMITTED → APP_VALIDATING → APP_ACCEPTED → REPLACEMENT_READY → BROWSER_CANCEL_REQUESTED → BROWSER_CANCELLED → DESKTOP_RUNNING`

Also support terminal or recoverable states:

- `IGNORED_BY_POLICY`
- `USER_CONFIRMATION_REQUIRED`
- `APP_UNAVAILABLE`
- `PROTOCOL_MISMATCH`
- `APP_REJECTED`
- `AUTH_REQUIRED`
- `UNSUPPORTED_REQUEST`
- `REPLACEMENT_FAILED`
- `BROWSER_CANCEL_FAILED`
- `BROWSER_FALLBACK_RUNNING`
- `COMPLETED`
- `FAILED`
- `CANCELLED_BY_USER`
- `RECOVERY_REQUIRED`

Persist state transitions and timestamps. Every transition must be validated; reject impossible or stale transitions.

**Critical cancellation rule:**
- Never cancel the browser's original download merely because the extension detected it, sent a message, or received a transport-level acknowledgement.
- The native application must validate the request, create a durable job record, reserve required resources where applicable, and return a durable acceptance response.
- For cases where a native retry may fail after browser cancellation, require a clearly defined replacement-ready condition or another tested recovery guarantee before cancellation.
- If the app is unavailable, rejects the request, times out, reports an unsupported request, or cannot establish a safe replacement, let the browser download continue.
- If cancellation itself fails, detect that fact and reconcile both transfers without silently creating duplicate downloads or claiming success.
- Do not cancel a browser download that has already completed.
- Do not claim the browser transfer was stopped unless the browser confirms the resulting state.
- Preserve the original browser download as the safe fallback until the handoff has crossed the defined safety boundary.

Where the browser API does not provide a reliable way to stop a transfer at the required point, explain the limitation and use a safe alternative such as user-confirmed handoff, allowing the browser transfer to finish, or using an explicit link action.

## 20A.6 Durable messaging, acknowledgements, and exactly-once effects

Design the extension/native protocol for at-least-once message delivery with idempotent processing. Do not assume a message is delivered exactly once.

Every handoff must include:

- Globally unique `handoff_id`.
- Unique `request_id` and message ID.
- Extension installation ID (non-secret).
- Browser family and version.
- Protocol version.
- Creation timestamp and expiry.
- Download event identity where available.
- A normalized request payload.
- Capability flags and known limitations.
- A content fingerprint or stable deduplication key that does not expose secrets.
- Current handoff state and retry count.

The native application must enforce a unique idempotency key and return the existing job for duplicate submissions rather than creating duplicate jobs.

Use explicit message types such as:

- `HELLO`
- `CAPABILITIES`
- `PING`
- `PONG`
- `SUBMIT_DOWNLOAD`
- `ACCEPTED`
- `REJECTED`
- `GET_HANDOFF_STATUS`
- `HANDOFF_STATUS`
- `CANCEL_BROWSER_DOWNLOAD`
- `BROWSER_CANCEL_RESULT`
- `AUTH_REQUIRED`
- `AUTH_CONTEXT_UPDATED`
- `CANCEL_HANDOFF`
- `ACK`
- `ERROR`
- `SHUTDOWN`

Define a versioned JSON schema for every message. Validate message size, fields, types, URL schemes, IDs, timestamps, enum values, and protocol versions on both sides. Reject malformed, oversized, stale, or unsupported messages safely.

Every state-changing request must receive an application-level acknowledgement. Distinguish:
- Message received.
- Request validated.
- Job durably persisted.
- Replacement transfer prepared.
- Transfer actually started.

A transport write succeeding is not proof that a job was accepted. An ACK must identify the request and the exact state it confirms.

Use bounded retries with exponential backoff and jitter, message expiry, dead-letter/error states, and a maximum retry policy. Never retry forever or create unbounded queues. Keep retry behavior deterministic and observable.

## 20A.7 Durable outbox, restart recovery, and reconnection

The extension must tolerate Manifest V3 service-worker suspension, browser shutdown, extension reload, desktop-app restart, operating-system restart, and temporary network loss.

- Persist pending handoffs and their last acknowledged state in extension storage.
- Use IndexedDB or another supported durable store for structured records; do not rely only on in-memory variables or service-worker globals.
- Keep messages small and avoid storing file contents in extension storage.
- On startup, browser wake, native-port disconnect, or app reconnect, reconcile every nonterminal handoff with the native application.
- Ask the app for authoritative status before resubmitting or changing state.
- Resume only safe operations; never infer that a transfer started from an old local status.
- Make repeated reconciliation idempotent.
- Remove or archive records only after terminal state and retention policy permit.
- Handle storage quota errors and corrupted/migrated records without crashing the extension.
- Use schema-versioned storage migrations with rollback or safe recovery behavior.
- If the native messaging port disconnects, mark the bridge as degraded, reconnect with bounded backoff, and show the user the actual status.
- If the app restarts, the extension must discover it again and reconcile pending jobs automatically.

Do not rely on persistent background execution where a browser does not support it.

## 20A.8 Native host and desktop bridge requirements

Implement a small, hardened native messaging host for Chromium and Firefox, and the appropriate Safari containing-app bridge.

The native host must:

- Use the exact browser-specific framing and message-size rules.
- Read and write protocol messages without corrupting framing or mixing diagnostic output with protocol output.
- Send logs only to a protected log destination, never to the native messaging standard-output stream.
- Validate the calling browser/extension identity using the platform's supported registration and origin restrictions.
- Support multiple browser installations and profiles where the platform permits.
- Register, repair, update, and unregister host manifests safely.
- Avoid arbitrary command execution and unsafe shell interpolation.
- Start the desktop backend or communicate with an already-running local service using a documented, authenticated IPC mechanism.
- Enforce strict message size limits, timeouts, and backpressure.
- Recover from partial reads, malformed frames, broken pipes, and unexpected process termination.
- Return structured errors without leaking credentials or internal paths.
- Never trust extension-provided filenames or filesystem paths; normalize and validate them in the desktop application.
- Avoid opening a public network listener merely to communicate with the extension.

For Safari, design and test the containing macOS application and extension messaging lifecycle separately. Do not pretend Chromium/Firefox Native Messaging is interchangeable with Safari's architecture.

## 20A.9 Request-context collection and privacy boundaries

Collect only data needed to reproduce the user's intended download and only where browser APIs and granted permissions permit it.

Capture, when available:

- Original and final URL.
- HTTP method.
- Request body only when legitimately exposed and safe to transfer.
- Referrer and initiator origin.
- Relevant request headers.
- Cookie/session context through supported APIs and explicit permissions.
- Suggested filename and Content-Disposition hints.
- MIME type and expected size.
- Tab ID, frame ID, browser profile context, and user-gesture information where available.
- Redirect chain and response status when observable.
- Whether the resource is a normal URL, blob, data URL, or generated resource.

Do not attempt to read passwords, page text, form fields, or unrelated browsing activity. Do not scrape arbitrary page DOM to discover secrets. Never bypass same-origin policy, content security policy, browser permission boundaries, or extension-store rules.

Treat cookies, authorization headers, signed URLs, POST bodies, and referrer values as secrets:
- Transfer them only over the authenticated local bridge.
- Do not expose them in popup UI, notifications, logs, crash reports, analytics, or diagnostic exports.
- Apply strict size and lifetime limits.
- Avoid persisting them in extension storage unless essential; prefer short-lived transfer and secure native storage.
- Redact them from error messages.
- Do not forward credentials to a different host after redirects unless explicitly authorized and safe.
- Provide a user-controlled setting for whether authenticated browser downloads may be handed off.

Explicitly mark unavailable request fields. The desktop engine must know whether a request is fully reproducible, partially reproducible, or unsupported rather than silently assuming missing context.

## 20A.10 Special resource types and difficult download cases

Create explicit strategies and tests for:

- Direct HTTP/HTTPS downloads.
- Redirect chains and expiring signed URLs.
- Cookie-authenticated downloads.
- HTTP Basic/Digest or other supported authorization.
- POST-based file downloads.
- Downloads initiated by forms.
- Blob and Object URL downloads.
- Data URLs.
- Dynamically generated links.
- Unknown MIME types and filenames.
- Content-Disposition filename variants.
- Very large files.
- Cross-origin downloads.
- Browser-managed downloads with partial metadata.
- Downloads initiated from iframes.
- Downloads that start before the extension can observe them.
- FTP links and FTP gateway pages.
- Media streams that should be played rather than downloaded.
- Browser-native viewers for PDF or media.
- Private/incognito windows where the user has explicitly enabled extension access.

For Blob/Object URL or generated downloads, determine whether the browser exposes a safe, bounded way to transfer the content. Never copy a huge file into extension memory or send binary payloads through Native Messaging. If the browser cannot expose a safe transfer path, keep the browser download or offer an explicit supported alternative.

For POST downloads, preserve the method and body only if the browser legitimately exposes them. If not, do not reconstruct a different GET request and pretend it is equivalent. Use a browser-assisted or browser-native fallback, or clearly report that automatic handoff is unsupported.

For media and browser-native viewers, distinguish playback/navigation from a file download. Provide an explicit context-menu handoff when automatic classification is ambiguous.

## 20A.11 Intelligent response validation and authentication recovery

The extension must cooperate with the desktop engine when the native request returns HTML, a login page, a challenge, an expired session, an access-denied page, or another unexpected response.

- Receive structured failure reasons from the desktop application.
- Display a useful explanation without exposing sensitive response content.
- Offer **Retry with browser session**, **Open original page**, or **Continue in browser** when appropriate.
- When supported, request a fresh, narrowly scoped browser session context after the user re-authenticates.
- Bind refreshed context to the same handoff ID and intended origin.
- Revalidate origin and redirect boundaries before sharing refreshed credentials.
- Expire temporary auth context promptly.
- Do not repeatedly retry an unchanged failed request.
- Do not bypass CAPTCHAs, access controls, paywalls, or other security mechanisms.
- Never cancel a working browser fallback merely because an authentication retry was attempted.

The desktop application remains responsible for validating actual response bytes, status, content type, content disposition, and file signatures. The extension must surface the result accurately.

## 20A.12 Extension popup, controls, and user experience

Build a polished popup and options page with:

- Connection status: Connected, Connecting, Disconnected, Incompatible, or Degraded.
- Current application version and extension protocol compatibility.
- Current interception mode.
- Per-browser integration status.
- Recent handoffs and their actual states.
- Active download count where available.
- Retry/reconnect action.
- Open Download Manager action.
- Pause/disable interception action.
- Per-site exclusion and allow action.
- Permission status and explanation.
- Diagnostics and copyable redacted error details.
- Link to full settings in the desktop application.

Each handoff entry should show a concise status and meaningful action. Examples: **Waiting for app**, **Accepted by app**, **Browser continuing**, **Authentication needed**, **Desktop transfer running**, **Completed**, or **Needs attention**.

Provide an explicit manual action such as **Download with Download Manager** in link context menus. It should work even when automatic detection is disabled, subject to the user's permissions and browser support.

Do not show a green success state until the desktop application confirms the relevant durable state. Avoid vague spinners that can remain indefinitely; show timeout, retry, and fallback states.

## 20A.13 Notifications and user decision controls

Provide concise, accurate notifications for meaningful state changes, with controls to avoid notification spam.

- Group simultaneous handoffs.
- Deduplicate repeated events.
- Respect browser and OS notification permissions.
- Allow notification preferences per event type.
- Clicking a notification should open the matching job or handoff details.
- Do not include full signed URLs, cookies, tokens, or sensitive filenames in notifications unless the user has explicitly chosen to show them.
- Distinguish a handoff accepted by the app from a transfer that has actually started.
- Notify when the browser fallback is continuing.
- Notify when user action is required.
- Allow the user to cancel a pending handoff without accidentally cancelling the original browser download.

## 20A.14 Multiple browsers, profiles, and concurrent events

Support multiple installed browsers and multiple browser profiles where the relevant platform APIs permit it.

- Give each extension installation a stable, non-secret installation identifier.
- Keep browser/profile identity separate from user secrets.
- Handle multiple simultaneous downloads without mixing metadata or statuses.
- Serialize or safely coordinate state transitions for the same handoff.
- Apply backpressure when many downloads arrive at once.
- Prevent one slow handoff from blocking unrelated downloads.
- Enforce configurable limits on pending handoffs and message queues.
- Handle duplicate browser events and event reordering.
- Correlate events using browser download IDs plus the globally unique handoff ID.
- Detect stale browser download IDs after browser restart.
- Never assume browser download IDs are globally unique or permanent.

## 20A.15 Extension health, self-diagnostics, and repair

Implement an active health model rather than a binary connected/disconnected flag.

Check and report independently:

- Extension installed and enabled, where detectable.
- Required permissions granted.
- Browser API capabilities available.
- Native host registered.
- Native host launch successful.
- Protocol version compatible.
- Desktop application reachable.
- Last successful heartbeat.
- Pending outbox count.
- Oldest pending handoff age.
- Recent failures and retry state.
- Storage health and migration state.
- Extension update required.
- Browser restart required, if applicable.

Provide a diagnostic test that performs a harmless handshake and a separate user-triggered test download using a safe local or controlled test resource. Never create an uncontrolled external download during diagnostics.

Offer guided repair steps for missing native host registration, incompatible versions, disabled permissions, unavailable app, and stale pending messages. Do not silently edit browser profiles or disable other extensions.

Use heartbeats only when supported and appropriate; do not keep service workers artificially alive in violation of browser lifecycle rules.

## 20A.16 Updates, compatibility, and rollout safety

- Version the extension, native host, and desktop app independently.
- Define minimum and maximum compatible protocol versions.
- Negotiate capabilities at connection time.
- Support a documented compatibility window for staged updates.
- Fail safely on incompatible versions; do not send messages with unknown semantics.
- Make database and extension-storage migrations backward-aware where possible.
- Do not remove old protocol support until the compatibility policy permits it.
- Ensure extension updates do not erase pending handoffs.
- Test upgrades from every supported previous release.
- Provide rollback or recovery instructions for failed updates.
- Sign and distribute packages through approved browser and OS channels.

## 20A.17 Observability and diagnostics

Maintain structured local logs and metrics for:

- Detection time.
- Classification decision and reason.
- Available/missing request-context fields.
- Bridge connection attempts.
- Message IDs and retry counts.
- Durable acceptance time.
- Replacement-ready time.
- Browser cancellation result.
- Desktop start confirmation.
- Final outcome and failure category.

Use correlation IDs across extension, native host, and Rust backend. Redact secrets at the point of collection, not merely when displaying logs.

Provide a downloadable diagnostic report containing versions, capabilities, state transitions, and redacted errors. Make diagnostic sharing opt-in. Do not collect browsing history or send telemetry by default.

## 20A.18 Extension test strategy and acceptance criteria

Test the real built extension in every supported browser and operating system. Unit tests and mocks are necessary but insufficient.

Include automated and manual tests for:

- Fresh install, upgrade, disable, re-enable, uninstall, and reinstall.
- Missing or broken native host.
- App not installed, app closed, app starting, app crashing, and app restarting.
- Native port disconnect during every handoff state.
- Browser restart and service-worker suspension during every handoff state.
- Duplicate events, duplicate messages, reordered messages, timeouts, malformed frames, and stale ACKs.
- Multiple concurrent downloads and large bursts of events.
- Permission denied, permission revoked, and host permission granted later.
- Every interception mode and per-site policy.
- Direct files, unknown extensions, redirects, authenticated resources, POST requests, Blob URLs, Object URLs, data URLs, and dynamically generated downloads.
- HTML login/error pages, expired sessions, access denied, and server challenges.
- Browser download already completed before observation.
- Browser cancellation succeeds, fails, or returns an ambiguous result.
- App accepts a job but crashes before starting it.
- App persists a job but the ACK is lost.
- Extension receives ACK but crashes before persisting it.
- Reconciliation after both app and browser restart.
- Protocol mismatch and extension/app version skew.
- Incognito/private mode with and without permission.
- Safari-specific lifecycle, signing, packaging, and messaging behavior.
- Storage quota exhaustion and corrupted extension state.
- Notification permission denied.
- Privacy checks proving secrets do not appear in logs or diagnostics.

Acceptance criteria:

1. A detected event never creates duplicate desktop jobs when messages are retried.
2. A browser download is never cancelled before durable app acceptance and the defined replacement safety condition.
3. If the bridge is unavailable or uncertain, the browser download remains available as fallback.
4. A lost ACK is recovered by querying the same handoff ID, not by creating a new job.
5. Extension or app restart reconciles pending handoffs without losing their identity or status.
6. The extension never reports a state stronger than the evidence received from the browser or desktop app.
7. Sensitive request context is not exposed in logs, notifications, or diagnostic exports.
8. Unsupported browser capabilities are disclosed accurately and degrade gracefully.
9. Every failure has a diagnosable state and a user-understandable recovery action.
10. Actual compatibility is claimed only for browser/OS combinations tested in the release.

## 20A.19 Required extension deliverables

Produce and maintain:

- Shared TypeScript extension core.
- Chromium Manifest V3 build.
- Firefox build and manifest.
- Safari Web Extension project and containing-app integration.
- Browser-specific capability matrix.
- Versioned message protocol schema and documentation.
- Native messaging host and registration installers.
- Durable outbox and recovery implementation.
- Popup, options, context menus, and notifications.
- Permission and privacy documentation.
- Handoff state-machine diagram.
- Failure/recovery decision table.
- Automated extension test suite.
- Real-browser integration test suite.
- Installation, update, repair, and troubleshooting guides.
- Security review covering extension permissions, native messaging, secrets, and hostile web content.

The extension is not complete merely because it can send a URL to the app. It is complete only when detection, policy, safe handoff, durable messaging, cancellation safety, recovery, diagnostics, privacy, and real-browser testing work together.

---

# 21. SECURITY AND PRIVACY

Create a formal threat model.

Protect:

- FTP credentials.
- Cookies.
- Session tokens.
- Authorization headers.
- Signed URLs.
- Download paths.
- Torrent metadata.
- Streaming endpoints.
- IPC communication.

Implement:

- OS-native secure storage.
- Least-privilege browser permissions.
- Strict IPC validation.
- Loopback-only streaming.
- Protected streaming access tokens where appropriate.
- SSRF protection.
- Path traversal prevention.
- Safe filenames.
- Redirect credential isolation.
- Secure temporary files.
- No arbitrary shell execution.
- Secure updates.
- Redacted logs.

---

# 22. DATABASE AND PERSISTENCE

Design a normalized SQLite schema.

Persist:

- Download jobs.
- Download states.
- Queue assignments.
- Queue configurations.
- Global concurrency settings.
- Per-download thread settings.
- Segment metadata.
- Resume validators.
- Schedules.
- Browser installations.
- Integration status.
- Torrent metadata.
- FTP profiles.
- Credential references.
- User preferences.
- Notifications.
- Retry history.

Use migrations and transactional state updates.

Ensure crashes do not lose accepted jobs or queue assignments.

Never store passwords or sensitive cookies directly in database records.

---

# 23. TESTING AND QUALITY ASSURANCE

Build comprehensive automated tests.

Test:

- All supported operating systems.
- Browser discovery.
- Extension integration.
- Native messaging.
- Download handoff.
- Failed handoff.
- Duplicate detection.
- Authentication.
- Cookie-dependent downloads.
- POST-based downloads.
- Redirects.
- HTML responses.
- FTP authentication.
- Range-supported servers.
- Non-resumable servers.
- Parallel connections.
- Segment merging.
- Segment corruption.
- Server connection limits.
- Changes in thread count.
- Global concurrent-download limits.
- Queue reassignment.
- Moving active downloads.
- Resumable queue reassignment.
- Non-resumable confirmation dialogues.
- Scheduling.
- Torrent downloading.
- Torrent streaming.
- Media streaming.
- Media seeking.
- Application restart.
- Browser restart.
- Network interruption.
- Large files.
- Insufficient disk space.

Build local test servers that simulate:

- Range support.
- No Range support.
- Invalid Content-Range.
- Changed ETags.
- Redirects.
- Authentication challenges.
- HTML error pages.
- Slow connections.
- Connection failures.
- Maximum connection limits.

Test actual browser extensions rather than relying only on mocks.

Test Safari on macOS and Windows/Linux on their respective environments.

Do not claim compatibility without actual testing.

---

# 24. INSTALLATION AND RELEASE ENGINEERING

Prepare:

Windows:
- Installer and uninstaller.
- Native messaging registration.
- Credential Manager integration.
- Browser discovery.

macOS:
- Signed application.
- Notarization.
- Safari Web Extension packaging.
- Keychain integration.

Linux:
- AppImage.
- Debian packages.
- RPM packages where practical.
- Native messaging registration.
- Secret Service integration.

Provide upgrade and uninstall cleanup procedures.

Document installation, browser integration, troubleshooting, and security.

---

# 25. MANDATORY TECHNICAL PLANNING

Before implementation, produce a detailed planning document covering:

1. Repository assessment.
2. System architecture.
3. Component architecture.
4. Rust crate/module breakdown.
5. Frontend architecture.
6. Browser compatibility matrix.
7. Browser interception capabilities.
8. Browser discovery strategy.
9. Native messaging.
10. Handoff sequence diagrams.
11. Authentication preservation.
12. HTML recovery.
13. FTP architecture.
14. Torrent engine comparison.
15. Media streaming architecture.
16. Scheduler architecture.
17. Global concurrency architecture.
18. Per-download connection and segmentation architecture.
19. Queue-management architecture.
20. Active-download reassignment state machine.
21. Resumability detection and safe restart strategy.
22. Database schema.
23. Security threat model.
24. Installation and distribution.
25. Dependency evaluation.
26. Testing strategy.
27. Development milestones.
28. Technical risks and limitations.
29. Browser-extension architecture, browser-specific capability matrix, and permission strategy.
30. Extension handoff state machine, durable outbox, idempotency, cancellation safety, and restart recovery.
31. Extension security, privacy boundaries, diagnostics, update compatibility, and real-browser acceptance tests.

For each major architectural decision, explain the alternatives and justify the selection.

Research official browser APIs and library documentation.

Do not invent unsupported capabilities.

---

# 26. IMPLEMENTATION WORKFLOW

Follow these phases strictly.

## Phase 1: Research and planning

- Inspect the repository.
- Research official browser APIs.
- Evaluate Rust networking libraries.
- Evaluate torrent engines.
- Design the architecture.
- Design the scheduler.
- Design queue and concurrency management.
- Design safe active-download reassignment.
- Design the shared extension core and browser-specific adapters.
- Verify browser interception limits and permission requirements from official documentation.
- Design the extension/native protocol, durable outbox, state machine, and cancellation safety rules.
- Define extension failure recovery, diagnostics, security, and real-browser acceptance tests.
- Produce the full technical plan.
- Identify unresolved issues.

**STOP AND WAIT FOR MY APPROVAL.**

## Phase 2: Core infrastructure

- Application architecture.
- Database.
- IPC.
- Download engine.
- Persistent state.

## Phase 3: Download engine

- HTTP/HTTPS.
- FTP and supported secure protocols.
- Parallel downloading.
- Segmentation.
- Pause/resume.
- Retry and recovery.

## Phase 4: Queue and scheduler

- Custom queues.
- Global concurrency.
- Per-queue concurrency.
- Per-download threads.
- Right-click queue reassignment.
- Safe active-download movement.
- Scheduling and recovery.

## Phase 5: Torrent engine

- Torrent integration.
- Magnet links.
- Selective downloads.
- Seeding.
- Torrent scheduling.
- Torrent streaming.

## Phase 6: Browser integration

- Chromium.
- Firefox.
- Safari.
- Browser discovery.
- Shared extension core and browser-specific adapters.
- Download detection, classification, policy engine, and manual context-menu handoff.
- Durable native bridge, protocol negotiation, outbox, idempotency, and recovery.
- Safe handoff state machine and browser cancellation safeguards.
- Popup, options, permissions, notifications, diagnostics, and repair flows.
- Real-browser compatibility and failure-injection testing.

## Phase 7: Advanced features

- Authentication recovery.
- FTP credential manager.
- HTML response detection.
- Media streaming.
- Browser integration center.

## Phase 8: User interface

- Download dashboard.
- Context menus.
- Queue manager.
- Scheduler calendar.
- Settings.
- Notifications.
- System tray.

## Phase 9: Production readiness

- Security review.
- Automated testing.
- Cross-platform testing.
- Packaging.
- Documentation.

At every milestone:

1. Explain the objective.
2. Implement the relevant functionality.
3. Add tests.
4. Run tests.
5. Report actual results.
6. Identify remaining issues.
7. Update documentation.

Never conceal failed tests or claim unimplemented features are complete.

---

# FINAL OBJECTIVE

Deliver a dependable, secure, production-grade download manager for Windows, macOS, and Linux with:

- Universal browser interception through a production-grade, actively managed extension.
- Browser detection and integration.
- Reliable browser-to-desktop handoff.
- HTTP, HTTPS, FTP and supported secure protocols.
- BitTorrent and magnet support.
- Progressive audio/video streaming.
- FTP credential management.
- Intelligent download scheduler.
- Custom download queues.
- Right-click queue reassignment.
- Safe scheduling and reassignment of active downloads.
- Automatic resumability detection.
- Explicit restart warnings for non-resumable downloads.
- Configurable global simultaneous downloads.
- Default 8 parallel connections per download.
- Configurable maximum of 20 connections per download.
- Individual download connection settings.
- Segmented downloading and integrity validation.
- Background operation.
- Production-grade security.

**Most importantly, never silently lose downloaded data, unnecessarily restart resumable downloads, corrupt segmented files, silently restart non-resumable downloads, falsely report successful handoffs, cancel the browser transfer before a safe replacement exists, or expose credentials.**

Prioritize correctness, reliability, data integrity, and genuine cross-platform compatibility over superficial feature completion.

**START WITH REPOSITORY INSPECTION AND THE COMPLETE TECHNICAL PLANNING PHASE. DO NOT IMPLEMENT ANY CODE UNTIL I EXPLICITLY APPROVE THE PLAN.**