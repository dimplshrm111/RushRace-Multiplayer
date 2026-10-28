#!/usr/bin/env bash

# CANYON RUSH — Dual Service Runner (Next.js App + Multiplayer Racing Service)

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install Bun and run bun install in the root and mini-services/racing-service."
  exit 1
fi
if [ ! -d mini-services/racing-service/node_modules ]; then
  echo "Install multiplayer dependencies first: (cd mini-services/racing-service && bun install)"
  exit 1
fi

cleanup() {
  echo ""
  echo "Shutting down Canyon Rush services..."
  kill $(jobs -p) 2>/dev/null
}

trap cleanup EXIT
trap 'exit 130' SIGINT
trap 'exit 143' SIGTERM

echo "=========================================================="
echo "🏎️  STARTING CANYON RUSH (App + Multiplayer Service)"
echo "=========================================================="

# 1. Start Multiplayer Service on port 3003
echo "📡 Starting Multiplayer Racing Service (Port 3003)..."
(cd mini-services/racing-service && bun run dev) &
RACING_PID=$!

# Wait a brief moment for Socket.IO to bind
sleep 1

# 2. Start Next.js App on port 3000
echo "🌐 Starting Next.js Web Game (Port 3000)..."
./node_modules/.bin/next dev -H 0.0.0.0 -p 3000 &
NEXT_PID=$!

echo ""
echo "✅ Both services running:"
echo "   - Web Game:            http://localhost:3000"
echo "   - Local Network (LAN): http://192.168.1.38:3000"
echo "   - Multiplayer Socket:  http://localhost:3003"
echo ""
echo "Press Ctrl+C to stop both services."
echo "=========================================================="

wait -n "$RACING_PID" "$NEXT_PID"
