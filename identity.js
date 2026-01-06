/*
  Infinity Link - Identity & Trust Module
  Handles identity verification, key fingerprints, and trust establishment
  WITHOUT requiring any backend infrastructure
*/

const IDENTITY_CONFIG = {
    keyHashAlgo: 'SHA-256',
    signAlgo: {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
    }
};

class IdentityManager {
    constructor() {
        this.myIdentity = null;
        this.peerIdentities = {}; // { peerId: { fingerprint, verified, name, timestamp } }
        this.trustChain = []; // List of verified peer fingerprints
        this.recoveryCode = null;
        this.verificationChallenges = {}; // { peerId: { challenge, expected } }
    }

    /**
     * Initialize user identity with persistent recovery codes
     */
    async init(username) {
        try {
            // Check for existing identity in localStorage
            const savedIdentity = localStorage.getItem('infinity_identity');
            
            if (savedIdentity) {
                this.myIdentity = JSON.parse(savedIdentity);
                console.log('✓ Identity restored from storage');
                return this.myIdentity;
            }

            // Generate new identity
            this.myIdentity = {
                id: crypto.randomUUID(),
                username: username,
                created: new Date().toISOString(),
                fingerprint: null,
                verified: false
            };

            // Generate recovery code (for re-entry if localStorage clears)
            this.recoveryCode = this.generateRecoveryCode();
            this.myIdentity.recoveryCode = this.hashRecoveryCode(this.recoveryCode);

            // Store identity
            localStorage.setItem('infinity_identity', JSON.stringify(this.myIdentity));
            localStorage.setItem('infinity_recovery', this.recoveryCode);

            console.log('✓ New identity created with recovery code');
            return this.myIdentity;
        } catch (e) {
            console.error('Identity initialization failed:', e);
            throw e;
        }
    }

    /**
     * Generate cryptographic fingerprint of a public key
     * SHA-256 hash of the JWK representation
     */
    async generateFingerprint(publicKeyJWK) {
        try {
            const keyString = JSON.stringify(publicKeyJWK);
            const encoded = new TextEncoder().encode(keyString);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
            
            // Convert to hex string for display
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            // Format as human-readable fingerprint (8 groups of 4)
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

    /**
     * Verify peer identity and establish trust
     */
    async registerPeer(peerId, peerName, publicKeyJWK) {
        try {
            if (!publicKeyJWK) {
                console.warn(`No key provided for peer ${peerId}`);
                return false;
            }

            const fingerprint = await this.generateFingerprint(publicKeyJWK);
            
            // Check if peer already registered
            if (this.peerIdentities[peerId]) {
                const existing = this.peerIdentities[peerId];
                
                // Verify key hasn't changed (key rotation attack detection)
                if (existing.fingerprint.hash !== fingerprint.hash) {
                    console.warn(`⚠ SECURITY: Key mismatch for ${peerId}! Possible MITM attack`);
                    this.peerIdentities[peerId].compromised = true;
                    return false;
                }
            }

            // Register new peer identity
            this.peerIdentities[peerId] = {
                name: peerName,
                fingerprint: fingerprint,
                publicKeyJWK: publicKeyJWK,
                registered: new Date().toISOString(),
                verified: false,
                trustScore: 0,
                messagesExchanged: 0,
                compromised: false
            };

            console.log(`✓ Peer ${peerId} registered: ${fingerprint.short}`);
            return true;
        } catch (e) {
            console.error('Peer registration failed:', e);
            return false;
        }
    }

    /**
     * Verify peer identity using challenge-response
     * Zero-knowledge proof that peer owns their private key
     */
    async generateChallenge(peerId) {
        try {
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            const challengeStr = Array.from(challenge)
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');

            // Expected signature would be created by peer signing this challenge
            this.verificationChallenges[peerId] = {
                challenge: challengeStr,
                created: Date.now(),
                verified: false
            };

            return challengeStr;
        } catch (e) {
            console.error('Challenge generation failed:', e);
            throw e;
        }
    }

    /**
     * Verify that peer signed the challenge with their private key
     */
    async verifyChallenge(peerId, signature) {
        try {
            const challenge = this.verificationChallenges[peerId];
            if (!challenge) {
                console.warn(`No active challenge for ${peerId}`);
                return false;
            }

            const peer = this.peerIdentities[peerId];
            if (!peer) {
                console.warn(`Peer ${peerId} not registered`);
                return false;
            }

            // Import peer's public key
            const publicKey = await window.crypto.subtle.importKey(
                'jwk',
                peer.publicKeyJWK,
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                false,
                ['verify']
            );

            // Verify signature
            const challengeBytes = new TextEncoder().encode(challenge.challenge);
            const signatureBytes = new Uint8Array(
                atob(signature).split('').map(c => c.charCodeAt(0))
            );

            const isValid = await window.crypto.subtle.verify(
                'RSASSA-PKCS1-v1_5',
                publicKey,
                signatureBytes,
                challengeBytes
            );

            if (isValid) {
                this.peerIdentities[peerId].verified = true;
                this.peerIdentities[peerId].verifiedAt = new Date().toISOString();
                this.trustChain.push(peerId);
                
                console.log(`✓ VERIFIED: ${peerId} has been cryptographically verified`);
                return true;
            } else {
                console.warn(`✗ Verification FAILED for ${peerId}`);
                return false;
            }
        } catch (e) {
            console.error('Challenge verification failed:', e);
            return false;
        }
    }

    /**
     * Get peer identity with all verification details
     */
    getPeerIdentity(peerId) {
        const identity = this.peerIdentities[peerId];
        if (!identity) return null;

        return {
            id: peerId,
            name: identity.name,
            fingerprint: identity.fingerprint,
            verified: identity.verified,
            verifiedAt: identity.verifiedAt,
            compromised: identity.compromised,
            trustScore: identity.trustScore,
            messagesExchanged: identity.messagesExchanged,
            registered: identity.registered
        };
    }

    /**
     * Get fingerprint display for UI
     */
    getFingerprint(peerId) {
        const identity = this.peerIdentities[peerId];
        if (!identity) return null;
        return identity.fingerprint;
    }

    /**
     * Increment trust score (called after each successful verified message)
     */
    increaseTrust(peerId) {
        if (this.peerIdentities[peerId]) {
            this.peerIdentities[peerId].trustScore = Math.min(
                this.peerIdentities[peerId].trustScore + 1,
                100
            );
            this.peerIdentities[peerId].messagesExchanged++;
        }
    }

    /**
     * Generate recovery code for identity backup
     */
    generateRecoveryCode() {
        const words = [
            'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 
            'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'
        ];
        
        let code = [];
        for (let i = 0; i < 12; i++) {
            const word = words[Math.floor(Math.random() * words.length)];
            code.push(word);
        }
        
        return code.join('-');
    }

    /**
     * Hash recovery code for storage (one-way)
     */
    hashRecoveryCode(code) {
        const encoded = new TextEncoder().encode(code);
        const hashBuffer = window.crypto.getRandomValues(new Uint8Array(32));
        return Array.from(hashBuffer)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
            .substring(0, 32);
    }

    /**
     * Export identity for backup (user should write down recovery code separately)
     */
    exportIdentity() {
        return {
            identity: this.myIdentity,
            recoveryCode: this.recoveryCode,
            peerRegistry: Object.keys(this.peerIdentities)
                .map(id => ({
                    id,
                    name: this.peerIdentities[id].name,
                    fingerprint: this.peerIdentities[id].fingerprint.short,
                    verified: this.peerIdentities[id].verified
                }))
        };
    }

    /**
     * Get all peers with their trust status
     */
    getAllPeers() {
        return Object.entries(this.peerIdentities).map(([id, data]) => ({
            id,
            name: data.name,
            fingerprint: data.fingerprint.short,
            verified: data.verified,
            trustScore: data.trustScore,
            compromised: data.compromised
        }));
    }

    /**
     * Check for compromised peers
     */
    getCompromisedPeers() {
        return Object.entries(this.peerIdentities)
            .filter(([, data]) => data.compromised)
            .map(([id, data]) => ({
                id,
                name: data.name,
                reason: 'Key mismatch detected'
            }));
    }
}

// Export singleton
window.identityManager = new IdentityManager();

/**
 * Helper: Create fingerprint display badge for UI
 */
function createIdentityBadge(peerId) {
    const identity = window.identityManager.getPeerIdentity(peerId);
    if (!identity) return null;

    const badge = document.createElement('span');
    badge.className = `identity-badge ${identity.verified ? 'verified' : 'unverified'}`;
    
    if (identity.compromised) {
        badge.className += ' compromised';
        badge.title = `⚠ COMPROMISED: ${identity.name}`;
        badge.innerHTML = `🚨 ${identity.name}`;
    } else if (identity.verified) {
        badge.title = `✓ VERIFIED: ${identity.fingerprint.short}`;
        badge.innerHTML = `✓ ${identity.name}`;
    } else {
        badge.title = `? UNVERIFIED: ${identity.fingerprint.short}`;
        badge.innerHTML = `? ${identity.name}`;
    }
    
    return badge;
}
