//! Integration Tests: BitTorrent & Magnet Bencode Parser, SHA-1 Info-Hash & Swarm Metadata
use xdm_lib::engine::torrent::*;

#[test]
fn test_parse_magnet_uri() {
    let magnet = "magnet:?xt=urn:btih:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4&dn=Ubuntu+24.04+Desktop+amd64.iso&xl=4950000000&tr=udp://tracker.opentrackr.org:1337/announce";
    let parsed = parse_magnet_uri(magnet).expect("should parse valid magnet");
    assert_eq!(parsed.info_hash, "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4");
    assert_eq!(parsed.display_name, "Ubuntu 24.04 Desktop amd64.iso");
    assert_eq!(parsed.exact_length, Some(4950000000));
    assert_eq!(parsed.trackers.len(), 1);
}

#[test]
fn test_parse_single_file_torrent_bytes() {
    let tracker = "http://tracker.example.com/ann";
    let raw = format!(
        "d8:announce{}:{}4:infod6:lengthi1048576e4:name12:testfile.zip12:piece lengthi262144e6:pieces20:12345678901234567890ee",
        tracker.len(),
        tracker
    );
    let meta =
        parse_torrent_bytes(raw.as_bytes(), true).expect("should parse valid bencoded torrent");
    assert_eq!(meta.files.len(), 1);
    assert_eq!(meta.files[0].path, "testfile.zip");
    assert_eq!(meta.files[0].size_bytes, 1048576);
    assert_eq!(meta.piece_length, 262144);
    assert_eq!(meta.total_pieces, 1);
    assert_eq!(meta.trackers, vec!["http://tracker.example.com/ann"]);
    assert_eq!(meta.info_hash.len(), 40);
}

#[test]
fn test_parse_multi_file_torrent_bytes() {
    let tracker = "udp://tracker.open.org:6969";
    // Bencoded dictionary with multi-file list in `info.files`
    let raw = format!(
        "d8:announce{}:{}4:infod5:filesld6:lengthi2048e4:pathl8:read.txteed6:lengthi8192e4:pathl7:app.bineee4:name7:my_pack12:piece lengthi512e6:pieces20:00000000000000000000ee",
        tracker.len(),
        tracker
    );
    let meta = parse_torrent_bytes(raw.as_bytes(), false)
        .expect("should parse multi-file bencoded torrent");
    assert_eq!(meta.files.len(), 2);
    assert_eq!(meta.files[0].path, "my_pack/read.txt");
    assert_eq!(meta.files[0].size_bytes, 2048);
    assert_eq!(meta.files[1].path, "my_pack/app.bin");
    assert_eq!(meta.files[1].size_bytes, 8192);
    assert_eq!(meta.total_pieces, 1);
    assert_eq!(meta.peers.len(), 0);
    assert_eq!(meta.peers_connected, 0);
}

#[test]
fn test_create_initial_torrent_metadata() {
    let magnet = "magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98&dn=ArchLinux.iso&xl=987654321";
    let default_trackers = vec!["udp://tracker.opentrackr.org:1337".to_string()];
    let meta = create_initial_torrent_metadata(magnet, &default_trackers, true);
    assert_eq!(meta.files.len(), 1);
    assert_eq!(meta.files[0].path, "ArchLinux.iso");
    assert_eq!(meta.files[0].size_bytes, 987654321);
    assert_eq!(meta.trackers, default_trackers);
    assert_eq!(meta.peers.len(), 0);
    assert_eq!(meta.peers_connected, 0);
}
