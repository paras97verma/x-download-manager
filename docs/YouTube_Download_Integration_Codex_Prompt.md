# YouTube Video and Audio Download Integration — Codex Engineering Prompt

## Objective

Extend the existing cross-platform download manager with a carefully designed YouTube integration. When the user is viewing a YouTube watch page and the browser extension is installed and connected to the desktop app, provide a clearly visible **Download with [App Name]** action. Clicking it should open a quality-selection interface showing the available, legitimately downloadable video and audio options, including resolution, frame rate (FPS), codec, format, and estimated file size where available.

The user must be able to choose video, audio-only, or the best/maximum available quality. The integration must use the existing application architecture and browser-extension-to-desktop handoff system rather than creating a separate downloader or bypassing existing safety controls.

**Important:** Do not assume that arbitrary YouTube downloads are technically or contractually permitted. YouTube's terms, content rights, regional restrictions, account restrictions, and technical protections matter. The implementation must comply with applicable law, YouTube's current terms and official platform capabilities, and the rights of the content owner. Support only methods and content for which downloading is authorized. Do not bypass DRM, paywalls, membership restrictions, access controls, or other technical protections; do not reverse-engineer private APIs, decipher protected signatures, evade throttling, or use stolen/session cookies to obtain media. If a compliant method for a particular video is unavailable, explain that clearly rather than attempting an unauthorized workaround.

---

## Phase 0 — Identify and Understand the Current Repository (Do This First)

Before proposing or changing anything:

1. Identify the current repository root and confirm the actual project being worked on. Do not assume the working directory, repository name, or architecture.
2. Inspect the repository structure, Git status, README, architecture documents, existing implementation, build configuration, and relevant tests.
3. Identify the existing:
   - Rust/Tauri desktop application and download engine.
   - Browser extension code and supported browser adapters.
   - Extension content scripts, background/service-worker logic, permissions, and manifest files.
   - Native Messaging or other extension-to-app bridge.
   - Download job model, queue/scheduler, persistence, progress reporting, and IPC commands.
   - Existing media playback/streaming, FFmpeg integration (if any), and post-processing pipeline.
   - Settings, notifications, context menus, and download details UI.
4. Determine what is implemented versus merely planned. Do not treat documentation or TODOs as completed functionality.
5. Report the repository root, detected stack, relevant files/modules, current extension-to-app handoff flow, and the best integration points.
6. Do not overwrite, replace, or duplicate existing architecture. Reuse established abstractions and conventions.

If the supplied working directory is not the intended repository, stop and ask for the correct repository path.

---

## Phase 1 — Research Feasibility, Platform Rules, and Legal Constraints

Before designing the feature, research current authoritative documentation and distinguish verified facts from assumptions.

Investigate:

- Current YouTube Terms of Service and relevant official download/offline features.
- Official YouTube APIs and whether they provide an authorized way to retrieve downloadable media streams. Do not assume the YouTube Data API provides media-download URLs.
- Official mechanisms available to creators to download their own uploaded videos, including YouTube Studio and Google Takeout where applicable.
- Browser-extension policies and API limitations for Chromium, Firefox, and Safari.
- Supported media formats, adaptive streaming concepts, separate audio/video tracks, codecs, resolutions, and frame rates, using public documentation where available.
- FFmpeg licensing, distribution, and platform-packaging implications if media muxing or remuxing is needed.
- Any current restrictions affecting downloading, DRM-protected content, private videos, members-only content, live streams, age-restricted content, or region-restricted content.

Create a capability and compliance matrix for the supported browsers and content cases. Explicitly classify each capability as:

- Supported and authorized.
- Supported only under specific ownership/permission or account conditions.
- Unsupported by official interfaces.
- Prohibited or not to be implemented.
- Unknown and requiring further verification.

Do not present unofficial extraction libraries, undocumented endpoints, or reverse-engineering techniques as official or guaranteed. If a proposed method depends on them, identify the compliance and reliability risks and do not implement it unless it is clearly lawful, authorized, and permitted by the applicable platform terms.

**Stop condition:** If no viable, compliant way exists to offer the requested functionality for a given content case, document the limitation and propose a compliant alternative. Do not silently implement a workaround.

---

## Phase 2 — Feature and User Experience

### 2.1 YouTube page integration

When a supported YouTube watch page is open:

- The extension should detect the page and confirm that the desktop app is connected.
- Add a clearly identifiable **Download with [App Name]** action near the YouTube player or in an appropriate player control/adjacent action area.
- Avoid covering native controls, captions, menus, or important page content.
- Match YouTube's responsive layout and adapt to theater mode, fullscreen, page navigation, and layout changes.
- Use a Shadow DOM or another isolated styling strategy where appropriate to avoid CSS conflicts.
- Do not inject the action on unrelated sites or unrelated YouTube pages.
- Support YouTube's single-page navigation: watch-page changes must update the button and video metadata without requiring a full reload.
- Remove stale UI and event listeners when navigating away or when the video changes.
- Do not modify, interfere with, or replace YouTube's own player controls.
- Provide a fallback extension popup/context-menu action if page injection is unavailable.

The injected UI must be clearly extension-owned and must not imitate YouTube's official download controls or mislead users into believing it is a YouTube feature.

### 2.2 Click flow

When the user clicks the injected action:

1. Validate the current video/page identity and extension-to-app connection.
2. Request only the metadata and download options that are available through an authorized implementation.
3. Open a quality-selection panel. Prefer an extension-owned popup/panel or a desktop-app window, depending on the existing architecture.
4. Show the video title, channel/uploader, thumbnail, duration, and source page URL when available.
5. Let the user select video, audio-only, or an available best-quality preset.
6. On confirmation, create a normal download job through the existing durable handoff protocol.
7. Show clear progress and status in the extension and desktop app.
8. If the app is unavailable, show a reconnect/install action and do not claim that the job was accepted.

Do not cancel or interrupt any browser activity merely because the user clicked the injected button. Follow the existing safe-handoff rules.

### 2.3 Quality selection

Where authorized stream metadata is available, present options in a readable table/list. Include:

- Content type: video + audio, video-only, or audio-only.
- Container/format: MP4, WebM, M4A, WebM audio, or actual available format.
- Video resolution: e.g. 2160p, 1440p, 1080p, 720p, 480p, 360p.
- Frame rate: e.g. 24, 25, 30, 48, 50, 60 FPS, or the actual reported value.
- Video codec: e.g. H.264/AVC, VP9, AV1, if known.
- Audio codec: e.g. AAC, Opus, if known.
- Audio bitrate and video bitrate, when available.
- Estimated size, clearly marked as an estimate if not exact.
- Whether audio and video are already combined or require authorized muxing.
- Any compatibility or processing note.

Never invent quality options, FPS, codecs, bitrates, or file sizes. Display “Unknown” or omit a field if it cannot be reliably determined.

Offer:

- **Best quality** — choose the highest authorized, available combined output that can be produced reliably.
- **Maximum resolution** — choose the highest authorized video resolution, while making clear if it has no matching audio track yet.
- **Best quality + highest FPS** — rank by resolution first, then frame rate, subject to user-configurable preference.
- **Balanced** — a reasonable quality/size option when enough metadata exists.
- **Audio only** — highest authorized available audio quality.
- **Manual selection** — allow the user to choose a specific resolution/FPS/format/codec combination.

Define the ranking logic explicitly. Do not equate resolution alone with quality. Consider frame rate, bitrate, codec efficiency, HDR where reliably exposed, audio quality, compatibility, and whether the required tracks can be combined.

If the requested maximum-quality combination is not available or cannot be generated through a compliant method, explain why and offer the best actually available option.

### 2.4 Audio and video tracks

Some streaming systems provide separate audio and video tracks. If a compliant and authorized source provides separate tracks:

- Model them as one parent media-download job with child track jobs or equivalent persisted task records.
- Download both tracks through the existing download engine where technically and legally permitted.
- Verify that both tracks belong to the same video/resource identity.
- Mux/remux them into the selected output container only after both complete successfully.
- Preserve the original tracks until the final output is verified.
- Report separate track progress and overall progress.
- Handle one-track failure, cancellation, retry, disk-full, and application restart.
- Avoid unnecessary transcoding. Prefer stream-copy/remux when compatible.
- If transcoding is required, disclose it, estimate processing impact, and make it an explicit option unless necessary for a selected output.
- Never claim that a file is complete until muxing and final validation succeed.

Do not use FFmpeg or another tool to bypass DRM or technical access restrictions. Any FFmpeg use must be limited to processing media that the application is authorized to handle.

### 2.5 Best and maximum quality behavior

Implement deterministic selection rules and explain them in the UI:

- “Best quality” should select the highest-quality output that can actually be downloaded and finalized.
- “Maximum resolution” should select the highest available resolution, but must not silently produce a video-only file when the user expects audio.
- When the highest-resolution video requires a separate audio track, include that track only if it is authorized and compatible.
- If a lower resolution is the only reliable combined output, show the trade-off and ask for confirmation rather than silently downgrading.
- Respect the user's preferred format, codec compatibility, maximum resolution, and maximum file size settings.
- Keep the original available quality metadata in the job details for diagnostics.

---

## Phase 3 — Extension and Desktop Architecture

Design the integration as a module within the existing extension and desktop app. Do not create a parallel download system.

### Browser extension responsibilities

- Detect supported YouTube watch pages and single-page navigation.
- Inject and manage the extension-owned action.
- Collect only permitted page metadata.
- Request authorized format/quality metadata from the approved integration path.
- Render the quality-selection UI.
- Send a versioned request to the desktop app.
- Persist pending handoff state in the extension's durable storage.
- Display app connection, job acceptance, and progress status.
- Handle duplicate clicks, stale tabs, navigation, service-worker suspension, and app reconnection.

Do not place long-running downloads, large media buffers, or media processing in the extension. The desktop app's Rust download engine should own accepted download jobs.

### Desktop app responsibilities

- Validate every incoming request and supported content case.
- Revalidate the media resource identity and authorization assumptions before starting.
- Create a persisted parent media job and associated track tasks where needed.
- Reuse existing queue, scheduler, retry, pause/resume, bandwidth, concurrency, and history functionality.
- Reuse the existing secure IPC and durable handoff protocol.
- Report progress, track status, muxing status, final output path, and errors to the extension.
- Keep credentials, cookies, authorization headers, and other secrets out of logs and ordinary job metadata.
- Ensure that jobs survive app restart and that extension reconnection can recover their status.

### Data model

Inspect the current schema before proposing changes. Extend it minimally to represent, as needed:

- Source platform and source page URL.
- Video/content identifier.
- Parent media job identity.
- Selected output profile.
- Available quality metadata snapshot.
- Video and audio track metadata.
- Child track task identities and states.
- Mux/remux state and output validation.
- Final container, codecs, resolution, FPS, and duration.
- Authorization/availability classification without storing secrets.

Use database migrations and transactional state transitions. Do not store raw cookies, session tokens, passwords, or sensitive authorization material in SQLite.

---

## Phase 4 — Reliability and Failure Handling

Plan and test at least these scenarios:

- Desktop app not installed, not running, disconnected, or outdated.
- Extension missing permissions or not enabled.
- User navigates to another video while the quality panel is open.
- YouTube page changes through single-page navigation.
- Duplicate clicks or duplicate handoff messages.
- Browser service-worker suspension or browser restart during handoff.
- Desktop app restart during track download or muxing.
- Authorized media source expires or becomes unavailable.
- Video or audio track unavailable.
- One track succeeds and the other fails.
- Highest-resolution option cannot be finalized.
- Unsupported or incompatible container/codec combination.
- Disk full, permission denied, network interruption, timeout, or server error.
- Live stream or content whose availability changes over time.
- Private, restricted, paid, DRM-protected, or otherwise unauthorized content.
- Metadata is incomplete, contradictory, or stale.

Use the existing durable outbox, idempotency keys, ACK semantics, and recovery protocol. The extension must not report success until the desktop app has durably accepted the job. The desktop app must not create duplicate jobs from retried messages.

For unsupported or restricted cases, provide a specific, honest explanation and do not attempt to bypass the restriction.

---

## Phase 5 — Security, Privacy, and Compliance

- Follow the existing extension permission-minimization strategy.
- Request only permissions necessary for the approved implementation.
- Do not collect browsing history or inspect unrelated tabs.
- Do not scrape unrelated page content or transmit user browsing data.
- Do not store or export YouTube cookies or session credentials unless an explicitly authorized, reviewed design requires a narrowly scoped mechanism; never use them to evade restrictions.
- Never send credentials to unrelated hosts or follow redirects with sensitive headers without strict origin validation.
- Do not bypass DRM, encryption, paywalls, age gates, membership requirements, region controls, or other access restrictions.
- Do not implement signature deciphering, private endpoint abuse, anti-bot evasion, proxy rotation, rate-limit evasion, or other circumvention.
- Respect rate limits and platform policies.
- Clearly distinguish official platform functionality from the download manager's own UI.
- Provide a user-facing explanation of supported use and limitations.
- Ensure all logs are structured and redact tokens, cookies, signed URLs, and sensitive headers.

Document the threat model and compliance assumptions.

---

## Phase 6 — Settings and User Preferences

Integrate settings into the existing application rather than creating a separate settings system. Consider:

- Enable/disable YouTube page action.
- Default action: ask every time, use best quality, or use last selection.
- Preferred container/format.
- Preferred codec where selectable.
- Maximum resolution.
- Preferred FPS or “highest available.”
- Audio-only default quality.
- Output folder or existing queue-specific destination.
- Whether to retain source tracks after successful muxing.
- Whether to allow post-processing/remuxing.
- Compatibility-first versus quality-first preference.

Defaults must be safe and predictable. Do not automatically start a download without a clear user action unless the user has explicitly enabled such behavior.

---

## Phase 7 — Testing and Acceptance Criteria

Create automated unit, integration, and UI tests using mocked/fixture metadata and authorized test media. Do not use real users' private content or attempt to bypass YouTube protections during testing.

Test:

- YouTube page detection and navigation lifecycle.
- Injection placement, cleanup, responsive layout, and duplicate prevention.
- Quality list rendering and accurate metadata display.
- Best-quality and maximum-resolution ranking logic.
- Audio-only selection.
- Separate-track job creation and progress aggregation.
- Durable handoff, ACK, idempotency, retries, and reconnection.
- Pause, resume, cancel, retry, and restart recovery.
- Muxing/remuxing and output validation where applicable.
- Unsupported/restricted content messaging.
- Browser compatibility and extension permission behavior.
- Regression of all existing download-manager features.

Acceptance criteria:

1. The extension action appears only on supported YouTube watch pages and does not disrupt the native player.
2. The quality panel shows only verified, authorized options and never fabricates metadata.
3. Resolution, FPS, codecs, format, and estimated size are displayed accurately when available.
4. Best-quality and maximum-resolution choices follow documented, deterministic ranking rules.
5. Audio-only downloads work where an authorized audio source is available.
6. Separate audio/video tracks are handled as one recoverable media job, with correct muxing and progress.
7. Accepted jobs use the existing desktop download engine, queues, scheduler, persistence, and handoff protocol.
8. Duplicate messages or clicks cannot create duplicate jobs.
9. Unsupported or restricted content fails safely with a clear explanation.
10. No DRM, access-control, paywall, authentication, or platform-protection circumvention is introduced.
11. Existing browser integrations and ordinary downloads continue to work without regression.

---

## Phase 8 — Required Deliverables

Before implementation, produce:

1. Repository identification and current-state report.
2. Current YouTube/platform capability and compliance matrix with authoritative references and research date.
3. Feasibility assessment separating officially supported capabilities, conditional capabilities, unsupported capabilities, and prohibited approaches.
4. Proposed extension UI/UX flow, including text wireframes if useful.
5. Architecture and component responsibility diagram.
6. Data model and migration proposal.
7. Versioned extension-to-app message examples and state machine.
8. Quality-ranking algorithm and tie-breaking rules.
9. Audio/video track lifecycle and muxing design.
10. Security, privacy, and compliance threat analysis.
11. Cross-browser compatibility matrix.
12. Test plan, acceptance criteria, and implementation phases.
13. Risks, unresolved questions, and any functionality that cannot be delivered compliantly.

Use actual repository paths and existing abstractions in the proposal. Cite authoritative documentation for current platform/API claims. Label assumptions and unverified behavior explicitly.

---

## Mandatory Workflow — Planning Before Coding

**Stage A: Inspect and research only.**

- Identify the current repository first.
- Inspect existing implementation and architecture.
- Research current official platform rules and APIs.
- Determine what can be implemented compliantly and reliably.
- Produce every deliverable listed above.
- Recommend the smallest maintainable design that fits the existing application.

**Do not modify source code, manifests, dependencies, database schemas, configuration, or generated files during Stage A. Do not begin implementation.**

At the end of Stage A, provide a concise decision summary:

- What can be built.
- What cannot be built and why.
- What requires user authorization or ownership.
- What existing modules will be reused or changed.
- Proposed implementation phases and risks.

Then **STOP and wait for my explicit approval** before writing or modifying any code.

**Stage B: Implementation — only after approval.**

After approval, implement in small, reviewable phases. Preserve existing functionality, add migrations and tests, validate all supported browsers, and report changed files, commands run, test results, limitations, and remaining work after each phase. Never silently expand scope or introduce an unapproved workaround.
