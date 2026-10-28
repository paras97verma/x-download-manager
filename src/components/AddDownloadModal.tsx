import React, { useState } from "react";
import { X, Plus, Magnet, KeyRound, Cpu } from "lucide-react";
import { AppSettings, NewDownloadRequest } from "../types/xdm";

interface AddDownloadModalProps {
  initialMode: "url" | "torrent";
  settings: AppSettings;
  onClose: () => void;
  onAdd: (req: NewDownloadRequest) => void;
}

export const AddDownloadModal: React.FC<AddDownloadModalProps> = ({
  initialMode,
  settings,
  onClose,
  onAdd,
}) => {
  const [url, setUrl] = useState(
    initialMode === "torrent"
      ? "magnet:?xt=urn:btih:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4&dn=Linux_Mint_22_Cinnamon_64bit.iso"
      : "https://usersdrive.com/f82k91m40zpa.html"
  );
  const [filename, setFilename] = useState("");
  const [category, setCategory] = useState("Auto");
  const [threadsCount, setThreadsCount] = useState(settings.default_threads_per_download);
  const [queueId, setQueueId] = useState("main-queue");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [cookies, setCookies] = useState("");
  const [sequentialTorrent, setSequentialTorrent] = useState(true);

  const handleSubmit = (startImmediately: boolean) => {
    if (!url.trim()) return;
    onAdd({
      url: url.trim(),
      filename: filename.trim() || undefined,
      category: category === "Auto" ? undefined : category,
      threads_count: threadsCount,
      queue_id: queueId,
      start_immediately: startImmediately,
      auth_username: authUser.trim() || undefined,
      auth_password: authPass.trim() || undefined,
      cookies: cookies.trim() || undefined,
      sequential_torrent: sequentialTorrent,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-sm text-white">
            {initialMode === "torrent" ? (
              <>
                <Magnet className="w-4 h-4 text-emerald-400" />
                Add BitTorrent (.torrent) or Magnet URI
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 text-blue-400" />
                Add Multi-Threaded HTTP/HTTPS, FTP, or Authenticated File-Host URL
              </>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Download URL / Magnet Link / FTP Path / Usersdrive Link
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://... or magnet:?xt=... or ftp://... or https://usersdrive.com/..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Save Filename (Optional)</label>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="Auto-detect from headers"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
              >
                <option value="Auto">Auto-Detect</option>
                <option value="Compressed">Compressed</option>
                <option value="Programs">Programs</option>
                <option value="Video">Video</option>
                <option value="Music">Music</option>
                <option value="Documents">Documents</option>
                <option value="Torrents">Torrents</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 flex items-center gap-1">
                <Cpu className="w-3 h-3 text-blue-400" /> Parallel Threads ({threadsCount})
              </label>
              <input
                type="range"
                min={1}
                max={32}
                value={threadsCount}
                onChange={(e) => setThreadsCount(Number(e.target.value))}
                className="w-full accent-blue-500 mt-1.5"
              />
            </div>
          </div>

          {/* FTP / Usersdrive / Protected File Host Credentials Override */}
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
            <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
              <KeyRound className="w-3.5 h-3.5" />
              Server / File-Host Authentication (FTP, SFTP, Usersdrive, 1fichier, Basic/Cookie Auth)
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
                placeholder="Username (or leave blank to use Site Vault)"
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200"
              />
              <input
                type="password"
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                placeholder="Password / API Token"
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200"
              />
            </div>
            <input
              type="text"
              value={cookies}
              onChange={(e) => setCookies(e.target.value)}
              placeholder="Optional Session Cookie (e.g., xfss=... for Usersdrive premium/free session)"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 font-mono"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                checked={sequentialTorrent}
                onChange={(e) => setSequentialTorrent(e.target.checked)}
                className="rounded accent-emerald-500"
              />
              Sequential Piece Download (for BitTorrent video streaming)
            </label>

            <select
              value={queueId}
              onChange={(e) => setQueueId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200"
            >
              {settings.queues.map((q) => (
                <option key={q.id} value={q.id}>
                  Queue: {q.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-slate-900 border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={() => handleSubmit(false)}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
          >
            Add to Queue Later
          </button>
          <button
            onClick={() => handleSubmit(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/25"
          >
            Start Multi-Thread Download Now
          </button>
        </div>
      </div>
    </div>
  );
};
