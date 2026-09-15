#!/usr/bin/env bash
# Crux Client — macOS build + GitHub release upload
#
# Run this INSIDE a macOS VM (or on a real Mac) from the project root:
#   bash scripts/release-mac.sh [version] [repo]
#
# Examples:
#   bash scripts/release-mac.sh              # uses package.json version, repo Dev-Reds/crux-client
#   bash scripts/release-mac.sh 1.1.70       # sets version, builds, uploads to default repo
#   bash scripts/release-mac.sh 1.1.70 Dev-Reds/website-nuxt
#
# Requires: node, npm, git, and the GitHub CLI (gh) authenticated via `gh auth login`.

set -euo pipefail

VERSION="${1:-}"
REPO="${2:-Dev-Reds/crux-client}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is not installed. Install it from https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: Not authenticated with gh. Run 'gh auth login' first." >&2
  exit 1
fi

if [ -n "$VERSION" ]; then
  node -e "
    const fs = require('fs');
    const pkg = require('./package.json');
    pkg.version = process.argv[1];
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 4) + '\n');
  " "$VERSION"
  echo "✔ package.json version set to $VERSION"
else
  VERSION="$(node -p "require('./package.json').version")"
fi

TAG="v$VERSION"
echo "→ Building Crux Client $TAG for macOS..."

# Keep the Mac build isolated so it never leaves Windows/Linux artifacts in the way.
rm -rf installer-mac
npx electron-builder --mac --publish=never --config.directories.output=installer-mac

ARTIFACT="$(ls installer-mac/*.zip installer-mac/*.dmg 2>/dev/null | head -n 1 || true)"
if [ -z "$ARTIFACT" ]; then
  echo "ERROR: No macOS artifact found in installer-mac/." >&2
  ls -la installer-mac 2>/dev/null || true
  exit 1
fi

echo "✔ Built: $ARTIFACT"

# Upload to the target release. Create the release if it does not exist yet.
echo "→ Uploading $ARTIFACT to $REPO release $TAG..."
if gh release upload "$TAG" "$ARTIFACT" --clobber -R "$REPO" 2>/dev/null; then
  echo "✔ Uploaded to existing release $TAG on $REPO"
else
  gh release create "$TAG" "$ARTIFACT" \
    --title "Crux Client $TAG" \
    --notes "Crux Client $TAG (macOS)" \
    -R "$REPO"
  echo "✔ Release $TAG created on $REPO with macOS artifact"
fi

echo ""
echo "Done!"
echo "  Release: https://github.com/$REPO/releases/tag/$TAG"
