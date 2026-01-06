/*
  Infinity Link - Security Dashboard
  Provides UI for viewing identity verification, fingerprints, and trust status
  Maintains 100% client-side, zero-backend architecture
*/

/**
 * Toast notification system - replaces alert() dialogs
 */
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <ion-icon name="${type === 'success' ? 'checkmark-circle' : type === 'error' ? 'alert-circle' : 'information-circle'}"></ion-icon>
            <span>${message}</span>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <ion-icon name="close"></ion-icon>
        </button>
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

function showSecurityDashboard() {
    const dashboard = document.createElement('div');
    dashboard.className = 'modal';
    dashboard.id = 'security-modal';
    
    dashboard.innerHTML = `
        <div class="modal-content security-modal">
            <div class="modal-header">
                <h2><ion-icon name="shield-checkmark"></ion-icon> Security Dashboard</h2>
                <button class="modal-close" onclick="document.getElementById('security-modal').remove()">
                    <ion-icon name="close"></ion-icon>
                </button>
            </div>
            
            <div class="modal-body">
                <!-- My Identity Section -->
                <section class="security-section">
                    <h3><ion-icon name="person-circle"></ion-icon> Your Identity</h3>
                    <div class="identity-card" id="my-identity-card">
                        <div class="identity-row">
                            <span class="label">User ID:</span>
                            <code id="my-id"></code>
                        </div>
                        <div class="identity-row">
                            <span class="label">Public Key Fingerprint:</span>
                            <code id="my-fingerprint" class="fingerprint"></code>
                        </div>
                        <div class="identity-row">
                            <span class="label">Created:</span>
                            <span id="my-created"></span>
                        </div>
                        <div class="identity-actions">
                            <button class="btn-secondary" onclick="exportIdentityBackup()">
                                <ion-icon name="download"></ion-icon> Export Backup
                            </button>
                            <button class="btn-secondary" onclick="copyToClipboard('my-fingerprint', this)">
                                <ion-icon name="copy"></ion-icon> Copy Fingerprint
                            </button>
                        </div>
                    </div>
                </section>

                <!-- Peers Trust Status -->
                <section class="security-section">
                    <h3><ion-icon name="people"></ion-icon> Peer Trust Status</h3>
                    <div id="peers-list" class="peers-security-list">
                        <!-- Populated by JS -->
                    </div>
                </section>

                <!-- Key Exchange Audit Log -->
                <section class="security-section">
                    <h3><ion-icon name="swap-horizontal"></ion-icon> Key Exchange Audit Log</h3>
                    <div id="audit-log" class="audit-log">
                        <!-- Populated by JS -->
                    </div>
                </section>

                <!-- Security Tips -->
                <section class="security-section">
                    <h3><ion-icon name="bulb"></ion-icon> Security Tips</h3>
                    <ul class="security-tips">
                        <li>✓ All keys are generated locally in your browser</li>
                        <li>✓ No key material ever leaves your device</li>
                        <li>✓ Verify peer fingerprints out-of-band (phone call, QR code)</li>
                        <li>✓ Messages use AES-256-GCM encryption</li>
                        <li>✓ Zero-knowledge proof optional for peer verification</li>
                        <li>✓ All data is stored locally only (localStorage)</li>
                        <li>✓ No backend server can access your conversations</li>
                        <li>✓ WebRTC provides peer-to-peer connectivity</li>
                    </ul>
                </section>
            </div>
        </div>
    `;
    
    document.body.appendChild(dashboard);
    updateSecurityDashboard();
}

function updateSecurityDashboard() {
    // My Identity
    if (window.identityManager && window.identityManager.myIdentity) {
        const identity = window.identityManager.myIdentity;
        document.getElementById('my-id').textContent = identity.id;
        document.getElementById('my-created').textContent = 
            new Date(identity.created).toLocaleDateString();
    }

    if (window.cryptoManager && window.cryptoManager.publicKeyFingerprint) {
        const fp = window.cryptoManager.publicKeyFingerprint;
        document.getElementById('my-fingerprint').textContent = fp.short;
    }

    // Peers List
    const peersList = document.getElementById('peers-list');
    if (window.identityManager) {
        const peers = window.identityManager.getAllPeers();
        
        if (peers.length === 0) {
            peersList.innerHTML = '<p class="empty-state">No connected peers yet</p>';
        } else {
            peersList.innerHTML = peers.map(peer => `
                <div class="peer-security-card ${peer.verified ? 'verified' : 'unverified'} ${peer.compromised ? 'compromised' : ''}">
                    <div class="peer-header">
                        <span class="peer-name">${peer.name}</span>
                        <span class="trust-badge ${peer.verified ? 'verified' : 'unverified'}">
                            ${peer.compromised ? '🚨 COMPROMISED' : (peer.verified ? '✓ VERIFIED' : '? UNVERIFIED')}
                        </span>
                    </div>
                    <div class="peer-details">
                        <div class="detail-row">
                            <span class="label">ID:</span>
                            <code>${peer.id.substring(0, 12)}...</code>
                        </div>
                        <div class="detail-row">
                            <span class="label">Fingerprint:</span>
                            <code>${peer.fingerprint}</code>
                        </div>
                        <div class="detail-row">
                            <span class="label">Trust Score:</span>
                            <div class="trust-meter">
                                <div class="trust-bar" style="width: ${peer.trustScore}%"></div>
                            </div>
                        </div>
                        <div class="peer-actions">
                            <button class="btn-micro" onclick="copyToClipboard('${peer.id}', this)">
                                Copy ID
                            </button>
                            ${!peer.verified ? `
                                <button class="btn-micro" onclick="verifyPeer('${peer.id}')">
                                    Verify
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }

    // Audit Log
    const auditLog = document.getElementById('audit-log');
    if (window.cryptoManager) {
        const log = window.cryptoManager.getKeyExchangeLog();
        const recentLog = log.slice(-10).reverse();
        
        if (recentLog.length === 0) {
            auditLog.innerHTML = '<p class="empty-state">No key exchange events yet</p>';
        } else {
            auditLog.innerHTML = `
                <table class="audit-table">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Event</th>
                            <th>Peer/Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recentLog.map(entry => `
                            <tr class="audit-${entry.type.toLowerCase()}">
                                <td class="time">${new Date(entry.timestamp).toLocaleTimeString()}</td>
                                <td class="event">${entry.type}</td>
                                <td class="details">
                                    ${entry.peerId ? `${entry.peerId.substring(0, 8)}...` : ''}
                                    ${entry.peerFingerprint ? ` (${entry.peerFingerprint})` : ''}
                                    ${entry.error ? ` - ${entry.error}` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    }
}

function exportIdentityBackup() {
    if (!window.identityManager) {
        showNotification('Identity manager not available', 'error');
        return;
    }

    const backup = window.identityManager.exportIdentity();
    const backupText = `
INFINITY LINK - IDENTITY BACKUP
================================

IMPORTANT: Save this backup in a secure location!

Recovery Code (Write this down in multiple places):
${backup.recoveryCode}

User ID:
${backup.identity.id}

Username:
${backup.identity.username}

Your Public Key Fingerprint:
${backup.identity.fingerprint || 'Not generated'}

Created: ${backup.identity.created}

Connected Peers:
${backup.peerRegistry.map(p => `  - ${p.name} (${p.fingerprint}) ${p.verified ? '✓ VERIFIED' : '?'}`).join('\n')}

SECURITY NOTES:
- Your private key is NEVER exported and stays in your browser
- The recovery code helps you restore your identity
- Peer fingerprints can be verified out-of-band
- Store this backup safely!
    `;

    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(backupText);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `infinity-backup-${new Date().toISOString().split('T')[0]}.txt`;
    link.click();

    showNotification('✓ Backup exported! Check your downloads folder', 'success');
    console.log('Recovery Code:', backup.recoveryCode);
}

function verifyPeer(peerId) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'verify-peer-modal';
    
    const peer = window.identityManager ? 
        window.identityManager.getPeerIdentity(peerId) : null;
    
    if (!peer) {
        showNotification('Peer not found', 'error');
        return;
    }

    modal.innerHTML = `
        <div class="modal-content verify-modal">
            <div class="modal-header">
                <h2><ion-icon name="shield-checkmark"></ion-icon> Verify Peer</h2>
                <button class="modal-close" onclick="document.getElementById('verify-peer-modal').remove()">
                    <ion-icon name="close"></ion-icon>
                </button>
            </div>
            
            <div class="modal-body">
                <h3>Verify ${peer.name}</h3>
                
                <div class="verify-section">
                    <h4>Step 1: Compare Fingerprints</h4>
                    <p>Ask ${peer.name} to tell you their public key fingerprint.</p>
                    <p>Their fingerprint displayed below should match what they say:</p>
                    <div class="fingerprint-box">
                        <code>${peer.fingerprint.full}</code>
                    </div>
                    <p style="font-size: 0.9em; opacity: 0.7;">Short: <code>${peer.fingerprint.short}</code></p>
                </div>

                <div class="verify-section">
                    <h4>Step 2: Verify Out-of-Band</h4>
                    <p>For maximum security, verify via:</p>
                    <ul>
                        <li>Video call</li>
                        <li>Phone call</li>
                        <li>In-person meeting</li>
                        <li>QR code scan</li>
                    </ul>
                </div>

                <div class="verify-section">
                    <h4>Step 3: Confirm Verification</h4>
                    <p>If the fingerprints match, click verify below:</p>
                    <button class="btn-primary" onclick="completePeerVerification('${peerId}')">
                        <ion-icon name="checkmark-circle"></ion-icon> Verify ${peer.name}
                    </button>
                </div>

                <div class="verify-section">
                    <h3>Zero-Knowledge Proof (Advanced)</h3>
                    <p>Send ${peer.name} this challenge and ask them to sign it with their private key:</p>
                    <button class="btn-secondary" onclick="generateAndDisplayChallenge('${peerId}')">
                        Generate Challenge
                    </button>
                    <div id="challenge-container"></div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function generateAndDisplayChallenge(peerId) {
    if (!window.identityManager) {
        showNotification('Identity manager not available', 'error');
        return;
    }

    window.identityManager.generateChallenge(peerId).then(challenge => {
        const container = document.getElementById('challenge-container');
        container.innerHTML = `
            <div class="challenge-box">
                <p>Send this challenge to ${window.identityManager.getPeerIdentity(peerId).name}:</p>
                <code id="challenge-text">${challenge}</code>
                <button class="btn-copy" onclick="copyToClipboard('challenge-text', this)">
                    <ion-icon name="copy"></ion-icon> Copy Challenge
                </button>
                <p style="font-size: 0.9em; margin-top: 10px;">Ask them to sign this with their private key and send you the signature.</p>
                <input type="text" id="signature-input" placeholder="Paste signature here" style="width: 100%; margin: 10px 0;">
                <button class="btn-primary" onclick="verifySignature('${peerId}')">
                    Verify Signature
                </button>
            </div>
        `;
    });
}

function verifySignature(peerId) {
    if (!window.identityManager) {
        showNotification('Identity manager not available', 'error');
        return;
    }

    const signature = document.getElementById('signature-input').value.trim();
    if (!signature) {
        showNotification('Please paste the signature', 'error');
        return;
    }

    window.identityManager.verifyChallenge(peerId, signature).then(isValid => {
        if (isValid) {
            const peerName = window.identityManager.getPeerIdentity(peerId).name;
            showNotification(`✓ ${peerName} is now verified!`, 'success');
            document.getElementById('verify-peer-modal').remove();
            updateSecurityDashboard();
        } else {
            showNotification('✗ Verification failed. Signature is invalid or expired.', 'error');
        }
    });
}

function completePeerVerification(peerId) {
    if (!window.identityManager) {
        showNotification('Identity manager not available', 'error');
        return;
    }

    const peer = window.identityManager.getPeerIdentity(peerId);
    if (peer.verified) {
        showNotification(`${peer.name} is already verified.`, 'info');
    } else {
        window.identityManager.peerIdentities[peerId].verified = true;
        window.identityManager.peerIdentities[peerId].verifiedAt = new Date().toISOString();
        showNotification(`✓ ${peer.name} is now verified!`, 'success');
        document.getElementById('verify-peer-modal').remove();
        updateSecurityDashboard();
    }
}

// Expose functions
window.showSecurityDashboard = showSecurityDashboard;
window.exportIdentityBackup = exportIdentityBackup;
window.verifyPeer = verifyPeer;
window.completePeerVerification = completePeerVerification;
window.generateAndDisplayChallenge = generateAndDisplayChallenge;
window.verifySignature = verifySignature;
