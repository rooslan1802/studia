#!/usr/bin/env bash
set -euo pipefail

message="${1:-Backup: $(date '+%Y-%m-%d %H:%M')}"

git add -A

if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "$message"
fi

git push
echo "Backup completed and pushed to origin."
