# Infinity Link - Quick Reference Card

## 🚀 Start Using (30 seconds)

### Option A: Two Browser Windows (Same Computer)
```
1. Open Window A & B: http://localhost:8000
2. Window A: "Launch Protocol" → "Group" → Copy Link
3. Window B: Paste Link → "Join"
4. DONE! Type messages
```

### Option B: Two Computers (Different Networks)
```
1. Host deploys to HTTPS domain (with STUN server)
2. Host: "Launch Protocol" → Copy QR/Link
3. Guest: Scan QR or click link
4. Both chat in real-time
```

---

## 📱 UI Navigation

### Landing Page
- **Launch Protocol** - New Lunch Protocol session
- **Host a Room** - Legacy network mode
- **Join a Room** - Join existing room

### Protocol Selection
- **Private Chat** - 1-to-1 secure conversation
- **Group Chat** - Multi-person session

### Sharing Options
- **Link** - Paste-able URL
- **Code** - Base64 text code
- **QR Code** - Scannable code

### Chat Interface
- **Encrypted** Mode - E2E encryption on
- **Relay** Mode - Messages via host
- **Direct** Mode - Peer-to-peer
- **Settings** - Chat options

---

## 🔌 Technical Details

### What Happens When You Join
```
1. Browser A generates offer (SDP)
2. Browser B receives, creates answer (SDP)
3. Exchange of Session Descriptions via codes
4. ICE candidates gathered (STUN)
5. WebRTC connection established
6. Data channel opens
7. HI message sent with public key
8. WELCOME response with peer list
9. NAME_UPDATE broadcasted
10. Messages flow in real-time
```

### Message Path
```
User Types
    ↓
Validate Input
    ↓
Encrypt (if private)
    ↓
Create Message Object
    ↓
Send via DataChannel
    ↓
Host Relays (if needed)
    ↓
Recipient Receives
    ↓
Decrypt (if encrypted)
    ↓
Display in Chat
```

---

## 📊 Status Codes in Console

| Message | Meaning | Action |
|---------|---------|--------|
| `✓ Initialization complete` | App ready | Can create/join session |
| `✓ Invite generated successfully` | Host created session | Share the code/link |
| `Peer connected` | Client joined | Can send/receive messages |
| `Data channel opened` | Connection ready | Messages can flow |
| `Gateway connection state: connected` | Host verified | Broadcasting ready |
| `⚠ ICE gathering timeout` | STUN taking time | Normal, proceeding |
| `❌ Data channel error` | Connection lost | Try reconnecting |

---

## 🎯 Common Tasks

### Create a Group Chat
```
1. Click "Launch Protocol"
2. Click "Group Chat"
3. Click "Next: Invite Others"
4. Copy the link/code/QR
5. Click "Start Session"
6. Share invitation
```

### Join a Lunch Protocol Session
```
1. Get invitation (link/code/QR)
2. Paste code or click link
3. Click "Join Session"
4. Automatically redirected to chat
5. Type messages!
```

### Send Private Message
```
1. In chat, see "Direct Messages" list
2. Click peer name
3. Chat field now for that peer only
4. Messages encrypted automatically
5. Only you and peer can read
```

### Send Group Message
```
1. In chat, click "Global Group"
2. Chat field broadcasts to all
3. All group members receive
4. Optional encryption available
```

### Test Encryption Works
```
1. Open console (F12)
2. Send private message
3. Look for 🔒 lock icon
4. Console shows: "type: ENCRYPT_CHAT"
5. ✅ Encryption is working!
```

---

## 🔍 Debug Commands

Copy/paste into browser console:

```javascript
// Check connection status
window.getConnectionStatus()

// Force refresh UI
window.updateUserList()

// Send test message
window.sendChatMessage()

// View all peers
console.log(window.peers)

// View all messages
console.log(window.state.messages)

// Check crypto ready
window.cryptoManager?.publicKeyJWK ? "Ready" : "Not ready"

// View active chat
console.log(window.state.activeChat)

// Monitor peers live
setInterval(() => console.log(window.getConnectionStatus()), 2000)
```

---

## ⚡ Performance Tips

### For Best Experience
1. Use HTTPS in production
2. Use modern browser (Chrome/Firefox/Safari latest)
3. Good internet connection
4. Close other heavy apps
5. Clear browser cache if issues

### For Multiple Users
1. Host on powerful computer
2. Use public STUN server
3. Test ICE connectivity first
4. Monitor console for errors

### For Production
1. Deploy to HTTPS domain
2. Configure STUN/TURN servers
3. Use CDN for static files
4. Enable compression
5. Monitor performance

---

## 🆘 Quick Fixes

| Issue | Fix |
|-------|-----|
| "No other users yet" | Wait 5 seconds, refresh host browser |
| "Peer not found" | Both users refresh, rejoin |
| Message not sending | Wait for "Data channel opened" |
| Can't connect | Check STUN server, try public WiFi |
| Encryption error | Wait 2-3 seconds, retry send |
| Mobile not joining | Use latest Chrome/Safari, check HTTPS |
| QR code not scanning | Check lighting, use latest camera app |

---

## 📈 Expected Timing

| Action | Time |
|--------|------|
| Generate invite | < 1 second |
| Join via code | < 2 seconds |
| Connect peers | 1-3 seconds |
| Send message | < 500ms |
| Encrypt message | < 100ms |
| Display on other end | < 500ms total |
| Add new peer | 1-2 seconds |

---

## 🎓 Learning Path

### Beginner
1. ✅ Open two browser windows
2. ✅ Create group chat
3. ✅ Exchange messages
4. ✅ Test on mobile

### Intermediate
1. ✅ Use private messages
2. ✅ Test 3+ peers
3. ✅ Monitor console logs
4. ✅ Test on different networks

### Advanced
1. ✅ Read app.js source code
2. ✅ Modify crypto.js settings
3. ✅ Deploy to production
4. ✅ Configure custom TURN server
5. ✅ Implement persistence layer

---

## 📚 Key Files Explained

### index.html
- All UI elements and dialogs
- Form inputs and buttons
- Chat interface markup
- About 430 lines

### app.js
- Core networking logic (1500+ lines)
- WebRTC connection management
- Message routing and broadcasting
- Encryption/decryption handling
- Lunch Protocol implementation
- User interface updates

### crypto.js
- ECDH key generation
- AES-GCM encryption
- Key import/export
- Per-peer shared secrets

### style.css
- Premium "Flame & Urban Black" design
- Glassmorphism effects
- Responsive layout
- Animation effects

---

## 🚀 Deployment Checklist

- [ ] HTTPS certificate ready
- [ ] STUN server configured
- [ ] Static files hosted
- [ ] Domain configured
- [ ] DNS pointing correctly
- [ ] Test with 2 browsers
- [ ] Test with mobile
- [ ] Test across networks
- [ ] Monitor console for errors
- [ ] Share with users!

---

## 📞 Getting Help

1. **Check Console**: F12 → Console tab for detailed logs
2. **Read TESTING_GUIDE.md**: Complete troubleshooting guide
3. **Check Connection Status**: `window.getConnectionStatus()`
4. **Review README.md**: Full documentation
5. **Check Browser Support**: Is your browser supported?

---

## ✅ Success Checklist

- [ ] Peers appear in user list
- [ ] Messages appear instantly
- [ ] No console errors
- [ ] Protocol badge shows correct mode
- [ ] Lock icon on private messages
- [ ] Connection status shows all connected
- [ ] Can send/receive messages
- [ ] Mobile works

---

**Version**: 2.0 | **Status**: Production Ready ✅ | **Last Updated**: Jan 6, 2026
