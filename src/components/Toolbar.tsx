import React from "react";
import {
  Plus,
  Magnet,
  Play,
  Pause,
  Square,
  Trash2,
  CalendarClock,
  Settings,
  Sparkles,
} from "lucide-react";
import { AppSettings } from "../types/xdm";

interface ToolbarProps {
  onOpenAddModal: (mode: "url" | "torrent") => void;
  onResumeSelected: () => void;
  onPauseSelected: () => void;
  onStopAll: () => void;
  onDeleteSelected: () => void;
  onOpenScheduler: () => void;
  onOpenExtensions?: () => void;
  onOpenSettings: (initialTab?: string) => void;
  onToggleUiMode: () => void;
  uiMode: "simple" | "advanced";
  settings?: AppSettings;
  selectedCount?: number;
  appVersion?: string;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onOpenAddModal,
  onResumeSelected,
  onPauseSelected,
  onStopAll,
  onDeleteSelected,
  onOpenScheduler,
  onOpenSettings,
  onToggleUiMode,
  uiMode,
  selectedCount = 0,
  appVersion,
}) => {
  const isMac = typeof navigator !== "undefined" && navigator.platform?.toUpperCase().includes("MAC");
  return (
    <header className="min-h-14 bg-[#111827] border-b border-slate-800 px-3 py-2 flex flex-wrap items-center justify-between select-none shrink-0 gap-2 min-w-0">
      {/* Left Brand + Actions */}
      <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
        <div className="flex items-center gap-2 pr-3 border-r border-slate-800 shrink-0">
        <img src="/bytex-mark.svg" alt="" className="w-8 h-8 rounded-lg shrink-0" />
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold tracking-tight text-white whitespace-nowrap">
              ByteX Download Manager
            </span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-cyan-400/15 text-cyan-300 border border-cyan-400/30 whitespace-nowrap">
              v{appVersion || (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "")}
            </span>
          </div>
        </div>

        {/* Primary Add Actions */}
        <button
          onClick={() => onOpenAddModal("url")}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-400 text-white font-medium text-xs shadow-sm transition shrink-0"
          title="Add Download (⌘N)"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden xl:inline">Add URL</span>
        </button>

        <button
          onClick={() => onOpenAddModal("torrent")}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-xs shadow-sm transition shrink-0"
          title="Add Torrent or Magnet (⌘T)"
        >
          <Magnet className="w-4 h-4" />
          <span className="hidden xl:inline">Add Torrent</span>
        </button>

        <div className="h-5 w-px bg-slate-800 mx-0.5" />

        {/* Transfer Controls */}
        <button
          onClick={onResumeSelected}
          disabled={selectedCount === 0}
          className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800/80 text-slate-200 text-xs font-medium transition shrink-0"
          title="Resume Selected (Space)"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden xl:inline">Resume</span>
          {selectedCount > 1 ? ` (${selectedCount})` : ""}
        </button>

        <button
          onClick={onPauseSelected}
          disabled={selectedCount === 0}
          className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800/80 text-slate-200 text-xs font-medium transition shrink-0"
          title="Pause Selected (Space)"
        >
          <Pause className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden xl:inline">Pause</span>
          {selectedCount > 1 ? ` (${selectedCount})` : ""}
        </button>

        <button
          onClick={onStopAll}
          className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium transition shrink-0"
          title="Stop All Transfers"
        >
          <Square className="w-3.5 h-3.5 text-rose-400" />
          <span className="hidden xl:inline">Stop All</span>
        </button>

        <button
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-950/60 hover:text-rose-300 disabled:opacity-40 disabled:hover:bg-slate-800/80 text-slate-300 text-xs font-medium transition shrink-0"
          title="Delete Selected (Backspace)"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {selectedCount > 1 ? ` (${selectedCount})` : ""}
        </button>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          onClick={onToggleUiMode}
          className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border text-xs font-semibold transition shrink-0 ${
            uiMode === "simple"
              ? "bg-cyan-700/20 border-cyan-400/40 text-cyan-200 hover:bg-cyan-700/30"
              : "bg-indigo-600/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30"
          }`}
          title={`Switch between Simple and Advanced Mode (${isMac ? "⌘" : "Ctrl+"}M)`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden xl:inline capitalize">{uiMode}</span>
        </button>

        <button
          onClick={onOpenScheduler}
          className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg bg-slate-800/70 hover:bg-slate-700 border border-slate-700/70 text-slate-200 text-xs font-medium transition shrink-0"
          title="Queues & Scheduler"
        >
          <CalendarClock className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden xl:inline">Queues</span>
        </button>

        <button
          onClick={() => onOpenSettings("general")}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium transition shrink-0"
          title="Settings (⌘,)"
        >
          <Settings className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Settings</span>
        </button>
      </div>
    </header>
  );
};
