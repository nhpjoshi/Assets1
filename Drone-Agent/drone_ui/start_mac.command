#!/bin/bash
# LabAtHome Ground Control - double-click launcher (macOS)
#
# First run: creates a venv and installs dependencies (takes a minute).
# Every run after that: starts instantly.
#
# Closing this Terminal window stops the server.

set -e
cd "$(dirname "$0")/backend"

if [ ! -d "venv" ]; then
  echo "First run - setting up (this takes a minute)..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -q -r requirements.txt
else
  source venv/bin/activate
fi

echo ""
echo "Starting LabAtHome Ground Control..."
echo "Dashboard will open automatically. Close this window to stop the server."
echo ""

# Open the browser a couple seconds after the server starts, once it's
# actually ready to serve requests.
( sleep 2 && open "http://localhost:8765" ) &

python3 -m uvicorn server:app --port 8765
