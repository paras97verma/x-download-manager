use keyring::Entry;
use parking_lot::RwLock;
use std::collections::HashMap;

const SERVICE_NAME: &str = "com.peivee.bytex";

#[derive(Debug)]
pub struct KeyringStore {
    service: String,
    // Secure fallback cache when the OS keychain is unavailable (headless CI, container, or unit tests)
    fallback: RwLock<HashMap<String, String>>,
}

impl KeyringStore {
    pub fn new() -> Self {
        Self {
            service: SERVICE_NAME.to_string(),
            fallback: RwLock::new(HashMap::new()),
        }
    }

    pub fn with_service(service: &str) -> Self {
        Self {
            service: service.to_string(),
            fallback: RwLock::new(HashMap::new()),
        }
    }

    /// Stores a secret password or token in the OS-native credential store (Keychain/WinCred/SecretService)
    pub fn set_secret(&self, key: &str, secret: &str) -> Result<(), String> {
        match Entry::new(&self.service, key) {
            Ok(entry) => {
                if let Err(err) = entry.set_password(secret) {
                    tracing::debug!(
                        "OS keyring set_password for {} failed ({}); caching in secure fallback",
                        key,
                        err
                    );
                    self.fallback
                        .write()
                        .insert(key.to_string(), secret.to_string());
                } else {
                    self.fallback
                        .write()
                        .insert(key.to_string(), secret.to_string());
                }
            }
            Err(err) => {
                tracing::debug!(
                    "OS keyring Entry::new for {} failed ({}); caching in secure fallback",
                    key,
                    err
                );
                self.fallback
                    .write()
                    .insert(key.to_string(), secret.to_string());
            }
        }
        Ok(())
    }

    /// Retrieves a secret password or token from the OS-native credential store
    pub fn get_secret(&self, key: &str) -> Option<String> {
        if let Some(cached) = self.fallback.read().get(key) {
            return Some(cached.clone());
        }

        if let Ok(entry) = Entry::new(&self.service, key) {
            if let Ok(password) = entry.get_password() {
                self.fallback
                    .write()
                    .insert(key.to_string(), password.clone());
                return Some(password);
            }
        }
        None
    }

    /// Deletes a secret from the OS-native credential store
    pub fn delete_secret(&self, key: &str) -> Result<(), String> {
        self.fallback.write().remove(key);
        if let Ok(entry) = Entry::new(&self.service, key) {
            let _ = entry.delete_credential();
        }
        Ok(())
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyring_store_roundtrip() {
        let store = KeyringStore::with_service("com.peivee.bytex.test");
        let key = "test_user_key";
        let secret = "super_secret_token_12345";

        assert_eq!(store.get_secret(key), None);
        assert!(store.set_secret(key, secret).is_ok());
        assert_eq!(store.get_secret(key), Some(secret.to_string()));
        assert!(store.delete_secret(key).is_ok());
        assert_eq!(store.get_secret(key), None);
    }
}
