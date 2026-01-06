/*
  Infinity Link - Security Module
  Handles ECDH Key Exchange and AES-GCM Encryption for E2EE Private Chats.
*/

const CRYPTO_CONFIG = {
    algo: { name: "ECDH", namedCurve: "P-256" },
    encryptAlgo: { name: "AES-GCM", length: 256 }
};

class CryptoManager {
    constructor() {
        this.keyPair = null;
        this.publicKeyJWK = null;
        this.publicKeyFingerprint = null;
        this.sharedSecrets = {}; // Cache: { peerId: CryptoKey }
        this.peerKeyFingerprints = {}; // Cache: { peerId: fingerprint }
        this.keyExchangeLog = []; // Track all key exchanges for audit
    }

    async init() {
        try {
            // 1. Generate Identity Keys (ECDH)
            this.keyPair = await window.crypto.subtle.generateKey(
                CRYPTO_CONFIG.algo,
                true, // Extractable
                ["deriveKey", "deriveBits"]
            );

            // 2. Export Public Key for broadcasting
            this.publicKeyJWK = await window.crypto.subtle.exportKey(
                "jwk",
                this.keyPair.publicKey
            );

            // 3. Generate fingerprint of our public key
            this.publicKeyFingerprint = await this.generateKeyFingerprint(this.publicKeyJWK);

            // 4. Log key generation
            this.keyExchangeLog.push({
                type: 'KEY_GENERATED',
                timestamp: new Date().toISOString(),
                fingerprint: this.publicKeyFingerprint.short,
                source: 'local'
            });

            console.log(`🔐 Security: Identity Keys Generated`);
            console.log(`   Fingerprint: ${this.publicKeyFingerprint.short}`);
        } catch (e) {
            console.error('Crypto initialization failed:', e);
            throw e;
        }
    }

    /**
     * Generate SHA-256 fingerprint of a public key
     */
    async generateKeyFingerprint(publicKeyJWK) {
        try {
            const keyString = JSON.stringify(publicKeyJWK);
            const encoded = new TextEncoder().encode(keyString);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
            
            // Convert to hex string
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            // Format as human-readable fingerprint
            const fingerprint = hashHex.match(/.{1,4}/g).join('-');
            
            return {
                full: fingerprint,
                short: hashHex.substring(0, 12).toUpperCase(),
                hash: hashHex
            };
        } catch (e) {
            console.error('Fingerprint generation failed:', e);
            throw e;
        }
    }

    async importPeerKey(peerId, jwk) {
        if (!jwk) {
            console.warn(`No key provided for ${peerId}`);
            return false;
        }
        
        try {
            // Generate fingerprint of peer's key
            const peerFingerprint = await this.generateKeyFingerprint(jwk);
            
            // Store fingerprint for verification
            if (this.peerKeyFingerprints[peerId]) {
                // Key rotation detection
                if (this.peerKeyFingerprints[peerId].hash !== peerFingerprint.hash) {
                    console.warn(`⚠ SECURITY: Key rotation detected for ${peerId}`);
                    this.keyExchangeLog.push({
                        type: 'KEY_ROTATION',
                        timestamp: new Date().toISOString(),
                        peerId: peerId,
                        oldFingerprint: this.peerKeyFingerprints[peerId].short,
                        newFingerprint: peerFingerprint.short
                    });
                }
            }

            this.peerKeyFingerprints[peerId] = peerFingerprint;

            const peerPublicKey = await window.crypto.subtle.importKey(
                "jwk",
                jwk,
                CRYPTO_CONFIG.algo,
                true,
                []
            );

            // 3. Derive Shared Secret (ECDH)
            const sharedKey = await window.crypto.subtle.deriveKey(
                { name: "ECDH", public: peerPublicKey },
                this.keyPair.privateKey,
                CRYPTO_CONFIG.encryptAlgo,
                false, // Key not extractable
                ["encrypt", "decrypt"]
            );

            this.sharedSecrets[peerId] = sharedKey;

            // Log key exchange
            this.keyExchangeLog.push({
                type: 'KEY_IMPORT',
                timestamp: new Date().toISOString(),
                peerId: peerId,
                peerFingerprint: peerFingerprint.short,
                status: 'success'
            });

            // Register with identity manager if available
            if (window.identityManager) {
                await window.identityManager.registerPeer(peerId, 'Peer', jwk);
            }

            console.log(`🔐 Secure Channel with ${peerId}: ${peerFingerprint.short}`);
            return true;
        } catch (e) {
            console.error("Key exchange failed:", e);
            
            this.keyExchangeLog.push({
                type: 'KEY_IMPORT_FAILED',
                timestamp: new Date().toISOString(),
                peerId: peerId,
                error: e.message
            });

            return false;
        }
    }

    async encryptMessage(peerId, text) {
        const sharedKey = this.sharedSecrets[peerId];
        if (!sharedKey) throw new Error("No secure channel for this peer");

        const encodedText = new TextEncoder().encode(text);
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV

        const ciphertext = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            sharedKey,
            encodedText
        );

        // Return bundle
        return {
            iv: Array.from(iv), // Convert to array for JSON transport
            content: Array.from(new Uint8Array(ciphertext))
        };
    }

    async decryptMessage(peerId, bundle) {
        const sharedKey = this.sharedSecrets[peerId];
        if (!sharedKey) throw new Error("No secure channel for this peer");

        try {
            const iv = new Uint8Array(bundle.iv);
            const ciphertext = new Uint8Array(bundle.content);

            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                sharedKey,
                ciphertext
            );

            const text = new TextDecoder().decode(decrypted);

            // Increase trust if identity manager is available
            if (window.identityManager) {
                window.identityManager.increaseTrust(peerId);
            }

            return text;
        } catch (e) {
            console.error('Decryption failed for', peerId, ':', e.message);
            
            // Log decryption failure
            this.keyExchangeLog.push({
                type: 'DECRYPT_FAILED',
                timestamp: new Date().toISOString(),
                peerId: peerId,
                error: e.message
            });

            throw e;
        }
    }

    /**
     * Get key exchange audit log
     */
    getKeyExchangeLog() {
        return this.keyExchangeLog;
    }

    /**
     * Get peer fingerprint
     */
    getPeerFingerprint(peerId) {
        return this.peerKeyFingerprints[peerId];
    }

    /**
     * Export security report
     */
    getSecurityReport() {
        return {
            myFingerprint: this.publicKeyFingerprint,
            peerCount: Object.keys(this.sharedSecrets).length,
            keyExchangeLog: this.keyExchangeLog.slice(-20), // Last 20 events
            timestamp: new Date().toISOString()
        };
    }
}

// Export singleton
window.cryptoManager = new CryptoManager();
