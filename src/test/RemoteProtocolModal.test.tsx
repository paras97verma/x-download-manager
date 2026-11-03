import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemoteProtocolModal } from "../components/RemoteProtocolModal";
import { AppSettings, SiteCredential } from "../types/xdm";
import { DEFAULT_SETTINGS } from "../services/tauriBridge";
import * as tauriBridge from "../services/tauriBridge";

describe("RemoteProtocolModal Component", () => {
  const mockSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    site_credentials: [
      {
        id: "ftp-1",
        host_pattern: "ftp.gnu.org",
        site_type: "ftp",
        protocol: "ftp",
        port: 21,
        username: "anonymous",
        password_or_token: "",
        cookies: null,
        custom_headers: {},
        enabled: true,
        remote_path: "/gnu",
        display_name: "GNU Mirror",
        is_anonymous: true,
        passive_mode: true,
      },
      {
        id: "sftp-2",
        host_pattern: "secure.backup.org",
        site_type: "sftp",
        protocol: "sftp",
        port: 22,
        username: "sysadmin",
        password_or_token: "secret",
        cookies: null,
        custom_headers: {},
        enabled: true,
        remote_path: "/backups",
        display_name: "Backup SFTP",
        is_anonymous: false,
        passive_mode: true,
      },
    ],
  };

  const onClose = vi.fn();
  const onUpdateSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Remote Protocol Manager header and saved profiles", () => {
    render(
      <RemoteProtocolModal
        settings={mockSettings}
        onClose={onClose}
        onUpdateSettings={onUpdateSettings}
      />
    );

    expect(screen.getByText("Remote Protocol Manager")).toBeInTheDocument();
    expect(screen.getByText("GNU Mirror")).toBeInTheDocument();
    expect(screen.getByText("Backup SFTP")).toBeInTheDocument();
    expect(screen.getByText(/ftp\.gnu\.org:21/)).toBeInTheDocument();
  });

  it("displays insecure plain FTP warning banner when FTP protocol is selected", () => {
    render(
      <RemoteProtocolModal
        settings={mockSettings}
        onClose={onClose}
        onUpdateSettings={onUpdateSettings}
      />
    );

    // FTP is selected by default in new form
    expect(screen.getByText(/Insecure Protocol Warning:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Plain FTP transmits usernames, passwords, and file contents unencrypted/i)
    ).toBeInTheDocument();
  });

  it("updates default port and removes insecure warning when switching to SFTP or FTPS", async () => {
    const user = userEvent.setup();
    render(
      <RemoteProtocolModal
        settings={mockSettings}
        onClose={onClose}
        onUpdateSettings={onUpdateSettings}
      />
    );

    const sftpButton = screen.getByRole("button", { name: /SFTP \(SSH File Transfer\)/i });
    await user.click(sftpButton);

    const portInput = screen.getByDisplayValue("22");
    expect(portInput).toBeInTheDocument();

    // Plain FTP warning should no longer be rendered
    expect(screen.queryByText(/Insecure Protocol Warning:/i)).not.toBeInTheDocument();

    // Switch to FTPS
    const ftpsButton = screen.getByRole("button", { name: /FTPS \(FTP over TLS\)/i });
    await user.click(ftpsButton);

    expect(screen.getByDisplayValue("990")).toBeInTheDocument();
    expect(screen.queryByText(/Insecure Protocol Warning:/i)).not.toBeInTheDocument();
  });

  it("hides username and password fields when Anonymous Login is checked", async () => {
    const user = userEvent.setup();
    render(
      <RemoteProtocolModal
        settings={mockSettings}
        onClose={onClose}
        onUpdateSettings={onUpdateSettings}
      />
    );

    const anonCheckbox = screen.getByRole("checkbox", { name: "" });
    expect(screen.getByPlaceholderText("e.g. ftpuser")).toBeInTheDocument();

    await user.click(anonCheckbox);

    // Username and password inputs should disappear
    expect(screen.queryByPlaceholderText("e.g. ftpuser")).not.toBeInTheDocument();
  });

  it("runs connection test and displays structured results upon clicking Test Connection", async () => {
    vi.spyOn(tauriBridge, "apiTestRemoteConnection").mockResolvedValueOnce({
      success: true,
      protocol: "ftp",
      host: "ftp.testserver.org",
      port: 21,
      banner: "220 Mock FTP Ready",
      authenticated: true,
      features: ["UTF8", "REST (STREAM)", "PASV"],
      remote_path_exists: true,
      message: "Successfully connected and authenticated as 'anonymous'.",
      latency_ms: 24,
      security_warning: "⚠️ Plain FTP Warning",
    });

    const user = userEvent.setup();
    render(
      <RemoteProtocolModal
        settings={mockSettings}
        onClose={onClose}
        onUpdateSettings={onUpdateSettings}
      />
    );

    const hostInput = screen.getByPlaceholderText(/e\.g\. ftp\.mirror\.gnu\.org/i);
    await user.type(hostInput, "ftp.testserver.org");

    const testBtn = screen.getByRole("button", { name: /Test Connection/i });
    await user.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText("Connection Verified Successfully")).toBeInTheDocument();
    });

    expect(screen.getByText(/220 Mock FTP Ready/)).toBeInTheDocument();
    expect(screen.getByText("24 ms")).toBeInTheDocument();
    expect(screen.getByText("REST (STREAM)")).toBeInTheDocument();
  });

  it("saves a new remote site profile and triggers onUpdateSettings", async () => {
    vi.spyOn(tauriBridge, "apiSaveRemoteCredential").mockResolvedValueOnce({
      ...mockSettings,
      site_credentials: [
        ...mockSettings.site_credentials,
        {
          id: "remote-ftp-new",
          host_pattern: "ftp.newmirror.org",
          site_type: "ftp",
          protocol: "ftp",
          port: 21,
          username: "alice",
          password_or_token: "secret123",
          cookies: null,
          custom_headers: {},
          enabled: true,
          remote_path: "/dist",
          display_name: "New Mirror",
          is_anonymous: false,
          passive_mode: true,
        },
      ],
    });

    const user = userEvent.setup();
    render(
      <RemoteProtocolModal
        settings={mockSettings}
        onClose={onClose}
        onUpdateSettings={onUpdateSettings}
      />
    );

    await user.type(screen.getByPlaceholderText("e.g. My University Archive"), "New Mirror");
    await user.type(screen.getByPlaceholderText(/e\.g\. ftp\.mirror\.gnu\.org/i), "ftp.newmirror.org");
    await user.type(screen.getByPlaceholderText("e.g. ftpuser"), "alice");
    await user.type(screen.getByPlaceholderText("••••••••••••"), "secret123");

    const saveBtn = screen.getByRole("button", { name: /Save Site Profile/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(onUpdateSettings).toHaveBeenCalled();
    });
  });
});
