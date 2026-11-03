import React, { useState } from "react";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Play,
  X,
  ShieldCheck,
  RefreshCw,
  Info,
} from "lucide-react";
import {
  UpdateRestorationReport,
  RestoredDownloadInfo,
  DownloadResumeVerificationResult,
} from "../types/xdm";
import {
  apiDismissUpdateRestorationReport,
  apiVerifyAndResumeDownload,
  formatBytes,
} from "../services/tauriBridge";

interface UpdateRestorationModalProps {
  report: UpdateRestorationReport;
  onClose: () => void;
  onRefreshDownloads: () => void;
}

export const UpdateRestorationModal: React.FC<UpdateRestorationModalProps> = ({
  report,
  onClose,
  onRefreshDownloads,
}) => {
  const [resumingIds, setResumingIds] = useState<Set<string>>(new Set());
  const [verificationFeedback, setVerificationFeedback] = useState<
    Record<string, DownloadResumeVerificationResult>
  >({});
  const [resumedCount, setResumedCount] = useState<number>(0);

  const handleVerifyAndResume = async (item: RestoredDownloadInfo) => {
    setResumingIds((prev) => new Set(prev).add(item.id));
    try {
      const result = await apiVerifyAndResumeDownload(item.id);
      setVerificationFeedback((prev) => ({ ...prev, [item.id]: result }));
      if (result.can_resume) {
        setResumedCount((c) => c + 1);
        onRefreshDownloads();
      }
    } catch (e: any) {
      setVerificationFeedback((prev) => ({
        ...prev,
        [item.id]: {
          id: item.id,
          can_resume: false,
          accepts_ranges: false,
          validator_matches: false,
          server_total_bytes: item.total_bytes,
          message: e?.message || "Verification request failed",
        },
      }));
    } finally {
      setResumingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleResumeAllEligible = async () => {
    for (const item of report.ready_to_resume) {
      if (!verificationFeedback[item.id]?.can_resume) {
        await handleVerifyAndResume(item);
      }
    }
  };

  const handleDismiss = async () => {
    await apiDismissUpdateRestorationReport();
    onClose();
  };

  const hasReadyItems = report.ready_to_resume.length > 0;
  const hasProtectedItems = report.non_resumable_protected.length > 0;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-cyan-500/40 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-cyan-950/60 to-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                ByteX Download Manager Updated Successfully
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40">
                  {report.previous_version ? `v${report.previous_version} → ` : ""}v
                  {report.app_version}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                All downloads, partial segments, queues, schedules, and settings have been safely preserved.
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs flex-1">
          {/* Summary Status Pill */}
          <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <div className="font-semibold text-emerald-200 text-xs">
                  Zero Data Loss: {report.total_restored} Total Transfers Preserved
                </div>
                <div className="text-[11px] text-slate-300">
                  {report.safely_paused} transfers were safely paused before update.
                  {report.completed_verified > 0 &&
                    ` ${report.completed_verified} completed files verified on disk.`}
                </div>
              </div>
            </div>
            {hasReadyItems && (
              <button
                onClick={handleResumeAllEligible}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs flex items-center gap-1.5 shrink-0 transition"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Resume All Ready
              </button>
            )}
          </div>

          {/* Resumable Transfers Ready to Resume */}
          {hasReadyItems && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                Ready to Resume with Server Verification ({report.ready_to_resume.length})
              </div>
              <div className="space-y-2">
                {report.ready_to_resume.map((item) => {
                  const isResuming = resumingIds.has(item.id);
                  const feedback = verificationFeedback[item.id];
                  const percent =
                    item.total_bytes > 0
                      ? Math.min(100, Math.round((item.downloaded_bytes / item.total_bytes) * 100))
                      : 0;

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="font-medium text-slate-200 truncate text-xs">
                          {item.filename}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>
                            {formatBytes(item.downloaded_bytes)} of{" "}
                            {item.total_bytes > 0 ? formatBytes(item.total_bytes) : "Unknown size"}
                          </span>
                          <span>•</span>
                          <span>{percent}% completed</span>
                        </div>
                        {feedback && (
                          <div
                            className={`text-[11px] flex items-center gap-1 ${
                              feedback.can_resume ? "text-emerald-400" : "text-amber-400"
                            }`}
                          >
                            <Info className="w-3 h-3 shrink-0" />
                            <span>{feedback.message}</span>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => handleVerifyAndResume(item)}
                        disabled={isResuming || feedback?.can_resume}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition ${
                          feedback?.can_resume
                            ? "bg-emerald-950 border border-emerald-500/40 text-emerald-300"
                            : "bg-slate-800 hover:bg-cyan-700 text-white border border-slate-700"
                        }`}
                      >
                        {isResuming ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" /> Verifying...
                          </>
                        ) : feedback?.can_resume ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Resumed
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" /> Verify & Resume
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Non-Resumable Transfers Kept Paused for Safety */}
          {hasProtectedItems && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                Protected Non-Resumable Transfers ({report.non_resumable_protected.length})
              </div>
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-[11px] leading-relaxed">
                These servers do not support HTTP Byte-Range requests. To protect your partial files from being overwritten or corrupted, ByteX kept them paused. You can resume them manually at any time to restart from the beginning.
              </div>
              <div className="space-y-2">
                {report.non_resumable_protected.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="font-medium text-slate-200 truncate text-xs">
                        {item.filename}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {formatBytes(item.downloaded_bytes)} downloaded • Kept paused safely
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-1 rounded bg-amber-950/60 text-amber-300 border border-amber-500/30 font-medium">
                      Non-Resumable
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400">
            Database integrity check passed. Checkpoint marked restored.
          </span>
          <button
            onClick={handleDismiss}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition shadow-lg shadow-cyan-600/20"
          >
            {resumedCount > 0 ? "Continue to ByteX" : "Acknowledge & Close"}
          </button>
        </div>
      </div>
    </div>
  );
};
