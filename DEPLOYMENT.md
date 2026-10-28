# Canyon Rush — Production Deployment & Service Guide

This document details how to build, run, and deploy both the **Next.js Web Game** and the **Multiplayer Racing Service** in development and production environments.

---

## Architecture Overview

Canyon Rush consists of two core services that run concurrently:

| Service | Technology | Port | Purpose |
| :--- | :--- | :--- | :--- |
| **Web Game Client & API** | Next.js 16 (Standalone), React 19, Three.js | `3000` | Game UI, 3D WebGL engine, leaderboards, PWA shell |
| **Multiplayer Racing Service** | Bun / Node.js, Socket.IO | `3003` | Authoritative lobbies, room state, chat, position relay |

---

## 1. Development Mode (Both Services)

To run both services simultaneously during local development:

```bash
# Bun is required, including when invoking the scripts with npm.
bun install
(cd mini-services/racing-service && bun install)
# Run both Next.js (port 3000) and Multiplayer (port 3003) together
npm run dev
# or
bun run dev
```

This invokes [`run-all.sh`](./run-all.sh), which boots both services and manages graceful termination (`Ctrl+C`).

**Access URLs:**
- Local browser: `http://localhost:3000`
- Local Wi-Fi (mobile test): `http://<your-local-ip>:3000`
- Multiplayer Socket: `http://localhost:3003`

---

## 2. Production Build

Before running in production, compile the Next.js standalone package:

```bash
# 1. Install dependencies (root & racing-service)
bun install
(cd mini-services/racing-service && bun install)

# 2. Build standalone Next.js production package
bun run build
# or: npm run build
```

This compiles optimized bundles into `.next/standalone/`, ready for zero-dependency containerized or bare-metal execution.

---

## 3. Running in Production Mode

### Option A: Automated Production Runner (Simplest)

Use the built-in production launcher script [`start-prod.sh`](./start-prod.sh):

```bash
npm run start
# or
bun run start
# or directly:
./start-prod.sh
```

**What it does:**
- Verifies `.next/standalone` production build exists (builds automatically if missing).
- Starts the **Multiplayer Service** (`mini-services/racing-service/index.ts`) on port `3003`.
- Starts the **Next.js Standalone Server** (`.next/standalone/server.js`) on port `3000`.
- Binds to `0.0.0.0` so external traffic and local network clients can connect.
- Handles `SIGTERM`/`SIGINT` to gracefully shut down both services.

---

### Option B: Using PM2 Process Manager (Recommended for Linux/Cloud VPS)

PM2 provides auto-restart on crash, server reboot persistence, and log rotation.

An [`ecosystem.config.js`](./ecosystem.config.js) configuration is pre-configured in the repository:

```bash
# Install PM2 globally if needed
npm install -g pm2

# Start both services
pm2 start ecosystem.config.js

# Check status
pm2 status

# View live streaming logs
pm2 logs

# Configure PM2 to start on system boot
pm2 startup
pm2 save
```

**Management commands:**
```bash
pm2 restart all   # Restart both services
pm2 stop all      # Stop both services
pm2 reload all    # Zero-downtime reload
```

---

### Option C: Individual Microservice Commands

If running via Docker containers, separate systemd units, or manual tabs:

1. **Multiplayer Racing Service (Port 3003):**
   ```bash
   npm run start:racing
   # Equivalent:
   cd mini-services/racing-service && NODE_ENV=production bun index.ts
   ```

2. **Next.js Web Game (Port 3000):**
   ```bash
   npm run start:web
   # Equivalent:
   NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 bun .next/standalone/server.js
   ```

---

## 4. Reverse Proxy & SSL Configuration (Nginx / Caddy)

For public internet deployment with a custom domain and HTTPS (required for PWA 1-click installation):

### Nginx Configuration

Create `/etc/nginx/sites-available/canyon-rush`:

```nginx
server {
    listen 80;
    server_name yourgame.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourgame.com;

    ssl_certificate     /etc/letsencrypt/live/yourgame.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourgame.com/privkey.pem;

    # Gzip / Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;

    # 1. Next.js Web Game & Static Assets
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 2. Multiplayer WebSocket Service (Socket.IO)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Enable the site and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/canyon-rush /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

### Caddy Configuration

If using Caddy (automatic SSL generation via Let's Encrypt):

```caddyfile
yourgame.com {
    # Socket.IO Multiplayer traffic
    @websockets {
        path /socket.io/*
    }
    reverse_proxy @websockets localhost:3003

    # Web Game Client & Next.js API
    reverse_proxy localhost:3000
}
```

---

## 5. Environment Variables & Database

Ensure `.env` in the root contains the absolute or valid relative path to the SQLite database:

```env
DATABASE_URL=file:/path/to/canyon-rush/db/custom.db
```

To sync or migrate the database:
```bash
bun run db:push
bun run db:generate
```

---

## 6. PWA Installation Notes

- **HTTPS Required**: Browsers enforce the Secure Context requirement (`https://` or `localhost`) for PWA installation.
- When deployed with valid SSL, desktop Chrome/Edge will display the **⊕ Install** button in the omnibox, and the in-game **INSTALL GAME** button will trigger the native installation prompt immediately.
- On iOS Safari, players can tap **Share (⬆️) ➔ Add to Home Screen** to launch the game full-screen without address bars.


## Vercel WebSocket integration (experimental)

The repository includes `api/racing.ts` as a Vercel Function entry point, reusing the existing Socket.IO engine without starting a second port. Set `NEXT_PUBLIC_MP_MODE=vercel` in Vercel Project Settings **before building** to connect the client to the same-origin `/api/racing/socket.io` Socket.IO endpoint using WebSocket-only transport. Keep Framework Preset **Next.js**, Root Directory `./`, Build Command `npm run build`, Output Directory **default**, and Install Command `bun install`. The `ecosystem.config.js` PM2 config remains unchanged for VPS deployment.

**Not production-ready for multiplayer yet:** authoritative rooms, race progression, timers, and player reconnect tokens are currently stored in a process-local Map. Players assigned to different Vercel Function instances cannot share the same room. Function recycling can also discard races. Production deployment requires a shared durable room-state coordinator and cross-instance broadcasts, tested under multiple Function instances; adding the Socket.IO Redis adapter alone does not make authoritative game state durable. Database storage also uses local SQLite and requires a persistent production solution for leaderboards.

Do not assume that the new endpoint provides production multiplayer reliability until these issues are resolved and a live Vercel multi-client test succeeds.
