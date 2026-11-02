import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { MenuBar } from "./components/MenuBar";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { DownloadTable } from "./components/DownloadTable";
import { SegmentInspector } from "./components/SegmentInspector";
import { AddDownloadModal } from "./components/AddDownloadModal";
import { BrowserExtensionsModal } from "./components/BrowserExtensionsModal";
import { SettingsModal } from "./components/SettingsModal";
import { SchedulerModal } from "./components/SchedulerModal";
import { FilePropertiesModal } from "./components/FilePropertiesModal";
import { DuplicateDownloadModal } from "./components/DuplicateDownloadModal";
import {
  DEFAULT_SETTINGS,
  INITIAL_BROWSERS,
  apiAddDownload,
  apiUpdateDownloadUrl,
  apiDeleteDownload,
  apiGetBrowserStatuses,
  apiGetDownloads,
  apiGetSettings,
  apiMoveToQueue,
  apiOpenFile,
  apiPauseDownload,
  apiRestartDownload,
  apiStartQueueNow,
  apiResumeDownload,
  apiShowInFolder,
  apiSetAutostart,
  apiToggleBrowserExtension,
  apiUpdateSettings,
  apiGetAppVersion,
  DEFAULT_APP_VERSION,
  buildSegments,
  formatSpeed,
  isTauriRuntime,
  onNativeMenuAction,
  onDuplicateDownloadDetected,
} from "./services/tauriBridge";
import {
  AppSettings,
  BrowserStatus,
  DownloadItem,
  NewDownloadRequest,
  DuplicateDownloadNotice,
} from "./types/xdm";

export const App: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [browsers, setBrowsers] = useState<BrowserStatus[]>(INITIAL_BROWSERS);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedQueue, setSelectedQueue] = useState<string>("all");

  const [addModalMode, setAddModalMode] = useState<"url" | "torrent" | null>(null);
  const [showExtensionsModal, setShowExtensionsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | null>(null);
  const [showSchedulerModal, setShowSchedulerModal] = useState(false);
  const [propertiesItem, setPropertiesItem] = useState<DownloadItem | null>(null);
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const [rememberDeleteConfirmation, setRememberDeleteConfirmation] = useState(false);
  const [appVersion, setAppVersion] = useState<string>(DEFAULT_APP_VERSION);
  const [duplicateNotices, setDuplicateNotices] = useState<DuplicateDownloadNotice[]>([]);
  const duplicateNotice = duplicateNotices[0] || null;
  const dismissDuplicateNotice = () => setDuplicateNotices((notices) => notices.slice(1));

  const previousStatusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onDuplicateDownloadDetected((notice) => {
      setDuplicateNotices((notices) => [...notices, notice]);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Audio completion chime using Web Audio API
  const playNotificationChime = useCallback(() => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (_) {}
  }, []);

  // Monitor download status transitions and trigger OS notification & audio chime
  useEffect(() => {
    for (const d of downloads) {
      const prev = previousStatusRef.current.get(d.id);
      if (prev && prev !== "completed" && d.status === "completed") {
        if (settings.play_sound_on_complete) {
          playNotificationChime();
        }
      }
      previousStatusRef.current.set(d.id, d.status);
    }
  }, [downloads, settings.play_sound_on_complete, playNotificationChime]);

  // Sync real state from Tauri backend on mount and via periodic polling
  const syncFromBackend = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const list = await apiGetDownloads();
      setDownloads(list);
      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          if (list.some((d) => d.id === id)) next.add(id);
        }
        return next;
      });
    } catch (e) {
      console.warn("Telemetry polling failed:", e);
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    apiGetSettings().then((s) => {
      if (s) setSettings(s);
    });

    apiGetAppVersion().then((v) => {
      if (v) setAppVersion(v);
    });

    apiGetBrowserStatuses().then((b) => {
      if (b && b.length > 0) setBrowsers(b);
    });

    syncFromBackend();
    const interval = setInterval(syncFromBackend, 1000);
    return () => clearInterval(interval);
  }, [syncFromBackend]);

  // Poll browser statuses every 3 seconds for live connection state updates
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const pollBrowsers = async () => {
      try {
        const b = await apiGetBrowserStatuses();
        if (b && b.length > 0) setBrowsers(b);
      } catch (e) {
        console.warn("Browser status polling failed:", e);
      }
    };
    pollBrowsers();
    const browserInterval = setInterval(pollBrowsers, 3000);
    return () => clearInterval(browserInterval);
  }, []);

  // Live telemetry simulation tick only when running in web preview mode (outside Tauri)
  // Incorporates natural speed fluctuations so throughput reflects real network conditions
  useEffect(() => {
    if (isTauriRuntime()) return;

    const timer = setInterval(() => {
      setDownloads((prev) =>
        prev.map((d) => {
          if (d.status !== "downloading") return d;
          const capBps = settings.speed_limiter_enabled
            ? settings.global_max_download_kbps * 1024
            : 32_000_000;

          // Natural fluctuation with +/- 12% random variance on each tick
          const baseSpeed = d.speed_bps > 0 ? d.speed_bps : 14_500_000;
          const jitter = 0.88 + Math.random() * 0.24;
          const fluctuatingSpeed = Math.round(Math.min(baseSpeed * jitter, capBps));

          const nextBytes = Math.min(
            d.total_bytes,
            d.downloaded_bytes + Math.floor(fluctuatingSpeed * 0.5)
          );
          const ratio = d.total_bytes > 0 ? nextBytes / d.total_bytes : 0;
          const completed = nextBytes >= d.total_bytes && d.total_bytes > 0;
          const remaining = Math.max(0, d.total_bytes - nextBytes);

          const fluctuatingUp =
            d.upload_speed_bps > 0
              ? Math.round(d.upload_speed_bps * (0.85 + Math.random() * 0.3))
              : 0;

          return {
            ...d,
            downloaded_bytes: nextBytes,
            speed_bps: completed ? 0 : fluctuatingSpeed,
            upload_speed_bps: completed ? 0 : fluctuatingUp,
            eta_seconds:
              completed
                ? 0
                : fluctuatingSpeed > 0
                ? Math.ceil(remaining / fluctuatingSpeed)
                : null,
            status: completed ? "completed" : "downloading",
            segments: buildSegments(d.total_bytes, d.threads_count, ratio, !completed),
          };
        })
      );
    }, 500);
    return () => clearInterval(timer);
  }, [settings.speed_limiter_enabled, settings.global_max_download_kbps]);

  const filteredDownloads = useMemo(() => {
    return downloads.filter((d) => {
      if (selectedCategory !== "all" && d.category !== selectedCategory) return false;
      if (selectedStatus !== "all" && d.status !== selectedStatus) return false;
      if (selectedQueue !== "all" && d.queue_id !== selectedQueue) return false;
      return true;
    });
  }, [downloads, selectedCategory, selectedStatus, selectedQueue]);

  // Primary selected item for segment inspection
  const selectedItem = useMemo(() => {
    if (lastSelectedId && downloads.some((d) => d.id === lastSelectedId)) {
      return downloads.find((d) => d.id === lastSelectedId) || null;
    }
    const firstId = Array.from(selectedIds)[0];
    return firstId ? downloads.find((d) => d.id === firstId) || null : null;
  }, [downloads, selectedIds, lastSelectedId]);

  const totalDownSpeed = useMemo(
    () =>
      downloads
        .filter((d) => d.status === "downloading")
        .reduce((acc, d) => acc + d.speed_bps, 0),
    [downloads]
  );

  const totalUpSpeed = useMemo(
    () =>
      downloads
        .filter((d) => d.status === "downloading" || d.status === "seeding")
        .reduce((acc, d) => acc + d.upload_speed_bps, 0),
    [downloads]
  );

  // Multi-Selection handler with Shift range and Cmd/Ctrl multi-click
  const handleSelect = (id: string, isMulti = false, isRange = false) => {
    setLastSelectedId(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isRange && lastSelectedId) {
        const idxA = filteredDownloads.findIndex((d) => d.id === lastSelectedId);
        const idxB = filteredDownloads.findIndex((d) => d.id === id);
        if (idxA !== -1 && idxB !== -1) {
          const [start, end] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
          for (let i = start; i <= end; i++) {
            next.add(filteredDownloads[i].id);
          }
          return next;
        }
      }

      if (isMulti) {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = (all: boolean) => {
    if (all) {
      setSelectedIds(new Set(filteredDownloads.map((d) => d.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleAddDownload = async (req: NewDownloadRequest) => {
    if (isTauriRuntime()) {
      try {
        const item = await apiAddDownload(req);
        if (item) {
          setDownloads((prev) => [item, ...prev.filter((d) => d.id !== item.id)]);
          setSelectedIds(new Set([item.id]));
          setLastSelectedId(item.id);
          return;
        }
      } catch (err) {
        if (!String(err).toLowerCase().includes("duplicate")) {
          console.error("Failed to add download via Tauri:", err);
        }
      }
      return;
    }

    const isMagnet = req.url.toLowerCase().startsWith("magnet:?");
    const isFtp =
      req.url.toLowerCase().startsWith("ftp://") ||
      req.url.toLowerCase().startsWith("sftp://");
    const protocol = isMagnet
      ? "magnet"
      : isFtp
      ? "ftp"
      : "https";

    const fname =
      req.filename ||
      (isMagnet
        ? (new URLSearchParams(req.url.replace(/^magnet:\?/i, "")).get("dn") || "torrent_download")
        : req.url.split("?")[0].split("/").filter(Boolean).pop() || "download");

    const threads = req.threads_count || settings.default_threads_per_download;
    const newItem: DownloadItem = {
      id: `dl-${Date.now()}`,
      filename: fname,
      url: req.url,
      resolved_url: req.url,
      protocol,
      category: req.category || (isMagnet ? "Torrents" : "Compressed"),
      queue_id: req.queue_id || "main-queue",
      save_path: `${settings.default_download_dir}/${fname}`,
      total_bytes: 0,
      downloaded_bytes: 0,
      speed_bps: 0,
      upload_speed_bps: 0,
      eta_seconds: null,
      status: req.start_immediately ? "connecting" : "queued",
      resumable: true,
      threads_count: threads,
      segments: [],
      source_browser: "Manual Entry",
      cookies: req.cookies || null,
      custom_headers: {},
      created_at: new Date().toISOString(),
      transfer_log: [
        `[${new Date().toLocaleTimeString()}] Task created (${protocol.toUpperCase()}) with ${threads} parallel threads`,
      ],
    };

    setDownloads((prev) => [newItem, ...prev]);
    setSelectedIds(new Set([newItem.id]));
    setLastSelectedId(newItem.id);
  };

  const handleUseExistingDuplicate = () => {
    if (duplicateNotice?.existing_download_id) {
      const id = duplicateNotice.existing_download_id;
      setSelectedIds(new Set([id]));
      setLastSelectedId(id);
    }
    if (duplicateNotice?.existing_path) void apiShowInFolder(duplicateNotice.existing_path);
    dismissDuplicateNotice();
  };

  const handleSaveDuplicateCopy = async () => {
    if (!duplicateNotice) return;
    try {
      const item = await apiAddDownload(duplicateNotice.request, true);
      if (item) {
        setDownloads((prev) => [item, ...prev.filter((download) => download.id !== item.id)]);
        setSelectedIds(new Set([item.id]));
        setLastSelectedId(item.id);
      }
      dismissDuplicateNotice();
    } catch (error) {
      window.alert(`Could not start a separate copy: ${String(error)}`);
    }
  };

  const handleTogglePauseResume = (item: DownloadItem) => {
    const resuming = item.status !== "downloading";
    if (isTauriRuntime()) {
      if (resuming) {
        apiResumeDownload(item.id);
      } else {
        apiPauseDownload(item.id);
      }
    }

    setDownloads((prev) =>
      prev.map((d) => {
        if (d.id !== item.id) return d;
        return {
          ...d,
          status: resuming ? "downloading" : "paused",
          speed_bps: resuming ? 16_500_000 : 0,
        };
      })
    );
  };

  const handleResumeBatch = () => {
    selectedIds.forEach((id) => {
      const item = downloads.find((d) => d.id === id);
      if (item && item.status !== "downloading" && item.status !== "completed") {
        handleTogglePauseResume(item);
      }
    });
  };

  const handlePauseBatch = () => {
    selectedIds.forEach((id) => {
      const item = downloads.find((d) => d.id === id);
      if (item && item.status === "downloading") {
        handleTogglePauseResume(item);
      }
    });
  };

  const completeDelete = async (ids: string[], deleteFile: boolean) => {
    try {
      await Promise.all(ids.map((id) => apiDeleteDownload(id, deleteFile)));
      const removedIds = new Set(ids);
      setDownloads((prev) => prev.filter((d) => !removedIds.has(d.id)));
      setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => !removedIds.has(id))));
      setLastSelectedId((prev) => (prev && removedIds.has(prev) ? null : prev));
    } catch (error) {
      console.error("Could not delete download:", error);
      window.alert(`Could not delete the download: ${String(error)}`);
    }
  };

  const requestDelete = (ids: string[], deleteFile: boolean) => {
    if (!ids.length) return;
    if (deleteFile && window.localStorage.getItem("xdm.rememberDeleteFromDisk") !== "true") {
      setRememberDeleteConfirmation(false);
      setDeleteConfirmIds(ids);
      return;
    }
    void completeDelete(ids, deleteFile);
  };

  const handleDeleteBatch = (deleteFile = false) => requestDelete(Array.from(selectedIds), deleteFile);

  const handleDeleteOne = (id: string, deleteFile = false) => requestDelete([id], deleteFile);

  const handleRestartDownload = (id: string) => {
    if (isTauriRuntime()) {
      apiRestartDownload(id);
    }
    setDownloads((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        return {
          ...d,
          downloaded_bytes: 0,
          speed_bps: 14_500_000,
          status: "downloading",
          segments: buildSegments(d.total_bytes, d.threads_count, 0, true),
        };
      })
    );
  };

  const handleMoveToQueue = (id: string, queueId: string) => {
    if (isTauriRuntime()) {
      apiMoveToQueue(id, queueId);
    }
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, queue_id: queueId } : d))
    );
  };

  const handleToggleSpeedLimiter = () => {
    const next = {
      ...settings,
      speed_limiter_enabled: !settings.speed_limiter_enabled,
    };
    setSettings(next);
    if (isTauriRuntime()) {
      apiUpdateSettings(next);
    }
  };

  const toggleUiMode = () => {
    const nextMode = (settings.ui_mode || "simple") === "simple" ? "advanced" : "simple";
    const nextSettings = { ...settings, ui_mode: nextMode as "simple" | "advanced" };
    setSettings(nextSettings);
    if (isTauriRuntime()) {
      apiUpdateSettings(nextSettings);
    }
  };

  // Standard macOS Keyboard Shortcuts (Cmd + , for Settings, Cmd + N for New URL, etc.)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      // Cmd + M / Ctrl + M -> Toggle Simple / Advanced Mode
      if ((e.metaKey || e.ctrlKey) && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        toggleUiMode();
        return;
      }

      // Cmd + , / Ctrl + , -> Settings Modal
      if ((e.metaKey || e.ctrlKey) && (e.key === "," || e.key === "Settings")) {
        e.preventDefault();
        setSettingsTab("general");
        return;
      }

      // Cmd + N / Ctrl + N -> Add URL Modal
      if ((e.metaKey || e.ctrlKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setAddModalMode("url");
        return;
      }

      // Cmd + T / Ctrl + T -> Add Torrent Modal
      if ((e.metaKey || e.ctrlKey) && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setAddModalMode("torrent");
        return;
      }

      // Cmd + A / Ctrl + A -> Select All (when not in text input)
      if (!isInput && (e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        handleSelectAll(true);
        return;
      }

      // Delete / Backspace -> Delete Selected (when not in text input)
      if (!isInput && (e.key === "Delete" || e.key === "Backspace")) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleDeleteBatch(false);
        }
        return;
      }

      // Spacebar -> Pause/Resume Primary Selected
      if (!isInput && e.key === " ") {
        if (selectedItem) {
          e.preventDefault();
          handleTogglePauseResume(selectedItem);
        }
        return;
      }

      // Escape -> Deselect All / Close Modals
      if (e.key === "Escape") {
        if (addModalMode) setAddModalMode(null);
        else if (showExtensionsModal) setShowExtensionsModal(false);
        else if (settingsTab) setSettingsTab(null);
        else if (showSchedulerModal) setShowSchedulerModal(false);
        else if (propertiesItem) setPropertiesItem(null);
        else if (selectedIds.size > 0) setSelectedIds(new Set());
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    selectedIds,
    selectedItem,
    addModalMode,
    showExtensionsModal,
    settingsTab,
    showSchedulerModal,
    propertiesItem,
  ]);

  // Handle native system menu actions from macOS system menu bar / native window menus
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onNativeMenuAction((actionId) => {
      switch (actionId) {
        case "add_url":
          setAddModalMode("url");
          break;
        case "add_torrent":
          setAddModalMode("torrent");
          break;
        case "preferences":
          setSettingsTab("general");
          break;
        case "about":
          setSettingsTab("about");
          break;
        case "select_all":
          handleSelectAll(true);
          break;
        case "deselect_all":
          handleSelectAll(false);
          break;
        case "delete_selected":
          handleDeleteBatch(false);
          break;
        case "delete_disk":
          handleDeleteBatch(true);
          break;
        case "toggle_ui_mode":
          toggleUiMode();
          break;
        case "resume_selected":
          handleResumeBatch();
          break;
        case "pause_selected":
          handlePauseBatch();
          break;
        case "restart_selected":
          if (selectedItem) {
            handleRestartDownload(selectedItem.id);
          }
          break;
        case "stop_all":
          if (isTauriRuntime()) {
            downloads
              .filter((d) => d.status === "downloading")
              .forEach((d) => apiPauseDownload(d.id));
          }
          setDownloads((prev) =>
            prev.map((d) =>
              d.status === "downloading" ? { ...d, status: "paused", speed_bps: 0 } : d
            )
          );
          break;
        case "open_file":
          if (selectedItem?.status === "completed") {
            apiOpenFile(selectedItem.save_path);
          }
          break;
        case "show_in_folder":
          if (selectedItem) {
            apiShowInFolder(selectedItem.save_path);
          }
          break;
        case "open_scheduler":
          setShowSchedulerModal(true);
          break;
        case "open_extensions":
          setSettingsTab("browser");
          break;
        case "open_vault":
          setSettingsTab("logins");
          break;
        case "open_speed":
          setSettingsTab("speed");
          break;
        case "shortcuts_guide":
          setSettingsTab("shortcuts");
          break;
        default:
          break;
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [
    handleSelectAll,
    handleDeleteBatch,
    toggleUiMode,
    handleResumeBatch,
    handlePauseBatch,
    selectedItem,
    handleRestartDownload,
    downloads,
  ]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0b0f17] text-slate-100 overflow-hidden">
      {/* Native menu handles top application menu on desktop (macOS system menu bar & native menus); only show in-window MenuBar in browser preview */}
      {!isTauriRuntime() && (
        <MenuBar
          onOpenAddUrl={() => setAddModalMode("url")}
          onOpenAddTorrent={() => setAddModalMode("torrent")}
          onOpenSettings={(tab) => setSettingsTab(tab || "general")}
          onOpenScheduler={() => setShowSchedulerModal(true)}
          onOpenExtensions={() => setSettingsTab("browser")}
          onToggleUiMode={toggleUiMode}
          uiMode={settings.ui_mode || "simple"}
          onResumeSelected={handleResumeBatch}
          onPauseSelected={handlePauseBatch}
          onStopAll={() => {
            if (isTauriRuntime()) {
              downloads
                .filter((d) => d.status === "downloading")
                .forEach((d) => apiPauseDownload(d.id));
            }
            setDownloads((prev) =>
              prev.map((d) =>
                d.status === "downloading" ? { ...d, status: "paused", speed_bps: 0 } : d
              )
            );
          }}
          onDeleteSelected={(deleteFile) => handleDeleteBatch(Boolean(deleteFile))}
          onSelectAll={() => handleSelectAll(true)}
          onDeselectAll={() => handleSelectAll(false)}
          onOpenFile={
            selectedItem?.status === "completed"
              ? () => apiOpenFile(selectedItem.save_path)
              : undefined
          }
          onShowInFolder={
            selectedItem ? () => apiShowInFolder(selectedItem.save_path) : undefined
          }
          onRestartSelected={
            selectedItem ? () => handleRestartDownload(selectedItem.id) : undefined
          }
          selectedCount={selectedIds.size}
        />
      )}

      <Toolbar
        appVersion={appVersion}
        onOpenAddModal={(mode) => setAddModalMode(mode)}
        onResumeSelected={handleResumeBatch}
        onPauseSelected={handlePauseBatch}
        onStopAll={() => {
          if (isTauriRuntime()) {
            downloads
              .filter((d) => d.status === "downloading")
              .forEach((d) => apiPauseDownload(d.id));
          }
          setDownloads((prev) =>
            prev.map((d) =>
              d.status === "downloading" ? { ...d, status: "paused", speed_bps: 0 } : d
            )
          );
        }}
        onDeleteSelected={() => handleDeleteBatch(false)}
        selectedCount={selectedIds.size}
        onOpenScheduler={() => setShowSchedulerModal(true)}
        onOpenSettings={(tab) => setSettingsTab(tab || "general")}
        onToggleUiMode={toggleUiMode}
        uiMode={settings.ui_mode || "simple"}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          downloads={downloads}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          selectedStatus={selectedStatus}
          onSelectStatus={setSelectedStatus}
          queues={settings.queues}
          selectedQueue={selectedQueue}
          onSelectQueue={setSelectedQueue}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          <DownloadTable
            downloads={filteredDownloads}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onSelectAll={handleSelectAll}
            onTogglePauseResume={handleTogglePauseResume}
            onRestartDownload={handleRestartDownload}
            onMoveToQueue={handleMoveToQueue}
            onOpenProperties={(item) => setPropertiesItem(item)}
            onOpenScheduler={() => setShowSchedulerModal(true)}
            onOpenFile={(path) => apiOpenFile(path)}
            onShowInFolder={(path) => apiShowInFolder(path)}
            onDeleteDownload={(id, deleteFile) => handleDeleteOne(id, deleteFile)}
            settings={settings}
            onToggleSpeedLimiter={handleToggleSpeedLimiter}
          />
          {(settings.ui_mode || "simple") === "advanced" && (
            <SegmentInspector item={selectedItem} />
          )}
        </main>
      </div>

      {/* Footer with required signature: Made with ❤️ by ~peivee */}
      <footer className="h-8 bg-[#090d14] border-t border-slate-800 px-4 flex items-center justify-between text-[11px] text-slate-400 select-none shrink-0 overflow-x-auto gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <span>
            Active Transfers:{" "}
            <strong className="text-slate-200">
              {downloads.filter((d) => d.status === "downloading").length}
            </strong>
          </span>
          <span className="text-emerald-400 font-mono">
            ↓ Total Down: {formatSpeed(totalDownSpeed)}
          </span>
          <span className="text-indigo-400 font-mono">
            ↑ Total Up: {formatSpeed(totalUpSpeed)}
          </span>
          <span>
            Extensions Connected:{" "}
            {(() => {
              const connected = browsers.filter(
                (b) =>
                  b.detected_installed &&
                  (b.is_connected ||
                    downloads.some((d) => d.source_browser && d.source_browser.toLowerCase().includes(b.id)))
              );
              if (connected.length === 0) {
                return (
                  <button
                    onClick={() => setSettingsTab("browser")}
                    className="text-amber-400 hover:text-amber-300 font-medium underline underline-offset-2 ml-1 cursor-pointer"
                  >
                    0 Connected (Click to Integrate)
                  </button>
                );
              }
              return (
                <button
                  onClick={() => setSettingsTab("browser")}
                  className="text-emerald-400 hover:text-emerald-300 font-medium ml-1 cursor-pointer underline underline-offset-2"
                >
                  {connected.length} {connected.length === 1 ? "Browser" : "Browsers"} ({connected.map((b) => b.display_name).join(", ")})
                </button>
              );
            })()}
          </span>
        </div>

        <div className="font-medium text-slate-200 tracking-wide shrink-0">
          Made with ❤️ by ~peivee
        </div>
      </footer>

      {addModalMode && (
        <AddDownloadModal
          initialMode={addModalMode}
          settings={settings}
          onClose={() => setAddModalMode(null)}
          onAdd={handleAddDownload}
        />
      )}

      {duplicateNotice && (
        <DuplicateDownloadModal
          notice={duplicateNotice}
          onUseExisting={handleUseExistingDuplicate}
          onSaveCopy={handleSaveDuplicateCopy}
          onCancel={dismissDuplicateNotice}
        />
      )}

      {showExtensionsModal && (
        <BrowserExtensionsModal
          browsers={browsers}
          settings={settings}
          onToggleBrowser={(browserId, enable) => {
            if (isTauriRuntime()) {
              apiToggleBrowserExtension(browserId, enable).then((updated) => {
                if (updated) {
                  setBrowsers((prev) =>
                    prev.map((b) => (b.id === browserId ? updated : b))
                  );
                }
              });
            }
            setBrowsers((prev) =>
              prev.map((b) =>
                b.id === browserId
                  ? {
                      ...b,
                      extension_enabled: enable,
                      native_host_registered: enable,
                      status_message: enable
                        ? "Connected & Intercepting Downloads"
                        : "Integration Disabled by User",
                    }
                  : b
              )
            );
          }}
          onReinstallAll={() => {
            if (isTauriRuntime()) {
              browsers.forEach((b) => {
                if (b.detected_installed) {
                  apiToggleBrowserExtension(b.id, true);
                }
              });
            }
            setBrowsers((prev) =>
              prev.map((b) =>
                b.detected_installed
                  ? {
                      ...b,
                      extension_enabled: true,
                      native_host_registered: true,
                      status_message: "Connected & Intercepting Downloads (Verified)",
                    }
                  : b
              )
            );
          }}
          onClose={() => setShowExtensionsModal(false)}
        />
      )}

      {settingsTab && (
        <SettingsModal
          appVersion={appVersion}
          initialTab={settingsTab}
          settings={settings}
          browsers={browsers}
          onToggleBrowser={async (id, enable) => {
            if (isTauriRuntime()) {
              const updated = await apiToggleBrowserExtension(id, enable);
              if (updated) {
                setBrowsers((prev) => prev.map((b) => (b.id === id ? updated : b)));
              }
            } else {
              setBrowsers((prev) =>
                prev.map((b) => (b.id === id ? { ...b, extension_enabled: enable } : b))
              );
            }
          }}
          onReinstallAll={async () => {
            if (isTauriRuntime()) {
              for (const b of browsers) {
                if (b.detected_installed) {
                  await apiToggleBrowserExtension(b.id, true);
                }
              }
              const fresh = await apiGetBrowserStatuses();
              if (fresh) setBrowsers(fresh);
            }
          }}
          onSave={async (newSettings) => {
            if (isTauriRuntime()) {
              try {
                const enabled = await apiSetAutostart(newSettings.start_on_boot);
                if (enabled !== newSettings.start_on_boot) {
                  throw new Error("The operating system did not apply the requested startup setting.");
                }
                const saved = await apiUpdateSettings(newSettings);
                if (!saved) throw new Error("ByteX could not save the updated preferences.");
                setSettings(saved);
              } catch (error) {
                await apiSetAutostart(settings.start_on_boot).catch(() => undefined);
                window.alert(`Could not apply the settings: ${String(error)}`);
              }
            } else {
              setSettings(newSettings);
            }
          }}
          onClose={() => setSettingsTab(null)}
        />
      )}

      {showSchedulerModal && (
        <SchedulerModal
          settings={settings}
          downloads={downloads}
          onSaveSettings={(newSettings) => {
            setSettings(newSettings);
            if (isTauriRuntime()) {
              apiUpdateSettings(newSettings);
            }
          }}
          onStartQueueNow={async (qId) => {
            try {
              if (isTauriRuntime()) {
                await apiStartQueueNow(qId);
                setDownloads(await apiGetDownloads());
              } else {
                setDownloads((prev) => prev.map((d) => d.queue_id === qId && d.status === "queued" ? { ...d, status: "downloading" } : d));
              }
            } catch (error) {
              window.alert(`Could not start queue: ${String(error)}`);
            }
          }}
          onClose={() => setShowSchedulerModal(false)}
        />
      )}

      {propertiesItem && (
        <FilePropertiesModal
          item={propertiesItem}
          onClose={() => setPropertiesItem(null)}
          onUpdateUrl={async (id, url) => {
            const updated = await apiUpdateDownloadUrl(id, url);
            setDownloads((prev) => prev.map((download) => download.id === id ? updated : download));
            setPropertiesItem(updated);
          }}
        />
      )}

      {deleteConfirmIds && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <section className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">Delete file from disk?</h2>
            <p className="mt-2 text-sm text-slate-300">
              This permanently deletes {deleteConfirmIds.length === 1 ? "the downloaded file" : `${deleteConfirmIds.length} downloaded files`}.
            </p>
            <label className="mt-5 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={rememberDeleteConfirmation}
                onChange={(event) => setRememberDeleteConfirmation(event.target.checked)}
              />
              Remember this choice for future sessions
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-md px-4 py-2 text-sm text-slate-300 hover:bg-slate-800" onClick={() => setDeleteConfirmIds(null)}>Cancel</button>
              <button
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
                onClick={() => {
                  const ids = deleteConfirmIds;
                  setDeleteConfirmIds(null);
                  if (rememberDeleteConfirmation) window.localStorage.setItem("xdm.rememberDeleteFromDisk", "true");
                  void completeDelete(ids, true);
                }}
              >
                Delete from disk
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
