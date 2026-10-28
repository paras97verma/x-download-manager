import React from "react";
import { X, CalendarClock, Play } from "lucide-react";
import { AppSettings } from "../types/xdm";

interface SchedulerModalProps {
  settings: AppSettings;
  onStartQueueNow: (queueId: string) => void;
  onClose: () => void;
}

export const SchedulerModal: React.FC<SchedulerModalProps> = ({
  settings,
  onStartQueueNow,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-white">
            <CalendarClock className="w-4 h-4 text-indigo-400" />
            IDM Synchronization Queues & Bandwidth Scheduler
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          {settings.queues.map((q) => (
            <div
              key={q.id}
              className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between"
            >
              <div className="space-y-1">
                <div className="font-bold text-white text-sm">{q.name}</div>
                <div className="text-slate-400">
                  Max Concurrent Transfers: <strong className="text-slate-200">{q.max_concurrent}</strong> |{" "}
                  Schedule:{" "}
                  {q.start_time_enabled
                    ? `${q.start_time_hhmm} – ${q.stop_time_hhmm}`
                    : "Manual / Immediate"}
                </div>
                <div className="text-[11px] text-indigo-300">
                  On Queue Completion: <span className="uppercase">{q.post_queue_action}</span>
                </div>
              </div>
              <button
                onClick={() => {
                  onStartQueueNow(q.id);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> Start Queue Now
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
