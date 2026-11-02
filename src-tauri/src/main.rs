#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{self, Read, Write};
use std::path::Path;
use std::process::Command;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--prepare-for-update") {
        // Installer scripts invoke this on the previous installation. It asks the already
        // running process to exit cleanly; a missing process is a successful no-op.
        let settings = xdm_lib::config::ConfigManager::new().load();
        let port = settings.browser.ipc_port;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build();
        if let Ok(runtime) = runtime {
            let _ = runtime.block_on(async move {
                reqwest::Client::new()
                    .post(format!("http://127.0.0.1:{port}/api/v1/prepare-update"))
                    .timeout(std::time::Duration::from_secs(3))
                    .send()
                    .await
            });
        }
        return;
    }

    // If launched by Chrome, Firefox, Brave, Edge, or Safari as a Native Messaging Host
    // (Chromium passes `chrome-extension://...`, Firefox passes path to `.json` and extension ID)
    let is_native_messaging = is_native_messaging_invocation(&args);

    if args.iter().any(|a| a == "--register-browsers-silent") {
        let cfg = xdm_lib::config::ConfigManager::new();
        let mut st = cfg.load();
        let _ = xdm_lib::browser::auto_register_all_detected_browsers(&mut st);
        let _ = cfg.save(&st);
        return;
    }

    if args.iter().any(|a| a == "--unregister-browsers-silent") {
        let cfg = xdm_lib::config::ConfigManager::new();
        let mut st = cfg.load();
        for (b, _, _) in xdm_lib::browser::SUPPORTED_BROWSERS {
            let _ = xdm_lib::browser::configure_browser_integration(b, false, &mut st);
        }
        return;
    }

    if is_native_messaging {
        run_native_messaging_stdio_bridge();
        return;
    }

    let _rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to initialize Tokio runtime");
    let _guard = _rt.enter();

    xdm_lib::run_app();
}

fn is_native_messaging_invocation(args: &[String]) -> bool {
    args.iter().any(|arg| {
        arg.starts_with("chrome-extension://")
            || arg.contains("com.peivee.xdm")
            || arg == "xdm-extension@peivee.com"
            || arg == "--native-messaging-host"
    })
}

/// Native Messaging STDIO Bridge (32-bit native-endian length prefix + UTF-8 JSON payload)
/// Forwards messages from Chrome/Firefox/Safari directly to the running XDM instance on 127.0.0.1:45678
fn run_native_messaging_stdio_bridge() {
    let mut stdin = io::stdin();
    let mut stdout = io::stdout();

    loop {
        let mut len_bytes = [0u8; 4];
        if stdin.read_exact(&mut len_bytes).is_err() {
            break;
        }
        let msg_len = u32::from_ne_bytes(len_bytes) as usize;
        if msg_len == 0 || msg_len > 10 * 1024 * 1024 {
            break;
        }

        let mut payload = vec![0u8; msg_len];
        if stdin.read_exact(&mut payload).is_err() {
            break;
        }

        let response_json = match serde_json::from_slice::<serde_json::Value>(&payload) {
            Ok(parsed) => forward_native_message(parsed),
            Err(_) => r#"{"accepted":false,"error":"invalid_json"}"#.to_string(),
        };

        let out_bytes = response_json.as_bytes();
        let out_len = (out_bytes.len() as u32).to_ne_bytes();
        let _ = stdout.write_all(&out_len);
        let _ = stdout.write_all(out_bytes);
        let _ = stdout.flush();
    }
}

fn forward_native_message(payload: serde_json::Value) -> String {
    let settings = xdm_lib::config::ConfigManager::new().load();
    let port = settings.browser.ipc_port;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build();
    let Ok(runtime) = runtime else {
        return r#"{"accepted":false,"error":"native_runtime_unavailable"}"#.to_string();
    };
    runtime.block_on(async move {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(2))
            .timeout(std::time::Duration::from_secs(50))
            .build();
        let Ok(client) = client else {
            return r#"{"accepted":false,"error":"native_http_client_unavailable"}"#.to_string();
        };
        let endpoint = format!("http://127.0.0.1:{port}");
        if !ipc_server_ready(&client, &endpoint).await {
            launch_desktop_app();
            let mut ready = false;
            for _ in 0..60 {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                if ipc_server_ready(&client, &endpoint).await {
                    ready = true;
                    break;
                }
            }
            if !ready {
                return r#"{"accepted":false,"error":"ByteX desktop app could not be started"}"#
                    .to_string();
            }
        }

        match client
            .post(format!("{endpoint}/api/v1/intercept"))
            .json(&payload)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => match response.text().await {
                Ok(text) if text.len() <= 1024 * 1024 => {
                    match serde_json::from_str::<serde_json::Value>(&text) {
                        Ok(value) if value.get("accepted").and_then(|v| v.as_bool()).is_some() => {
                            value.to_string()
                        }
                        _ => r#"{"accepted":false,"error":"invalid_desktop_acknowledgement"}"#
                            .to_string(),
                    }
                }
                _ => r#"{"accepted":false,"error":"invalid_desktop_response"}"#.to_string(),
            },
            _ => r#"{"accepted":false,"error":"ByteX desktop app did not accept the download"}"#
                .to_string(),
        }
    })
}

async fn ipc_server_ready(client: &reqwest::Client, endpoint: &str) -> bool {
    client
        .get(format!("{endpoint}/api/v1/status?browser=native-messaging"))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

fn launch_desktop_app() {
    let Ok(executable) = std::env::current_exe() else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let mut ancestor = Some(executable.as_path());
        while let Some(path) = ancestor {
            if path.extension().is_some_and(|extension| extension == "app") {
                let _ = Command::new("open").arg("-a").arg(path).spawn();
                return;
            }
            ancestor = path.parent();
        }
    }
    let _ = Command::new(Path::new(&executable)).spawn();
}

#[cfg(test)]
mod native_messaging_invocation_tests {
    use super::is_native_messaging_invocation;

    #[test]
    fn recognizes_chromium_and_firefox_native_host_origins() {
        assert!(is_native_messaging_invocation(&[
            "bytex-download-manager".to_string(),
            "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/".to_string(),
        ]));
        assert!(is_native_messaging_invocation(&[
            "bytex-download-manager".to_string(),
            "xdm-extension@peivee.com".to_string(),
        ]));
        assert!(!is_native_messaging_invocation(&[
            "bytex-download-manager".to_string()
        ]));
    }
}
