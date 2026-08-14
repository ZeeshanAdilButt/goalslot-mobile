#!/usr/bin/env bash
# EAS Build runs this automatically after installing dependencies and before
# bundling — see https://docs.expo.dev/build-reference/npm-hooks/. It exists
# because `packages/shared/dist/` is gitignored (a build artifact, not
# source), so the archive EAS Build works from never contains it: Metro then
# fails to resolve `@goalslot/shared` at all ("main module field could not
# be resolved... dist/index.js"). A local `pnpm install` + `expo run` never
# hits this because a dev machine typically already has `dist/` built from
# normal day-to-day work in the monorepo.
set -euo pipefail

echo "[eas-build-post-install] Building @goalslot/shared..."
cd "$(dirname "$0")/../../packages/shared"
npx tsup
