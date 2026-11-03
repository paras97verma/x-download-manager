import React, { useState, useEffect, useRef } from "react";
import {
  Globe,
  Magnet,
  Server,
  KeyRound,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  FolderOpen,
  FileText,
  Copy,
  Trash2,
  ExternalLink,
  ShieldCheck,
  CalendarClock,
  Info,
  ChevronRight,
  Gauge,
  Cpu,
  ArrowUpDown,
  X,
} from "lucide-react";
import { DownloadItem, AppSettings } from "../types/xdm";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  isMediaFile,
  apiOpenInExternalPlayer,
} from "../services/tauriBridge";

interface DownloadTableProps {
  downloads: DownloadItem[];
  selectedIds: Set<string>;
  onSelect: (id: string, isMulti?: boolean, isRange?: boolean) => void;
  onSelectAll: (all: boolean) => void;
  onTogglePauseResume: (item: DownloadItem) => void;
  onRestartDownload: (id: string) => void;
  onMoveToQueue: (id: string, queueId: string, forceRestart?: boolean) => void;
  onSetDownloadThreads?: (id: string, threads: number) => void;
  onSetDownloadPriority?: (id: string, priority: "high" | "normal" | "low") => void;
  onSetDownloadSpeedLimit?: (id: string, speedLimitKbps: number | null) => void;
  onOpenProperties: (item: DownloadItem) => void;
  onOpenScheduler: () => void;
  onOpenFile: (path: string) => void;
  onShowInFolder: (path: string) => void;
  onDeleteDownload: (id: string, deleteFile: boolean) => void;
  settings?: AppSettings;
  onToggleSpeedLimiter?: () => void;
  onPlayMedia?: (item: DownloadItem) => void;
  onScheduleDownload?: (
    downloadId: string,
    startTime: string | null,
    stopTime: string | null
  ) => Promise<void>;
}

interface ContextMenuState {
  x: number;
  y: number;
  item: DownloadItem;
}

export const DownloadTable: React.FC<DownloadTableProps> = ({
  downloads,
  selectedIds,
  onSelect,
  onSelectAll,
  onTogglePauseResume,
  onRestartDownload,
  onMoveToQueue,
  onSetDownloadThreads,
  onSetDownloadPriority,
  onSetDownloadSpeedLimit,
  onOpenProperties,
  onOpenScheduler,
  onOpenFile,
  onShowInFolder,
  onDeleteDownload,
  settings,
  onToggleSpeedLimiter,
  onPlayMedia,
  onScheduleDownload,
}) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [nonResumableModal, setNonResumableModal] = useState<{
    item: DownloadItem;
    targetQueueId: string;
  } | null>(null);
  const [speedLimitModalItem, setSpeedLimitModalItem] = useState<DownloadItem | null>(null);
  const [customSpeedKbps, setCustomSpeedKbps] = useState<string>("");
  const [scheduleModalItem, setScheduleModalItem] = useState<DownloadItem | null>(null);
  const [scheduleStartTime, setScheduleStartTime] = useState<string>("");
  const [scheduleStopTime, setScheduleStopTime] = useState<string>("");
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleQueueSelect = (item: DownloadItem, targetQueueId: string) => {
    if (item.queue_id === targetQueueId) return;
    const isActive =
      item.status === "downloading" ||
      item.status === "connecting" ||
      item.status === "authenticating";
    if (isActive && !item.resumable) {
      setNonResumableModal({ item, targetQueueId });
    } else {
      onMoveToQueue(item.id, targetQueueId, false);
    }
  };

  const handleRowContextMenu = (e: React.MouseEvent, item: DownloadItem) => {
    e.preventDefault();
    if (!selectedIds.has(item.id)) {
      onSelect(item.id, false);
    }
    const x = Math.min(e.clientX, window.innerWidth - 270);
    const y = Math.min(e.clientY, Math.max(10, window.innerHeight - 560));
    setContextMenu({ x, y, item });
  };

  const handleDoubleClick = (item: DownloadItem) => {
    if (item.status === "completed") {
      onOpenFile(item.save_path);
    } else {
      onTogglePauseResume(item);
    }
  };

  const getProtocolBadge = (item: DownloadItem) => {
    switch (item.protocol) {
      case "magnet":
      case "bit_torrent":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <Magnet className="w-3 h-3" /> BitTorrent
          </span>
        );
      case "usersdrive":
      case "file_host_auth":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <KeyRound className="w-3 h-3" /> Usersdrive Auth
          </span>
        );
      case "ftp":
      case "ftps":
      case "sftp":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
            <Server className="w-3 h-3" /> {item.protocol.toUpperCase()}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
            <Globe className="w-3 h-3" /> {item.threads_count}x HTTP/S
          </span>
        );
    }
  };

  const allSelected = downloads.length > 0 && selectedIds.size === downloads.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < downloads.length;

  return (
    <div className="flex-1 overflow-auto bg-[#0b0f17] relative select-none">
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 bg-[#111827] border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400 z-10">
          <tr>
            <th className="py-2.5 px-3 w-8 text-center">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = isIndeterminate;
                }}
                onChange={(e) => onSelectAll(e.target.checked)}
                className="rounded bg-slate-900 border-slate-700 text-cyan-700 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                title="Select all downloads"
              />
            </th>
            <th className="py-2.5 px-3">File Name</th>
            <th className="py-2.5 px-3">Protocol / Auth</th>
            <th className="py-2.5 px-3 w-52">Progress & Segments</th>
            <th className="py-2.5 px-3">Size</th>
            <th className="py-2.5 px-3">Speed</th>
            <th className="py-2.5 px-3">ETA</th>
            <th className="py-2.5 px-3">Browser</th>
            <th className="py-2.5 px-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 text-xs">
          {downloads.length === 0 && (
            <tr>
              <td colSpan={9} className="py-24 text-center text-slate-500">
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                    <Globe className="w-6 h-6 text-slate-400" />
                  </div>
                  <div className="text-sm font-medium text-slate-300">No downloads in list</div>
                  <div className="text-xs text-slate-500 max-w-sm leading-relaxed">
                    Click <strong className="text-cyan-300">+ Add URL</strong> or <strong className="text-emerald-400">+ Torrent</strong> to start, or trigger any file download in Dia, Safari, Arc, Chrome, or Firefox to intercept automatically.
                  </div>
                </div>
              </td>
            </tr>
          )}
          {downloads.map((item) => {
            const pct =
              item.total_bytes > 0
                ? Math.min(100, (item.downloaded_bytes / item.total_bytes) * 100)
                : 0;
            const isSelected = selectedIds.has(item.id);

            return (
              <tr
                key={item.id}
                onClick={(e) => onSelect(item.id, e.metaKey || e.ctrlKey, e.shiftKey)}
                onDoubleClick={() => handleDoubleClick(item)}
                onContextMenu={(e) => handleRowContextMenu(e, item)}
                className={`cursor-pointer transition ${
                  isSelected
                    ? "bg-cyan-700/15 hover:bg-cyan-700/20"
                    : "hover:bg-slate-900/90"
                }`}
              >
                <td
                  className="py-2.5 px-3 w-8 text-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onSelect(item.id, true)}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-700 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                </td>
                <td className="py-2.5 px-3 font-medium text-slate-100 max-w-xs">
                  <div className="truncate font-semibold">{item.filename}</div>
                  <div className="text-[10px] text-slate-400 truncate">{item.url}</div>
                </td>
                <td className="py-2.5 px-3">{getProtocolBadge(item)}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="font-semibold text-slate-200">{pct.toFixed(1)}%</span>
                    <span className="text-slate-400 text-[10px] capitalize">{item.status}</span>
                  </div>
                  {/* Multi-Segment Visual Bar */}
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden flex gap-[1px]">
                    {item.segments.length > 0 ? (
                      item.segments.map((seg) => {
                        const segLen = Math.max(1, seg.end_byte - seg.start_byte + 1);
                        const isCompleted = item.status === "completed" || seg.status === "completed";
                        const segDownloaded = isCompleted ? segLen : seg.downloaded_bytes;
                        const segPct = isCompleted ? 100 : Math.min(100, (segDownloaded / segLen) * 100);
                        return (
                          <div key={seg.id} className="flex-1 bg-slate-900 h-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                isCompleted
                                  ? "bg-emerald-500"
                                  : item.status === "paused"
                                  ? "bg-amber-500"
                                  : "bg-cyan-400"
                              }`}
                              style={{ width: `${segPct}%` }}
                            />
                          </div>
                        );
                      })
                    ) : (
                      <div
                        className={`h-full transition-all duration-300 ${
                          item.status === "completed"
                            ? "bg-emerald-500"
                            : item.status === "paused"
                            ? "bg-amber-500"
                            : "bg-cyan-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">
                  <div>{formatBytes(item.downloaded_bytes)}</div>
                  <div className="text-[10px] text-slate-500">of {formatBytes(item.total_bytes)}</div>
                </td>
                <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                  {item.status === "downloading" ? (
                    <span className="text-emerald-400 font-semibold">
                      ↓ {formatSpeed(item.speed_bps)}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                  {item.upload_speed_bps > 0 && (
                    <div className="text-[10px] text-indigo-400">
                      ↑ {formatSpeed(item.upload_speed_bps)}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-3 text-slate-300 font-mono whitespace-nowrap">
                  {formatEta(item.eta_seconds)}
                </td>
                <td className="py-2.5 px-3 text-slate-400">
                  {item.source_browser || "Manual"}
                </td>
                <td className="py-2.5 px-3 text-right">
                  {item.status === "completed" ? (
                    <div className="flex items-center justify-end gap-1.5">
                      {isMediaFile(item.filename) && onPlayMedia && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayMedia(item);
                          }}
                          className="px-2 py-1 rounded bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 inline-flex items-center gap-1 text-[11px] transition"
                          title="Play Media File"
                        >
                          <Play className="w-3 h-3 fill-indigo-400" /> Play
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenFile(item.save_path);
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1 text-[11px]"
                        title="Open file"
                      >
                        <FileText className="w-3 h-3 text-cyan-300" /> Open
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onShowInFolder(item.save_path);
                        }}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                        title="Show in Finder"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : item.status === "failed" ? (
                    <span className="inline-flex items-center gap-1 text-rose-400 text-[11px]">
                      <AlertCircle className="w-4 h-4" /> Error
                    </span>
                  ) : item.status === "queued" ? (
                    <span className="inline-flex items-center gap-1 text-slate-400 text-[11px]">
                      <Clock className="w-4 h-4" /> Queued
                    </span>
                  ) : (
                    <div className="flex items-center justify-end gap-1.5">
                      {isMediaFile(item.filename) && onPlayMedia && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayMedia(item);
                          }}
                          className="p-1 rounded bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 transition"
                          title="Stream While Downloading"
                        >
                          <Play className="w-3.5 h-3.5 fill-indigo-400" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePauseResume(item);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1 text-[11px]"
                      >
                        {item.status === "downloading" ? (
                          <>
                            <Pause className="w-3 h-3 text-amber-400" /> Pause
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 text-emerald-400" /> Resume
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ByteX full right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-64 max-h-[85vh] overflow-y-auto bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Progressive Media Streaming */}
          {isMediaFile(contextMenu.item.filename) && (
            <>
              <button
                onClick={() => {
                  onPlayMedia?.(contextMenu.item);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left font-medium text-indigo-300"
              >
                <Play className="w-3.5 h-3.5 text-indigo-400 fill-indigo-400/40" />
                {contextMenu.item.status === "completed"
                  ? "Play Media File"
                  : "Play While Downloading (Stream)"}
              </button>
              <button
                onClick={() => {
                  apiOpenInExternalPlayer(contextMenu.item.id);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left text-slate-300"
              >
                <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                Open in System Player (VLC)
              </button>
              <div className="h-px bg-slate-700/60 my-1" />
            </>
          )}

          {/* Pause / Resume */}
          {contextMenu.item.status === "downloading" ? (
            <button
              onClick={() => {
                onTogglePauseResume(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
            >
              <Pause className="w-3.5 h-3.5 text-amber-400" />
              Pause Download
            </button>
          ) : (
            <button
              onClick={() => {
                onTogglePauseResume(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
            >
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              Resume Download
            </button>
          )}

          {/* Restart from 0 bytes */}
          <button
            onClick={() => {
              onRestartDownload(contextMenu.item.id);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-300" />
            Restart from 0%
          </button>

          {/* Open File if completed */}
          {contextMenu.item.status === "completed" && (
            <button
              onClick={() => {
                onOpenFile(contextMenu.item.save_path);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left font-medium text-emerald-300"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open File
            </button>
          )}

          {/* Show in Finder */}
          <button
            onClick={() => {
              onShowInFolder(contextMenu.item.save_path);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
          >
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
            Show in Finder / Folder
          </button>

          <div className="h-px bg-slate-700/60 my-1" />

          {/* Move to Queue - Dynamic Queues */}
          <div className="px-3 py-1.5 bg-slate-900/60 border-y border-slate-700/50">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Server className="w-3 h-3 text-purple-400" /> Move to Queue
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(settings?.queues && settings.queues.length > 0
                ? settings.queues
                : [
                    { id: "main-queue", name: "Main Queue" },
                    { id: "night-queue", name: "Night Queue" },
                  ]
              ).map((q) => {
                const isCurrent = contextMenu.item.queue_id === q.id;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      handleQueueSelect(contextMenu.item, q.id);
                      setContextMenu(null);
                    }}
                    className={`px-2 py-1 rounded text-[11px] font-medium text-center transition ${
                      isCurrent
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {isCurrent ? `✓ ${q.name}` : q.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Connections / Threads */}
          <div className="px-3 py-1.5 bg-slate-900/40 border-b border-slate-700/40">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-cyan-400" /> Connections
              </span>
              <span className="text-cyan-300 font-mono text-[10px]">
                {contextMenu.item.threads_count || 8} threads
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {[1, 2, 4, 8, 16, 20].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    onSetDownloadThreads?.(contextMenu.item.id, t);
                    setContextMenu((prev) =>
                      prev ? { ...prev, item: { ...prev.item, threads_count: t } } : null
                    );
                  }}
                  className={`py-0.5 rounded text-[10px] font-mono font-medium text-center transition ${
                    contextMenu.item.threads_count === t
                      ? "bg-cyan-600 text-white font-bold"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                  title={`${t} connection${t > 1 ? "s" : ""}${t === 8 ? " (Default)" : ""}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className="px-3 py-1.5 bg-slate-900/40 border-b border-slate-700/40">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <ArrowUpDown className="w-3 h-3 text-emerald-400" /> Priority
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(["high", "normal", "low"] as const).map((p) => {
                const active = (contextMenu.item.priority || "normal") === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      onSetDownloadPriority?.(contextMenu.item.id, p);
                      setContextMenu((prev) =>
                        prev ? { ...prev, item: { ...prev.item, priority: p } } : null
                      );
                    }}
                    className={`py-0.5 rounded text-[10px] font-medium capitalize text-center transition ${
                      active
                        ? p === "high"
                          ? "bg-emerald-600 text-white font-bold"
                          : p === "low"
                          ? "bg-amber-600 text-white font-bold"
                          : "bg-cyan-600 text-white font-bold"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Per-Download Speed Limit */}
          <button
            onClick={() => {
              setSpeedLimitModalItem(contextMenu.item);
              setCustomSpeedKbps(
                contextMenu.item.speed_limit_bps
                  ? String(Math.round(contextMenu.item.speed_limit_bps / 1024))
                  : ""
              );
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-cyan-700 hover:text-white text-left"
          >
            <span className="flex items-center gap-2">
              <Gauge className="w-3.5 h-3.5 text-amber-400" />
              Download Speed Limit...
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-amber-300 font-mono">
              {contextMenu.item.speed_limit_bps
                ? `${Math.round(contextMenu.item.speed_limit_bps / 1024)} KB/s`
                : "Unlimited"}
            </span>
          </button>

          {/* Global Speed Limit / Uncapped Toggle */}
          {onToggleSpeedLimiter && (
            <button
              onClick={() => {
                onToggleSpeedLimiter();
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-cyan-700 hover:text-white text-left"
              title="Toggle Global Speed Limiter"
            >
              <span className="flex items-center gap-2">
                <Gauge className="w-3.5 h-3.5 text-slate-400" />
                Global Limiter
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                  settings?.speed_limiter_enabled
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    : "bg-slate-800 border-slate-700 text-slate-300"
                }`}
              >
                {settings?.speed_limiter_enabled
                  ? `${((settings?.global_max_download_kbps || 10240) / 1024).toFixed(0)} MB/s`
                  : "Off"}
              </span>
            </button>
          )}

          <div className="h-px bg-slate-700/60 my-1" />

          {/* Schedule Individual Download */}
          <button
            onClick={() => {
              setScheduleModalItem(contextMenu.item);
              setScheduleStartTime(contextMenu.item.scheduled_start || "");
              setScheduleStopTime(contextMenu.item.scheduled_stop || "");
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
          >
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            Schedule Download...
          </button>

          {/* Schedule Queue & Timer */}
          <button
            onClick={() => {
              onOpenScheduler();
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
          >
            <CalendarClock className="w-3.5 h-3.5 text-indigo-400" />
            Queue Scheduler & Timetable...
          </button>

          {/* Verify Checksum / File Properties */}
          <button
            onClick={() => {
              onOpenProperties(contextMenu.item);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
          >
            <Info className="w-3.5 h-3.5 text-emerald-400" />
            File Properties & Checksum...
          </button>

          <div className="h-px bg-slate-700/60 my-1" />

          {/* Copy URL & Path */}
          <button
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.item.url);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            Copy Download Link
          </button>

          <button
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.item.save_path);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-cyan-700 hover:text-white text-left"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            Copy File Save Path
          </button>

          <div className="h-px bg-slate-700/60 my-1" />

          {/* Remove / Delete */}
          <button
            onClick={() => {
              onDeleteDownload(contextMenu.item.id, false);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-rose-950/70 hover:text-rose-200 text-rose-300 text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove from List
          </button>

          <button
            onClick={() => {
              onDeleteDownload(contextMenu.item.id, true);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-rose-950/70 hover:text-rose-200 text-rose-400 text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete File from Disk
          </button>
        </div>
      )}

      {/* Non-Resumable Reassignment Confirmation Modal (OBJECTIVE.md §7) */}
      {nonResumableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#131b2a] border border-amber-500/40 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5">
              <div className="flex items-start gap-3.5 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 text-amber-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    This download does not support resuming
                  </h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Moving this download to another queue will stop the current transfer. When it starts again, the file must be downloaded from the beginning because the server does not support Range requests.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 mb-5 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>File:</span>
                  <span className="font-medium text-slate-200 truncate max-w-[220px]">
                    {nonResumableModal.item.filename}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Target Queue:</span>
                  <span className="font-medium text-indigo-300">
                    {settings?.queues.find((q) => q.id === nonResumableModal.targetQueueId)?.name ||
                      nonResumableModal.targetQueueId}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Current Progress:</span>
                  <span className="font-medium text-slate-200">
                    {formatBytes(nonResumableModal.item.downloaded_bytes)} of{" "}
                    {formatBytes(nonResumableModal.item.total_bytes)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between text-amber-400 font-semibold">
                  <span>Data that will be lost:</span>
                  <span>{formatBytes(nonResumableModal.item.downloaded_bytes)}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNonResumableModal(null)}
                  className="w-full sm:w-auto px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setNonResumableModal(null)}
                  className="w-full sm:w-auto px-3.5 py-1.5 rounded-lg border border-slate-600 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium transition"
                >
                  Continue Downloading
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMoveToQueue(nonResumableModal.item.id, nonResumableModal.targetQueueId, true);
                    setNonResumableModal(null);
                  }}
                  className="w-full sm:w-auto px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-sm transition"
                >
                  Move and Restart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-Download Custom Speed Limit Modal */}
      {speedLimitModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#131b2a] border border-cyan-500/40 rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">Download Speed Limit</h3>
                </div>
                <button
                  onClick={() => setSpeedLimitModalItem(null)}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-300 mb-3 truncate">
                Set limit for:{" "}
                <span className="font-semibold text-white">{speedLimitModalItem.filename}</span>
              </p>

              <div className="mb-4">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Speed Limit in KB/s (0 or blank for unlimited):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 1024 (KB/s)"
                    value={customSpeedKbps}
                    onChange={(e) => setCustomSpeedKbps(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  <span className="absolute right-3 top-2 text-xs text-slate-500">KB/s</span>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 mb-1">Presets:</div>
              <div className="grid grid-cols-3 gap-1.5 mb-5">
                {[
                  { label: "Unlimited", val: "" },
                  { label: "512 KB/s", val: "512" },
                  { label: "1 MB/s", val: "1024" },
                  { label: "2 MB/s", val: "2048" },
                  { label: "5 MB/s", val: "5120" },
                  { label: "10 MB/s", val: "10240" },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setCustomSpeedKbps(preset.val)}
                    className={`py-1 px-2 rounded text-[11px] font-medium border transition ${
                      customSpeedKbps === preset.val
                        ? "border-cyan-500 bg-cyan-500/20 text-cyan-300"
                        : "border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSpeedLimitModalItem(null)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const val =
                      customSpeedKbps.trim() === ""
                        ? null
                        : Math.max(0, parseInt(customSpeedKbps, 10));
                    onSetDownloadSpeedLimit?.(
                      speedLimitModalItem.id,
                      val === 0 || isNaN(val as number) ? null : val
                    );
                    setSpeedLimitModalItem(null);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shadow-sm transition"
                >
                  Apply Limit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Individual Download Schedule Modal */}
      {scheduleModalItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                Schedule Download
              </h3>
              <button
                onClick={() => setScheduleModalItem(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="font-semibold text-slate-200 truncate">
                  {scheduleModalItem.filename}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Queue: {scheduleModalItem.queue_id} • Status: {scheduleModalItem.status}
                </div>
              </div>

              {/* Case B Non-resumable warning */}
              {scheduleModalItem.status === "downloading" &&
                !scheduleModalItem.resumable && (
                  <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-600/40 text-amber-200 text-[11px] flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>Non-resumable Download:</strong> Moving or scheduling
                      this active download will pause the transfer. When it
                      restarts, data must be downloaded from the beginning.
                    </div>
                  </div>
                )}

              {/* Quick Presets */}
              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Quick Presets:</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { label: "In 15 Mins", mins: 15 },
                    { label: "In 1 Hour", mins: 60 },
                    { label: "In 3 Hours", mins: 180 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        const target = new Date(Date.now() + preset.mins * 60000);
                        // Format to YYYY-MM-DDTHH:MM
                        const pad = (n: number) => n.toString().padStart(2, "0");
                        const str = `${target.getFullYear()}-${pad(
                          target.getMonth() + 1
                        )}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(
                          target.getMinutes()
                        )}`;
                        setScheduleStartTime(str);
                      }}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition"
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleStartTime("");
                      setScheduleStopTime("");
                    }}
                    className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-400 hover:text-white text-[11px] transition"
                  >
                    Clear Times
                  </button>
                </div>
              </div>

              {/* Start Date & Time */}
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">
                  Start Date & Time (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={scheduleStartTime}
                  onChange={(e) => setScheduleStartTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>

              {/* Stop Date & Time */}
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">
                  Stop / Pause Date & Time (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={scheduleStopTime}
                  onChange={(e) => setScheduleStopTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setScheduleModalItem(null)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (onScheduleDownload) {
                    await onScheduleDownload(
                      scheduleModalItem.id,
                      scheduleStartTime.trim() || null,
                      scheduleStopTime.trim() || null
                    );
                  }
                  setScheduleModalItem(null);
                }}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow"
              >
                Save Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
