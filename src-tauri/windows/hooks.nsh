!include "FileFunc.nsh"

!macro NSIS_HOOK_PREINSTALL
  ; Locate both the selected install directory and the previous product-name defaults.
  IfFileExists "$INSTDIR\uninstall.exe" 0 xdm_check_legacy_user_install
  StrCpy $0 "$INSTDIR\uninstall.exe"
  Goto xdm_run_previous_uninstaller

  xdm_check_legacy_user_install:
  IfFileExists "$LOCALAPPDATA\Programs\X Download Manager\uninstall.exe" 0 xdm_check_legacy_user_root
  StrCpy $0 "$LOCALAPPDATA\Programs\X Download Manager\uninstall.exe"
  Goto xdm_run_previous_uninstaller

  xdm_check_legacy_user_root:
  IfFileExists "$LOCALAPPDATA\X Download Manager\uninstall.exe" 0 xdm_check_legacy_machine_install
  StrCpy $0 "$LOCALAPPDATA\X Download Manager\uninstall.exe"
  Goto xdm_run_previous_uninstaller

  xdm_check_legacy_machine_install:
  IfFileExists "$PROGRAMFILES64\X Download Manager\uninstall.exe" 0 xdm_check_legacy_machine_x86
  StrCpy $0 "$PROGRAMFILES64\X Download Manager\uninstall.exe"
  Goto xdm_run_previous_uninstaller

  xdm_check_legacy_machine_x86:
  IfFileExists "$PROGRAMFILES\X Download Manager\uninstall.exe" 0 xdm_preinstall_done
  StrCpy $0 "$PROGRAMFILES\X Download Manager\uninstall.exe"

  xdm_run_previous_uninstaller:
  ; Ask the old app to quit before removing files. Its local IPC handler exits the
  ; process after acknowledging this request, even when the window is in the tray.
  ${GetParent} $2 "$0"
  IfFileExists "$2\x-download-manager.exe" 0 xdm_run_uninstaller
  Exec '"$2\x-download-manager.exe" --prepare-for-update'
  Sleep 1000
  ; Older releases do not have the IPC quit command. Close any remaining old
  ; process before the uninstaller removes its executable and data files.
  ExecWait 'taskkill /IM x-download-manager.exe /T'
  xdm_run_uninstaller:
  DetailPrint "Removing the previous ByteX Download Manager installation..."
  ExecWait '"$0" /S' $1
  ; A failed uninstall should stop setup rather than overlay two versions.
  IntCmp $1 0 xdm_preinstall_done xdm_preinstall_failed xdm_preinstall_failed
  xdm_preinstall_failed:
  Abort "The previous ByteX Download Manager version could not be removed. Close it and retry setup."
  xdm_preinstall_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Automatically register ByteX Download Manager Native Messaging Host & Browser Extensions on install
  ExecWait '"$INSTDIR\x-download-manager.exe" --register-browsers-silent'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Cleanly unregister browser extensions and Native Messaging Host keys before uninstalling
  ExecWait '"$INSTDIR\x-download-manager.exe" --unregister-browsers-silent'
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\The Browser Company\Arc\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Dia\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Opera Software\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Vivaldi\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Yandex\YandexBrowser\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Zen Browser\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Google\Chrome\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\Microsoft\Edge\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\The Browser Company\Arc\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\Dia\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\Opera Software\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\Vivaldi\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\Chromium\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\Yandex\YandexBrowser\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegValue HKCU "Software\Mozilla\Firefox\Extensions" "xdm-extension@peivee.com"
!macroend
