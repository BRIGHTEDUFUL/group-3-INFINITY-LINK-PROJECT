# Hosting Infinity Link

Infinity Link can be hosted on any static hosting platform. Here are the easiest options:

## 1. GitHub Pages (Recommended)

The app automatically deploys to GitHub Pages when you push to `main` branch.

**Setup:**
1. Go to your repository settings
2. Under "Code and automation" → "Pages"
3. Select "Deploy from a branch"
4. Choose branch: `main`
5. Save

Your app will be live at: `https://GITHUB_USERNAME.github.io/group-3-INFINITY-LINK-PROJECT`

## 2. Vercel (Fast Alternative)

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repository
4. Click "Deploy"

Your app will be at: `https://your-project-name.vercel.app`

## 3. Netlify

1. Go to [netlify.com](https://netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Connect your GitHub account
4. Select the repository
5. Deploy

Your app will be at: `https://your-site-name.netlify.app`

## 4. Local Testing

To test locally before hosting:

```bash
# Option 1: Using Python (built-in)
python -m http.server 8000

# Option 2: Using Node.js
npx http-server

# Option 3: Using PHP (built-in)
php -S localhost:8000
```

Then open: `http://localhost:8000`

## Features Included

✅ Real-time P2P messaging  
✅ Works on all devices (mobile, tablet, desktop)  
✅ No server required - peer-to-peer  
✅ WebRTC + STUN servers for NAT traversal  
✅ End-to-end encrypted messaging  
✅ Works offline and online  
✅ Instant link sharing  

## Deployment Checklist

- [x] All HTML/CSS/JS files present
- [x] No compilation needed (static site)
- [x] HTTPS enabled on hosting platform
- [x] CORS and CSP configured
- [x] WebRTC STUN servers configured
- [x] GitHub Pages workflow ready

## How It Works

When hosted:
1. User visits your domain
2. They create a room or join via link
3. WebRTC peer connections established
4. Real-time messaging begins
5. No central server required

## Troubleshooting

**Issue: "Failed to establish connection"**
- Check that HTTPS is enabled
- Ensure STUN servers are reachable
- Try with different network (WiFi vs mobile data)

**Issue: "Messages not sending"**
- Wait 2-3 seconds for connection to stabilize
- Check browser console for errors
- Try refreshing and rejoining

**Issue: "Multiple people can't connect"**
- Peer-to-peer connections require 1 host + guests
- Host creates room first
- Guests join via shared link
- Check NAT/firewall settings if issues persist

## Domain Setup (Custom Domain)

For GitHub Pages with custom domain:
1. Create `CNAME` file in repository root with your domain name
2. Configure DNS records to point to GitHub Pages
3. Enable HTTPS in Pages settings

For Vercel/Netlify: Follow their domain setup guides (automatic with free SSL)

## Performance Notes

- App uses minimal bandwidth (P2P only)
- Works with unstable connections (message queuing)
- Optimized for mobile (48px touch targets)
- Fast - no server round trips
- Scales to any number of users (decentralized)

## Security Notes

- Uses WebRTC DataChannels (encrypted by default)
- Public key fingerprints verified for trust
- No messages stored on servers
- No tracking or analytics
- Works entirely in browser

---

**Ready to host?** Push your code and your app goes live! 🚀
