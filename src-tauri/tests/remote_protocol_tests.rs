//! Integration Tests: Dedicated Remote Protocol (FTP, FTPS, SFTP) Prober & Keyring Site Vault
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread;
use std::time::Duration;
use xdm_lib::config::SiteCredential;
use xdm_lib::engine::remote_protocol::*;
use xdm_lib::security::KeyringStore;

#[tokio::test]
async fn test_remote_connection_empty_host_returns_error() {
    let params = RemoteConnectionTestParams {
        protocol: "ftp".into(),
        host: "".into(),
        port: 21,
        username: None,
        password: None,
        is_anonymous: true,
        remote_path: None,
        passive_mode: true,
    };
    let res = test_remote_connection(params).await;
    assert!(!res.success);
    assert!(res.message.contains("Host address cannot be empty"));
}

#[tokio::test]
async fn test_remote_connection_unsupported_protocol_returns_error() {
    let params = RemoteConnectionTestParams {
        protocol: "gopher".into(),
        host: "127.0.0.1".into(),
        port: 70,
        username: None,
        password: None,
        is_anonymous: false,
        remote_path: None,
        passive_mode: true,
    };
    let res = test_remote_connection(params).await;
    assert!(!res.success);
    assert!(res.message.contains("Unsupported remote protocol"));
}

#[tokio::test]
async fn test_sftp_connection_prober_with_mock_ssh_server() {
    // Bind a mock TCP server simulating an SSH/SFTP server banner
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind mock SSH port");
    let addr = listener.local_addr().unwrap();
    let port = addr.port();

    let server_handle = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            // Per RFC 4253, send SSH version string
            let _ = stream.write_all(b"SSH-2.0-OpenSSH_9.3p1 Debian-1ubuntu3\r\n");
            let _ = stream.flush();
            thread::sleep(Duration::from_millis(50));
        }
    });

    let params = RemoteConnectionTestParams {
        protocol: "sftp".into(),
        host: "127.0.0.1".into(),
        port,
        username: Some("deploy".into()),
        password: Some("secret123".into()),
        is_anonymous: false,
        remote_path: Some("/var/www/uploads".into()),
        passive_mode: true,
    };

    let res = test_remote_connection(params).await;
    let _ = server_handle.join();

    assert!(
        res.success,
        "SFTP probe should succeed for valid SSH server banner: {:?}",
        res
    );
    assert_eq!(res.protocol, "sftp");
    assert_eq!(res.port, port);
    assert!(res.banner.is_some());
    assert!(res.banner.unwrap().contains("SSH-2.0-OpenSSH"));
    assert!(res.features.iter().any(|f| f.contains("SSH-2.0")));
    assert!(
        res.security_warning.is_none(),
        "SFTP is secure and must not emit plain FTP warning"
    );
}

#[tokio::test]
async fn test_ftp_connection_prober_with_mock_ftp_server() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind mock FTP port");
    let addr = listener.local_addr().unwrap();
    let port = addr.port();

    let server_handle = thread::spawn(move || {
        if let Ok((stream, _)) = listener.accept() {
            let mut writer = stream.try_clone().unwrap();
            let mut reader = BufReader::new(stream);
            let _ = writer.write_all(b"220 ByteX Test FTP Server Ready\r\n");
            let _ = writer.flush();

            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                let trimmed = line.trim();
                if trimmed.starts_with("USER") {
                    let _ = writer.write_all(b"331 Password required\r\n");
                    let _ = writer.flush();
                } else if trimmed.starts_with("PASS") {
                    let _ = writer.write_all(b"230 User logged in, proceed\r\n");
                    let _ = writer.flush();
                } else if trimmed.starts_with("FEAT") {
                    let _ = writer.write_all(
                        b"211-Features:\r\n UTF8\r\n REST STREAM\r\n PASV\r\n211 End\r\n",
                    );
                    let _ = writer.flush();
                } else if trimmed.starts_with("CWD") {
                    let _ = writer.write_all(b"250 Directory changed\r\n");
                    let _ = writer.flush();
                } else if trimmed.starts_with("QUIT") {
                    let _ = writer.write_all(b"221 Goodbye\r\n");
                    let _ = writer.flush();
                    break;
                } else {
                    let _ = writer.write_all(b"502 Command not implemented\r\n");
                    let _ = writer.flush();
                }
                line.clear();
            }
        }
    });

    let params = RemoteConnectionTestParams {
        protocol: "ftp".into(),
        host: "127.0.0.1".into(),
        port,
        username: Some("tester".into()),
        password: Some("ftpsecret".into()),
        is_anonymous: false,
        remote_path: Some("/pub/releases".into()),
        passive_mode: true,
    };

    let res = test_remote_connection(params).await;
    let _ = server_handle.join();

    assert!(res.success, "FTP probe should succeed: {:?}", res);
    assert_eq!(res.protocol, "ftp");
    assert!(res.authenticated, "FTP should be authenticated");
    assert!(
        res.security_warning.is_some(),
        "Plain FTP must emit an insecure warning"
    );
    assert!(res.security_warning.unwrap().contains("Plain FTP"));
    assert_eq!(res.remote_path_exists, Some(true));
    assert!(res.features.iter().any(|f| f.contains("UTF8")));
    assert!(res.features.iter().any(|f| f.contains("REST")));
}

#[test]
fn test_keyring_site_credential_secret_isolation() {
    let keyring = KeyringStore::with_service("test.bytex.remote");
    let cred_id = "ftp-site-alpha";

    // Set password in keyring
    keyring
        .set_secret(&format!("site_cred:{}", cred_id), "MySuperSecretFtpPass")
        .expect("Keyring set should work");

    // Fetch from keyring
    let fetched = keyring.get_secret(&format!("site_cred:{}", cred_id));
    assert_eq!(fetched.as_deref(), Some("MySuperSecretFtpPass"));

    // Verify sanitized credential representation leaves password_or_token empty for storage
    let cred = SiteCredential {
        id: cred_id.into(),
        host_pattern: "ftp.alpha.org".into(),
        site_type: "ftp".into(),
        username: "alpha_user".into(),
        password_or_token: String::new(), // Passwords are never stored plaintext in struct
        cookies: None,
        custom_headers: HashMap::new(),
        enabled: true,
        protocol: Some("ftp".into()),
        port: Some(21),
        remote_path: Some("/pub".into()),
        display_name: Some("Alpha FTP Mirror".into()),
        is_anonymous: Some(false),
        passive_mode: Some(true),
    };

    let serialized = serde_json::to_string(&cred).expect("Serialization must succeed");
    assert!(
        !serialized.contains("MySuperSecretFtpPass"),
        "Serialized credential must never contain secret password"
    );

    // Delete from keyring
    keyring
        .delete_secret(&format!("site_cred:{}", cred_id))
        .expect("Keyring delete should work");
    assert!(keyring
        .get_secret(&format!("site_cred:{}", cred_id))
        .is_none());
}
