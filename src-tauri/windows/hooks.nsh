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
