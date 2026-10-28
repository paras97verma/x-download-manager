import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  Plus,
  Magnet,
  Settings,
  FolderOpen,
  CalendarClock,
  Puzzle,
  Play,
  Pause,
  Square,
  Trash2,
  CheckSquare,
  Sparkles,
  Gauge,
  HelpCircle,
  KeyRound,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";

interface MenuBarProps {
  onOpenAddUrl: () => void;
  onOpenAddTorrent: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenScheduler: () => void;
  onOpenExtensions: () => void;
  onToggleUiMode: () => void;
  uiMode: "simple" | "advanced";
  onResumeSelected: () => void;
  onPauseSelected: () => void;
  onStopAll: () => void;
  onDeleteSelected: (deleteFile?: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onOpenFile?: () => void;
  onShowInFolder?: () => void;
  onRestartSelected?: () => void;
  selectedCount: number;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  onOpenAddUrl,
  onOpenAddTorrent,
  onOpenSettings,
  onOpenScheduler,
  onOpenExtensions,
  onToggleUiMode,
  uiMode,
  onResumeSelected,
  onPauseSelected,
  onStopAll,
  onDeleteSelected,
  onSelectAll,
  onDeselectAll,
  onOpenFile,
  onShowInFolder,
  onRestartSelected,
  selectedCount,
}) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  const isMac = typeof navigator !== "undefined" && navigator.platform?.toUpperCase().includes("MAC");
  const modKey = isMac ? "⌘" : "Ctrl+";

  // Close menus on outside click or Escape
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleAction = (cb: () => void) => {
    setOpenMenu(null);
    cb();
  };

  return (
    <div
      ref={menuBarRef}
      className="h-7 bg-[#0c1017] border-b border-slate-800/80 px-2 flex items-center text-xs text-slate-300 select-none relative z-40 shrink-0 font-medium"
    >
      {/* File Menu */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}
          className={`px-2.5 py-0.5 rounded hover:bg-slate-800 transition ${
            openMenu === "file" ? "bg-slate-800 text-white" : ""
          }`}
        >
          File
        </button>
        {openMenu === "file" && (
          <div className="absolute left-0 top-full mt-1 w-60 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200">
            <button
              onClick={() => handleAction(onOpenAddUrl)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <Plus className="w-3.5 h-3.5 text-blue-400" /> Add URL...
              </span>
              <kbd className="text-[10px] text-slate-400">{modKey}N</kbd>
            </button>
            <button
              onClick={() => handleAction(onOpenAddTorrent)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <Magnet className="w-3.5 h-3.5 text-emerald-400" /> Add Torrent / Magnet...
              </span>
              <kbd className="text-[10px] text-slate-400">{modKey}T</kbd>
            </button>
            <div className="h-px bg-slate-700/60 my-1" />
            <button
              onClick={() => handleAction(() => onOpenSettings("general"))}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 text-slate-400" /> Preferences...
              </span>
              <kbd className="text-[10px] text-slate-400">{modKey},</kbd>
            </button>
          </div>
        )}
      </div>

      {/* Edit Menu */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
          className={`px-2.5 py-0.5 rounded hover:bg-slate-800 transition ${
            openMenu === "edit" ? "bg-slate-800 text-white" : ""
          }`}
        >
          Edit
        </button>
        {openMenu === "edit" && (
          <div className="absolute left-0 top-full mt-1 w-56 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200">
            <button
              onClick={() => handleAction(onSelectAll)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <CheckSquare className="w-3.5 h-3.5 text-blue-400" /> Select All
              </span>
              <kbd className="text-[10px] text-slate-400">{modKey}A</kbd>
            </button>
            <button
              onClick={() => handleAction(onDeselectAll)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span>Deselect All</span>
              <kbd className="text-[10px] text-slate-400">Esc</kbd>
            </button>
            <div className="h-px bg-slate-700/60 my-1" />
            <button
              onClick={() => handleAction(() => onDeleteSelected(false))}
              disabled={selectedCount === 0}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-rose-950/70 hover:text-rose-200 text-rose-300 disabled:opacity-40 text-left"
            >
              <span className="flex items-center gap-2">
                <Trash2 className="w-3.5 h-3.5" /> Remove from List
              </span>
              <kbd className="text-[10px] text-slate-400">Del</kbd>
            </button>
            <button
              onClick={() => handleAction(() => onDeleteSelected(true))}
              disabled={selectedCount === 0}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-rose-950/70 hover:text-rose-200 text-rose-400 disabled:opacity-40 text-left"
            >
              <span className="flex items-center gap-2">
                <Trash2 className="w-3.5 h-3.5" /> Delete File from Disk
              </span>
            </button>
          </div>
        )}
      </div>

      {/* View Menu */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === "view" ? null : "view")}
          className={`px-2.5 py-0.5 rounded hover:bg-slate-800 transition ${
            openMenu === "view" ? "bg-slate-800 text-white" : ""
          }`}
        >
          View
        </button>
        {openMenu === "view" && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200">
            <button
              onClick={() => handleAction(onToggleUiMode)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left font-semibold text-blue-300"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" />
                Switch to {uiMode === "simple" ? "Advanced Mode" : "Simple Mode"}
              </span>
              <kbd className="text-[10px] text-slate-400">{modKey}M</kbd>
            </button>
            <div className="px-3 py-1 text-[10px] text-slate-400 leading-tight">
              {uiMode === "simple"
                ? "Currently in Beginner Simple Mode (clean view, minimal distractions)"
                : "Currently in Advanced Mode (multi-threaded chunk maps & logs)"}
            </div>
          </div>
        )}
      </div>

      {/* Tasks & Downloads Menu */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === "tasks" ? null : "tasks")}
          className={`px-2.5 py-0.5 rounded hover:bg-slate-800 transition ${
            openMenu === "tasks" ? "bg-slate-800 text-white" : ""
          }`}
        >
          Downloads
        </button>
        {openMenu === "tasks" && (
          <div className="absolute left-0 top-full mt-1 w-60 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200">
            <button
              onClick={() => handleAction(onResumeSelected)}
              disabled={selectedCount === 0}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left disabled:opacity-40"
            >
              <span className="flex items-center gap-2">
                <Play className="w-3.5 h-3.5 text-emerald-400" /> Resume Selected
              </span>
              <kbd className="text-[10px] text-slate-400">Space</kbd>
            </button>
            <button
              onClick={() => handleAction(onPauseSelected)}
              disabled={selectedCount === 0}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left disabled:opacity-40"
            >
              <span className="flex items-center gap-2">
                <Pause className="w-3.5 h-3.5 text-amber-400" /> Pause Selected
              </span>
              <kbd className="text-[10px] text-slate-400">Space</kbd>
            </button>
            {onRestartSelected && (
              <button
                onClick={() => handleAction(onRestartSelected)}
                disabled={selectedCount === 0}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left disabled:opacity-40"
              >
                <RotateCcw className="w-3.5 h-3.5 text-blue-400" /> Restart Selected from 0%
              </button>
            )}
            <button
              onClick={() => handleAction(onStopAll)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left text-rose-300"
            >
              <Square className="w-3.5 h-3.5 text-rose-400" /> Stop All Transfers
            </button>
            <div className="h-px bg-slate-700/60 my-1" />
            {onOpenFile && (
              <button
                onClick={() => handleAction(onOpenFile)}
                className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
              >
                <span className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-blue-400" /> Open File
                </span>
                <kbd className="text-[10px] text-slate-400">Enter</kbd>
              </button>
            )}
            {onShowInFolder && (
              <button
                onClick={() => handleAction(onShowInFolder)}
                className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
              >
                <span className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5 text-indigo-400" /> Reveal in Finder / Folder
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scheduler Menu */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === "scheduler" ? null : "scheduler")}
          className={`px-2.5 py-0.5 rounded hover:bg-slate-800 transition ${
            openMenu === "scheduler" ? "bg-slate-800 text-white" : ""
          }`}
        >
          Scheduler
        </button>
        {openMenu === "scheduler" && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200">
            <button
              onClick={() => handleAction(onOpenScheduler)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <CalendarClock className="w-3.5 h-3.5 text-indigo-400" /> IDM Queues & Scheduler...
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Tools Menu */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === "tools" ? null : "tools")}
          className={`px-2.5 py-0.5 rounded hover:bg-slate-800 transition ${
            openMenu === "tools" ? "bg-slate-800 text-white" : ""
          }`}
        >
          Tools
        </button>
        {openMenu === "tools" && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200">
            <button
              onClick={() => handleAction(onOpenExtensions)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <Puzzle className="w-3.5 h-3.5 text-indigo-400" /> Browser Integration...
              </span>
            </button>
            <button
              onClick={() => handleAction(() => onOpenSettings("logins"))}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-amber-400" /> Site Logins & Auth Vault...
              </span>
            </button>
            <button
              onClick={() => handleAction(() => onOpenSettings("speed"))}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <Gauge className="w-3.5 h-3.5 text-blue-400" /> Speed Limiter Settings...
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Help Menu */}
      <div className="relative">
        <button
          onClick={() => setOpenMenu(openMenu === "help" ? null : "help")}
          className={`px-2.5 py-0.5 rounded hover:bg-slate-800 transition ${
            openMenu === "help" ? "bg-slate-800 text-white" : ""
          }`}
        >
          Help
        </button>
        {openMenu === "help" && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-[#161f30] border border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-200">
            <button
              onClick={() => handleAction(() => onOpenSettings("shortcuts"))}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span className="flex items-center gap-2">
                <HelpCircle className="w-3.5 h-3.5 text-emerald-400" /> Keyboard Shortcuts Guide
              </span>
              <kbd className="text-[10px] text-slate-400">{modKey}/</kbd>
            </button>
            <button
              onClick={() => handleAction(() => onOpenSettings("about"))}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
            >
              <span>About X Download Manager</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
