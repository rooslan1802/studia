#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: npm run git:rollback -- <commit_hash>"
  echo "Tip: git log --oneline -n 15"
  exit 1
fi

target="$1"

git revert --no-edit "$target"
git push
echo "Rollback completed with revert commit and pushed to origin."
