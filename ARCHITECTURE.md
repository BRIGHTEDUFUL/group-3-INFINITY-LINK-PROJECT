# Infinity Link Architecture

This document explains the distributed system type, overall architecture, network topology, signaling, security model, deployment, and operational considerations for Infinity Link.

## Overview
Infinity Link is a serverless, browser-based peer-to-peer (P2P) chat application. It uses WebRTC data channels for real-time communication and end-to-end encryption for private messages. The entire system runs client-side; no backend servers are required for messaging.

## Distributed System Type
- Peer-to-Peer, serverless
- Star topology (host hub + guest spokes) for coordination and routing
- Manual signaling (copy-paste offers/answers) instead of a signaling server
- Best-effort delivery over WebRTC data channels with browser-managed ICE

## Architecture Components
- UI & Flow: [index.html](index.html), [style.css](style.css)
- Core App Logic: [app.js](app.js)
- Cryptography (ECDH + AES-GCM): [crypto.js](crypto.js)
- Identity & Trust (fingerprints, verification): [identity.js](identity.js)
- Security Dashboard (UI helpers): [security-ui.js](security-ui.js)

### Responsibilities
- `app.js`: Session creation/join, message routing, invite generation, UI state
- `crypto.js`: Key generation, peer key import, shared secret derivation, encrypt/decrypt
- `identity.js`: Peer identity registry, fingerprinting, challenge verification
- `security-ui.js`: User-facing trust overview, audit log display

## Network Topology
- Primary: Star (Host as hub, Guests as spokes)
  - Group messages: routed via host to all connected peers
  - Private messages: sent pairwise; host relays if needed
- NAT traversal: STUN servers (`stun.l.google.com:19302` and `stun1.l.google.com:19302`)
- TURN: Not configured by default (add for restrictive networks)

### Data Flow
1. User composes a message
2. Private: encrypt per recipient using shared secret
3. Group: encrypt per peer and send; host relays to peers
4. Recipient decrypts and renders

## Signaling (Manual)
- Host generates an "offer" and shares an invite link containing `#init=` code
- Guest pastes link, generates an "answer" code
- Host pastes answer to finalize the connection
- Lunch Protocol (`#lunch=`) provides a simplified join link for session awareness
- Invite links (`#invite=`) surface join UI for group/private sessions

## Security Model
- Key Exchange: ECDH P-256
- Encryption: AES-256-GCM per peer
- Fingerprinting: SHA-256 of public keys for identity
- Private messages: E2EE (host cannot decrypt)
- Group messages: encrypted individually for each peer (pairwise E2EE); host relays ciphertext
- Trust: Optional out-of-band verification + challenge-response in `identity.js`

## Identity & Trust
- Local identity stored in browser (recovery code for restoration)
- Peers registered with fingerprints; mismatches flagged as compromised
- Challenge-response verification available via Security Dashboard

## Deployment
- Static hosting (recommended: GitHub Pages)
- Must use HTTPS for WebRTC and modern APIs
- Invite links built using the current base URL so subpaths work under Pages

## Scalability & Limits
- Tested for small groups (5+ peers) in a star topology
- Host browser acts as relay and can become a bottleneck
- For larger rooms or poor NAT conditions, consider deploying TURN

## Fault Tolerance & Failure Modes
- ICE gathering timeout with fallback
- Data channel state monitoring and reconnection guidance
- If the host tab closes, group routing stops (session ends)

## Performance
- Message latency: typically < 500ms
- Encryption: < 100ms per message in modern browsers
- Resource usage scales with peers due to per-peer encryption for group messages

## Privacy & Threat Model
- No servers store or see message content
- Metadata (peer names, session info) is unencrypted for UI convenience
- Private message contents are only visible to sender/recipient
- Users should verify fingerprints out-of-band to avoid MITM

## Testing & Monitoring
- Manual tests: two windows/devices, host + guest
- Console helpers: `window.getConnectionStatus()` in `app.js`
- Security dashboard: opens via profile menu (fingerprints, audit log)

## Future Enhancements
- Optional TURN configuration
- Persist chat history locally (opt-in)
- File transfer and rich content
- Automated signaling service for one-click joins

## Glossary
- STAR TOPOLOGY: One central node (host) connected to many spokes (guests)
- ECDH: Elliptic Curve Diffie-Hellman key agreement
- AES-GCM: Authenticated encryption mode providing confidentiality and integrity
- STUN/TURN: NAT traversal and relay services for WebRTC
