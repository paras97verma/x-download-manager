import React from "react";
import { X, Puzzle, CheckCircle2, RefreshCw, Shield, Power } from "lucide-react";
import { AppSettings, BrowserStatus } from "../types/xdm";

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
  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Puzzle className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-sm font-bold text-white">
                Browser Extensions & Native Messaging Auto-Installer
              </h2>
              <p className="text-[11px] text-slate-400">
                XDM automatically detects installed Chromium, Firefox, and Safari browsers and registers the Native Messaging Host.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
          {/* Top Auto-Detection Banner */}
          <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="font-semibold text-indigo-200 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-indigo-400" />
                Automatic Browser Extension Deployment Active (Port {settings.browser.ipc_port})
              </div>
              <div className="text-[11px] text-slate-300">
                Captures downloads, streaming video/audio, Referer headers, and session cookies (for Usersdrive & private servers).
              </div>
            </div>
            <button
              onClick={onReinstallAll}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Auto-Install / Repair All Detected
            </button>
          </div>

          {/* Browser Grid */}
          <div className="space-y-2">
            {browsers.map((b) => (
              <div
                key={b.id}
                className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100 text-sm">{b.display_name}</span>
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
                      {b.family}
                    </span>
                    {b.detected_installed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" /> Installed on OS
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-500">
                        Not Found
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Manifest: <span className="font-mono text-slate-300">{b.manifest_path}</span>
                  </div>
                  <div className="text-[11px] text-indigo-300">{b.status_message}</div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onToggleBrowser(b.id, !b.extension_enabled)}
                    className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition ${
                      b.extension_enabled
                        ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-rose-600/20 hover:text-rose-300 hover:border-rose-500/40"
                        : "bg-slate-800 text-slate-300 hover:bg-blue-600 hover:text-white"
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {b.extension_enabled ? "Enabled (Click to Disable)" : "Enable & Install"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex justify-between items-center text-[11px] text-slate-400">
          <span>Hold [{settings.browser.bypass_key}] key while clicking a link in your browser to bypass XDM interception.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
