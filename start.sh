#!/bin/bash
set -e
cd /workspace/server
node index.js &
cd /workspace/client
exec npm run dev -- --host 0.0.0.0 --port 5173
