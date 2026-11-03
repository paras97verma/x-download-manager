import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsModal } from "../components/SettingsModal";
import { DEFAULT_SETTINGS } from "../services/tauriBridge";

describe("SettingsModal Component", () => {
  it("renders the settings modal tabs including Remote Sites", () => {
    render(
      <SettingsModal
        settings={DEFAULT_SETTINGS}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Preferences & Settings/i)).toBeInTheDocument();
    expect(screen.getByText("Remote Sites (FTP / SFTP)")).toBeInTheDocument();
    expect(screen.getByText("Site Logins & Auth")).toBeInTheDocument();
  });

  it("switches to the Remote Sites tab and allows launching dedicated manager", async () => {
    const user = userEvent.setup();
    const onOpenRemoteProtocol = vi.fn();

    render(
      <SettingsModal
        settings={DEFAULT_SETTINGS}
        onOpenRemoteProtocol={onOpenRemoteProtocol}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const remoteTab = screen.getByRole("button", { name: /Remote Sites \(FTP \/ SFTP\)/i });
    await user.click(remoteTab);

    expect(screen.getByText("Dedicated Remote Protocol Manager (FTP, FTPS, SFTP)")).toBeInTheDocument();

    const launchBtn = screen.getByRole("button", { name: /Launch Dedicated Manager/i });
    expect(launchBtn).toBeInTheDocument();

    await user.click(launchBtn);
    expect(onOpenRemoteProtocol).toHaveBeenCalled();
  });
});
