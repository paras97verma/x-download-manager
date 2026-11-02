import React from "react";
import { Copy, FolderOpen, X } from "lucide-react";
import { DuplicateDownloadNotice } from "../types/xdm";

interface DuplicateDownloadModalProps {
  notice: DuplicateDownloadNotice;
  onUseExisting: () => void;
  onSaveCopy: () => void;
  onCancel: () => void;
}

export const DuplicateDownloadModal: React.FC<DuplicateDownloadModalProps> = ({
  notice,
  onUseExisting,
  onSaveCopy,
  onCancel,
}) => (
  <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-download-title"
      className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#111827] shadow-2xl overflow-hidden"
    >
      <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-800">
        <div>
          <h2 id="duplicate-download-title" className="text-base font-semibold text-white">
            Duplicate download detected
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            An item with this name or URL already exists. Choose what ByteX should do.
          </p>
        </div>
        <button onClick={onCancel} aria-label="Close duplicate dialog" className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="px-5 py-4">
        <div className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2">
          <div className="truncate text-sm font-medium text-slate-100" title={notice.existing_filename}>
            {notice.existing_filename}
          </div>
          {notice.existing_status && (
            <div className="mt-1 text-[11px] capitalize text-slate-400">
              Existing download: {notice.existing_status.replaceAll("_", " ")}
            </div>
          )}
          <div className="mt-1 truncate text-[11px] font-mono text-slate-500" title={notice.existing_path}>
            {notice.existing_path}
          </div>
        </div>
        <p className="mt-3 text-xs text-emerald-300">Recommended: use the existing item, or save another copy with a new name.</p>
      </div>

      <footer className="flex flex-wrap justify-end gap-2 px-5 py-4 border-t border-slate-800">
        <button onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800">
          Cancel
        </button>
        <button onClick={onUseExisting} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800">
          <FolderOpen className="h-3.5 w-3.5" /> Use existing
        </button>
        <button onClick={onSaveCopy} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500">
          <Copy className="h-3.5 w-3.5" /> Save another copy
        </button>
      </footer>
    </section>
  </div>
);
