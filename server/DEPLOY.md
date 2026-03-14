# WatchParty Signaling Server

## Deploy to Render (Free)

1. Push your code to GitHub
2. Go to [render.com](https://render.com) → New → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
5. Click **Deploy**

Once deployed, you'll get a URL like `https://watchparty-xxxx.onrender.com`.

Update the `SERVER_URL` in the extension code to use that URL (with `wss://` instead of `ws://`).
