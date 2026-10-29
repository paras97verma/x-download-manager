import React, { useState, useEffect } from "react";
import {
  X,
  Sliders,
  Cpu,
  Gauge,
  Magnet,
  KeyRound,
  FolderOpen,
  Puzzle,
  Globe,
  Plus,
  Trash2,
  Info,
  Keyboard,
  Sparkles,
  Check,
  Folder,
  Bell,
  Power,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Shield,
  Copy,
  CheckCheck,
} from "lucide-react";
import { AppSettings, BrowserStatus, SiteCredential } from "../types/xdm";
import {
  apiPickDirectory,
  apiPromptNotificationPermission,
  apiSetAutostart,
  apiIsAutostartEnabled,
  apiOpenExtensionFolder,
  apiOpenBrowserUrl,
  apiShowNotification,
} from "../services/tauriBridge";

interface SettingsModalProps {
  initialTab?: string;
  settings: AppSettings;
  browsers?: BrowserStatus[];
  onToggleBrowser?: (browserId: string, enable: boolean) => void;
  onReinstallAll?: () => void;
  onSave: (updated: AppSettings) => void;
  onClose: () => void;
  appVersion?: string;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  initialTab = "general",
  settings,
  browsers = [],
  onToggleBrowser,
  onReinstallAll,
  onSave,
  onClose,
  appVersion,
}) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [draft, setDraft] = useState<AppSettings>(JSON.parse(JSON.stringify(settings)));
  const [openingFolder, setOpeningFolder] = useState<string | null>(null);
  const [safariPathCopied, setSafariPathCopied] = useState<boolean>(false);

  // Sync actual OS autostart state on modal load
  useEffect(() => {
    apiIsAutostartEnabled().then((enabled) => {
      setDraft((prev) => ({ ...prev, start_on_boot: enabled }));
    });
  }, []);

  const [newHostPattern, setNewHostPattern] = useState("");
  const [newSiteType, setNewSiteType] = useState<SiteCredential["site_type"]>("usersdrive");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newCookies, setNewCookies] = useState("");

  const isMac =
    typeof navigator !== "undefined" && navigator.platform?.toUpperCase().includes("MAC");
  const modKey = isMac ? "⌘" : "Ctrl+";

  const tabs = [
    { id: "general", label: "General & UI", icon: Sliders },
    { id: "connections", label: "Connections & Threads", icon: Cpu },
    { id: "speed", label: "Speed Limiter", icon: Gauge },
    { id: "torrent", label: "BitTorrent / DHT", icon: Magnet },
    { id: "logins", label: "Site Logins & Auth", icon: KeyRound },
    { id: "categories", label: "File Categories", icon: FolderOpen },
    { id: "browser", label: "Browser Extensions & Integration", icon: Puzzle },
    { id: "proxy", label: "Proxy & Network", icon: Globe },
    { id: "shortcuts", label: "Shortcuts & Keybindings", icon: Keyboard },
    { id: "about", label: "About & Credits", icon: Info },
  ];

  const handlePickDirectory = async () => {
    try {
      const picked = await apiPickDirectory();
      if (picked) {
        setDraft({ ...draft, default_download_dir: picked });
      }
    } catch (e) {
      console.error("Failed to pick directory:", e);
    }
  };

  const handleToggleAutostart = async (enabled: boolean) => {
    setDraft({ ...draft, start_on_boot: enabled });
    try {
      await apiSetAutostart(enabled);
    } catch (e) {
      console.error("Failed to set autostart:", e);
    }
  };

  const handleToggleNotifications = async (enabled: boolean) => {
    setDraft({ ...draft, play_sound_on_complete: enabled, show_completion_dialog: enabled });
    if (enabled) {
      try {
        const granted = await apiPromptNotificationPermission();
        if (granted) {
          await apiShowNotification(
            "X Download Manager",
            "Download completion notifications are active!"
          );
        }
      } catch (e) {
        console.error("Failed to prompt notification permission:", e);
      }
    }
  };

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

  const handleCopySafariPath = async () => {
    try {
      const folderPath = await apiOpenExtensionFolder("safari");
      if (folderPath && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(folderPath);
      }
      setSafariPathCopied(true);
      setTimeout(() => setSafariPathCopied(false), 6000);
    } catch (e) {
      console.error("Failed to copy Safari extension path:", e);
    }
  };

  const handleLaunchAndReveal = async (b: BrowserStatus) => {
    setOpeningFolder(b.id);
    try {
      const folderPath = await apiOpenExtensionFolder(b.family);
      if (b.family === "safari") {
        if (folderPath && typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(folderPath);
        }
        setSafariPathCopied(true);
        setTimeout(() => setSafariPathCopied(false), 6000);
      }
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

  const addCredential = () => {
    if (!newHostPattern.trim()) return;
    const entry: SiteCredential = {
      id: `cred-${Date.now()}`,
      host_pattern: newHostPattern.trim(),
      site_type: newSiteType,
      username: newUsername.trim(),
      password_or_token: newPassword,
      cookies: newCookies.trim() || null,
      custom_headers: {},
      enabled: true,
    };
    setDraft({
      ...draft,
      site_credentials: [...draft.site_credentials, entry],
    });
    setNewUsername("");
    setNewPassword("");
    setNewCookies("");
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-4xl h-[600px] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="font-bold text-sm text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-400" />
            X Download Manager — Preferences & Settings
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body with Sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Tabs Sidebar */}
          <div className="w-56 bg-slate-900/70 border-r border-slate-800 p-2.5 space-y-1 shrink-0 overflow-y-auto">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                    activeTab === t.id
                      ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                      : "text-slate-300 hover:bg-slate-800/80"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Panel Content */}
          <div className="flex-1 p-5 overflow-y-auto text-xs space-y-4">
            {/* General & UI Mode Tab */}
            {activeTab === "general" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white">General Behavior & UI Experience</h3>

                {/* Beginner vs Advanced Mode Toggle */}
                <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
                  <div className="font-semibold text-slate-200 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                    Interface Mode ({draft.ui_mode === "simple" ? "Simple / Beginner" : "Advanced / Professional"})
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <label
                      className={`p-3 rounded-lg border flex flex-col gap-1 cursor-pointer transition ${
                        draft.ui_mode === "simple"
                          ? "bg-blue-600/20 border-blue-500/50 text-blue-200"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-white">
                        <input
                          type="radio"
                          name="ui_mode"
                          checked={draft.ui_mode === "simple"}
                          onChange={() => setDraft({ ...draft, ui_mode: "simple" })}
                          className="text-blue-600 bg-slate-900 border-slate-700"
                        />
                        Simple Mode (Beginner Friendly)
                      </div>
                      <span className="text-[11px] text-slate-400 pl-5">
                        Clean, streamlined view. Big easy buttons, automated queue management, and zero technical clutter.
                      </span>
                    </label>

                    <label
                      className={`p-3 rounded-lg border flex flex-col gap-1 cursor-pointer transition ${
                        draft.ui_mode === "advanced"
                          ? "bg-blue-600/20 border-blue-500/50 text-blue-200"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-white">
                        <input
                          type="radio"
                          name="ui_mode"
                          checked={draft.ui_mode === "advanced"}
                          onChange={() => setDraft({ ...draft, ui_mode: "advanced" })}
                          className="text-blue-600 bg-slate-900 border-slate-700"
                        />
                        Advanced Mode (Power User)
                      </div>
                      <span className="text-[11px] text-slate-400 pl-5">
                        Multi-threaded byte chunk allocation maps, BitTorrent swarm peer table, and raw protocol transfer logs.
                      </span>
                    </label>
                  </div>
                </div>

                {/* Download Folder Chooser */}
                <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
                  <label className="block text-slate-200 font-semibold">
                    Default Download Directory
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draft.default_download_dir}
                      onChange={(e) => setDraft({ ...draft, default_download_dir: e.target.value })}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={handlePickDirectory}
                      className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5 shrink-0 shadow transition"
                    >
                      <Folder className="w-3.5 h-3.5" />
                      Browse Folder...
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    Click Browse to select any directory. Prompts for OS folder permissions automatically on macOS, Windows, and Linux.
                  </p>
                </div>

                {/* System Permissions & OS Behaviors */}
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={draft.start_on_boot}
                      onChange={(e) => handleToggleAutostart(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">Start with Operating System</div>
                      <div className="text-[10px] text-slate-400">Auto-launches on system startup</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={draft.play_sound_on_complete}
                      onChange={(e) => handleToggleNotifications(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">OS Completion Notifications</div>
                      <div className="text-[10px] text-slate-400">Requests native system alert permission</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={draft.minimize_to_tray}
                      onChange={(e) => setDraft({ ...draft, minimize_to_tray: e.target.checked })}
                      className="rounded bg-slate-950 border-slate-700 text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">Menu Bar / System Tray</div>
                      <div className="text-[10px] text-slate-400">Keep running in background when closed</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={draft.prevent_system_sleep}
                      onChange={(e) => setDraft({ ...draft, prevent_system_sleep: e.target.checked })}
                      className="rounded bg-slate-950 border-slate-700 text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">Prevent OS Sleep</div>
                      <div className="text-[10px] text-slate-400">Keep system awake while downloading</div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* Connections & Multi-Threading Tab */}
            {activeTab === "connections" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white">Multi-Threaded Segmentation Engine (XDM Architecture)</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                    <label className="block text-slate-200 font-semibold">
                      Default Parallel Threads per Download: <strong className="text-blue-400">{draft.default_threads_per_download}</strong>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={32}
                      value={draft.default_threads_per_download}
                      onChange={(e) =>
                        setDraft({ ...draft, default_threads_per_download: Number(e.target.value) })
                      }
                      className="w-full accent-blue-600"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>1 (Single)</span>
                      <span>8 (Standard)</span>
                      <span>16 (High)</span>
                      <span>32 (Max Turbo)</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                    <label className="block text-slate-200 font-semibold">
                      Max Simultaneous Active Downloads: <strong className="text-indigo-400">{draft.max_concurrent_downloads}</strong>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={draft.max_concurrent_downloads}
                      onChange={(e) =>
                        setDraft({ ...draft, max_concurrent_downloads: Number(e.target.value) })
                      }
                      className="w-full accent-indigo-600"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>1 file</span>
                      <span>5 files</span>
                      <span>10 files</span>
                      <span>20 files</span>
                    </div>
                  </div>
                </div>

                <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.dynamic_segment_stealing}
                    onChange={(e) => setDraft({ ...draft, dynamic_segment_stealing: e.target.checked })}
                    className="rounded bg-slate-950 border-slate-700 text-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-slate-200">Dynamic Segment Work-Stealing</div>
                    <div className="text-[10px] text-slate-400">
                      When fast threads finish, automatically divide the remainder of slow threads to maximize bandwidth utilization.
                    </div>
                  </div>
                </label>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Custom HTTP User-Agent</label>
                  <input
                    type="text"
                    value={draft.custom_user_agent}
                    onChange={(e) => setDraft({ ...draft, custom_user_agent: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {/* Speed Limiter Tab */}
            {activeTab === "speed" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white">Token-Bucket Bandwidth Speed Limiter</h3>
                <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.speed_limiter_enabled}
                    onChange={(e) => setDraft({ ...draft, speed_limiter_enabled: e.target.checked })}
                    className="rounded bg-slate-950 border-slate-700 text-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-slate-200">Enable Global Bandwidth Speed Limiter</div>
                    <div className="text-[10px] text-slate-400">Restricts download and upload speeds to prevent network congestion.</div>
                  </div>
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                    <label className="block text-slate-200 font-semibold">
                      Max Download Speed: <strong className="text-emerald-400">{(draft.global_max_download_kbps / 1024).toFixed(1)} MB/s</strong> ({draft.global_max_download_kbps} KB/s)
                    </label>
                    <input
                      type="number"
                      value={draft.global_max_download_kbps}
                      onChange={(e) => setDraft({ ...draft, global_max_download_kbps: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                    <label className="block text-slate-200 font-semibold">
                      Max Seeding / Upload Speed: <strong className="text-indigo-400">{(draft.global_max_upload_kbps / 1024).toFixed(1)} MB/s</strong> ({draft.global_max_upload_kbps} KB/s)
                    </label>
                    <input
                      type="number"
                      value={draft.global_max_upload_kbps}
                      onChange={(e) => setDraft({ ...draft, global_max_upload_kbps: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* BitTorrent Tab */}
            {activeTab === "torrent" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white">BitTorrent Protocol & Swarm Client (uTorrent Parity)</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.torrent.enable_dht}
                      onChange={(e) =>
                        setDraft({ ...draft, torrent: { ...draft.torrent, enable_dht: e.target.checked } })
                      }
                      className="rounded bg-slate-950 border-slate-700 text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">Mainline DHT</div>
                      <div className="text-[10px] text-slate-400">Discover peers without trackers</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.torrent.enable_pex}
                      onChange={(e) =>
                        setDraft({ ...draft, torrent: { ...draft.torrent, enable_pex: e.target.checked } })
                      }
                      className="rounded bg-slate-950 border-slate-700 text-blue-600"
                    />
                    <div>
                      <div className="font-semibold text-slate-200">Peer Exchange (PEX)</div>
                      <div className="text-[10px] text-slate-400">Exchange swarm members with peers</div>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">BitTorrent Incoming Listen Port</label>
                    <input
                      type="number"
                      value={draft.torrent.listen_port}
                      onChange={(e) =>
                        setDraft({ ...draft, torrent: { ...draft.torrent, listen_port: Number(e.target.value) } })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Stop Seeding at Share Ratio</label>
                    <input
                      type="number"
                      step="0.1"
                      value={draft.torrent.seed_ratio_limit}
                      onChange={(e) =>
                        setDraft({ ...draft, torrent: { ...draft.torrent, seed_ratio_limit: Number(e.target.value) } })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Site Logins & Auth Vault */}
            {activeTab === "logins" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white">
                  Site Logins Vault (Usersdrive, 1fichier, MediaFire, FTP/SFTP, Basic & Bearer Auth)
                </h3>
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-200">Add New Site Authentication:</div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={newHostPattern}
                      onChange={(e) => setNewHostPattern(e.target.value)}
                      placeholder="e.g. *.example.com or ftp.server.org"
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                    />
                    <select
                      value={newSiteType}
                      onChange={(e) => setNewSiteType(e.target.value as SiteCredential["site_type"])}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                    >
                      <option value="usersdrive">Usersdrive Resolver</option>
                      <option value="ftp">FTP / FTPS Stream</option>
                      <option value="sftp">SFTP (SSH)</option>
                      <option value="1fichier">1fichier</option>
                      <option value="mediafire">MediaFire</option>
                      <option value="http_basic">HTTP Basic Auth</option>
                      <option value="bearer">Bearer Token</option>
                    </select>
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="Username / Account"
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Password or Token"
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                    />
                    <input
                      type="text"
                      value={newCookies}
                      onChange={(e) => setNewCookies(e.target.value)}
                      placeholder="Cookies (xfss=...)"
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-mono"
                    />
                    <button
                      type="button"
                      onClick={addCredential}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-3 py-1.5 flex items-center justify-center gap-1.5 shadow"
                    >
                      <Plus className="w-3.5 h-3.5" /> Save Auth Entry
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {draft.site_credentials.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-amber-300 truncate">{c.host_pattern}</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] uppercase font-semibold">
                            {c.site_type}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          User: <strong className="text-slate-300">{c.username || "(session token)"}</strong>
                          {c.cookies ? " • Cookies Configured" : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            site_credentials: draft.site_credentials.filter((x) => x.id !== c.id),
                          })
                        }
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-400 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File Categories */}
            {activeTab === "categories" && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">Auto-Categorization Rules & Subfolders</h3>
                <div className="space-y-2">
                  {draft.categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-slate-200">
                          {cat.name} → <span className="font-mono text-blue-400">/{cat.default_subfolder}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          Extensions: {cat.extensions.join(", ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Browser Extensions & Monitoring Tab */}
            {activeTab === "browser" && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-indigo-200 flex items-center gap-1.5 text-xs">
                      <Shield className="w-4 h-4 text-indigo-400" />
                      Native IPC Host Active on 127.0.0.1:{draft.browser.ipc_port}
                    </div>
                    <div className="text-[11px] text-slate-300">
                      Receives intercepted downloads, auth cookies, referers, and torrent payloads directly from your browsers.
                    </div>
                  </div>
                  {onReinstallAll && (
                    <button
                      type="button"
                      onClick={onReinstallAll}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shrink-0 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Re-register All Hosts
                    </button>
                  )}
                </div>

                {/* Dedicated Safari Instructions Guide (macOS) */}
                <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/40 space-y-3">
                  <div className="font-semibold text-indigo-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 font-bold text-sm">
                      <Puzzle className="w-4 h-4 text-indigo-400" />
                      Apple Safari (macOS) Extension Installation Guide
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopySafariPath}
                        className="px-2.5 py-1 rounded bg-indigo-600/40 hover:bg-indigo-600 text-indigo-200 hover:text-white text-[11px] font-semibold flex items-center gap-1.5 transition border border-indigo-500/40"
                      >
                        {safariPathCopied ? (
                          <>
                            <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> Path Copied to Clipboard!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> Copy Safari Extension Path
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => apiOpenExtensionFolder("safari")}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1.5 transition border border-slate-700"
                      >
                        <FolderOpen className="w-3.5 h-3.5" /> Reveal Folder in Finder
                      </button>
                    </div>
                  </div>

                  {/* Clarification about Safari's App Store redirect */}
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] flex items-start gap-2 leading-relaxed">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-amber-100">Why does Safari's "Get Extensions..." button open the Mac App Store?</strong>
                      <br />
                      In Safari Settings, the <em>Extensions</em> tab only shows extensions that are <strong>already loaded</strong>. If none are loaded yet, clicking "Get Extensions" opens the Mac App Store by Apple design.
                      <br />
                      To load XDM into Safari, <strong>do not click "Get Extensions"</strong>. Instead, use the <strong>Develop &rarr; Add Temporary Extension…</strong> menu as instructed below:
                    </div>
                  </div>

                  <ol className="list-decimal list-inside space-y-2 text-[11px] text-slate-300 pl-1 leading-relaxed">
                    <li>
                      <strong>Enable Developer Features:</strong> Open <strong className="text-white">Safari</strong> &rarr; <strong className="text-white">Settings...</strong> (<kbd className="px-1 py-0.5 bg-slate-800 rounded font-mono text-[10px]">⌘,</kbd>) &rarr; <strong className="text-indigo-300">Advanced</strong> tab &rarr; check <strong className="text-amber-300">"Show features for web developers"</strong>.
                    </li>
                    <li>
                      <strong>Allow Unsigned Extensions:</strong> In the macOS top menu bar, click <strong className="text-white">Develop</strong> &rarr; check <strong className="text-amber-300">"Allow Unsigned Extensions"</strong> (or in Safari Settings &rarr; <strong className="text-indigo-300">Developer</strong> tab &rarr; check "Allow unsigned extensions" and authenticate with Touch ID / Mac password).
                    </li>
                    <li>
                      <strong>Load Extension from Folder:</strong> In the macOS top menu bar, click <strong className="text-emerald-400 font-bold">Develop &rarr; Add Temporary Extension…</strong> (or in Safari Settings &rarr; <strong className="text-emerald-400 font-bold">Developer</strong> tab &rarr; click <strong>"Add Temporary Extension…"</strong>).
                    </li>
                    <li>
                      <strong>Select XDM Folder:</strong> In the file picker dialog that appears, press <kbd className="px-1 py-0.5 bg-slate-800 rounded font-mono text-[10px]">⌘⇧G</kbd> (Go to Folder), paste with <kbd className="px-1 py-0.5 bg-slate-800 rounded font-mono text-[10px]">⌘V</kbd> (the path was copied to your clipboard), and click <strong className="text-emerald-300">Select</strong>!
                    </li>
                    <li>
                      <strong>Enable & Set Permissions:</strong> Now in Safari Settings &rarr; switch to the <strong className="text-indigo-300">Extensions</strong> tab. <strong className="text-white">X Download Manager</strong> is now visible! Check its checkbox to enable it and choose <strong className="text-blue-300">"Always Allow on Every Website..."</strong>.
                    </li>
                  </ol>
                </div>

                {/* Installed Browsers List */}
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Installed Browsers & Extension Status ({browsers.filter((b) => b.detected_installed).length})
                  </div>

                  {browsers.filter((b) => b.detected_installed).length === 0 ? (
                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-xs">
                      No supported browsers detected automatically. Ensure Dia, Chrome, Safari, or Firefox is installed.
                    </div>
                  ) : (
                    browsers
                      .filter((b) => b.detected_installed)
                      .map((b) => (
                        <div
                          key={b.id}
                          className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 flex items-center justify-between gap-3 transition"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-100 text-xs">{b.display_name}</span>
                              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold">
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
                                  Ready
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              Host: <span className="font-mono text-slate-300">{b.manifest_path}</span>
                            </div>
                            <div className={`text-[10px] font-medium ${b.is_connected ? "text-emerald-400" : "text-slate-400"}`}>
                              {b.status_message}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleLaunchAndReveal(b)}
                              className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 font-semibold text-xs flex items-center gap-1 transition"
                              title={`Open ${b.display_name} extensions and reveal folder`}
                            >
                              <ExternalLink className="w-3 h-3" />
                              {openingFolder === b.id
                                ? "Opening..."
                                : b.family === "safari"
                                ? safariPathCopied
                                  ? "Path Copied! (Develop Menu)"
                                  : "Load in Safari (Develop Menu)"
                                : "Load Unpacked"}
                            </button>

                            <button
                              type="button"
                              onClick={() => apiOpenExtensionFolder(b.family)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                              title="Reveal Extension Folder in Finder"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>

                            {onToggleBrowser && (
                              <button
                                type="button"
                                onClick={() => onToggleBrowser(b.id, !b.extension_enabled)}
                                className={`px-2.5 py-1 rounded-lg font-semibold text-xs flex items-center gap-1 transition ${
                                  b.extension_enabled
                                    ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-rose-600/20 hover:text-rose-300 hover:border-rose-500/40"
                                    : "bg-slate-800 text-slate-300 hover:bg-blue-600 hover:text-white"
                                }`}
                              >
                                <Power className="w-3 h-3" />
                                {b.extension_enabled ? "Enabled" : "Enable"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                  )}
                </div>

                {/* Integration Options */}
                <h4 className="text-xs font-bold text-slate-200 mt-2">Interception Preferences</h4>
                <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.browser.auto_install_extensions_on_startup}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        browser: {
                          ...draft.browser,
                          auto_install_extensions_on_startup: e.target.checked,
                        },
                      })
                    }
                    className="rounded bg-slate-950 border-slate-700 text-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-slate-200 text-xs">
                      Auto-register Native Messaging Host when X Download Manager starts
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Ensures Native Messaging manifests across Dia, Opera, Arc, Safari, Firefox, and Chromium stay registered.
                    </div>
                  </div>
                </label>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1 text-xs">
                    Automatically Intercept File Extensions (Comma separated)
                  </label>
                  <textarea
                    rows={3}
                    value={draft.browser.intercepted_extensions.join(", ")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        browser: {
                          ...draft.browser,
                          intercepted_extensions: e.target.value
                            .split(",")
                            .map((s) => s.trim().toUpperCase())
                            .filter(Boolean),
                        },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {/* Proxy & Network */}
            {activeTab === "proxy" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white">HTTP / HTTPS / SOCKS5 Proxy Configuration</h3>
                <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.proxy.enabled}
                    onChange={(e) =>
                      setDraft({ ...draft, proxy: { ...draft.proxy, enabled: e.target.checked } })
                    }
                    className="rounded bg-slate-950 border-slate-700 text-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-slate-200">Route All Downloads through Proxy</div>
                    <div className="text-[10px] text-slate-400">Applies to HTTP, FTP, and BitTorrent connections</div>
                  </div>
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <select
                    value={draft.proxy.proxy_type}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        proxy: {
                          ...draft.proxy,
                          proxy_type: e.target.value as AppSettings["proxy"]["proxy_type"],
                        },
                      })
                    }
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                  >
                    <option value="http">HTTP Proxy</option>
                    <option value="https">HTTPS Proxy</option>
                    <option value="socks5">SOCKS5 Proxy</option>
                  </select>
                  <input
                    type="text"
                    value={draft.proxy.host}
                    onChange={(e) => setDraft({ ...draft, proxy: { ...draft.proxy, host: e.target.value } })}
                    placeholder="Host (127.0.0.1)"
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                  />
                  <input
                    type="number"
                    value={draft.proxy.port}
                    onChange={(e) =>
                      setDraft({ ...draft, proxy: { ...draft.proxy, port: Number(e.target.value) } })
                    }
                    placeholder="Port"
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                  />
                </div>
              </div>
            )}

            {/* Keyboard Shortcuts Guide Tab */}
            {activeTab === "shortcuts" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-emerald-400" />
                    Keyboard Shortcuts & Quick Actions ({isMac ? "macOS" : "Windows / Linux"})
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    All Active & Functional
                  </span>
                </div>

                <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/80">
                  {[
                    { key: `${modKey}N`, action: "Add Download URL", desc: "Opens the Add Download dialog (auto-pastes clipboard link)" },
                    { key: `${modKey}T`, action: "Add Torrent / Magnet", desc: "Upload .torrent file or paste magnet URI with file selector" },
                    { key: `${modKey},`, action: "Open Preferences / Settings", desc: "Access all behavior, connection, and auth options" },
                    { key: `${modKey}M`, action: "Toggle Simple / Advanced Mode", desc: "Switch between beginner-friendly mode and full telemetry" },
                    { key: "Space", action: "Pause / Resume Transfer", desc: "Toggles download state on selected items" },
                    { key: `${modKey}A`, action: "Select All Downloads", desc: "Selects all visible downloads in the active list" },
                    { key: "Delete / ⌫", action: "Delete Selected", desc: "Removes selected download task from list" },
                    { key: "Enter / Double Click", action: "Open File", desc: "Opens the completed file in default OS application" },
                    { key: "Esc", action: "Deselect All / Close Dialog", desc: "Clears selection or dismisses open modals" },
                    { key: "Hold [Alt]", action: "Bypass Browser Interception", desc: "Click link while holding Alt to let browser download normally" },
                  ].map((s) => (
                    <div key={s.key} className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs">
                      <div>
                        <div className="font-semibold text-slate-100">{s.action}</div>
                        <div className="text-[11px] text-slate-400">{s.desc}</div>
                      </div>
                      <kbd className="px-2.5 py-1 rounded bg-slate-800 text-slate-200 font-mono text-[11px] border border-slate-700 shadow-sm shrink-0">
                        {s.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* About Tab */}
            {activeTab === "about" && (
              <div className="space-y-4">
                <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 text-center space-y-3.5">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-500/30 text-white font-black text-2xl">
                    X
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">X Download Manager</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Version {appVersion || (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "")} (Production)</p>
                  </div>
                  <div>
                    <span className="inline-block px-4 py-2 rounded-xl bg-slate-800/90 border border-slate-700/60 text-sm font-semibold text-white shadow-sm tracking-wide">
                      Made with ❤️ by ~peivee
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    Native multi-threaded download accelerator, BitTorrent swarm client, FTP/SFTP stream worker, and automated cross-browser interceptor.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex justify-between items-center shrink-0">
          <span className="text-[11px] text-slate-400">
            Changes are saved to persistent OS configuration.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onSave(draft);
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition"
            >
              Save All Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
