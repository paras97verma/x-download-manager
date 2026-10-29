import React, { useState, useMemo } from "react";
import {
  X,
  Puzzle,
  CheckCircle2,
  RefreshCw,
  Shield,
  Power,
  FolderOpen,
  ExternalLink,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { AppSettings, BrowserStatus } from "../types/xdm";
import { apiOpenBrowserUrl, apiOpenExtensionFolder } from "../services/tauriBridge";

interface BrowserExtensionsModalProps {
  browsers: BrowserStatus[];
  settings: AppSettings;
  onToggleBrowser: (browserId: string, enable: boolean) => void;
  onReinstallAll: () => void;
  onClose: () => void;
}

export const BrowserExtensionsModal: React.FC<BrowserExtensionsModalProps> = ({
  browsers,
  settings,
  onToggleBrowser,
  onReinstallAll,
  onClose,
}) => {
  const [openingFolder, setOpeningFolder] = useState<string | null>(null);

  const installedBrowsers = useMemo(
    () => browsers.filter((b) => b.detected_installed),
    [browsers]
  );
  const uninstalledBrowsers = useMemo(
    () => browsers.filter((b) => !b.detected_installed),
    [browsers]
  );

  const getBrowserExtensionsUrl = (id: string, family: string): string => {
    switch (id) {
      case "dia":
        return "dia://extensions";
      case "arc":
        return "arc://extensions";
      case "brave":
        return "brave://extensions";
      case "edge":
        return "edge://extensions";
      case "opera":
      case "operagx":
        return "opera://extensions";
      case "vivaldi":
        return "vivaldi://extensions";
      case "safari":
        return "";
      default:
        return family === "firefox" ? "about:addons" : "chrome://extensions";
    }
  };

  const handleLaunchAndReveal = async (b: BrowserStatus) => {
    setOpeningFolder(b.id);
    try {
      // 1. Reveal unpacked extension in Finder / Explorer for the specific browser family
      await apiOpenExtensionFolder(b.family);
      // 2. Open browser extensions page if applicable
      const url = getBrowserExtensionsUrl(b.id, b.family);
      if (url) {
        await apiOpenBrowserUrl(url);
      }
    } catch (err) {
      console.error("Failed to launch extension helper:", err);
    } finally {
      setTimeout(() => setOpeningFolder(null), 1500);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Puzzle className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-sm font-bold text-white">
                Browser Integration & Extensions Manager
              </h2>
              <p className="text-[11px] text-slate-400">
                Native download capture and host registration for Dia, Safari, Chromium, and Firefox engines.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto text-xs flex-1">
          {/* Top Host Status Banner */}
          <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="font-semibold text-indigo-200 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-indigo-400" />
                Native IPC Host Active on 127.0.0.1:{settings.browser.ipc_port}
              </div>
              <div className="text-[11px] text-slate-300">
                Intercepts every file download (documents, archives, software, media) directly from your browser.
              </div>
            </div>
            <button
              onClick={onReinstallAll}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-register All Hosts
            </button>
          </div>

          {/* Quick Activation Guide for Chromium & Firefox */}
          <div className="p-3.5 rounded-xl bg-blue-950/20 border border-blue-500/30 space-y-2">
            <div className="font-semibold text-blue-200 flex items-center gap-1.5 text-xs">
              <Sparkles className="w-4 h-4 text-blue-400" />
              How to Activate in Dia, Arc, Chrome & Firefox:
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300 pl-1 leading-relaxed">
              <li>
                Click <strong className="text-blue-300">"Load Unpacked"</strong> on your installed browser below. This opens Finder with the extension folder selected and opens the browser extensions page.
              </li>
              <li>
                Turn on <strong className="text-amber-300">Developer mode</strong> (top-right of browser), click <strong className="text-emerald-300">Load unpacked</strong>, and select the opened extension folder.
              </li>
            </ol>
          </div>

          {/* Dedicated Safari Instructions Guide */}
          <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/40 space-y-2">
            <div className="font-semibold text-indigo-200 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Puzzle className="w-4 h-4 text-indigo-400" />
                How to Install & Enable Extension in Apple Safari (macOS):
              </span>
              <button
                onClick={() => apiOpenExtensionFolder("safari")}
                className="px-2.5 py-1 rounded bg-indigo-600/40 hover:bg-indigo-600 text-indigo-200 hover:text-white text-[10px] font-semibold flex items-center gap-1 transition"
              >
                <FolderOpen className="w-3 h-3" /> Reveal Safari Extension Folder
              </button>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300 pl-1 leading-relaxed">
              <li>
                Open <strong className="text-white">Safari</strong> &rarr; <strong className="text-white">Settings...</strong> (<kbd className="px-1 bg-slate-800 rounded font-mono text-[10px]">⌘,</kbd>) &rarr; <strong className="text-indigo-300">Advanced</strong> tab.
              </li>
              <li>
                Check the box: <strong className="text-amber-300">"Show features for web developers"</strong> (or "Show Develop menu in menu bar").
              </li>
              <li>
                In the macOS top menu bar, click <strong className="text-white">Develop</strong> &rarr; check <strong className="text-amber-300">"Allow Unsigned Extensions"</strong> (confirm with your Mac password / Touch ID).
              </li>
              <li>
                In Safari Settings, switch to the <strong className="text-indigo-300">Extensions</strong> tab, check <strong className="text-emerald-300">X Download Manager</strong> to enable it, and select <strong className="text-blue-300">"Always Allow on Every Website..."</strong>.
              </li>
            </ol>
          </div>

          {/* SECTION 1: INSTALLED BROWSERS ON THIS SYSTEM */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Installed on Your System ({installedBrowsers.length})
            </div>

            {installedBrowsers.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center text-slate-400">
                Detecting installed browsers...
              </div>
            ) : (
              installedBrowsers.map((b) => (
                <div
                  key={b.id}
                  className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 flex items-center justify-between gap-4 transition"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100 text-sm">{b.display_name}</span>
                      <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
                        {b.family}
                      </span>
                      {b.is_connected ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium">
                          <CheckCircle2 className="w-3 h-3" /> Connected
                        </span>
                      ) : b.native_host_registered ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 font-medium">
                          <AlertCircle className="w-3 h-3" /> Host Registered
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-medium">
                          Ready to Register
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      Host Manifest: <span className="font-mono text-slate-300">{b.manifest_path}</span>
                    </div>
                    <div className={`text-[11px] font-medium ${b.is_connected ? "text-emerald-400" : "text-slate-400"}`}>
                      {b.status_message}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleLaunchAndReveal(b)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-semibold flex items-center gap-1.5 transition"
                      title={`Open ${b.display_name} extensions and reveal folder`}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {openingFolder === b.id
                        ? "Opening..."
                        : b.family === "safari"
                        ? "Reveal Safari Folder"
                        : "Load Unpacked"}
                    </button>

                    <button
                      onClick={() => apiOpenExtensionFolder(b.family)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                      title="Reveal Extension Folder in Finder"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onToggleBrowser(b.id, !b.extension_enabled)}
                      className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition ${
                        b.extension_enabled
                          ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-rose-600/20 hover:text-rose-300 hover:border-rose-500/40"
                          : "bg-slate-800 text-slate-300 hover:bg-blue-600 hover:text-white"
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {b.extension_enabled ? "Enabled" : "Enable"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* SECTION 2: OTHER SUPPORTED BROWSERS (NOT INSTALLED - GREYED OUT & UNCLICKABLE) */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-slate-500" />
              Other Supported Browsers (Not Installed) ({uninstalledBrowsers.length})
            </div>

            <div className="space-y-2">
              {uninstalledBrowsers.map((b) => (
                <div
                  key={b.id}
                  className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60 opacity-40 select-none flex items-center justify-between gap-4 cursor-not-allowed"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-400 text-sm">{b.display_name}</span>
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-500 font-medium">
                        {b.family}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-500">
                        Not Installed
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Install {b.display_name} on your system to enable integration.
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      disabled
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800/40 text-slate-600 text-xs font-medium cursor-not-allowed border border-slate-800/60"
                    >
                      Unavailable
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex justify-between items-center text-[11px] text-slate-400 shrink-0">
          <span>
            Hold <strong className="text-slate-200">[{settings.browser.bypass_key}]</strong> key while clicking a link to download through your browser normally.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium shadow"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
