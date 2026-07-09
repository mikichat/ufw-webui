#!/usr/bin/env bash

set -euo pipefail

rm -rf dist
mkdir -p dist
cp -a apps/server/dist dist/
cp -a apps/server/public dist/
cp apps/server/package.json dist/package.json
