#!/bin/sh
set -eu
./node_modules/.bin/tsx scripts/prepare-runtime.ts
exec ./node_modules/.bin/tsx src/server.ts
