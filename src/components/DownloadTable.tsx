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
} from "lucide-react";
import { DownloadItem } from "../types/xdm";
import { formatBytes, formatEta, formatSpeed } from "../services/tauriBridge";

interface DownloadTableProps {
  downloads: DownloadItem[];
  selectedIds: Set<string>;
  onSelect: (id: string, isMulti?: boolean, isRange?: boolean) => void;
  onSelectAll: (all: boolean) => void;
  onTogglePauseResume: (item: DownloadItem) => void;
  onRestartDownload: (id: string) => void;
  onMoveToQueue: (id: string, queueId: string) => void;
  onOpenProperties: (item: DownloadItem) => void;
  onOpenScheduler: () => void;
  onOpenFile: (path: string) => void;
  onShowInFolder: (path: string) => void;
  onDeleteDownload: (id: string, deleteFile: boolean) => void;
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
  onOpenProperties,
  onOpenScheduler,
  onOpenFile,
  onShowInFolder,
  onDeleteDownload,
}) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showQueueSubmenu, setShowQueueSubmenu] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setShowQueueSubmenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setShowQueueSubmenu(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleRowContextMenu = (e: React.MouseEvent, item: DownloadItem) => {
    e.preventDefault();
    if (!selectedIds.has(item.id)) {
      onSelect(item.id, false);
    }
    const x = Math.min(e.clientX, window.innerWidth - 250);
    const y = Math.min(e.clientY, window.innerHeight - 380);
    setContextMenu({ x, y, item });
    setShowQueueSubmenu(false);
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
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
                className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
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
                    Click <strong className="text-blue-400">+ Add URL</strong> or <strong className="text-emerald-400">+ Torrent</strong> to start, or trigger any file download in Dia, Safari, Arc, Chrome, or Firefox to intercept automatically.
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
                    ? "bg-blue-600/15 hover:bg-blue-600/20"
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
                    className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
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
                        const segPct = Math.min(100, (seg.downloaded_bytes / segLen) * 100);
                        return (
                          <div key={seg.id} className="flex-1 bg-slate-900 h-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                item.status === "completed"
                                  ? "bg-emerald-500"
                                  : item.status === "paused"
                                  ? "bg-amber-500"
                                  : "bg-blue-500"
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
                            : "bg-blue-500"
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenFile(item.save_path);
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1 text-[11px]"
                        title="Open file"
                      >
                        <FileText className="w-3 h-3 text-blue-400" /> Open
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
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* IDM / FDM Full Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-60 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Pause / Resume */}
          {contextMenu.item.status === "downloading" ? (
            <button
              onClick={() => {
                onTogglePauseResume(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left"
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
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left"
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
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left"
          >
            <RotateCcw className="w-3.5 h-3.5 text-blue-400" />
            Restart from 0%
          </button>

          {/* Open File if completed */}
          {contextMenu.item.status === "completed" && (
            <button
              onClick={() => {
                onOpenFile(contextMenu.item.save_path);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left font-medium text-emerald-300"
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
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left"
          >
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
            Show in Finder / Folder
          </button>

          <div className="h-px bg-slate-700/60 my-1" />

          {/* Move to Queue submenu trigger */}
          <div
            className="relative"
            onMouseEnter={() => setShowQueueSubmenu(true)}
            onMouseLeave={() => setShowQueueSubmenu(false)}
          >
            <button
              type="button"
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <Server className="w-3.5 h-3.5 text-purple-400" />
                Move to Queue
              </span>
              <ChevronRight className="w-3 h-3 text-slate-400" />
            </button>

            {showQueueSubmenu && (
              <div className="absolute left-full top-0 ml-1 w-48 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs">
                <button
                  onClick={() => {
                    onMoveToQueue(contextMenu.item.id, "main-queue");
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-blue-600 hover:text-white ${
                    contextMenu.item.queue_id === "main-queue" ? "text-indigo-400 font-semibold" : ""
                  }`}
                >
                  Main Download Queue
                </button>
                <button
                  onClick={() => {
                    onMoveToQueue(contextMenu.item.id, "night-queue");
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-blue-600 hover:text-white ${
                    contextMenu.item.queue_id === "night-queue" ? "text-indigo-400 font-semibold" : ""
                  }`}
                >
                  Night Off-Peak Queue
                </button>
              </div>
            )}
          </div>

          {/* Schedule Download */}
          <button
            onClick={() => {
              onOpenScheduler();
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left"
          >
            <CalendarClock className="w-3.5 h-3.5 text-indigo-400" />
            Schedule Queue & Timer...
          </button>

          {/* Verify Checksum / File Properties */}
          <button
            onClick={() => {
              onOpenProperties(contextMenu.item);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left"
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
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            Copy Download Link
          </button>

          <button
            onClick={() => {
              navigator.clipboard?.writeText(contextMenu.item.save_path);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left"
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
    </div>
  );
};
