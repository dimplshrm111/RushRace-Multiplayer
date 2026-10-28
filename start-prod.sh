#!/usr/bin/env bash

# CANYON RUSH — Production Runner (Next.js Standalone + Multiplayer Service)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

cleanup() {
  echo ""
  echo "🛑 Stopping Canyon Rush production services..."
  kill $(jobs -p) 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' SIGINT
trap 'exit 143' SIGTERM

echo "=========================================================="
echo "🏁 CANYON RUSH — PRODUCTION RUNNER"
echo "=========================================================="

# Check if standalone build exists, otherwise build it
if [ ! -f ".next/standalone/server.js" ]; then
  echo "⚙️ Standalone production build not found. Running build..."
  bun run build
fi

# Ensure racing-service dependencies are installed
if [ ! -d "mini-services/racing-service/node_modules" ]; then
  echo "📦 Installing racing-service dependencies..."
  (cd mini-services/racing-service && bun install)
fi

export NODE_ENV=production
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

# 1. Start Multiplayer Service on port 3003
echo "📡 Starting Multiplayer Service on port 3003..."
(cd mini-services/racing-service && NODE_ENV=production bun index.ts) &
RACING_PID=$!

sleep 1

# 2. Start Next.js Standalone Server on port 3000
echo "🌐 Starting Next.js Production Server on port $PORT..."
(NODE_ENV=production bun .next/standalone/server.js) &
WEB_PID=$!

echo ""
echo "🎉 Canyon Rush is LIVE in Production mode:"
echo "   - Web Game:   http://${HOSTNAME}:${PORT}"
echo "   - Multiplayer: Port 3003"
echo "=========================================================="

wait -n "$RACING_PID" "$WEB_PID"
