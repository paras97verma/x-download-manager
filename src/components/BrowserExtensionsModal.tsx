import React, { useState } from "react";
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
      default:
        return family === "firefox" ? "about:addons" : "chrome://extensions";
    }
  };

  const handleLaunchAndReveal = async (b: BrowserStatus) => {
    setOpeningFolder(b.id);
    try {
      // 1. Reveal unpacked extension in Finder / Explorer
      await apiOpenExtensionFolder(b.family);
      // 2. Open browser extensions page
      const url = getBrowserExtensionsUrl(b.id, b.family);
      await apiOpenBrowserUrl(url);
    } catch (err) {
      console.error("Failed to launch extension helper:", err);
    } finally {
      setTimeout(() => setOpeningFolder(null), 1500);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Puzzle className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-sm font-bold text-white">
                Browser Extensions & Native Messaging Manager
              </h2>
              <p className="text-[11px] text-slate-400">
                Automatic Native Messaging host registration for Dia, Arc, Chrome, Brave, Firefox, Edge, and Safari.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs flex-1">
          {/* Top Auto-Detection Banner */}
          <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="font-semibold text-indigo-200 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-indigo-400" />
                Native IPC Host Active on 127.0.0.1:{settings.browser.ipc_port}
              </div>
              <div className="text-[11px] text-slate-300">
                Captures multi-threaded downloads, streaming media, and authenticated site cookies directly.
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

          {/* Quick 2-Step Activation Guide for Modern Browsers (Dia, Arc, Chrome) */}
          <div className="p-3.5 rounded-xl bg-blue-950/20 border border-blue-500/30 space-y-2">
            <div className="font-semibold text-blue-200 flex items-center gap-1.5 text-xs">
              <Sparkles className="w-4 h-4 text-blue-400" />
              Easy 2-Click Installation for Dia, Arc & Chromium Browsers:
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300 pl-1 leading-relaxed">
              <li>
                Click <strong className="text-blue-300">"Load Unpacked"</strong> on your browser below. This opens Finder with the extension folder selected and opens your browser's extensions page.
              </li>
              <li>
                Toggle <strong className="text-amber-300">Developer mode</strong> (top-right of your browser), click <strong className="text-emerald-300">Load unpacked</strong>, and select the opened extension folder.
              </li>
            </ol>
          </div>

          {/* Browser Grid */}
          <div className="space-y-2">
            {browsers.map((b) => (
              <div
                key={b.id}
                className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100 text-sm">{b.display_name}</span>
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
                      {b.family}
                    </span>
                    {b.detected_installed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" /> Detected on System
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-500">
                        Not Installed
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Native Host Manifest: <span className="font-mono text-slate-300">{b.manifest_path}</span>
                  </div>
                  <div className="text-[11px] text-indigo-300">{b.status_message}</div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleLaunchAndReveal(b)}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-medium flex items-center gap-1.5 transition"
                    title={`Open ${b.display_name} extensions page and reveal folder in Finder`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {openingFolder === b.id ? "Opening..." : "Load Unpacked"}
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
            ))}
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex justify-between items-center text-[11px] text-slate-400 shrink-0">
          <span>
            Hold <strong className="text-slate-200">[{settings.browser.bypass_key}]</strong> key while clicking a link in your browser to bypass XDM interception.
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
