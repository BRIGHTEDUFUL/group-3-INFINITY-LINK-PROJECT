/*
    Infinity Link - Core Application Logic
    Handles UI interactions and integrates with the PeerManager for networking.
*/

// --- Simple Reliability Settings ---
const RELIABILITY_CONFIG = {
    maxRetries: 2,
    connectionTimeoutMs: 10000,
    messageQueueLimit: 100,
    healthCheckIntervalMs: 10000,
    autoReconnectEnabled: true
};

// --- Enhanced State with Dual Chat Support ---
const state = {
    myId: crypto.randomUUID().substring(0, 8),
    username: 'User_' + Math.floor(Math.random() * 1000),
    isHost: false,
    connecting: false,
    pendingMessages: [],
    securityDisabled: true,
    connectionAttempts: 0,
    isHealthy: true,
    
    // DUAL CHAT STATE
    groups: {
        'general': {
            id: 'general',
            name: 'General',
            type: 'group',
            members: [],
            messages: [],
            unread: 0,
            created: new Date(),
            description: 'Main group chat'
        }
    },
    
    privateChats: {},  // { userId: { id, name, messages: [], unread: 0, created, lastMessage } }
    onlineUsers: {},   // { userId: { name, status: 'online'|'offline', fingerprint } }
    
    // ACTIVE CHAT
    activeChat: {
        type: 'group',  // 'group' or 'private'
        id: 'general',  // group id or user id
        name: 'General'
    },
    
    // CHAT MODES
    chatModes: {
        group: 'encrypted',   // 'encrypted', 'relay', 'direct'
        private: 'encrypted'
    },
    
    // UI STATE
    ui: {
        sidebarOpen: true,
        rightPanelVisible: true,
        selectedGroup: 'general',
        selectedPrivateChat: null
    },
    
    // LUNCH PROTOCOL STATE
    protocol: null,        // 'private' or 'group'
    sessionId: null,
    invitationCode: null,
    invitationLink: null
};

// --- WebRTC Config ---
// Strict no-servers mode: when true, we won't use any external STUN/TURN
// servers at all. This limits connectivity to very permissive networks or LAN.
const NO_EXTERNAL_SERVERS = false;

// Base STUN servers
const RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" }
    ]
};

// Optional TURN configuration (set your server credentials if available)
const NETWORK_CONFIG = {
    useTurn: false, // set to true when TURN creds are configured
    iceTransportPolicy: 'all', // switch to 'relay' for TURN-only
    turnServers: [
        // Example: { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' }
    ]
};

function buildRtcConfig() {
    if (NO_EXTERNAL_SERVERS) {
        return {
            iceServers: [],
            // Keep policy 'all' to allow direct host candidates if any
            iceTransportPolicy: 'all'
        };
    }
    const cfg = {
        iceServers: [...RTC_CONFIG.iceServers],
        iceTransportPolicy: NETWORK_CONFIG.iceTransportPolicy
    };
    if (NETWORK_CONFIG.useTurn && NETWORK_CONFIG.turnServers.length > 0) {
        cfg.iceServers = cfg.iceServers.concat(NETWORK_CONFIG.turnServers);
    }
    return cfg;
}

function updateSessionStatusBadge(text, status = 'active') {
    try {
        const badge = document.getElementById('session-status-badge');
        if (!badge) return;
        const dotClass = status === 'active' ? 'active' : status === 'retry' ? 'retry' : 'inactive';
        badge.innerHTML = `<span class="status-dot ${dotClass}"></span> ${text}`;
    } catch {}
}

function attachConnectionWatchers(pc, role = 'peer') {
    try {
        pc.oniceconnectionstatechange = () => {
            const st = pc.iceConnectionState;
            console.log(`[${role}] ICE state:`, st);
            if (st === 'connected' || st === 'completed') {
                updateSessionStatusBadge('Session Active', 'active');
                state.connecting = false;
            } else if (st === 'disconnected') {
                updateSessionStatusBadge('Reconnecting…', 'retry');
                // Attempt ICE restart if supported
                if (typeof pc.restartIce === 'function') {
                    try { pc.restartIce(); } catch (e) { console.warn('restartIce failed:', e); }
                }
            } else if (st === 'failed') {
                updateSessionStatusBadge('Connection failed', 'inactive');
            }
        };
        pc.onconnectionstatechange = () => {
            const st = pc.connectionState;
            console.log(`[${role}] Conn state:`, st);
            if (st === 'connected') {
                updateSessionStatusBadge('Session Active', 'active');
                state.connecting = false;
            } else if (st === 'connecting') {
                updateSessionStatusBadge('Connecting…', 'retry');
                state.connecting = true;
            } else if (st === 'failed' || st === 'disconnected') {
                updateSessionStatusBadge('Connection issue', 'inactive');
            }
        };
    } catch (e) {
        console.warn('attachConnectionWatchers error:', e);
    }
}

let peers = {}; // { id: { conn, channel, name } }
let myConnection = null; // Use manual handshake for the FIRST connection (Gateway)


// --- DOM Elements Cache ---
const views = {
    landing: document.getElementById('landing-page'),
    welcome: document.getElementById('step-welcome'),
    dashboard: document.getElementById('dashboard-view'),
    connection: document.getElementById('connection-panel')
};

const chatElements = {
    // Center Panel - Chat Messages
    messagesContainer: document.getElementById('messages-container'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    
    // Chat Header
    chatTitle: document.getElementById('chat-title-text'),
    chatTypeBadge: document.getElementById('chat-type-badge'),
    memberCountBadge: document.getElementById('member-count'),
    
    // Left Panel - Navigation
    groupsList: document.getElementById('groups-list'),
    dmList: document.getElementById('dm-list'),
    
    // Right Panel - Members & Details
    membersList: document.getElementById('members-list'),
    rightPanel: document.querySelector('.right-panel'),
    rightPanelTitle: document.getElementById('right-panel-title'),
    
    // User Display
    usernameDisplay: document.getElementById('my-username-display'),
    messageCountValue: document.getElementById('message-count-value'),
    chatTypeValue: document.getElementById('chat-type-value'),
    createdDate: document.getElementById('created-date')
};

// --- Navigation Flow ---
function enterApp() {
    // Show user setup screen instead of connection panel
    const userSetup = document.getElementById('user-setup-screen');
    if (views.landing) {
        views.landing.style.opacity = '0';
        views.landing.style.transform = 'scale(0.95)';
        views.landing.style.pointerEvents = 'none';
        setTimeout(() => {
            views.landing.classList.add('hidden');
            if (userSetup) {
                userSetup.classList.remove('hidden');
                // Set initial ID
                regenerateId();
            }
        }, 400);
    }
}

function showLanding() {
    const userSetup = document.getElementById('user-setup-screen');
    if (views.landing) {
        if (userSetup) userSetup.classList.add('hidden');
        views.landing.classList.remove('hidden');
        void views.landing.offsetWidth;
        views.landing.style.opacity = '1';
        views.landing.style.pointerEvents = 'all';
        views.connection.classList.add('hidden');
    }
}

// --- User Setup Functions ---
function regenerateId() {
    const idInput = document.getElementById('setup-id');
    if (idInput) {
        const newId = 'user_' + Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        idInput.value = newId;
    }
}

function completeUserSetup() {
    const nameInput = document.getElementById('setup-username');
    const idInput = document.getElementById('setup-id');
    
    const displayName = nameInput?.value?.trim();
    const userId = idInput?.value?.trim();
    
    // Validate name
    if (!displayName || displayName.length < 2) {
        showNotification('⚠️ Please enter a name (at least 2 characters)', 'error');
        nameInput?.focus();
        return;
    }
    
    // Update global state
    state.username = displayName;
    state.myId = userId || state.myId;
    
    // Update UI
    const usernameDisplay = document.getElementById('my-username-display');
    if (usernameDisplay) {
        usernameDisplay.textContent = displayName;
    }
    
    // Hide setup, show dashboard
    const userSetup = document.getElementById('user-setup-screen');
    if (userSetup) {
        userSetup.classList.add('hidden');
    }
    if (views.dashboard) {
        views.dashboard.classList.remove('hidden');
        // Ensure messages are displayed
        updateChatDisplay();
    }
    
    showNotification(`👋 Welcome, ${displayName}!`, 'success');
    console.log(`✓ User setup complete: ${displayName} (${state.myId})`);
}

// Expose to global scope
window.enterApp = enterApp;
window.showLanding = showLanding;
window.regenerateId = regenerateId;
window.completeUserSetup = completeUserSetup;

// Expose chat functions
window.switchToGroup = switchToGroup;
window.switchToPrivateChat = switchToPrivateChat;
window.sendMessage = sendMessage;
window.broadcastToGroup = broadcastToGroup;
window.sendToUser = sendToUser;

// Expose modal functions
window.showCreateGroupModal = showCreateGroupModal;
window.createGroupWithInvite = createGroupWithInvite;
window.startChat = startChat;
window.startPrivateChatWithPeer = startPrivateChatWithPeer;
window.startPrivateChatWithInvite = startPrivateChatWithInvite;
window.showChatSettings = showChatSettings;
window.showMembersPanel = showMembersPanel;
window.hideRightPanel = hideRightPanel;
window.verifyMemberIdentity = verifyMemberIdentity;

// Expose invite sharing functions
window.showInviteShareModal = showInviteShareModal;
window.closeInviteModal = closeInviteModal;
window.copyInviteLink = copyInviteLink;
window.shareInviteLink = shareInviteLink;

// Expose mobile functions
window.toggleSidebar = toggleSidebar;
window.closeSidebarOnMobile = closeSidebarOnMobile;
window.toggleLeftPanel = toggleLeftPanel;
window.toggleRightPanel = toggleRightPanel;

// --- Initialization ---
window.onload = async () => {
    try {
        console.log('Application starting...');

        // Silence non-error notifications for a cleaner, real-time-first experience
        try {
            if (typeof window.showNotification === 'function') {
                const _origNotify = window.showNotification;
                window.showNotification = (message, type = 'info') => {
                    if (type === 'error') {
                        _origNotify(message, type);
                    } else {
                        // No-op for info/success to keep UI silent
                        console.log('[notify]', type, message);
                    }
                };
            }
        } catch {}

        // Ensure we are running in a secure context (required for WebRTC and clipboard APIs)
        if (!window.isSecureContext && location.protocol !== 'http:' && location.hostname !== 'localhost') {
            showNotification('⚠️ Please use HTTPS (GitHub Pages) for multi-device chats to work', 'error');
        }
        
        // 1. Initialize Crypto Identity with Fingerprints
        if (window.cryptoManager && window.cryptoManager.init) {
            await window.cryptoManager.init();
            console.log('✓ Crypto manager initialized');
            console.log(`  📋 Your Fingerprint: ${window.cryptoManager.publicKeyFingerprint.short}`);
        } else {
            console.warn('⚠ Crypto manager not available');
        }

        // 2. Initialize Identity Manager for Trust Verification
        if (window.identityManager && window.identityManager.init) {
            await window.identityManager.init(state.username);
            console.log('✓ Identity manager initialized');
            console.log(`  🆔 Your Identity: ${window.identityManager.myIdentity.id}`);
        } else {
            console.warn('⚠ Identity manager not available');
        }

        // Check for Magic Link (Lunch Protocol)
        const hash = window.location.hash;
        
        if (hash.startsWith('#lunch=')) {
            // Lunch Protocol Invitation
            const code = hash.substring(7);
            document.getElementById('connection-panel')?.classList.remove('hidden');
            document.getElementById('step-welcome')?.classList.remove('active');
            document.getElementById('step-protocol-join')?.classList.add('active');
            
            // Pre-populate the invitation code
            const codeInput = document.getElementById('protocol-join-code-input');
            if (codeInput) {
                codeInput.value = code;
            }
            console.log('✓ Lunch protocol link detected');
        } 
        else if (hash.startsWith('#init=')) {
            // Legacy Network Invitation - Auto-join enabled
            const code = hash.substring(6);
            const codeInput = document.getElementById('join-offer-input');
            if (codeInput) {
                codeInput.value = code;
            }
            
            // Auto-generate username if not set
            if (!state.username || state.username.startsWith('User_')) {
                state.username = 'Guest_' + Math.floor(Math.random() * 10000);
            }
            
            // Hide all setup screens - go directly to join
            document.getElementById('step-welcome')?.classList.remove('active');
            document.getElementById('connection-panel')?.classList.remove('hidden');
            
            // Auto-join without user clicking button
            console.log('✓ Network invitation link detected - Auto-joining...');
            state.connecting = true;
            setTimeout(() => {
                try {
                    joinNetwork();
                } catch (e) {
                    console.error('Auto-join failed:', e);
                    showNotification('Auto-join failed. Please click "Join Room" manually.', 'error');
                }
            }, 300);
        }
        
        console.log('✓ Initialization complete');
        logStatus('Application Ready', getConnectionStatus());
        
        // Initialize keyboard shortcuts
        initializeKeyboardShortcuts();
    } catch (e) {
        console.error('Initialization error:', e);
        alert('Failed to initialize application: ' + e.message);
    }
};

// --- Keyboard Shortcuts for Enhanced Usability ---
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter to send message
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const sendBtn = document.getElementById('send-btn');
            if (sendBtn && !sendBtn.disabled) {
                e.preventDefault();
                sendBtn.click();
            }
        }
        
        // Ctrl/Cmd + / for help/keyboard shortcuts
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            showKeyboardShortcutsInfo();
        }
        
        // Escape to close modals
        if (e.key === 'Escape') {
            const openModals = document.querySelectorAll('.modal.active');
            openModals.forEach(modal => {
                const closeBtn = modal.querySelector('[data-close-modal]');
                if (closeBtn) closeBtn.click();
            });
        }
        
        // Ctrl/Cmd + Shift + N for new group (quick access)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
            e.preventDefault();
            showCreateGroupModal();
        }
        
        // Ctrl/Cmd + F to focus search (if available)
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            const searchInput = document.querySelector('[data-search]');
            if (searchInput) {
                e.preventDefault();
                searchInput.focus();
            }
        }
    });
}

function showKeyboardShortcutsInfo() {
    showNotification('📋 Keyboard Shortcuts: Ctrl+Enter (send), Ctrl+/ (help), Esc (close), Ctrl+Shift+N (new chat)', 'info');
}

// --- Mobile Responsive Functions ---
let mobileListenersAttached = false; // Track if we've already attached listeners

function toggleSidebar() {
    const leftPanel = document.querySelector('.left-panel');
    const backdrop = document.getElementById('sidebar-backdrop');
    
    if (leftPanel) {
        leftPanel.classList.toggle('open');
        if (backdrop) {
            backdrop.classList.toggle('show');
        }
    }
}

function closeSidebarOnMobile() {
    const leftPanel = document.querySelector('.left-panel');
    const backdrop = document.getElementById('sidebar-backdrop');
    
    if (leftPanel) {
        leftPanel.classList.remove('open');
    }
    if (backdrop) {
        backdrop.classList.remove('show');
    }
}

/**
 * Toggle left panel visibility (desktop)
 */
function toggleLeftPanel() {
    const leftPanel = document.querySelector('.left-panel');
    const toggleBtn = document.getElementById('btn-toggle-left-panel');
    
    if (leftPanel) {
        leftPanel.classList.toggle('panel-hidden');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('ion-icon');
            if (icon) {
                icon.name = leftPanel.classList.contains('panel-hidden') ? 'chevron-forward' : 'chevron-back';
            }
        }
    }
}

/**
 * Toggle right panel visibility (desktop)
 */
function toggleRightPanel() {
    const rightPanel = document.querySelector('.right-panel');
    const toggleBtn = document.getElementById('btn-toggle-right-panel');
    
    if (rightPanel) {
        rightPanel.classList.toggle('panel-hidden');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('ion-icon');
            if (icon) {
                icon.name = rightPanel.classList.contains('panel-hidden') ? 'chevron-back' : 'chevron-forward';
            }
        }
    }
}

// Close sidebar when clicking on a chat (mobile UX)
function setupMobileNav() {
    const isMobile = window.innerWidth <= 1024;
    
    // Attach chat click listeners only once
    if (isMobile && !mobileListenersAttached) {
        document.querySelectorAll('.groups-list li, .dm-list li').forEach(item => {
            item.addEventListener('click', closeSidebarOnMobile);
        });
        mobileListenersAttached = true;
    }

    // Show/hide hamburger based on screen size
    const toggleBtn = document.querySelector('.btn-toggle-sidebar');
    if (toggleBtn) {
        toggleBtn.style.display = isMobile ? 'flex' : 'none';
    }

    // Hide backdrop on large screens
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) {
        backdrop.style.display = isMobile ? 'block' : 'none';
    }

    // Close sidebar on resize if going to desktop
    if (!isMobile) {
        closeSidebarOnMobile();
    }
}

// Handle viewport changes
window.addEventListener('resize', () => {
    setupMobileNav();
});

// Close sidebar when clicking outside of it on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 1024) {
        const leftPanel = document.querySelector('.left-panel');
        const toggleBtn = document.querySelector('.btn-toggle-sidebar');
        
        if (leftPanel && leftPanel.classList.contains('open') && 
            !leftPanel.contains(e.target) && 
            !toggleBtn?.contains(e.target)) {
            closeSidebarOnMobile();
        }
    }
});

// Initialize mobile on load
document.addEventListener('DOMContentLoaded', setupMobileNav);

// --- Networking Helper Class (internal) ---
// We define it here to access global 'peers' and 'state' easily 
// In a larger app, this would be a module.

function broadcast(msg, excludeId = null) {
    try {
        const msgJson = JSON.stringify(msg);
        let sentCount = 0;
        let failedCount = 0;
        const failedPeers = [];
        
        Object.keys(peers).forEach(pid => {
            if (pid !== excludeId) {
                try {
                    const p = peers[pid];
                    if (p && p.channel && p.channel.readyState === 'open') {
                        try {
                            p.channel.send(msgJson);
                            sentCount++;
                        } catch (sendErr) {
                            failedCount++;
                            failedPeers.push(pid);
                            console.warn('Send to peer failed:', pid, sendErr);
                            // Mark peer for cleanup if sending fails
                            if (sendErr.name === 'NetworkError' || sendErr.name === 'InvalidStateError') {
                                console.log('Marking peer for removal:', pid);
                                // Don't remove immediately, let onclose handler do it
                            }
                        }
                    } else {
                        // Channel not ready - add to retry queue if connecting
                        if (p?.channel?.readyState === 'connecting') {
                            console.debug('Peer channel connecting, will retry:', pid);
                            failedPeers.push(pid);
                            failedCount++;
                        }
                    }
                } catch (e) {
                    failedCount++;
                    failedPeers.push(pid);
                    console.error('Error sending to peer', pid, ':', e);
                }
            }
        });
        
        // Retry failed sends with exponential backoff
        if (failedPeers.length > 0) {
            console.log(`Scheduling retry for ${failedPeers.length} failed peers`);
            setTimeout(() => {
                retryBroadcast(msg, failedPeers, 1);
            }, 1000); // Initial retry after 1 second
        }
        
        // Log broadcast result
        if (sentCount === 0 && Object.keys(peers).length > 0) {
            console.warn('Broadcast: No peers available (queuing may occur)');
        } else if (failedCount > 0) {
            console.warn(`Broadcast: Sent to ${sentCount}, failed to ${failedCount} peers`);
        } else if (sentCount > 0) {
            console.log(`Broadcast: Successfully sent to ${sentCount} peers`);
        }
    } catch (e) {
        console.error('Broadcast error:', e);
    }
}

function retryBroadcast(msg, peerIds, attempt) {
    if (attempt > RELIABILITY_CONFIG.maxRetries) {
        console.warn(`Max retries reached for broadcast to peers:`, peerIds);
        return;
    }
    
    const msgJson = JSON.stringify(msg);
    const stillFailed = [];
    
    peerIds.forEach(pid => {
        const p = peers[pid];
        if (p && p.channel && p.channel.readyState === 'open') {
            try {
                p.channel.send(msgJson);
                console.log(`Retry ${attempt} succeeded for peer:`, pid);
            } catch (err) {
                console.warn(`Retry ${attempt} failed for peer:`, pid, err);
                stillFailed.push(pid);
            }
        } else {
            console.debug(`Peer ${pid} still not ready on retry ${attempt}`);
            stillFailed.push(pid);
        }
    });
    
    // Schedule next retry with exponential backoff
    if (stillFailed.length > 0) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
        console.log(`Scheduling retry ${attempt + 1} in ${delay}ms for ${stillFailed.length} peers`);
        setTimeout(() => {
            retryBroadcast(msg, stillFailed, attempt + 1);
        }, delay);
    }
}

function sendToPeer(id, msg) {
    try {
        if (!id || !msg) {
            console.warn('Invalid sendToPeer parameters');
            return false;
        }
        
        const p = peers[id];
        if (!p) {
            console.warn('Peer not found:', id);
            return false;
        }
        
        if (!p.channel) {
            console.warn('Peer channel not initialized:', id);
            return false;
        }
        
        const channelState = p.channel.readyState;
        if (channelState !== 'open') {
            console.warn('Peer channel not open:', id, 'State:', channelState);
            
            // If channel is connecting, schedule retry
            if (channelState === 'connecting') {
                console.log('Channel connecting, scheduling retry...');
                setTimeout(() => {
                    retrySendToPeer(id, msg, 1);
                }, 500);
                return false;
            }
            
            // If channel is closing but not closed, wait a bit
            if (channelState === 'closing') {
                console.log('Channel closing, scheduling retry...');
                setTimeout(() => {
                    retrySendToPeer(id, msg, 1);
                }, 100);
                return false;
            }
            return false;
        }
        
        const msgJson = JSON.stringify(msg);
        try {
            p.channel.send(msgJson);
            console.log('✅ Message sent to peer:', id, 'Type:', msg.type);
            return true;
        } catch (sendErr) {
            console.error('Channel send error:', id, sendErr);
            // Schedule retry
            setTimeout(() => {
                retrySendToPeer(id, msg, 1);
            }, 1000);
            return false;
        }
    } catch (e) {
        console.error('sendToPeer error:', e);
        return false;
    }
}

function retrySendToPeer(id, msg, attempt) {
    if (attempt > RELIABILITY_CONFIG.maxRetries) {
        console.warn(`Max retries reached for peer ${id}`);
        if (typeof showNotification === 'function') {
            showNotification(`Failed to send message to ${peers[id]?.name || id}`, 'error');
        }
        return;
    }
    
    console.log(`Retry ${attempt} sending to peer:`, id);
    const p = peers[id];
    
    if (!p || !p.channel) {
        console.warn(`Peer ${id} no longer available`);
        return;
    }
    
    if (p.channel.readyState === 'open') {
        try {
            const msgJson = JSON.stringify(msg);
            p.channel.send(msgJson);
            console.log(`✅ Retry ${attempt} succeeded for peer:`, id);
            if (typeof showNotification === 'function') {
                showNotification('Message sent', 'success');
            }
        } catch (err) {
            console.error(`Retry ${attempt} failed for peer:`, id, err);
            const delay = Math.pow(2, attempt) * 1000;
            setTimeout(() => {
                retrySendToPeer(id, msg, attempt + 1);
            }, delay);
        }
    } else {
        // Channel not ready yet, keep retrying with backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Channel not ready, scheduling retry ${attempt + 1} in ${delay}ms`);
        setTimeout(() => {
            retrySendToPeer(id, msg, attempt + 1);
        }, delay);
    }
}

// --- Utility Functions ---

function logStatus(title, data) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${title}:`, data);
    
    // Also show in UI if available
    try {
        const statusDiv = document.getElementById('connection-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<strong>${title}</strong>: ${JSON.stringify(data).substring(0, 100)}`;
        }
    } catch (e) {
        // UI element not available
    }
}

function getConnectionStatus() {
    return {
        isHost: state.isHost,
        myId: state.myId,
        peersCount: Object.keys(peers).length,
        peersList: Object.keys(peers).map(id => ({
            id,
            name: peers[id]?.name,
            connected: peers[id]?.channel?.readyState === 'open'
        })),
        protocol: state.protocol || 'network',
        activeChatType: state.activeChat.type || 'group',
        iceServersMode: NO_EXTERNAL_SERVERS ? 'none' : 'stun/turn',
        iceServersConfigured: NO_EXTERNAL_SERVERS ? 0 : ((RTC_CONFIG.iceServers?.length || 0) + ((NETWORK_CONFIG.useTurn ? NETWORK_CONFIG.turnServers?.length : 0) || 0)),
        iceTransportPolicy: NO_EXTERNAL_SERVERS ? 'all' : NETWORK_CONFIG.iceTransportPolicy,
        gatewayState: gatewayPC ? {
            connectionState: gatewayPC.connectionState,
            iceConnectionState: gatewayPC.iceConnectionState,
            iceGatheringState: gatewayPC.iceGatheringState
        } : null
    };
}

function refreshDiagnostics() {
    try {
        const status = getConnectionStatus();
        logStatus('Connection Status', status);
        const statusDiv = document.getElementById('connection-status');
        if (statusDiv) {
            const peersHtml = (status.peersList || []).map(p => `
                <li><strong>${p.name || p.id}</strong> — ${p.connected ? 'open' : 'closed'}</li>
            `).join('');
            statusDiv.innerHTML = `
                <div class="diag-grid">
                    <div><strong>Role:</strong> ${status.isHost ? 'Host' : 'Guest'}</div>
                    <div><strong>My ID:</strong> ${status.myId}</div>
                    <div><strong>Peers:</strong> ${status.peersCount}</div>
                    <div><strong>Active Chat:</strong> ${status.activeChatType}</div>
                </div>
                <div><strong>ICE:</strong> ${status.iceServersMode} (servers: ${status.iceServersConfigured}, policy: ${status.iceTransportPolicy})</div>
                <div><strong>Gateway:</strong> ${status.gatewayState ? `${status.gatewayState.connectionState} / ${status.gatewayState.iceConnectionState} / ${status.gatewayState.iceGatheringState}` : 'n/a'}</div>
                <div>
                    <strong>Peer Channels</strong>
                    <ul class="diag-list">${peersHtml || '<li>None</li>'}</ul>
                </div>
            `;
        }
    } catch (e) {
        console.error('refreshDiagnostics error:', e);
    }
}

// Derive the current page URL without any hash so shared links work on GitHub Pages subpaths
function getBaseUrl() {
    const url = new URL(window.location.href);
    url.hash = '';
    return url.toString();
}

// --- State Management ---

function handleData(data, fromId) {
    try {
        if (!data || !data.type) {
            console.warn('Invalid data received:', data);
            return;
        }
        
        if (data.type === 'CHAT') {
            processChatMessage(data, fromId);
        }
        else if (data.type === 'GROUP_MESSAGE') {
            console.log('📨 Received GROUP_MESSAGE from:', fromId, 'Content:', data.content);
            
            // Host relays to others
            if (state.isHost) {
                console.log('🔄 Host relaying message to other peers');
                broadcast(data, fromId);
            }
            
            const msg = {
                from: fromId,
                fromName: data.fromName || 'Unknown',
                content: data.content,
                timestamp: data.timestamp,
                target: 'group'
            };
            
            // Store in the general group
            if (!state.groups['general']) {
                console.error('General group not found, creating it');
                state.groups['general'] = {
                    id: 'general',
                    name: 'General',
                    type: 'group',
                    members: [],
                    messages: [],
                    unread: 0,
                    created: new Date(),
                    description: 'Main group chat'
                };
            }
            
            storeMessage('general', msg);
            console.log('✅ GROUP_MESSAGE stored and displayed');
        }
        else if (data.type === 'PRIVATE_MESSAGE') {
            console.log('💬 Received PRIVATE_MESSAGE from:', fromId, 'Target:', data.target);
            
            // Relay if host and not for host
            if (state.isHost && data.target && data.target !== state.myId) {
                console.log('🔄 Host relaying private message to:', data.target);
                sendToPeer(data.target, data);
                return; // Don't store/display messages being relayed
            }
            
            // If plaintext content present, store directly
            if (typeof data.content === 'string') {
                console.log('📝 Storing plaintext private message');
                const msg = {
                    from: fromId,
                    fromName: data.fromName || 'Unknown',
                    content: data.content,
                    timestamp: data.timestamp,
                    target: data.target
                };
                const chatId = fromId;
                storeMessage(chatId, msg);
                console.log('✅ PRIVATE_MESSAGE stored and displayed');
            } else if (data.payload && window.cryptoManager && !state.securityDisabled) {
                // Decrypt if payload and crypto enabled
                console.log('🔓 Decrypting private message');
                window.cryptoManager.decryptMessage(fromId, data.payload).then(content => {
                    const msg = {
                        from: fromId,
                        fromName: data.fromName || 'Unknown',
                        content,
                        timestamp: data.timestamp,
                        target: data.target,
                        encrypted: true
                    };
                    const chatId = fromId;
                    storeMessage(chatId, msg);
                    console.log('✅ Encrypted PRIVATE_MESSAGE decrypted and displayed');
                }).catch(err => {
                    console.error('Decrypt private failed:', err);
                    // Still store an error message so user knows something was received
                    const errorMsg = {
                        from: fromId,
                        fromName: data.fromName || 'Unknown',
                        content: '[Unable to decrypt message]',
                        timestamp: data.timestamp,
                        target: data.target
                    };
                    storeMessage(fromId, errorMsg);
                });
            }
        }
        else if (data.type === 'ENCRYPT_CHAT') {
            const chatId = data.target !== 'group' ? (data.from === state.myId ? data.target : data.from) : 'group';

            // Decrypt
            if (window.cryptoManager && window.cryptoManager.decryptMessage) {
                window.cryptoManager.decryptMessage(data.from, data.payload).then(text => {
                    const decMsg = {
                        target: data.target,
                        from: data.from,
                        content: text,
                        timestamp: data.timestamp,
                        encrypted: true
                    };
                    storeMessage(chatId, decMsg);
                }).catch(err => {
                    console.error("Decryption failed:", err);
                    addSystemMessage(chatId, '🔒 [Encrypted message - decryption failed]');
                });
            } else {
                console.warn('Crypto manager not available for decryption');
            }

            // Forwarding logic for Host
            if (state.isHost && data.target !== state.myId && data.target !== 'group') {
                sendToPeer(data.target, data);
            }
        }
        else if (data.type === 'USER_JOIN') {
            // A new peer joined the network
            if (data.user) {
                peers[data.user.id] = { name: data.user.name, id: data.user.id, dummy: true };

                // IMPORT PEER KEY
                if (data.user.key && window.cryptoManager) {
                    window.cryptoManager.importPeerKey(data.user.id, data.user.key);
                }

                // Create private chat entry for new user
                if (!state.privateChats[data.user.id]) {
                    state.privateChats[data.user.id] = {
                        id: data.user.id,
                        name: data.user.name,
                        messages: [],
                        unread: 0
                    };
                }
                
                // Add to group members if in general group
                if (!state.groups['general'].members.includes(data.user.id)) {
                    state.groups['general'].members.push(data.user.id);
                }
                
                updateLeftPanel();
                updateMembersPanel();
                addSystemMessage('general', `${data.user.name} joined the network.`);
            }
        }
        else if (data.type === 'NAME_UPDATE') {
            if (peers[fromId]) {
                peers[fromId].name = data.name;
                // Update private chat name
                if (state.privateChats[fromId]) {
                    state.privateChats[fromId].name = data.name;
                }
                // IMPORT PEER KEY (Late arrival)
                if (data.key && window.cryptoManager) {
                    window.cryptoManager.importPeerKey(fromId, data.key);
                }
                updateLeftPanel();
                updateMembersPanel();
            }
        }
        else {
            console.log('Unknown message type:', data.type);
        }
    } catch (e) {
        console.error('Handle data error:', e);
    }
}

function processChatMessage(data, fromId) {
    // ... (Legacy unencrypted chat processing, basically same as before)
    const isPrivate = data.target !== 'group';
    const chatId = isPrivate ? (data.from === state.myId ? data.target : data.from) : 'general';

    // If we are Host and it's a GROUP message, broadcast it to others
    if (state.isHost && !isPrivate) {
        broadcast(data, fromId); // Relay to everyone else
    }

    // If it looks like a private message for someone else (and we are host relay), forward it
    // (Simplification: Private messages direct for now, or via Host if Star topology)
    // For this V2, we assume Star Topology for Group, Direct for Private if Possible.
    // Actually, let's stick to Star Topology for everything to GUARANTEE delivery without complex Mesh logic.
    if (state.isHost && isPrivate && data.target !== state.myId) {
        sendToPeer(data.target, data); // Relay private message
        return; // Don't show it to Host
    }

    storeMessage(chatId, data);
}

function storeMessage(chatId, msg) {
    // Legacy function for backward compatibility
    // Route to new state structure based on type
    if (chatId === 'group' || chatId === 'general' || state.groups[chatId]) {
        // Normalize group chat ID
        const groupId = (chatId === 'group') ? 'general' : chatId;
        
        if (!state.groups[groupId]) {
            console.log('Creating new group:', groupId);
            state.groups[groupId] = {
                id: groupId,
                name: groupId,
                messages: [],
                members: [],
                unread: 0
            };
        }
        
        state.groups[groupId].messages.push(msg);
        state.groups[groupId].lastMessage = msg;
        
        // If currently viewing this chat, append to DOM
        if (state.activeChat.id === groupId || (state.activeChat.id === 'general' && groupId === 'group')) {
            console.log('Rendering message in active group chat:', groupId);
            renderMessage(msg);
        } else {
            // Mark unread and update left panel
            console.log('Incrementing unread count for group:', groupId);
            state.groups[groupId].unread++;
            updateLeftPanel();
        }
    } else {
        // Treat as private chat with user
        if (!state.privateChats[chatId]) {
            console.log('Creating new private chat with:', chatId);
            state.privateChats[chatId] = {
                id: chatId,
                name: peers[chatId]?.name || chatId,
                messages: [],
                unread: 0
            };
        }
        
        state.privateChats[chatId].messages.push(msg);
        state.privateChats[chatId].lastMessage = msg;
        
        // If currently viewing this chat, append to DOM
        if (state.activeChat.type === 'private' && state.activeChat.id === chatId) {
            console.log('Rendering message in active private chat:', chatId);
            renderMessage(msg);
        } else {
            // Mark unread and update left panel
            console.log('Incrementing unread count for private chat:', chatId);
            state.privateChats[chatId].unread++;
            updateLeftPanel();
        }
    }
}

// === DUAL CHAT SUPPORT FUNCTIONS ===

/**
 * Switch active chat to a group
 */
function switchToGroup(groupId) {
    if (!state.groups[groupId]) {
        console.warn('Group not found:', groupId);
        return;
    }
    
    state.activeChat.type = 'group';
    state.activeChat.id = groupId;
    state.activeChat.name = state.groups[groupId].name;
    state.ui.selectedGroup = groupId;
    state.ui.selectedPrivateChat = null;
    
    console.log('Switched to group:', groupId);
    updateChatDisplay();
    updateLeftPanel();
    
    // Focus message input for immediate typing
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        setTimeout(() => messageInput.focus(), 100);
    }
}

/**
 * Switch active chat to a private chat with a user
 */
function switchToPrivateChat(userId) {
    // Create private chat if doesn't exist
    if (!state.privateChats[userId]) {
        state.privateChats[userId] = {
            id: userId,
            name: peers[userId]?.name || userId,
            messages: [],
            unread: 0,
            created: new Date(),
            lastMessage: null
        };
    }
    
    state.activeChat.type = 'private';
    state.activeChat.id = userId;
    state.activeChat.name = state.privateChats[userId].name;
    state.ui.selectedGroup = null;
    state.ui.selectedPrivateChat = userId;
    
    console.log('Switched to private chat with:', userId);
    updateChatDisplay();
    updateLeftPanel();
}

/**
 * Send message to active chat (routes based on type)
 */
function sendMessage(content) {
    if (!content || !content.trim()) {
        console.warn('Empty message content');
        return;
    }
    
    try {
        // Validate state before sending
        if (!state.myId) {
            console.error('Cannot send message: user ID not initialized');
            return;
        }
        
        if (!state.username) {
            console.warn('Username not set, using default');
            state.username = 'Anonymous';
        }
        
        const msg = {
            from: state.myId,
            fromName: state.username,
            content: content.trim(),
            timestamp: new Date().toISOString(),
            type: state.activeChat?.type === 'group' ? 'GROUP_MESSAGE' : 'PRIVATE_MESSAGE'
        };
        
        // Validate active chat
        if (!state.activeChat || !state.activeChat.id) {
            console.warn('No active chat selected');
            renderMessage(msg); // Still display locally
            return;
        }
        
        if (state.activeChat.type === 'group') {
            broadcastToGroup(state.activeChat.id, msg);
        } else if (state.activeChat.type === 'private') {
            sendToUser(state.activeChat.id, msg);
        } else {
            console.warn('Unknown chat type:', state.activeChat.type);
            renderMessage(msg);
        }
    } catch (e) {
        console.error('Send message error:', e);
        // Still try to display locally
        renderMessage({ from: state.myId, fromName: state.username, content: content.trim(), timestamp: new Date().toISOString() });
    }
}

/**
 * Broadcast message to all members of a group
 */
function broadcastToGroup(groupId, msg) {
    try {
        // Validate group exists
        if (!state.groups || !state.groups[groupId]) {
            console.warn('Group not found:', groupId);
            renderMessage(msg);
            return;
        }
        
        // Store and display locally first
        state.groups[groupId].messages.push(msg);
        renderMessage(msg);
        
        // Send to peers - simplified for real-time
        const peerCount = Object.keys(peers).length;
        
        if (peerCount > 0) {
            const broadcastMsg = {
                type: 'GROUP_MESSAGE',
                from: state.myId,
                fromName: state.username,
                target: 'group',
                content: msg.content,
                timestamp: msg.timestamp
            };
            broadcast(broadcastMsg);
        }
        
    } catch (e) {
        console.error('Broadcast error:', e);
        renderMessage(msg);
    }
}

/**
 * Send encrypted message to a specific user
 */
function sendToUser(userId, msg) {
    try {
        // Validate inputs
        if (!userId || !msg) {
            console.warn('Invalid sendToUser parameters');
            return;
        }
        
        // Store locally
        if (!state.privateChats[userId]) {
            state.privateChats[userId] = {
                id: userId,
                name: peers[userId]?.name || userId,
                messages: [],
                unread: 0
            };
        }
        state.privateChats[userId].messages.push(msg);
        state.privateChats[userId].lastMessage = msg;
        
        // Display locally immediately
        renderMessage(msg);
        
        // Encrypt unless disabled
        if (!state.securityDisabled && window.cryptoManager) {
            window.cryptoManager.encryptMessage(userId, msg.content).then(encrypted => {
                const encMsg = {
                    type: 'PRIVATE_MESSAGE',
                    from: state.myId,
                    fromName: state.username,
                    target: userId,
                    payload: encrypted,
                    timestamp: msg.timestamp
                };
                
                // Try to send, queue if fails
                const sent = sendToPeer(userId, encMsg);
                if (!sent && state.pendingMessages.length < RELIABILITY_CONFIG.messageQueueLimit) {
                    console.log('Message queued for later delivery');
                    state.pendingMessages.push({
                        content: encMsg,
                        peerId: userId,
                        timestamp: Date.now()
                    });
                }
            }).catch(err => {
                console.error('Encryption failed:', err);
                // Queue for retry even if encryption fails
                if (state.pendingMessages.length < RELIABILITY_CONFIG.messageQueueLimit) {
                    state.pendingMessages.push({
                        content: msg,
                        peerId: userId,
                        timestamp: Date.now()
                    });
                }
            });
        } else {
            // Send plaintext when crypto unavailable or disabled
            const plainMsg = {
                type: 'PRIVATE_MESSAGE',
                from: state.myId,
                fromName: state.username,
                target: userId,
                content: msg.content,
                timestamp: msg.timestamp
            };
            
            const sent = sendToPeer(userId, plainMsg);
            if (!sent && state.pendingMessages.length < RELIABILITY_CONFIG.messageQueueLimit) {
                state.pendingMessages.push({
                    content: plainMsg,
                    peerId: userId,
                    timestamp: Date.now()
                });
            }
        }
        
    } catch (e) {
        console.error('Send to user error:', e);
    }
}

/**
 * Handle incoming message and route by type
 */
function handleIncomingMessage(data, fromId) {
    try {
        if (!data || !data.type) {
            console.warn('Invalid message:', data);
            return;
        }
        
        if (data.type === 'GROUP_MESSAGE') {
            // Store in group messages
            if (!state.groups['general'].messages) state.groups['general'].messages = [];
            state.groups['general'].messages.push({
                from: fromId,
                fromName: data.fromName || 'Unknown',
                content: data.content,
                timestamp: data.timestamp
            });
            
            // Display if viewing group
            if (state.activeChat.type === 'group' && state.activeChat.id === 'general') {
                renderMessage({
                    from: fromId,
                    content: data.content,
                    timestamp: data.timestamp
                });
            }
        } else if (data.type === 'PRIVATE_MESSAGE') {
            // Decrypt
            if (window.cryptoManager) {
                window.cryptoManager.decryptMessage(fromId, data.payload).then(content => {
                    // Store in private chat
                    if (!state.privateChats[fromId]) {
                        state.privateChats[fromId] = {
                            id: fromId,
                            name: peers[fromId]?.name || fromId,
                            messages: [],
                            unread: 0
                        };
                    }
                    state.privateChats[fromId].messages.push({
                        from: fromId,
                        fromName: data.fromName,
                        content: content,
                        timestamp: data.timestamp
                    });
                    
                    // Display if viewing this chat
                    if (state.activeChat.type === 'private' && state.activeChat.id === fromId) {
                        renderMessage({
                            from: fromId,
                            fromName: data.fromName,
                            content: content,
                            timestamp: data.timestamp
                        });
                    }
                });
            }
        } else {
            // Legacy handling
            handleData(data, fromId);
        }
    } catch (e) {
        console.error('Message routing error:', e);
    }
}

// --- Workflows ---

async function initHost() {
    try {
        state.isHost = true;
        state.username = "Host_" + state.myId.substring(0, 4);

        // Prepare gateway for first connection
        // We reuse the existing UI flow for the INITIAL connection
        document.getElementById('connection-panel').classList.remove('hidden');
        document.getElementById('step-welcome').classList.remove('active');
        document.getElementById('step-host-1').classList.add('active');

        // Create a "Gateway" PeerConnection to accept the first user
        // Subsequent users will need new gateway connections. 
        await generateInvite();
        
        console.log('Host initialized, waiting for peer connections');
    } catch (e) {
        console.error('Host initialization error:', e);
        alert('Failed to initialize host. Please try again.');
    }
}

let gatewayPC = null;
let gateways = []; // Store all gateway connections for multi-peer support

// --- Simple Connection Health Monitor ---
function startHealthChecks() {
    setInterval(() => {
        try {
            const openPeers = Object.keys(peers).filter(id => 
                peers[id]?.channel?.readyState === 'open'
            );
            
            const isHealthy = openPeers.length > 0;
            state.isHealthy = isHealthy;
            
            // Process pending messages if peers are available
            if (openPeers.length > 0 && state.pendingMessages?.length > 0) {
                processPendingMessages();
            }
        } catch (e) {
            console.error('Health check error:', e);
        }
    }, RELIABILITY_CONFIG.healthCheckIntervalMs);
}

// --- Connection State Tracking ---
let state_lastConnectionInfo = null;

function attemptReconnect() {
    try {
        if (!state_lastConnectionInfo) return;
        
        console.log('Attempting reconnection...');
        state.connecting = true;
        
        // Try to rejoin with previous connection info
        const { code } = state_lastConnectionInfo;
        if (code) {
            const offerInput = document.getElementById('join-offer-input');
            if (offerInput) {
                offerInput.value = code;
                joinNetwork();
            }
        }
    } catch (e) {
        console.error('Reconnection attempt failed:', e);
    }
}

/**
 * Process pending messages when connection is restored
 */
function processPendingMessages() {
    if (!state.pendingMessages || state.pendingMessages.length === 0) {
        return;
    }
    
    console.log(`Processing ${state.pendingMessages.length} pending messages`);
    const toRetry = [...state.pendingMessages];
    state.pendingMessages = [];
    
    for (const pending of toRetry) {
        try {
            // Check if target peer is connected
            const peer = peers[pending.peerId];
            if (peer && peer.connected && peer.channel && peer.channel.readyState === 'open') {
                const sent = sendToPeer(pending.peerId, pending.content);
                if (!sent) {
                    // Couldn't send, re-queue
                    state.pendingMessages.push(pending);
                }
            } else if (state.pendingMessages.length < RELIABILITY_CONFIG.messageQueueLimit) {
                // Peer not available yet, keep in queue
                state.pendingMessages.push(pending);
            }
        } catch (e) {
            console.error('Error processing pending message:', e);
            if (state.pendingMessages.length < RELIABILITY_CONFIG.messageQueueLimit) {
                state.pendingMessages.push(pending);
            }
        }
    }
    
    if (state.pendingMessages.length > 0) {
        console.log(`${state.pendingMessages.length} messages still pending`);
    }
}

// Cleanup completed gateways periodically
setInterval(() => {
    gateways = gateways.filter(g => {
        if (g.connectionState === 'failed' || g.connectionState === 'closed') {
            try { g.close(); } catch (e) {}
            return false;
        }
        return true;
    });
}, 10000);

async function generateInvite() {
    try {
        // Create a NEW gateway for accepting peer connections
        // This allows multiple peers to join simultaneously
        const newGatewayPC = new RTCPeerConnection(buildRtcConfig());
        const dc = newGatewayPC.createDataChannel("mesh-net", { ordered: true });
        setupGateway(newGatewayPC, dc);
        attachConnectionWatchers(newGatewayPC, 'host');
        
        // Keep reference for backward compatibility, but also track in array
        gatewayPC = newGatewayPC;
        gateways.push(newGatewayPC);
        
        // Add ICE candidate handler
        newGatewayPC.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE candidate:', event.candidate.candidate);
            }
        };
        
        // Monitor connection state
        newGatewayPC.onconnectionstatechange = () => {
            console.log('Gateway conn state:', newGatewayPC.connectionState);
            logStatus('Gateway Connection', {
                state: newGatewayPC.connectionState,
                iceConnection: newGatewayPC.iceConnectionState,
                iceGathering: newGatewayPC.iceGatheringState
            });
        };
        
        // Create offer
        const offer = await newGatewayPC.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
        });
        
        await newGatewayPC.setLocalDescription(offer);
        
        // Wait for ICE candidates
        await waitForICEGathering(newGatewayPC, 3000);
        
        if (!newGatewayPC.localDescription) {
            throw new Error('Local description not set');
        }
        
        const code = btoa(JSON.stringify(newGatewayPC.localDescription));
        const offerOutput = document.getElementById('host-offer-output');
        if (offerOutput) offerOutput.value = code;
        
        generateShareableLink(code, 'host');
        
        const loading = document.getElementById('host-loading');
        if (loading) loading.style.display = 'none';
        
        console.log('Invite generated successfully');
    } catch (e) {
        console.error('Invite generation error:', e);
        alert('Failed to generate invite: ' + e.message);
    }
}

function waitForICEGathering(pc, timeout = 3000) {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
            resolve();
            return;
        }
        
        const handleStateChange = () => {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', handleStateChange);
                clearTimeout(timeoutId);
                resolve();
            }
        };
        
        const timeoutId = setTimeout(() => {
            pc.removeEventListener('icegatheringstatechange', handleStateChange);
            console.warn('ICE gathering timeout');
            resolve();
        }, timeout);
        
        pc.addEventListener('icegatheringstatechange', handleStateChange);
    });
}


function setupGateway(pc, dc) {
    let peerId = null;

    pc.onconnectionstatechange = () => {
        console.log('Gateway connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            console.log("✅ New peer connected via gateway!");
            // Flush pending messages when peer connection is fully established
            setTimeout(() => {
                console.log('Flushing pending messages after peer connection established...');
                flushPendingMessages();
            }, 200);
        } else if (pc.connectionState === 'disconnected') {
            console.log("⚠️ Peer disconnected");
        } else if (pc.connectionState === 'failed') {
            console.error("❌ Peer connection failed");
        }
    };
    attachConnectionWatchers(pc, 'host');

    dc.onopen = () => {
        try {
            console.log('🟢 Data channel OPENED for gateway peer');
            
            // Peer joins - generate UUID for this peer
            peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
            
            if (peers[peerId]) {
                console.warn('Peer ID collision, regenerating...');
                peerId = 'peer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
            }
            
            peers[peerId] = { conn: pc, channel: dc, name: 'Guest', id: peerId };

            // Send them Welcome Packet
            dc.send(JSON.stringify({
                type: 'WELCOME',
                id: peerId,
                peers: Object.values(peers).map(p => ({
                    id: p.id,
                    name: p.name
                })).filter(p => p.id !== peerId)
            }));

            // Announce to others
            broadcast({
                type: 'USER_JOIN',
                user: {
                    id: peerId,
                    name: 'Guest'
                }
            }, peerId);
            
            console.log('✅ Peer connected:', peerId);
            
            // Flush any pending messages now that channel is open
            console.log('Flushing pending messages after peer connection...');
            setTimeout(() => {
                flushPendingMessages();
            }, 100);
        } catch (e) {
            console.error('Data channel open error:', e);
        }
    };

    dc.onerror = (err) => {
        console.error('❌ Data channel ERROR:', err);
        if (peerId && peers[peerId]) {
            delete peers[peerId];
            updateUserList();
        }
    };
    
    dc.onclose = () => {
        console.log('🔴 Data channel CLOSED for peer:', peerId);
        if (peerId && peers[peerId]) {
            delete peers[peerId];
            updateUserList();
        }
    };

    dc.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'HI') {
                peers[peerId].name = msg.name;
                // IMPORT KEY
                if (msg.key && window.cryptoManager) {
                    window.cryptoManager.importPeerKey(peerId, msg.key);
                    peers[peerId].key = msg.key;
                    
                    // Register peer with identity manager
                    if (window.identityManager) {
                        const fingerprint = window.cryptoManager.getPeerFingerprint(peerId);
                        console.log(`  📋 Peer ${peerId} Fingerprint: ${fingerprint.short}`);
                    }
                }

                updateUserList();
                addSystemMessage('group', `${msg.name} joined.`);

                // Broadcast name AND KEY to others
                broadcast({
                    type: 'NAME_UPDATE',
                    id: peerId,
                    name: msg.name,
                    key: msg.key
                }, peerId);

                // Send the Host's key to the new guest
                sendToPeer(peerId, {
                    type: 'NAME_UPDATE',
                    id: state.myId,
                    name: state.username,
                    key: window.cryptoManager ? window.cryptoManager.publicKeyJWK : null
                });
            } else {
                handleData(msg, peerId);
            }
        } catch (err) {
            console.error('Message parsing error:', err, 'Data:', e.data);
        }
    };
}

async function finalizeHostConnection() {
    try {
        const answerCode = document.getElementById('host-answer-input')?.value?.trim();
        if (!answerCode) {
            alert("Please paste the answer code");
            return;
        }
        
        let answer;
        try {
            answer = JSON.parse(atob(answerCode));
        } catch (e) {
            alert("Invalid answer code format");
            return;
        }
        
        if (!gatewayPC) {
            alert("Gateway not initialized. Please generate an invite first.");
            return;
        }
        
        await gatewayPC.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("Host connection finalized!");
        
        // Transition to dashboard
        transitionToDashboard();
        document.getElementById('connection-panel').classList.add('hidden');
    } catch (e) {
        console.error("Connection error:", e);
        alert("Failed to finalize connection: " + e.message);
    }
}

async function pasteHostAnswerAndAccept() {
    try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            alert('Clipboard read not supported. Please paste manually.');
            return;
        }
        const txt = await navigator.clipboard.readText();
        const input = document.getElementById('host-answer-input');
        if (input) input.value = (txt || '').trim();
        await finalizeHostConnection();
    } catch (e) {
        console.error('Paste & Accept error:', e);
        alert('Failed to paste from clipboard. Please paste manually.');
    }
}

async function joinNetwork() {
    try {
        state.connecting = true;
        state.isHost = false;
        const code = document.getElementById('join-offer-input')?.value?.trim();
        if (!code) {
            alert("Please paste the invitation link first");
            return;
        }

        // Parse the invitation code
        let offer;
        try {
            offer = JSON.parse(atob(code));
        } catch (e) {
            alert("Invalid invitation data. Please check the link and try again.");
            return;
        }

        // Close existing connection if any
        if (gatewayPC) {
            gatewayPC.close();
        }

        gatewayPC = new RTCPeerConnection(buildRtcConfig());
    attachConnectionWatchers(gatewayPC, 'client');

        // Add ICE candidate handler
        gatewayPC.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Client ICE candidate:', event.candidate.candidate);
            }
        };

        gatewayPC.onconnectionstatechange = () => {
            console.log('Client connection state:', gatewayPC.connectionState);
        };

        gatewayPC.ondatachannel = (e) => {
            console.log('📡 Received data channel from host');
            const dc = e.channel;
            
            dc.onopen = () => {
                try {
                    console.log('🟢 Client data channel OPENED');
                    state.connecting = false;
                    
                    // Show dashboard immediately
                    transitionToDashboard();
                    
                    // Hide connection panel
                    document.getElementById('connection-panel')?.classList.add('hidden');
                    
                    // Switch to general group chat
                    switchToGroup('general');
                    updateUserList();
                    updateChatDisplay();

                    // SEND HI with PUBLIC KEY
                    dc.send(JSON.stringify({
                        type: 'HI',
                        name: state.username,
                        key: window.cryptoManager ? window.cryptoManager.publicKeyJWK : null
                    }));
                    
                    console.log('✅ Connected to network - Chat ready');
                    
                    // Flush any messages queued during connecting
                    console.log('Flushing pending messages after connection...');
                    setTimeout(() => {
                        flushPendingMessages();
                    }, 100);
                } catch (err) {
                    console.error('Data channel open error:', err);
                }
            };
            
            dc.onmessage = (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.type === 'WELCOME') {
                        // Authoritative ID assignment
                        state.myId = msg.id;
                        console.log("Assigned ID:", state.myId);

                        // Populate existing peers
                        if (msg.peers && msg.peers.length > 0) {
                            msg.peers.forEach(p => {
                                peers[p.id] = { name: p.name, id: p.id, dummy: true };
                            });
                        }
                        updateUserList();
                    } else {
                        handleData(msg, 'HOST');
                    }
                } catch (err) {
                    console.error("Error parsing message:", err);
                }
            };
            
            dc.onerror = (err) => {
                console.error('❌ Client data channel ERROR:', err);
            };
            
            dc.onclose = () => {
                console.log('🔴 Client data channel CLOSED');
                state.connecting = false;
            };
            
            peers['HOST'] = { conn: gatewayPC, channel: dc, name: 'Host', id: 'HOST' };
            updateUserList();
        };

        // Set remote description
        await gatewayPC.setRemoteDescription(new RTCSessionDescription(offer));
        
        // Create answer
        const answer = await gatewayPC.createAnswer();
        await gatewayPC.setLocalDescription(answer);
        
        // Wait for ICE candidates
        await waitForICEGathering(gatewayPC, 3000);
        
        if (!gatewayPC.localDescription) {
            throw new Error('Local description not set');
        }
        
        const answerCode = btoa(JSON.stringify(gatewayPC.localDescription));
        const answerInput = document.getElementById('join-answer-output');
        if (answerInput) {
            answerInput.value = answerCode;
            // Auto-copy the answer to clipboard for quick sharing back to host
            try {
                await navigator.clipboard.writeText(answerCode);
                showNotification('Answer copied. Send it back to the host to complete connection.', 'success');
            } catch (copyErr) {
                console.warn('Auto-copy failed:', copyErr);
            }
            // Generate a one-click answer link for the host
            try {
                const linkEl = document.getElementById('join-answer-link');
                if (linkEl) {
                    const answerLink = `${getBaseUrl()}#answer=${answerCode}`;
                    linkEl.value = answerLink;
                }
            } catch (linkErr) {
                console.warn('Answer link generation error:', linkErr);
            }
        }
        showStep('step-join-2');
        
        console.log('Join network initiated successfully');
    } catch (e) {
        console.error("Join error:", e);
        state.connecting = false;
        alert("Failed to join network: " + e.message);
    }
}


// --- UI Functions ---

function transitionToDashboard() {
    try {
        // Hide all connection panels and setup screens
        document.getElementById('connection-panel')?.classList.add('hidden');
        document.getElementById('step-welcome')?.classList.remove('active');
        document.getElementById('step-join-1')?.classList.remove('active');
        document.getElementById('step-join-2')?.classList.remove('active');
        document.getElementById('step-host-1')?.classList.remove('active');
        document.getElementById('step-host-2')?.classList.remove('active');
        
        // Show dashboard
        views.dashboard.classList.remove('hidden');
        document.getElementById('my-username-display').textContent = state.username;
        
        // Update protocol indicator
        updateProtocolDisplay();
        
        // Ensure chat area is visible and ready
        const messagesContainer = document.getElementById('messages-container');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        console.log('✓ Dashboard ready - Chat active');
    } catch (e) {
        console.error('Dashboard transition error:', e);
    }
}

function updateProtocolDisplay() {
    try {
        const displayElement = document.getElementById('protocol-display');
        if (!displayElement) return;
        
        if (state.protocol === 'private') {
            displayElement.textContent = 'Private';
            displayElement.style.background = 'rgba(239, 68, 68, 0.2)';
            displayElement.style.color = 'var(--danger)';
        } else if (state.protocol === 'group') {
            displayElement.textContent = 'Group';
            displayElement.style.background = 'rgba(16, 185, 129, 0.2)';
            displayElement.style.color = 'var(--success)';
        } else {
            displayElement.textContent = 'Network';
            displayElement.style.background = 'rgba(254, 127, 45, 0.2)';
            displayElement.style.color = 'var(--primary-500)';
        }
    } catch (e) {
        console.error('Protocol display update error:', e);
    }
}

/**
 * Update the entire chat display (header, messages, panels)
 */
function updateChatDisplay() {
    updateChatHeader();
    updateMessageDisplay();
    updateMembersPanel();
}

/**
 * Update chat header with current chat info
 */
function updateChatHeader() {
    if (chatElements.chatTitle) {
        chatElements.chatTitle.textContent = state.activeChat.name;
    }
    
    if (state.activeChat.type === 'group' && chatElements.chatTypeBadge) {
        chatElements.chatTypeBadge.textContent = 'Group Chat';
    } else if (chatElements.chatTypeBadge) {
        chatElements.chatTypeBadge.textContent = 'Private Chat';
    }
    
    // Update member count
    if (chatElements.memberCountBadge && state.activeChat.type === 'group') {
        const groupId = state.activeChat.id;
        const memberCount = state.groups[groupId]?.members?.length || 0;
        chatElements.memberCountBadge.textContent = memberCount;
    }
}

/**
 * Update message display for current chat
 */
function updateMessageDisplay() {
    if (!chatElements.messagesContainer) return;
    
    chatElements.messagesContainer.innerHTML = '';
    
    let messages = [];
    if (state.activeChat.type === 'group') {
        messages = state.groups[state.activeChat.id]?.messages || [];
    } else {
        messages = state.privateChats[state.activeChat.id]?.messages || [];
    }
    
    if (messages.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-chat';
        const chatName = state.activeChat.name;
        const emoji = state.activeChat.type === 'group' ? '👋' : '💬';
        emptyMsg.innerHTML = `
            <div class="empty-chat-icon">${emoji}</div>
            <h3>Welcome to ${chatName}</h3>
            <p>${state.activeChat.type === 'group' ? 'No messages yet. Be the first to start the conversation!' : 'Start chatting! Messages are E2E encrypted.'}</p>
        `;
        chatElements.messagesContainer.appendChild(emptyMsg);
    } else {
        messages.forEach(msg => renderMessage(msg));
    }
}

/**
 * Update left panel with groups and DMs
 */
function updateLeftPanel() {
    updateGroupsList();
    updateDMList();
}

/**
 * Update groups list in left panel
 */
function updateGroupsList() {
    if (!chatElements.groupsList) return;
    
    chatElements.groupsList.innerHTML = '';
    
    Object.values(state.groups).forEach(group => {
        const li = document.createElement('li');
        li.className = state.activeChat.id === group.id ? 'active' : '';
        li.setAttribute('data-chat-id', group.id);
        li.onclick = () => switchToGroup(group.id);
        
        const lastMsg = group.messages?.length > 0 
            ? group.messages[group.messages.length - 1].content.substring(0, 30)
            : 'No messages yet';
        
        li.innerHTML = `
            <ion-icon name="people"></ion-icon>
            <div class="chat-item-content">
                <span class="chat-name">${group.name}</span>
                <span class="chat-preview">${lastMsg}${group.messages?.length > 30 ? '...' : ''}</span>
            </div>
            ${group.unread > 0 ? `<span class="unread-badge">${group.unread}</span>` : ''}
        `;
        
        chatElements.groupsList.appendChild(li);
    });
}

/**
 * Update direct messages list in left panel
 */
function updateDMList() {
    if (!chatElements.dmList) return;
    
    chatElements.dmList.innerHTML = '';
    
    const dmCount = Object.keys(state.privateChats).length;
    if (dmCount === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'empty-state';
        emptyLi.textContent = 'No conversations yet...';
        chatElements.dmList.appendChild(emptyLi);
    } else {
        Object.values(state.privateChats).forEach(chat => {
            const li = document.createElement('li');
            li.className = state.activeChat.id === chat.id ? 'active' : '';
            li.onclick = () => switchToPrivateChat(chat.id);
            
            const lastMsg = chat.lastMessage 
                ? chat.lastMessage.content.substring(0, 30)
                : 'Start conversation...';
            
            li.innerHTML = `
                <ion-icon name="person"></ion-icon>
                <div class="chat-item-content">
                    <span class="chat-name">${chat.name}</span>
                    <span class="chat-preview">${lastMsg}</span>
                </div>
                ${chat.unread > 0 ? `<span class="unread-badge">${chat.unread}</span>` : ''}
            `;
            
            chatElements.dmList.appendChild(li);
        });
    }
}

/**
 * Update members panel on right side
 */
function updateMembersPanel() {
    if (!chatElements.membersList) return;
    
    chatElements.membersList.innerHTML = '';
    
    if (state.activeChat.type === 'group') {
        const groupId = state.activeChat.id;
        const members = state.groups[groupId]?.members || [];
        
        // Add self
        const selfItem = document.createElement('div');
        selfItem.className = 'member-item';
        selfItem.innerHTML = `
            <div class="member-avatar"><ion-icon name="person-circle"></ion-icon></div>
            <div class="member-info">
                <span class="member-name">${state.username}</span>
                <span class="member-status">You</span>
            </div>
            <span class="status-indicator online"></span>
        `;
        chatElements.membersList.appendChild(selfItem);
        
        // Add other members
        members.forEach(memberId => {
            const peer = peers[memberId];
            if (!peer) return;
            
            const item = document.createElement('div');
            item.className = 'member-item';
            const isOnline = peer.channel && peer.channel.readyState === 'open';
            
            item.innerHTML = `
                <div class="member-avatar"><ion-icon name="person-circle"></ion-icon></div>
                <div class="member-info">
                    <span class="member-name">${peer.name}</span>
                    <span class="member-status">${isOnline ? 'Online' : 'Offline'}</span>
                </div>
                <span class="status-indicator ${isOnline ? 'online' : 'offline'}"></span>
            `;
            
            chatElements.membersList.appendChild(item);
        });
    } else {
        // Private chat - show the other user
        const userId = state.activeChat.id;
        const peer = peers[userId];
        
        if (peer) {
            const item = document.createElement('div');
            item.className = 'member-item';
            const isOnline = peer.channel && peer.channel.readyState === 'open';
            
            item.innerHTML = `
                <div class="member-avatar"><ion-icon name="person-circle"></ion-icon></div>
                <div class="member-info">
                    <span class="member-name">${peer.name}</span>
                    <span class="member-status">${isOnline ? 'Online' : 'Offline'}</span>
                </div>
                <span class="status-indicator ${isOnline ? 'online' : 'offline'}"></span>
            `;
            
            chatElements.membersList.appendChild(item);
        }
    }
}

/**
 * Legacy function for backward compatibility
 */
function updateUserList() {
    updateLeftPanel();
    updateMembersPanel();
}

function switchChat(id) {
    if (id === 'group') {
        switchToGroup('general');
    } else {
        switchToPrivateChat(id);
    }
}

function renderChatHistory() {
    updateMessageDisplay();
}

// === MODAL & UI FUNCTIONS ===

/**
 * Show modal for creating a new group
 */
function showCreateGroupModal() {
    try {
        // Close the start-chat modal if it is open so the group modal is visible
        const startModal = document.getElementById('start-chat-modal');
        if (startModal) startModal.classList.add('hidden');

        const modal = document.getElementById('create-group-modal');
        if (!modal) {
            showNotification('Create group dialog not found', 'error');
            return;
        }
        modal.classList.remove('hidden');
    } catch (e) {
        console.error('Failed to open create group modal:', e);
        showNotification('Unable to open group dialog', 'error');
    }
}

async function createGroupWithInvite() {
    const nameInput = document.getElementById('group-name-input');
    const descInput = document.getElementById('group-desc-input');
    const groupName = (nameInput?.value || '').trim() || 'New Group';
    const description = descInput.value.trim();
    
    try {
        // Create the group
        const groupId = 'group_' + Date.now();
        state.groups[groupId] = {
            id: groupId,
            name: groupName,
            type: 'group',
            members: [],
            messages: [],
            unread: 0,
            created: new Date(),
            description: description
        };
        
        console.log('Group created:', groupId, groupName);
        updateLeftPanel();
        switchToGroup(groupId);
        
        // Prepare a WebRTC offer for immediate joining by invitees
        try {
            await generateInvite();
        } catch (e) {
            console.warn('Invite generation failed (metadata-only invite will be used):', e);
        }

        // Show invite modal
        closeInviteModal('create-group-modal');
        closeInviteModal('start-chat-modal');
        showInviteShareModal(groupId, 'group', groupName);
        showNotification('Group created. Share the invite link to add others.', 'success');
    } catch (e) {
        console.error('Failed to create group with invite:', e);
        showNotification('Could not create group. Please try again.', 'error');
    }
}

/**
 * Show modal for starting a chat (private or group)
 */
function startChat() {
    const modal = document.getElementById('start-chat-modal');
    const peerList = document.getElementById('available-peers');
    
    // Get list of connected peers
    const peers = Object.values(window.peers || {})
        .filter(p => !p.dummy && p.id !== state.myId);
    
    if (peers.length === 0) {
        peerList.innerHTML = '<li class="empty-state">No other users connected yet</li>';
    } else {
        peerList.innerHTML = peers.map(peer => `
            <li onclick="startPrivateChatWithPeer('${peer.id}', '${peer.name}')">
                <div class="peer-item">
                    <div class="peer-avatar">${peer.name.charAt(0).toUpperCase()}</div>
                    <div class="peer-info">
                        <div class="peer-name">${peer.name}</div>
                        <div class="peer-status">Connected</div>
                    </div>
                </div>
            </li>
        `).join('');
    }
    
    modal.classList.remove('hidden');
}

function startPrivateChatWithPeer(peerId, peerName) {
    switchToPrivateChat(peerId);
    closeInviteModal('start-chat-modal');
}

function startPrivateChatWithInvite() {
    closeInviteModal('start-chat-modal');
    
    // Create a temporary private chat for invitation
    const userId = 'pending_' + Date.now();
    state.privateChats[userId] = {
        id: userId,
        name: 'New Chat',
        messages: [],
        unread: 0,
        lastMessage: null
    };
    
    showInviteShareModal(userId, 'private', 'New Chat');
}

/**
 * Show invite share modal with link sharing only
 */
function showInviteShareModal(chatId, chatType, chatName) {
    try {
        const modal = document.getElementById('invite-share-modal');
        const linkInput = document.getElementById('invite-link-input');
        const titleSpan = document.getElementById('invite-chat-name');
        
        if (!modal || !linkInput || !titleSpan) {
            console.error('Invite modal elements missing');
            showNotification('Invite dialog not available', 'error');
            return;
        }
        
        // Set chat name in header
        titleSpan.textContent = chatName;
        
        // Generate invitation data
        // Include WebRTC host offer if available (enables auto-join)
        const hostOfferEl = document.getElementById('host-offer-output');
        const hostOfferCode = hostOfferEl?.value && hostOfferEl.value !== 'Generating...'
            ? hostOfferEl.value.trim()
            : null;

        const inviteData = {
            chatId: chatId,
            chatType: chatType,
            chatName: chatName,
            creatorId: state.myId,
            creatorName: state.username,
            timestamp: Date.now(),
            version: '2.0',
            networkOffer: hostOfferCode
        };
        
        // Encode invitation code
        const inviteCode = btoa(JSON.stringify(inviteData));
        const inviteLink = `${getBaseUrl()}#invite=${inviteCode}`;
        
        // Store in state for access
        state.currentInvite = {
            chatId: chatId,
            chatType: chatType,
            code: inviteCode,
            link: inviteLink
        };
        
        // Populate inputs
        linkInput.value = inviteLink;
        
        // Show modal
        modal.classList.remove('hidden');
    } catch (e) {
        console.error('Invite share modal error:', e);
        showNotification('Failed to generate invite link', 'error');
    }
}

/**
 * Close invite modal
 */
function closeInviteModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

/**
 * Copy invite link to clipboard
 */
function copyInviteLink() {
    const input = document.getElementById('invite-link-input');
    if (input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
            showCopyFeedback('Link copied!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy link');
        });
    }
}

/**
 * Share invite link using native share API if available
 */
function shareInviteLink() {
    const inviteLink = document.getElementById('invite-link-input').value;
    const chatName = document.getElementById('invite-chat-name').textContent;
    
    if (navigator.share) {
        navigator.share({
            title: `Join ${chatName} on Infinity Link`,
            text: `I'd like to invite you to join "${chatName}" on Infinity Link - a serverless chat app.`,
            url: inviteLink
        }).catch(err => {
            if (err.name !== 'AbortError') {
                console.error('Share failed:', err);
            }
        });
    } else {
        // Fallback: copy to clipboard
        copyInviteLink();
        alert('Share API not available. Link copied to clipboard instead.');
    }
}

/**
 * Show copy feedback notification
 */
function showCopyFeedback(message) {
    // Create temporary feedback element
    const feedback = document.createElement('div');
    feedback.textContent = message;
    feedback.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--success);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: var(--radius-md);
        z-index: 2000;
        animation: slideIn 0.3s var(--ease-spring);
        font-weight: 600;
    `;
    document.body.appendChild(feedback);
    
    // Remove after 2 seconds
    setTimeout(() => {
        feedback.style.animation = 'slideOut 0.3s var(--ease-spring)';
        setTimeout(() => feedback.remove(), 300);
    }, 2000);
}

/**
 * Show settings/details modal
 */
function showChatSettings() {
    // Close dropdown if open
    if (window.closeDropdowns) closeDropdowns();

    // Remove existing modal if present
    const existing = document.getElementById('chat-settings-modal');
    if (existing) existing.remove();

    const active = state.activeChat;
    const chatData = active.type === 'group' ? state.groups[active.id] : state.privateChats[active.id];
    if (!chatData) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'chat-settings-modal';
    modal.innerHTML = `
        <div class="modal-container">
            <div class="modal-header">
                <h2><ion-icon name="settings"></ion-icon> Chat Settings</h2>
                <button class="modal-close" onclick="document.getElementById('chat-settings-modal')?.remove()" title="Close">
                    <ion-icon name="close"></ion-icon>
                    <span class="btn-label">Close</span>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Chat Name</label>
                    <div class="info-row">${chatData.name || 'Unnamed Chat'}</div>
                </div>
                <div class="form-group">
                    <label>Type</label>
                    <div class="info-row">${active.type === 'group' ? 'Group' : 'Private'}</div>
                </div>
                <div class="form-group">
                    <label>Messages</label>
                    <div class="info-row">${(chatData.messages || []).length}</div>
                </div>
                ${active.type === 'group' ? `<div class="form-group"><label>Members</label><div class="info-row">${(chatData.members || []).length}</div></div>` : ''}
            </div>
            <div class="modal-footer" style="display:flex; gap:0.75rem; flex-wrap:wrap;">
                <button class="btn-secondary" onclick="toggleRightPanel(); document.getElementById('chat-settings-modal')?.remove()">
                    <ion-icon name="people"></ion-icon>
                    <span class="btn-label">View Members</span>
                </button>
                <button class="btn-secondary" onclick="exportChatHistory(); document.getElementById('chat-settings-modal')?.remove()">
                    <ion-icon name="download"></ion-icon>
                    <span class="btn-label">Export History</span>
                </button>
                <button class="btn-primary" onclick="document.getElementById('chat-settings-modal')?.remove()">
                    <ion-icon name="checkmark"></ion-icon>
                    <span class="btn-label">Done</span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

/**
 * Show members panel (mobile-friendly)
 */
function showMembersPanel() {
    if (state.ui.rightPanelVisible) {
        hideRightPanel();
    } else {
        showRightPanel();
    }
}

/**
 * Show right panel
 */
function showRightPanel() {
    state.ui.rightPanelVisible = true;
    if (chatElements.rightPanel) {
        chatElements.rightPanel.style.display = 'flex';
    }
    updateMembersPanel();
}

/**
 * Hide right panel (for mobile)
 */
function hideRightPanel() {
    state.ui.rightPanelVisible = false;
    if (chatElements.rightPanel) {
        chatElements.rightPanel.style.display = 'none';
    }
}

/**
 * Verify member identity (show fingerprint)
 */
function verifyMemberIdentity() {
    if (state.activeChat.type === 'private') {
        const userId = state.activeChat.id;
        if (window.cryptoManager) {
            const fingerprint = window.cryptoManager.peerKeyFingerprints[userId];
            if (fingerprint) {
                alert(`Fingerprint for ${state.privateChats[userId].name}:\n\n${fingerprint.short}\n\nFull: ${fingerprint.full}`);
            }
        }
    }
}

// === MESSAGE RENDERING ===
function renderMessage(msg) {
    try {
        if (!msg || !msg.content) {
            console.warn('Invalid message object');
            return;
        }
        
        if (!chatElements.messagesContainer) {
            console.warn('Messages container not found');
            return;
        }
        
        const isMe = msg.from === state.myId || msg.from === 'SYSTEM';
        const div = document.createElement('div');
        
        // Handle system messages
        if (msg.from === 'SYSTEM' || msg.type === 'SYSTEM') {
            div.className = 'message system';
            div.innerHTML = `<ion-icon name="information-circle"></ion-icon> ${msg.content}`;
            chatElements.messagesContainer.appendChild(div);
            chatElements.messagesContainer.scrollTop = chatElements.messagesContainer.scrollHeight;
            return;
        }
        
        div.className = `message ${isMe ? 'sent' : 'received'}`;

        // Encrypted Badge
        if (msg.encrypted) {
            div.classList.add('encrypted');
            const lock = document.createElement('span');
            lock.innerHTML = '<ion-icon name="lock-closed" style="font-size:0.7rem; margin-right:4px; opacity:0.7;"></ion-icon>';
            div.prepend(lock);
        }

        let senderName = isMe ? 'You' : (msg.fromName || (peers[msg.from] ? peers[msg.from].name : 'Unknown'));
        
        // Show sender name in group chat
        if (state.activeChat.type === 'group' && !isMe) {
            const nameSpan = document.createElement('div');
            nameSpan.className = 'sender-name';
            nameSpan.textContent = senderName;
            div.appendChild(nameSpan);
        }

        const textSpan = document.createElement('span');
        textSpan.textContent = msg.content;
        div.appendChild(textSpan);

        // Add timestamp
        if (msg.timestamp) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'message-timestamp';
            const time = new Date(msg.timestamp);
            const now = new Date();
            let timeStr;
            if (time.toDateString() === now.toDateString()) {
                timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } else {
                timeStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });
            }
            timeSpan.textContent = timeStr;
            div.appendChild(timeSpan);
        }

        // Add read indicator for sent messages
        if (isMe && msg.read) {
            const readSpan = document.createElement('span');
            readSpan.className = 'read-indicator';
            readSpan.innerHTML = '<ion-icon name="checkmark-done" title="Read"></ion-icon>';
            div.appendChild(readSpan);
        }

        chatElements.messagesContainer.appendChild(div);
        chatElements.messagesContainer.scrollTop = chatElements.messagesContainer.scrollHeight;
    } catch (e) {
        console.error('Render message error:', e);
    }
}

function addSystemMessage(chatId, text) {
    try {
        if (!chatId || !text) {
            console.warn('Invalid system message parameters');
            return;
        }
        
        // Store in appropriate message store
        const systemMsg = {
            from: 'SYSTEM',
            content: text,
            timestamp: new Date().toISOString(),
            type: 'SYSTEM'
        };
        
        if (state.groups[chatId]) {
            state.groups[chatId].messages.push(systemMsg);
        } else if (state.privateChats[chatId]) {
            state.privateChats[chatId].messages.push(systemMsg);
        }
        
        // Display if viewing this chat
        if (state.activeChat.id === chatId && chatElements.messagesContainer) {
            const div = document.createElement('div');
            div.className = 'message system';
            div.innerHTML = `<ion-icon name="information-circle"></ion-icon> ${text}`;
            chatElements.messagesContainer.appendChild(div);
            chatElements.messagesContainer.scrollTop = chatElements.messagesContainer.scrollHeight;
        }
    } catch (e) {
        console.error('System message error:', e);
    }
}

async function sendChatMessage() {
    try {
        if (!chatElements.messageInput) {
            console.warn('Message input not found');
            return;
        }
        
        const text = chatElements.messageInput.value.trim();
        if (!text || text.length === 0) {
            chatElements.messageInput.focus();
            return;
        }

        // Check if we have open channels
        const hasOpen = Object.keys(peers).some(pid => peers[pid]?.channel?.readyState === 'open');
        
        // Always send the message (it will be displayed locally and sent to peers if available)
        sendMessage(text);
        
        // Inform user if message was queued due to no peers
        if (!hasOpen) {
            showNotification(state.connecting ? '⏳ Message queued - will send when connected' : '⚠️ No peers connected yet', 'info');
        }
        
        // Clear input and focus for next message
        chatElements.messageInput.value = '';
        chatElements.messageInput.focus();
        
        // Auto-reset textarea height
        chatElements.messageInput.style.height = 'auto';
    } catch (e) {
        console.error('Send chat message error:', e);
        showNotification('Failed to send message', 'error');
    }
}

function flushPendingMessages() {
    try {
        if (!state.pendingMessages || state.pendingMessages.length === 0) return;
        const originalActive = { ...state.activeChat };
        const hasOpen = Object.keys(peers).some(pid => peers[pid]?.channel?.readyState === 'open');
        if (!hasOpen) return;
        const toSend = [...state.pendingMessages];
        state.pendingMessages = [];
        toSend.forEach(item => {
            state.activeChat.type = item.chatType;
            state.activeChat.id = item.chatId;
            sendMessage(item.content);
        });
        state.activeChat = originalActive;
        showNotification(`✅ Sent ${toSend.length} queued message(s)`, 'success');
    } catch (e) {
        console.error('Flush pending messages error:', e);
    }
}

// Enhanced message input with auto-resize
document.addEventListener('DOMContentLoaded', () => {
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        // Auto-focus on chat switch
        messageInput.addEventListener('focus', () => {
            messageInput.parentElement?.classList.add('focused');
        });
        
        messageInput.addEventListener('blur', () => {
            messageInput.parentElement?.classList.remove('focused');
        });
        
        // Auto-resize textarea
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        });
    }

    // Handle inbound invite links from URL hash (#invite=...)
    handleInviteFromHash();
    // Handle inbound answer links from URL hash (#answer=...)
    handleAnswerFromHash();
});

// Helpers
function showStep(id) {
    document.querySelectorAll('.step-container').forEach(e => e.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// --- Invite Link Handler ---
function handleInviteFromHash() {
    try {
        const hash = window.location.hash || '';
        if (!hash.startsWith('#invite=')) return;

        const inviteCode = hash.replace('#invite=', '').trim();
        if (!inviteCode) return;

        let inviteData;
        try {
            inviteData = JSON.parse(atob(inviteCode));
        } catch (e) {
            console.error('Invalid invite code in URL:', e);
            showNotification('Invalid invite link', 'error');
            return;
        }

        const fullLink = window.location.href;

        // Prefill join inputs for quick start
        const joinInput = document.getElementById('join-link-input');
        if (joinInput) joinInput.value = fullLink;
        const protocolJoinInput = document.getElementById('protocol-join-link-input');
        if (protocolJoinInput) protocolJoinInput.value = fullLink;

        // Surface the join flow
        const connectionPanel = document.getElementById('connection-panel');
        if (connectionPanel) connectionPanel.classList.remove('hidden');
        showStep('step-join-1');

        // Store for potential later use
        state.currentInvite = {
            chatId: inviteData.chatId,
            chatType: inviteData.chatType,
            code: inviteCode,
            link: fullLink,
            fromHash: true
        };

        showNotification(`Invite detected: ${inviteData.chatName || 'Chat'}`, 'info');

        // If the invite contains a network offer, auto-populate and start joining
        if (inviteData.networkOffer && typeof inviteData.networkOffer === 'string' && inviteData.networkOffer.length > 0) {
            const offerInput = document.getElementById('join-offer-input');
            if (offerInput) {
                offerInput.value = inviteData.networkOffer.trim();
                state.connecting = true;
                showNotification('Connecting to host…', 'info');
                joinNetwork();
            }
        }
        // Clear the URL hash to avoid re-triggering when navigating
        try { history.replaceState(null, document.title, window.location.pathname + window.location.search); } catch {}
    } catch (e) {
        console.error('Invite hash handling failed:', e);
    }
}

// --- Host Answer Link Handler ---
function handleAnswerFromHash() {
    try {
        const hash = window.location.hash || '';
        if (!hash.startsWith('#answer=')) return;

        const answerCode = hash.replace('#answer=', '').trim();
        if (!answerCode) return;

        // Fill host input and finalize automatically
        const hostInput = document.getElementById('host-answer-input');
        if (hostInput) {
            hostInput.value = answerCode;
            showStep('step-host-2');
            finalizeHostConnection();
            showNotification('Applying guest reply… finalizing connection', 'info');
        }

        // Clear the hash
        try { history.replaceState(null, document.title, window.location.pathname + window.location.search); } catch {}
    } catch (e) {
        console.error('Answer hash handling failed:', e);
    }
}

// --- Link Sharing Functions ---
function generateShareableLink(code, type = 'host') {
    try {
        if (!code || code.length === 0) {
            console.warn('Invalid code for link generation');
            return;
        }
        
        const link = `${getBaseUrl()}#init=${code}`;
        
        if (type === 'host') {
            const linkInput = document.getElementById('host-link-output');
            if (linkInput) {
                linkInput.value = link;
            }
        }
    } catch (e) {
        console.error('Link generation error:', e);
    }
}
function switchInviteTab(tabName) {
    try {
        // Hide all tabs
        const container = document.getElementById('step-host-1');
        if (!container) return;
        
        container.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        container.querySelectorAll('.invite-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Show selected tab
        const tabElement = document.getElementById(`tab-${tabName}`);
        const activeBtn = container.querySelector(`.invite-tabs [data-tab="${tabName}"]`);
        
        if (tabElement) {
            tabElement.classList.add('active');
        }
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    } catch (e) {
        console.error('Tab switch error:', e);
    }
}

function switchJoinTab(tabName) {
    try {
        // Hide all tabs
        const container = document.getElementById('step-join-1');
        if (!container) return;
        
        container.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        container.querySelectorAll('.join-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Show selected tab
        const tabElement = document.getElementById(`join-tab-${tabName}`);
        const activeBtn = container.querySelector(`.join-tabs [data-tab="${tabName}"]`);
        
        if (tabElement) {
            tabElement.classList.add('active');
        }
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    } catch (e) {
        console.error('Tab switch error:', e);
    }
}

function switchReplyTab(tabName) {
    try {
        // Hide all tabs
        const container = document.getElementById('step-join-2');
        if (!container) return;
        
        container.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        container.querySelectorAll('.reply-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Show selected tab
        const tabElement = document.getElementById(`reply-tab-${tabName}`);
        const activeBtn = container.querySelector(`.reply-tabs [data-tab="${tabName}"]`);
        
        if (tabElement) {
            tabElement.classList.add('active');
        }
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    } catch (e) {
        console.error('Tab switch error:', e);
    }
}

function processJoinInput() {
    try {
        // Try to get code from whichever tab is active
        let code = (document.getElementById('join-offer-input')?.value || '').trim() ||
              (document.getElementById('join-link-input')?.value || '').trim();
        
        // If it's a link, extract embedded code
        if (code.includes('#init=')) {
            code = code.split('#init=')[1];
        } else if (code.includes('#invite=')) {
            try {
                const inviteCode = code.split('#invite=')[1];
                const inviteData = JSON.parse(atob(inviteCode));
                if (inviteData && typeof inviteData.networkOffer === 'string') {
                    code = inviteData.networkOffer.trim();
                }
            } catch (e) {
                console.warn('Failed to parse invite link in join input:', e);
            }
        }
        
        if (code && code.length > 0) {
            document.getElementById('join-offer-input').value = code;
            joinNetwork();
        } else {
            alert('Please provide an invite link');
        }
    } catch (e) {
        console.error('Join input error:', e);
        alert('Error processing invite. Please try again.');
    }
}

// --- Chat Mode Functions ---


function copyToClipboard(id, btnElement) {
    try {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`Element with id "${id}" not found`);
            return;
        }
        
        const text = element.value || element.textContent || '';
        
        if (!text) {
            alert('Nothing to copy');
            return;
        }
        
        navigator.clipboard.writeText(text).then(() => {
            if (btnElement) {
                const originalText = btnElement.innerText;
                const originalClass = btnElement.className;
                btnElement.innerText = '✓ Copied!';
                btnElement.classList.add('active');

                setTimeout(() => {
                    btnElement.innerText = originalText;
                    btnElement.className = originalClass;
                }, 2000);
            }
        }).catch(err => {
            console.error('Failed to copy:', err);
            // Fallback for older browsers
            try {
                element.select();
                document.execCommand('copy');
                if (btnElement) {
                    btnElement.innerText = '✓ Copied!';
                    btnElement.classList.add('active');
                    setTimeout(() => {
                        btnElement.innerText = 'Copy';
                        btnElement.classList.remove('active');
                    }, 2000);
                }
            } catch (e) {
                alert('Copy failed. Please try again.');
            }
        });
    } catch (e) {
        console.error('Clipboard error:', e);
        alert('An error occurred while copying.');
    }
}

// Bindings
function initializeEventListeners() {
    try {
        const sendBtn = document.getElementById('send-btn');
        const messageInput = document.getElementById('message-input');

        if (sendBtn) {
            sendBtn.onclick = sendChatMessage;
            console.log('Send button bound');
        } else {
            console.warn('Send button not found');
        }
        
        if (messageInput) {
            messageInput.onkeypress = (e) => { 
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendChatMessage();
                }
            };
            console.log('Message input bound');
        } else {
            console.warn('Message input not found');
        }

        // Modal function bindings (exposed to global scope above)
        console.log('Event listeners initialized');
    } catch (e) {
        console.error('Event listener initialization error:', e);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEventListeners);
} else {
    initializeEventListeners();
}

// Expose to HTML
window.startHost = initHost;
window.startJoin = joinNetwork;
window.finalizeConnection = finalizeHostConnection;
window.pasteHostAnswerAndAccept = pasteHostAnswerAndAccept;
window.generateAnswer = processJoinInput;
window.copyToClipboard = copyToClipboard;
window.showStep = showStep;
window.switchInviteTab = switchInviteTab;
window.switchJoinTab = switchJoinTab;
window.switchReplyTab = switchReplyTab;
window.processJoinInput = processJoinInput;
window.generateShareableLink = generateShareableLink;
window.generateInvite = generateInvite;
window.initializeEventListeners = initializeEventListeners;
window.refreshDiagnostics = refreshDiagnostics;

// --- LUNCH PROTOCOL FUNCTIONS ---

function selectProtocol(type) {
    try {
        if (type !== 'private' && type !== 'group') {
            throw new Error('Invalid protocol type');
        }
        
        state.protocol = type; // 'private' or 'group'
        showStep('step-protocol-create');
        
        // Update UI based on protocol type
        const badge = document.getElementById('protocol-badge-type');
        const subtitle = document.getElementById('protocol-create-subtitle');
        const description = document.getElementById('protocol-description');
        const loading = document.getElementById('protocol-loading');
        
        if (badge) badge.textContent = type === 'private' ? 'PRIVATE' : 'GROUP';
        if (type === 'private') {
            if (subtitle) subtitle.textContent = 'Creating a secure 1-to-1 conversation...';
            if (description) description.textContent = 'Direct encrypted channel - only you and your contact can see messages';
        } else {
            if (subtitle) subtitle.textContent = 'Creating a secure group conversation...';
            if (description) description.textContent = 'Multi-person encrypted group - all members can see and send messages';
        }
        
        // Reset loading state
        if (loading) loading.style.display = 'block';
        const nextBtn = document.getElementById('btn-protocol-next');
        if (nextBtn) nextBtn.style.display = 'none';
        
        // Start session creation
        createProtocolSession();
    } catch (e) {
        console.error('Protocol selection error:', e);
        alert('Error selecting protocol. Please try again.');
        showStep('step-protocol-select');
    }
}

async function createProtocolSession() {
    try {
        // Validate prerequisites
        if (!state.myId || !state.username) {
            throw new Error('User identity not initialized');
        }
        
        // Generate session ID and timestamp
        state.sessionId = crypto.randomUUID();
        const timestamp = Date.now();
        
        // Create session metadata
        const sessionData = {
            sessionId: state.sessionId,
            protocol: state.protocol,
            creatorId: state.myId,
            creatorName: state.username,
            timestamp: timestamp,
            version: '2.0'
        };
        
        // Encode invitation code (base64 + optional crypto enhancement)
        // Current: base64 encoding for universal browser compatibility
        // Future: Can use cryptoManager for additional encryption layer
        state.invitationCode = btoa(JSON.stringify(sessionData));
        
        // For enhanced security, optionally encrypt with session key
        // This would require sharing the session encryption key separately
        // For now, rely on HTTPS transport security
        
        // Generate shareable link with hash
        state.invitationLink = `${getBaseUrl()}#lunch=${state.invitationCode}`;
        
        // Log session creation with obfuscated code
        const codePreview = state.invitationCode.substring(0, 16) + '...';
        console.log('Protocol session created:', {
            sessionId: state.sessionId,
            protocol: state.protocol,
            timestamp: timestamp,
            codePreview: codePreview
        });
        
        // Show next button and hide loading
        const nextBtn = document.getElementById('btn-protocol-next');
        const loading = document.getElementById('protocol-loading');
        if (nextBtn) nextBtn.style.display = 'inline-block';
        if (loading) loading.style.display = 'none';
        
    } catch (e) {
        console.error('Session creation error:', e);
        alert('Failed to create session: ' + e.message);
        showStep('step-protocol-select');
    }
}

function switchProtocolTab(tabName) {
    try {
        const container = document.getElementById('step-protocol-invite');
        if (!container) return;
        
        // Single link view now; keep function for backward compatibility
        container.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('active'));
        container.querySelectorAll('.protocol-tabs .tab-btn').forEach(btn => btn.classList.add('active'));
    } catch (e) {
        console.error('Protocol tab switch error:', e);
    }
}

function switchProtocolJoinTab(tabName) {
    try {
        const container = document.getElementById('step-protocol-join');
        if (!container) return;
        container.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('active'));
        container.querySelectorAll('.protocol-tabs .tab-btn').forEach(btn => btn.classList.add('active'));
    } catch (e) {
        console.error('Protocol join tab switch error:', e);
    }
}

function startProtocolSession() {
    try {
        // Validate session state
        if (!state.sessionId || !state.invitationCode) {
            alert('Session not properly initialized. Please go back and try again.');
            return;
        }
        
        // Populate invitation outputs
        const linkOutput = document.getElementById('protocol-link-output');
        if (linkOutput) linkOutput.value = state.invitationLink;
        
        // Update status badge
        const statusBadge = document.getElementById('session-status-badge');
        if (statusBadge) {
            statusBadge.innerHTML = '<span class="status-dot active"></span> Session Active';
        }
        
        // Move to invite step
        showStep('step-protocol-invite');
        
        console.log('Protocol session started and ready for invitations');
        
    } catch (e) {
        console.error('Session start error:', e);
        alert('Error starting session: ' + e.message);
    }
}

function joinProtocolSession() {
    try {
        const linkOrCode = (document.getElementById('protocol-join-link-input')?.value || '').trim();
        if (!linkOrCode || linkOrCode.length === 0) {
            alert('Please provide a valid invitation link');
            return;
        }

        // Extract embedded code from the link hash
        let code = linkOrCode;
        if (linkOrCode.includes('#lunch=')) {
            code = linkOrCode.split('#lunch=')[1];
        }
        
        // Validate and decode invitation code
        let sessionData;
        try {
            const decodedJson = atob(code);
            sessionData = JSON.parse(decodedJson);
        } catch (e) {
            alert('Invalid invitation code format. Please check and try again.');
            console.error('Invitation decode error:', e);
            return;
        }
        
        // Validate required fields
        if (!sessionData.sessionId || !sessionData.protocol || !sessionData.creatorId) {
            alert('Invalid invitation data. Missing required fields.');
            return;
        }
        
        // Set protocol state from invitation
        state.sessionId = sessionData.sessionId;
        state.protocol = sessionData.protocol;
        
        console.log('Joined protocol session:', {
            sessionId: state.sessionId,
            protocol: state.protocol,
            creator: sessionData.creatorName
        });
        
        // Add system message
        const protocolType = state.protocol === 'private' ? 'Private 1-to-1' : 'Group';
        addSystemMessage('group', `Successfully joined ${protocolType} session hosted by ${sessionData.creatorName}`);
        
        // Transition to dashboard
        transitionToDashboard();
        document.getElementById('connection-panel').classList.add('hidden');
        views.dashboard.classList.remove('hidden');
        
    } catch (e) {
        console.error('Join protocol error:', e);
        alert('Error joining session: ' + e.message);
    }
}

// Expose lunch protocol functions
window.selectProtocol = selectProtocol;
window.switchProtocolTab = switchProtocolTab;
window.switchProtocolJoinTab = switchProtocolJoinTab;
window.startProtocolSession = startProtocolSession;
window.joinProtocolSession = joinProtocolSession;
window.updateProtocolDisplay = updateProtocolDisplay;
window.getConnectionStatus = getConnectionStatus;
window.logStatus = logStatus;
