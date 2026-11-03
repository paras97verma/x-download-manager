import React, { useState, useEffect } from "react";
import {
  Download,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  X,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppUpdateInfo, UpdatePreparationSummary } from "../types/xdm";
import {
  apiCheckForUpdates,
  apiOpenBrowserUrl,
  apiPrepareAppForUpdate,
} from "../services/tauriBridge";

interface UpdateCheckModalProps {
  appVersion: string;
  onClose: () => void;
}

export const UpdateCheckModal: React.FC<UpdateCheckModalProps> = ({
  appVersion,
  onClose,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<boolean>(false);
  const [prepSummary, setPrepSummary] = useState<UpdatePreparationSummary | null>(null);

  const fetchUpdate = async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await apiCheckForUpdates();
      setUpdateInfo(info);
    } catch (e: any) {
      setError(e?.message || "Failed to check for updates. Check your internet connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUpdate();
  }, []);

  const handlePrepareUpdate = async () => {
    setPreparing(true);
    setError(null);
    try {
      const summary = await apiPrepareAppForUpdate(updateInfo?.latest_version);
      setPrepSummary(summary);
    } catch (e: any) {
      setError(e?.message || "Failed to prepare application for update.");
    } finally {
      setPreparing(false);
    }
  };

  const handleOpenReleasePage = () => {
    const url = updateInfo?.release_url || "https://github.com/paras97verma/x-download-manager/releases";
    apiOpenBrowserUrl(url);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-bold text-white">Software Updates</h2>
              <p className="text-[11px] text-slate-400">
                Check for official releases, changelogs, and safe installer handoffs.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
              <div className="text-xs font-medium">Checking for latest ByteX releases...</div>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/30 text-rose-300 space-y-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 text-rose-400" />
                Update Check Failed
              </div>
              <div className="text-[11px] text-rose-200/80">{error}</div>
              <button
                onClick={fetchUpdate}
                className="mt-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition"
              >
                Retry
              </button>
            </div>
          ) : updateInfo?.has_update ? (
            <div className="space-y-4">
              {/* New version banner */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-950/40 to-indigo-950/40 border border-cyan-500/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-cyan-200 flex items-center gap-2">
                    <Download className="w-4 h-4 text-cyan-400" />
                    New Version Available: v{updateInfo.latest_version}
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    Current: v{appVersion}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 leading-relaxed">
                  A new verified build of ByteX Download Manager is available.
                </div>
              </div>

              {/* Release Notes */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Changelog & Release Notes:
                </div>
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto font-mono text-[10px]">
                  {updateInfo.release_notes}
                </div>
              </div>

              {/* Preparation feedback if triggered */}
              {prepSummary ? (
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 space-y-1 text-xs">
                  <div className="font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Application Prepared for Update
                  </div>
                  <div className="text-[11px] text-slate-300">
                    {prepSummary.paused_downloads_count} active transfers safely paused. Database checkpoint truncated and backup created at:{" "}
                    <code className="text-emerald-300 text-[10px]">{prepSummary.backup_path}</code>.
                  </div>
                  <div className="text-[11px] text-emerald-200 pt-1">
                    You can now run the downloaded installer (.dmg on macOS, .exe on Windows, or .AppImage/.deb/.rpm on Linux) or replace the application file.
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-[11px] space-y-1">
                  <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-cyan-400" />
                    Safe Update Guarantee
                  </div>
                  <div>
                    Click <strong>"Prepare App for Update"</strong> before running your installer to flush in-flight byte segments to disk and create an automatic SQLite backup snapshot.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center justify-center space-y-3 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-white text-sm">You're on the Latest Version</h3>
                <p className="text-xs text-slate-400">
                  ByteX Download Manager v{appVersion} is up to date.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between shrink-0">
          <button
            onClick={fetchUpdate}
            disabled={loading || preparing}
            className="text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Check Again
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
            >
              Close
            </button>
            {updateInfo?.has_update && (
              <>
                <button
                  onClick={handleOpenReleasePage}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Download Release
                </button>
                {!prepSummary && (
                  <button
                    onClick={handlePrepareUpdate}
                    disabled={preparing}
                    className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-lg shadow-cyan-600/20"
                  >
                    {preparing ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Preparing...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5" /> Prepare App for Update
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
