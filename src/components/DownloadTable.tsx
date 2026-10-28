import React from "react";
import {
  Globe,
  Magnet,
  Server,
  KeyRound,
  Play,
  Pause,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { DownloadItem } from "../types/xdm";
import { formatBytes, formatEta, formatSpeed } from "../services/tauriBridge";

interface DownloadTableProps {
  downloads: DownloadItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePauseResume: (item: DownloadItem) => void;
}

export const DownloadTable: React.FC<DownloadTableProps> = ({
  downloads,
  selectedId,
  onSelect,
  onTogglePauseResume,
}) => {
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

  return (
    <div className="flex-1 overflow-auto bg-[#0b0f17]">
      <table className="w-full text-left border-collapse select-none">
        <thead className="sticky top-0 bg-[#111827] border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400 z-10">
          <tr>
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
              <td colSpan={8} className="py-24 text-center text-slate-500">
                <div className="flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                    <Globe className="w-6 h-6 text-slate-400" />
                  </div>
                  <div className="text-sm font-medium text-slate-300">No downloads in list</div>
                  <div className="text-xs text-slate-500 max-w-sm leading-relaxed">
                    Click <strong className="text-blue-400">+ Add URL</strong> or <strong className="text-emerald-400">+ Torrent</strong> to start, or download any file in Chrome, Firefox, Safari, Arc, Brave, Edge, or Zen to intercept automatically.
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
            const isSelected = item.id === selectedId;

            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`cursor-pointer transition ${
                  isSelected
                    ? "bg-blue-600/15 hover:bg-blue-600/20"
                    : "hover:bg-slate-900/90"
                }`}
              >
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
                        className="h-full bg-blue-500"
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
                    <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-semibold">
                      <CheckCircle2 className="w-4 h-4" /> Done
                    </span>
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
    </div>
  );
};
