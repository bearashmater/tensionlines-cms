#!/bin/bash

# CMS Startup Script
# Checks if CMS is already running before starting a new instance

PORT=3001
CMS_DIR="/Users/admin/clawd/cms"

# Check if port 3001 is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  CMS already running on port $PORT"
    echo "   Use 'npm run dev' to access the running instance"
    echo "   Or kill the process: kill \$(lsof -t -i:$PORT)"
    exit 1
fi

# Start CMS server
echo "🚀 Starting CMS on port $PORT..."
cd "$CMS_DIR" && npm start
