import React, { useState } from "react";
import {
  X,
  Server,
  ShieldAlert,
  ShieldCheck,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  Folder,
  Eye,
  EyeOff,
  Radio,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Lock,
} from "lucide-react";
import {
  AppSettings,
  RemoteConnectionTestParams,
  RemoteConnectionTestResult,
  SiteCredential,
} from "../types/xdm";
import {
  apiTestRemoteConnection,
  apiSaveRemoteCredential,
  apiDeleteRemoteCredential,
} from "../services/tauriBridge";

interface RemoteProtocolModalProps {
  settings: AppSettings;
  onClose: () => void;
  onUpdateSettings: (newSettings: AppSettings) => void;
}

export const RemoteProtocolModal: React.FC<RemoteProtocolModalProps> = ({
  settings,
  onClose,
  onUpdateSettings,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<"ftp" | "ftps" | "sftp">("ftp");
  const [displayName, setDisplayName] = useState("");
  const [hostname, setHostname] = useState("");
  const [port, setPort] = useState<number>(21);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remotePath, setRemotePath] = useState("/");
  const [passiveMode, setPassiveMode] = useState(true);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RemoteConnectionTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const remoteProfiles = settings.site_credentials.filter((c) =>
    ["ftp", "ftps", "sftp"].includes(c.protocol || c.site_type)
  );

  const filteredProfiles = remoteProfiles.filter(
    (c) =>
      c.host_pattern.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.display_name && c.display_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const resetForm = (targetProtocol: "ftp" | "ftps" | "sftp" = "ftp") => {
    setEditingId(null);
    setProtocol(targetProtocol);
    setDisplayName("");
    setHostname("");
    setPort(targetProtocol === "sftp" ? 22 : targetProtocol === "ftps" ? 990 : 21);
    setIsAnonymous(false);
    setUsername("");
    setPassword("");
    setRemotePath("/");
    setPassiveMode(true);
    setTestResult(null);
    setErrorMsg(null);
  };

  const startEdit = (c: SiteCredential) => {
    setEditingId(c.id);
    const p = (c.protocol || c.site_type || "ftp") as "ftp" | "ftps" | "sftp";
    setProtocol(p);
    setDisplayName(c.display_name || "");
    setHostname(c.host_pattern);
    setPort(c.port || (p === "sftp" ? 22 : p === "ftps" ? 990 : 21));
    setIsAnonymous(c.is_anonymous || false);
    setUsername(c.username);
    setPassword(c.password_or_token || "");
    setRemotePath(c.remote_path || "/");
    setPassiveMode(c.passive_mode !== false);
    setTestResult(null);
    setErrorMsg(null);
  };

  const handleProtocolChange = (p: "ftp" | "ftps" | "sftp") => {
    setProtocol(p);
    if (!editingId || port === 21 || port === 990 || port === 22) {
      setPort(p === "sftp" ? 22 : p === "ftps" ? 990 : 21);
    }
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!hostname.trim()) {
      setErrorMsg("Please enter a valid hostname or IP address.");
      return;
    }
    setErrorMsg(null);
    setTesting(true);
    setTestResult(null);

    try {
      const params: RemoteConnectionTestParams = {
        protocol,
        host: hostname.trim(),
        port: Number(port) || (protocol === "sftp" ? 22 : protocol === "ftps" ? 990 : 21),
        username: isAnonymous ? "anonymous" : username.trim() || null,
        password: isAnonymous ? null : password || null,
        is_anonymous: isAnonymous,
        remote_path: remotePath.trim() || null,
        passive_mode: passiveMode,
      };

      const result = await apiTestRemoteConnection(params);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        protocol,
        host: hostname,
        port: Number(port) || 21,
        banner: null,
        authenticated: false,
        features: [],
        remote_path_exists: null,
        message: err instanceof Error ? err.message : String(err),
        latency_ms: 0,
        security_warning: null,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!hostname.trim()) {
      setErrorMsg("Please specify the server hostname or IP address.");
      return;
    }
    setErrorMsg(null);
    setSaving(true);

    const credId = editingId || `remote-${protocol}-${Date.now()}`;
    const credentialEntry: SiteCredential = {
      id: credId,
      host_pattern: hostname.trim(),
      site_type: protocol,
      protocol,
      port: Number(port) || (protocol === "sftp" ? 22 : protocol === "ftps" ? 990 : 21),
      username: isAnonymous ? "anonymous" : username.trim(),
      password_or_token: isAnonymous ? "" : password,
      cookies: null,
      custom_headers: {},
      enabled: true,
      remote_path: remotePath.trim() || "/",
      display_name: displayName.trim() || hostname.trim(),
      is_anonymous: isAnonymous,
      passive_mode: passiveMode,
    };

    try {
      const updated = await apiSaveRemoteCredential(credentialEntry);
      if (updated) {
        onUpdateSettings(updated);
      } else {
        // Fallback update in state
        const existingIdx = settings.site_credentials.findIndex((c) => c.id === credId);
        let newCreds = [...settings.site_credentials];
        if (existingIdx >= 0) {
          newCreds[existingIdx] = credentialEntry;
        } else {
          newCreds.push(credentialEntry);
        }
        onUpdateSettings({ ...settings, site_credentials: newCreds });
      }
      resetForm();
    } catch (err) {
      setErrorMsg(`Failed to save profile: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      const updated = await apiDeleteRemoteCredential(id);
      if (updated) {
        onUpdateSettings(updated);
      } else {
        onUpdateSettings({
          ...settings,
          site_credentials: settings.site_credentials.filter((c) => c.id !== id),
        });
      }
      if (editingId === id) {
        resetForm();
      }
    } catch (err) {
      console.error("Failed to delete remote credential:", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-5xl h-[680px] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-500/30 text-cyan-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-white flex items-center gap-2">
                Remote Protocol Manager
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-400/10 text-cyan-300 border border-cyan-400/20 uppercase tracking-wider">
                  FTP • FTPS • SFTP
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Manage remote server site profiles, credentials, and test connectivity with zero plain-text disk storage.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel: Profile List */}
          <div className="w-80 bg-slate-900/50 border-r border-slate-800 flex flex-col shrink-0">
            {/* List Controls */}
            <div className="p-3 border-b border-slate-800 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Saved Remote Sites</span>
                <button
                  type="button"
                  onClick={() => resetForm()}
                  className="px-2 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-medium flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> New Site
                </button>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter sites..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Profiles Scroll Area */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {filteredProfiles.length === 0 ? (
                <div className="text-center py-12 px-4 text-slate-500 text-xs">
                  <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No remote site profiles configured yet.
                  <div className="mt-1 text-[11px] text-slate-600">
                    Add FTP, FTPS, or SFTP servers to automatically authenticate downloads.
                  </div>
                </div>
              ) : (
                filteredProfiles.map((p) => {
                  const pType = (p.protocol || p.site_type || "ftp").toLowerCase();
                  const isSelected = editingId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => startEdit(p)}
                      className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1.5 ${
                        isSelected
                          ? "bg-cyan-950/40 border-cyan-500/50 text-white"
                          : "bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-xs text-white truncate">
                          {p.display_name || p.host_pattern}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              pType === "sftp"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : pType === "ftps"
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            }`}
                          >
                            {pType}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProfile(p.id);
                            }}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                            title="Delete Profile"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        {p.host_pattern}:{p.port || (pType === "sftp" ? 22 : pType === "ftps" ? 990 : 21)}
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                        <span className="truncate">
                          User: <strong className="text-slate-300">{p.is_anonymous ? "anonymous" : p.username || "—"}</strong>
                        </span>
                        {p.remote_path && p.remote_path !== "/" && (
                          <span className="truncate max-w-[120px] font-mono text-slate-400">
                            {p.remote_path}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Edit / New Form & Connection Tester */}
          <div className="flex-1 flex flex-col overflow-y-auto bg-slate-950/40 p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-white">
                  {editingId ? "Edit Site Profile" : "Configure Remote Profile"}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Set server parameters, authentication, and test connectivity prior to saving.
                </p>
              </div>
              {editingId && (
                <button
                  type="button"
                  onClick={() => resetForm()}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Switch to New Profile
                </button>
              )}
            </div>

            {/* Error Banner */}
            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0 text-rose-400" />
                {errorMsg}
              </div>
            )}

            {/* Form Body */}
            <div className="space-y-4">
              {/* Protocol Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Remote Protocol
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleProtocolChange("ftp")}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
                      protocol === "ftp"
                        ? "bg-amber-950/30 border-amber-500/50 text-white"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${protocol === "ftp" ? "text-amber-400" : "text-slate-500"}`} />
                    <div>
                      <div className="font-bold text-xs">FTP (Plain)</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">Port 21 • Unencrypted</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProtocolChange("ftps")}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
                      protocol === "ftps"
                        ? "bg-cyan-950/30 border-cyan-500/50 text-white"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <ShieldCheck className={`w-4 h-4 mt-0.5 shrink-0 ${protocol === "ftps" ? "text-cyan-400" : "text-slate-500"}`} />
                    <div>
                      <div className="font-bold text-xs">FTPS (FTP over TLS)</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">Port 990 / 21 • TLS Encrypted</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProtocolChange("sftp")}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition ${
                      protocol === "sftp"
                        ? "bg-emerald-950/30 border-emerald-500/50 text-white"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <Lock className={`w-4 h-4 mt-0.5 shrink-0 ${protocol === "sftp" ? "text-emerald-400" : "text-slate-500"}`} />
                    <div>
                      <div className="font-bold text-xs">SFTP (SSH File Transfer)</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">Port 22 • SSH Cryptographic</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Insecure FTP Warning Notice */}
              {protocol === "ftp" && (
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs flex items-start gap-2.5 leading-relaxed">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Insecure Protocol Warning:</span> Plain FTP transmits usernames, passwords, and file contents unencrypted across the network. Anyone on your local network or ISP path can read your credentials. We strongly advise using FTPS or SFTP whenever supported by your server.
                  </div>
                </div>
              )}

              {/* Host, Port & Label */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Display Name / Label
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. My University Archive"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="col-span-6">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Hostname or IP Address <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    placeholder="e.g. ftp.mirror.gnu.org or 192.168.1.50"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Port
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    min={1}
                    max={65535}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500 text-center"
                  />
                </div>
              </div>

              {/* Anonymous Login Checkbox */}
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Anonymous Login</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Connect using standard anonymous credentials (anonymous@bytex.local).
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="w-4 h-4 rounded text-cyan-500 bg-slate-800 border-slate-700 focus:ring-cyan-500"
                />
              </div>

              {/* Username & Password */}
              {!isAnonymous && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. ftpuser"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Password (OS Keychain Protected)
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-8 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Remote Directory & Passive Mode */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-8">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Remote Working Directory
                  </label>
                  <div className="relative">
                    <Folder className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={remotePath}
                      onChange={(e) => setRemotePath(e.target.value)}
                      placeholder="/pub or /files"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="col-span-4 flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={passiveMode}
                      onChange={(e) => setPassiveMode(e.target.checked)}
                      className="w-4 h-4 rounded text-cyan-500 bg-slate-800 border-slate-700 focus:ring-cyan-500"
                    />
                    <span className="text-xs text-slate-300 font-medium">
                      Passive Mode (PASV)
                    </span>
                  </label>
                </div>
              </div>

              {/* Action Buttons: Test Connection & Save */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing || !hostname.trim()}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
                >
                  <Radio className={`w-3.5 h-3.5 ${testing ? "animate-pulse text-cyan-400" : ""}`} />
                  {testing ? "Probing Connection..." : "Test Connection"}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => resetForm()}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition"
                  >
                    Clear Form
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={saving || !hostname.trim()}
                    className="px-4 py-2 rounded-xl bg-cyan-700 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-900/30 flex items-center gap-2 transition disabled:opacity-50"
                  >
                    {saving ? "Saving Profile..." : editingId ? "Update Site Profile" : "Save Site Profile"}
                  </button>
                </div>
              </div>

              {/* Test Connection Result Box */}
              {testResult && (
                <div
                  className={`p-4 rounded-xl border transition animate-in fade-in duration-150 ${
                    testResult.success
                      ? "bg-emerald-950/20 border-emerald-500/40 text-emerald-200"
                      : "bg-rose-950/20 border-rose-500/40 text-rose-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {testResult.success ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                      )}
                      <div>
                        <div className="font-bold text-xs text-white">
                          {testResult.success ? "Connection Verified Successfully" : "Connection Probe Failed"}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {testResult.message}
                        </div>
                      </div>
                    </div>
                    {testResult.latency_ms > 0 && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 shrink-0">
                        {testResult.latency_ms} ms
                      </span>
                    )}
                  </div>

                  {/* Banner / Identification */}
                  {testResult.banner && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 text-[11px]">
                      <span className="text-slate-400">Server Banner: </span>
                      <span className="font-mono text-cyan-300">{testResult.banner}</span>
                    </div>
                  )}

                  {/* Features / Capabilities */}
                  {testResult.features && testResult.features.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1">
                        Detected Server Capabilities:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {testResult.features.map((feat, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300"
                          >
                            {feat}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Directory Check */}
                  {testResult.remote_path_exists !== null && testResult.remote_path_exists !== undefined && (
                    <div className="mt-2 text-[11px] text-slate-300 flex items-center gap-1.5">
                      <Folder className="w-3.5 h-3.5 text-cyan-400" />
                      Directory {remotePath}:{" "}
                      <strong className={testResult.remote_path_exists ? "text-emerald-400" : "text-rose-400"}>
                        {testResult.remote_path_exists ? "Verified and accessible" : "Directory not found or inaccessible"}
                      </strong>
                    </div>
                  )}

                  {/* Security Warning */}
                  {testResult.security_warning && (
                    <div className="mt-2.5 p-2 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-300 text-[11px] flex items-start gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <div>{testResult.security_warning}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
