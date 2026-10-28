#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{self, Read, Write};

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // If launched by Chrome, Firefox, Brave, Edge, or Safari as a Native Messaging Host
    // (Chromium passes `chrome-extension://...`, Firefox passes path to `.json` and extension ID)
    let is_native_messaging = args.iter().any(|a| {
        a.starts_with("chrome-extension://")
            || a.contains("com.peivee.xdm")
            || a == "--native-messaging-host"
    });

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
        for b in ["chrome", "brave", "edge", "opera", "vivaldi", "firefox", "safari"] {
            let _ = xdm_lib::browser::configure_browser_integration(b, false, &mut st);
        }
        return;
    }

    if is_native_messaging {
        run_native_messaging_stdio_bridge();
        return;
    }

    xdm_lib::run_app();
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

        let response_json = if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&payload) {
            // Forward to running XDM IPC server on 127.0.0.1:45678
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();
            if let Ok(rt) = rt {
                rt.block_on(async {
                    let client = reqwest::Client::new();
                    match client
                        .post("http://127.0.0.1:45678/api/v1/intercept")
                        .json(&parsed)
                        .send()
                        .await
                    {
                        Ok(resp) => resp.text().await.unwrap_or_else(|_| r#"{"accepted":true}"#.to_string()),
                        Err(_) => r#"{"accepted":false,"error":"XDM desktop app not reachable"}"#.to_string(),
                    }
                })
            } else {
                r#"{"accepted":false}"#.to_string()
            }
        } else {
            r#"{"accepted":false,"error":"invalid_json"}"#.to_string()
        };

        let out_bytes = response_json.as_bytes();
        let out_len = (out_bytes.len() as u32).to_ne_bytes();
        let _ = stdout.write_all(&out_len);
        let _ = stdout.write_all(out_bytes);
        let _ = stdout.flush();
    }
}
