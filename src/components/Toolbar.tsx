import React from "react";
import {
  Plus,
  Magnet,
  Play,
  Pause,
  Square,
  Trash2,
  CalendarClock,
  Gauge,
  Puzzle,
  Settings,
  KeyRound,
  Search,
} from "lucide-react";
import { AppSettings } from "../types/xdm";

interface ToolbarProps {
  onOpenAddModal: (mode: "url" | "torrent") => void;
  onResumeSelected: () => void;
  onPauseSelected: () => void;
  onStopAll: () => void;
  onDeleteSelected: () => void;
  onOpenScheduler: () => void;
  onOpenExtensions: () => void;
  onOpenSettings: (initialTab?: string) => void;
  settings: AppSettings;
  onToggleSpeedLimiter: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedCount?: number;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onOpenAddModal,
  onResumeSelected,
  onPauseSelected,
  onStopAll,
  onDeleteSelected,
  onOpenScheduler,
  onOpenExtensions,
  onOpenSettings,
  settings,
  onToggleSpeedLimiter,
  searchQuery,
  onSearchChange,
  selectedCount = 0,
}) => {
  return (
    <header className="h-16 bg-[#111827] border-b border-slate-800 px-4 flex items-center justify-between select-none shrink-0">
      {/* Left Brand + Primary IDM/FDM Actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2.5 pr-3 border-r border-slate-800">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 font-black text-white text-lg tracking-tighter">
            X
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              X Download Manager
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                v1.0.0 RUST
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span>Multi-Thread • BitTorrent • FTP</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-200 font-medium">Made with ❤️ by ~peivee</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => onOpenAddModal("url")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-sm transition"
          title="Add HTTP/HTTPS, FTP, SFTP, or Usersdrive Download"
        >
          <Plus className="w-4 h-4" />
          Add URL
        </button>

        <button
          onClick={() => onOpenAddModal("torrent")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-xs shadow-sm transition"
          title="Add BitTorrent (.torrent) or Magnet URI"
        >
          <Magnet className="w-4 h-4" />
          Add Torrent
        </button>

        <div className="h-6 w-px bg-slate-800 mx-1" />

        <button
          onClick={onResumeSelected}
          disabled={selectedCount === 0}
          className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800/80 text-slate-200 text-xs font-medium transition"
          title="Resume Selected Download(s)"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400" />
          Resume {selectedCount > 1 ? `(${selectedCount})` : ""}
        </button>

        <button
          onClick={onPauseSelected}
          disabled={selectedCount === 0}
          className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800/80 text-slate-200 text-xs font-medium transition"
          title="Pause Selected Download(s)"
        >
          <Pause className="w-3.5 h-3.5 text-amber-400" />
          Pause {selectedCount > 1 ? `(${selectedCount})` : ""}
        </button>

        <button
          onClick={onStopAll}
          className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
          title="Stop All Active Downloads"
        >
          <Square className="w-3.5 h-3.5 text-rose-400" />
          Stop All
        </button>

        <button
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800/80 hover:bg-rose-950/60 hover:text-rose-300 disabled:opacity-40 disabled:hover:bg-slate-800/80 text-slate-300 text-xs font-medium transition"
          title="Remove Selected Task(s)"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {selectedCount > 1 ? ` (${selectedCount})` : ""}
        </button>
      </div>

      {/* Right Search + Speed Limiter + Extensions + Settings */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter downloads, hosts..."
            className="w-44 bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <button
          onClick={onToggleSpeedLimiter}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
            settings.speed_limiter_enabled
              ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
              : "bg-slate-800/70 border-slate-700/70 text-slate-300 hover:bg-slate-800"
          }`}
          title="Toggle Global Token-Bucket Speed Limiter"
        >
          <Gauge className="w-3.5 h-3.5" />
          {settings.speed_limiter_enabled
            ? `Limit: ${(settings.global_max_download_kbps / 1024).toFixed(0)} MB/s`
            : "Unthrottled"}
        </button>

        <button
          onClick={onOpenScheduler}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 border border-slate-700/70 text-slate-200 text-xs font-medium transition"
          title="IDM Queue & Night Scheduler"
        >
          <CalendarClock className="w-3.5 h-3.5 text-indigo-400" />
          Queues
        </button>

        <button
          onClick={() => onOpenSettings("logins")}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 border border-slate-700/70 text-slate-200 text-xs font-medium transition"
          title="Site Logins & Auth Vault (Usersdrive, FTP, 1fichier)"
        >
          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
          Site Auth
        </button>

        <button
          onClick={onOpenExtensions}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-semibold transition"
          title="Install, Enable, or Disable Chrome, Firefox, and Safari Extensions"
        >
          <Puzzle className="w-3.5 h-3.5 text-indigo-400" />
          Extensions
        </button>

        <button
          onClick={() => onOpenSettings("general")}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition"
          title="Open X Download Manager Settings"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </button>
      </div>
    </header>
  );
};
