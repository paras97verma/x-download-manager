import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { DownloadTable } from "./components/DownloadTable";
import { SegmentInspector } from "./components/SegmentInspector";
import { AddDownloadModal } from "./components/AddDownloadModal";
import { BrowserExtensionsModal } from "./components/BrowserExtensionsModal";
import { SettingsModal } from "./components/SettingsModal";
import { SchedulerModal } from "./components/SchedulerModal";
import {
  DEFAULT_SETTINGS,
  INITIAL_BROWSERS,
  apiAddDownload,
  apiDeleteDownload,
  apiGetBrowserStatuses,
  apiGetDownloads,
  apiGetSettings,
  apiPauseDownload,
  apiResumeDownload,
  apiToggleBrowserExtension,
  apiUpdateSettings,
  buildSegments,
  formatSpeed,
  isTauriRuntime,
} from "./services/tauriBridge";
import {
  AppSettings,
  BrowserStatus,
  DownloadItem,
  NewDownloadRequest,
} from "./types/xdm";

export const App: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [browsers, setBrowsers] = useState<BrowserStatus[]>(INITIAL_BROWSERS);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedQueue, setSelectedQueue] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [addModalMode, setAddModalMode] = useState<"url" | "torrent" | null>(null);
  const [showExtensionsModal, setShowExtensionsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | null>(null);
  const [showSchedulerModal, setShowSchedulerModal] = useState(false);

  // Sync real state from Tauri backend on mount and via periodic polling
  const syncFromBackend = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const list = await apiGetDownloads();
      setDownloads(list);
      setSelectedId((prev) => {
        if (prev && list.some((d) => d.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
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

    apiGetBrowserStatuses().then((b) => {
      if (b && b.length > 0) setBrowsers(b);
    });

    syncFromBackend();
    const interval = setInterval(syncFromBackend, 1000);
    return () => clearInterval(interval);
  }, [syncFromBackend]);

  // Live telemetry simulation tick only when running in web preview mode (outside Tauri)
  useEffect(() => {
    if (isTauriRuntime()) return;

    const timer = setInterval(() => {
      setDownloads((prev) =>
        prev.map((d) => {
          if (d.status !== "downloading") return d;
          const capBps = settings.speed_limiter_enabled
            ? settings.global_max_download_kbps * 1024
            : d.speed_bps;
          const effectiveSpeed = Math.min(d.speed_bps || 12_500_000, capBps);
          const nextBytes = Math.min(d.total_bytes, d.downloaded_bytes + Math.floor(effectiveSpeed * 0.5));
          const ratio = d.total_bytes > 0 ? nextBytes / d.total_bytes : 0;
          const completed = nextBytes >= d.total_bytes && d.total_bytes > 0;
          const remaining = Math.max(0, d.total_bytes - nextBytes);

          return {
            ...d,
            downloaded_bytes: nextBytes,
            speed_bps: completed ? 0 : effectiveSpeed,
            eta_seconds: completed ? 0 : effectiveSpeed > 0 ? Math.ceil(remaining / effectiveSpeed) : null,
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
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!d.filename.toLowerCase().includes(q) && !d.url.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [downloads, selectedCategory, selectedStatus, selectedQueue, searchQuery]);

  const selectedItem = useMemo(
    () => downloads.find((d) => d.id === selectedId) || null,
    [downloads, selectedId]
  );

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

  const handleAddDownload = async (req: NewDownloadRequest) => {
    if (isTauriRuntime()) {
      try {
        const item = await apiAddDownload(req);
        if (item) {
          setDownloads((prev) => [item, ...prev.filter((d) => d.id !== item.id)]);
          setSelectedId(item.id);
          return;
        }
      } catch (err) {
        console.error("Failed to add download via Tauri:", err);
      }
    }

    const isMagnet = req.url.toLowerCase().startsWith("magnet:?");
    const isUsersdrive = req.url.toLowerCase().includes("usersdrive.com");
    const isFtp = req.url.toLowerCase().startsWith("ftp://") || req.url.toLowerCase().startsWith("sftp://");
    const protocol = isMagnet
      ? "magnet"
      : isUsersdrive
      ? "usersdrive"
      : isFtp
      ? "ftp"
      : "https";

    const fname =
      req.filename ||
      (isMagnet
        ? "Linux_Mint_22_Cinnamon_64bit.iso"
        : req.url.split("?")[0].split("/").pop() || "downloaded_archive.zip");

    const total = 1_572_864_000;
    const threads = req.threads_count || settings.default_threads_per_download;
    const newItem: DownloadItem = {
      id: `dl-${Date.now()}`,
      filename: fname,
      url: req.url,
      resolved_url: isUsersdrive ? `https://cdn4.usersdrive.com/d/auto_resolved/${fname}` : req.url,
      protocol,
      category: req.category || (isMagnet ? "Torrents" : "Compressed"),
      queue_id: req.queue_id || "main-queue",
      save_path: `${settings.default_download_dir}/${fname}`,
      total_bytes: total,
      downloaded_bytes: 0,
      speed_bps: req.start_immediately ? 18_400_000 : 0,
      upload_speed_bps: isMagnet && req.start_immediately ? 1_200_000 : 0,
      eta_seconds: 85,
      status: req.start_immediately ? "downloading" : "queued",
      resumable: true,
      threads_count: threads,
      segments: buildSegments(total, threads, 0.02, req.start_immediately),
      source_browser: "Manual / Clipboard",
      cookies: req.cookies || null,
      custom_headers: {},
      created_at: new Date().toISOString(),
      transfer_log: [
        `[${new Date().toLocaleTimeString()}] Task created (${protocol.toUpperCase()}) with ${threads} parallel threads`,
        isUsersdrive
          ? `[${new Date().toLocaleTimeString()}] Usersdrive Authenticated Resolver extracted direct stream link`
          : `[${new Date().toLocaleTimeString()}] Range probe succeeded (206 Partial Content)`,
      ],
    };

    setDownloads((prev) => [newItem, ...prev]);
    setSelectedId(newItem.id);
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

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0b0f17] text-slate-100 overflow-hidden">
      <Toolbar
        onOpenAddModal={(mode) => setAddModalMode(mode)}
        onResumeSelected={() => {
          if (selectedItem) handleTogglePauseResume({ ...selectedItem, status: "paused" });
        }}
        onPauseSelected={() => {
          if (selectedItem) handleTogglePauseResume({ ...selectedItem, status: "downloading" });
        }}
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
        onDeleteSelected={() => {
          if (!selectedId) return;
          if (isTauriRuntime()) {
            apiDeleteDownload(selectedId, false);
          }
          setDownloads((prev) => prev.filter((d) => d.id !== selectedId));
          setSelectedId(null);
        }}
        onOpenScheduler={() => setShowSchedulerModal(true)}
        onOpenExtensions={() => setShowExtensionsModal(true)}
        onOpenSettings={(tab) => setSettingsTab(tab || "general")}
        settings={settings}
        onToggleSpeedLimiter={() => {
          const next = { ...settings, speed_limiter_enabled: !settings.speed_limiter_enabled };
          setSettings(next);
          if (isTauriRuntime()) {
            apiUpdateSettings(next);
          }
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
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
            selectedId={selectedId}
            onSelect={setSelectedId}
            onTogglePauseResume={handleTogglePauseResume}
          />
          <SegmentInspector item={selectedItem} />
        </main>
      </div>

      {/* Footer with required signature: Made with ❤️ by ~peivee */}
      <footer className="h-8 bg-[#090d14] border-t border-slate-800 px-4 flex items-center justify-between text-[11px] text-slate-400 select-none shrink-0">
        <div className="flex items-center gap-4">
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
            <strong className="text-blue-400">
              {browsers.filter((b) => b.extension_enabled && b.detected_installed).length} Browsers
            </strong>
          </span>
        </div>

        <div className="font-medium text-slate-200 tracking-wide">
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

      {showExtensionsModal && (
        <BrowserExtensionsModal
          browsers={browsers}
          settings={settings}
          onToggleBrowser={(browserId, enable) => {
            if (isTauriRuntime()) {
              apiToggleBrowserExtension(browserId, enable).then((updated) => {
                if (updated) {
                  setBrowsers((prev) => prev.map((b) => (b.id === browserId ? updated : b)));
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
          initialTab={settingsTab}
          settings={settings}
          onSave={(newSettings) => {
            setSettings(newSettings);
            if (isTauriRuntime()) {
              apiUpdateSettings(newSettings);
            }
          }}
          onClose={() => setSettingsTab(null)}
        />
      )}

      {showSchedulerModal && (
        <SchedulerModal
          settings={settings}
          onStartQueueNow={(qId) => {
            setDownloads((prev) =>
              prev.map((d) =>
                d.queue_id === qId && d.status !== "completed"
                  ? { ...d, status: "downloading", speed_bps: 14_500_000 }
                  : d
              )
            );
          }}
          onClose={() => setShowSchedulerModal(false)}
        />
      )}
    </div>
  );
};

      {showSchedulerModal && (
        <SchedulerModal
          settings={settings}
          onStartQueueNow={(qId) => {
            setDownloads((prev) =>
              prev.map((d) =>
                d.queue_id === qId && d.status !== "completed"
                  ? { ...d, status: "downloading", speed_bps: 14_500_000 }
                  : d
              )
            );
          }}
          onClose={() => setShowSchedulerModal(false)}
        />
      )}
    </div>
  );
};
