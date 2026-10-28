!macro NSIS_HOOK_POSTINSTALL
  ; Automatically register X Download Manager Native Messaging Host & Browser Extensions on install
  ExecWait '"$INSTDIR\x-download-manager.exe" --register-browsers-silent'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Cleanly unregister browser extensions and Native Messaging Host keys before uninstalling
  ExecWait '"$INSTDIR\x-download-manager.exe" --unregister-browsers-silent'
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.peivee.xdm"
  DeleteRegKey HKCU "Software\Google\Chrome\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\Microsoft\Edge\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\Extensions\knldjmfmopnpolahpmmgbagdohdnhkik"
  DeleteRegValue HKCU "Software\Mozilla\Firefox\Extensions" "xdm-extension@peivee.com"
!macroend
