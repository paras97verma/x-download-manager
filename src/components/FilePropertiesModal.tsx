import React, { useState } from "react";
import {
  X,
  FileText,
  FolderOpen,
  Copy,
  Check,
  ShieldCheck,
  Globe,
  Layers,
  Clock,
  Cpu,
  RefreshCw,
} from "lucide-react";
import { DownloadItem } from "../types/xdm";
import {
  apiOpenFile,
  apiShowInFolder,
  apiVerifyFileChecksum,
  formatBytes,
  formatEta,
  formatSpeed,
} from "../services/tauriBridge";

interface FilePropertiesModalProps {
  item: DownloadItem;
  onClose: () => void;
}

export const FilePropertiesModal: React.FC<FilePropertiesModalProps> = ({ item, onClose }) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(item.checksum_sha256 || null);
  const [isHashing, setIsHashing] = useState(false);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleComputeHash = async () => {
    setIsHashing(true);
    try {
      const computed = await apiVerifyFileChecksum(item.save_path);
      if (computed) {
        setHash(computed);
      }
    } catch (e) {
      console.error("Failed to verify checksum:", e);
    } finally {
      setIsHashing(false);
    }
  };

  const pct =
    item.total_bytes > 0
      ? Math.min(100, (item.downloaded_bytes / item.total_bytes) * 100).toFixed(1)
      : "0";

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white truncate max-w-md">{item.filename}</h2>
              <p className="text-[11px] text-slate-400">Download Task Properties & Verification</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs flex-1">
          {/* General Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Status</div>
              <div className="font-semibold text-slate-200 capitalize flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    item.status === "completed"
                      ? "bg-emerald-400"
                      : item.status === "downloading"
                      ? "bg-blue-400 animate-pulse"
                      : item.status === "paused"
                      ? "bg-amber-400"
                      : "bg-rose-400"
                  }`}
                />
                {item.status} ({pct}%)
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Category & Queue</div>
              <div className="font-semibold text-slate-200 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                {item.category} • {item.queue_id}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Size & Transferred</div>
              <div className="font-semibold text-slate-200">
                {formatBytes(item.downloaded_bytes)} of {formatBytes(item.total_bytes)}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Engine & Speed</div>
              <div className="font-semibold text-slate-200 flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-blue-400" />
                {item.threads_count} Threads • {item.status === "downloading" ? formatSpeed(item.speed_bps) : "Idle"}
              </div>
            </div>
          </div>

          {/* URL */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span>Source URL</span>
              <button
                onClick={() => copyToClipboard(item.url, "url")}
                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                {copiedField === "url" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedField === "url" ? "Copied" : "Copy URL"}
              </button>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono break-all select-text">
              {item.url}
            </div>
          </div>

          {/* Save Path */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span>Local Save Path</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => apiShowInFolder(item.save_path)}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <FolderOpen className="w-3 h-3" /> Reveal in Finder
                </button>
                <button
                  onClick={() => copyToClipboard(item.save_path, "path")}
                  className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  {copiedField === "path" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedField === "path" ? "Copied" : "Copy Path"}
                </button>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono break-all select-text">
              {item.save_path}
            </div>
          </div>

          {/* SHA-256 Checksum Verification */}
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Integrity Checksum (SHA-256)
              </span>
              <button
                onClick={handleComputeHash}
                disabled={isHashing}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-[11px] font-medium flex items-center gap-1 transition"
              >
                <RefreshCw className={`w-3 h-3 ${isHashing ? "animate-spin text-blue-400" : ""}`} />
                {isHashing ? "Calculating..." : hash ? "Recalculate" : "Verify Integrity"}
              </button>
            </div>
            <div className="text-[11px] font-mono text-emerald-400 bg-black/40 p-2 rounded border border-emerald-500/20 break-all select-text">
              {hash || "No checksum verified yet. Click Verify Integrity to calculate."}
            </div>
          </div>

          {/* Timestamps & Browser Source */}
          <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
            <span>
              Captured from: <strong className="text-slate-200">{item.source_browser || "Manual / Extension"}</strong>
            </span>
            <span>
              Created: <strong className="text-slate-200">{new Date(item.created_at).toLocaleString()}</strong>
            </span>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex justify-between items-center shrink-0">
          {item.status === "completed" ? (
            <button
              onClick={() => apiOpenFile(item.save_path)}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow"
            >
              <FileText className="w-3.5 h-3.5" /> Open File
            </button>
          ) : (
            <div />
          )}

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

