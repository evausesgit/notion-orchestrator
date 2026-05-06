#!/usr/bin/env bash
set -euo pipefail

npm run build
node dist/cli.js version >/dev/null
node dist/cli.js help >/dev/null
