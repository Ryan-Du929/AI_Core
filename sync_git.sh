#!/usr/bin/env bash
# sync_git.sh — Commit + Push workspace changes to GitHub
set -euo pipefail

REPO_DIR="/home/node/.openclaw/workspace-your"
REMOTE="origin"
BRANCH="main"
TS="$(date '+%Y-%m-%d %H:%M UTC+8')"

cd "$REPO_DIR"

# Sync .gitignore first if it exists
if [ -f "$REPO_DIR/.gitignore" ]; then
  git add "$REPO_DIR/.gitignore" 2>/dev/null || true
fi

# Pull latest first
git pull "$REMOTE" "$BRANCH" --ff-only 2>/dev/null || true

# Stage all changes (honors .gitignore)
git add -A

if ! git diff --cached --quiet; then
  # Build a meaningful summary message
  FILES=$(git diff --cached --name-only | head -20 | tr '\n' ' ')
  if [ -z "$FILES" ]; then
    GIT_MSG="[auto-sync] $TS"
  else
    GIT_MSG="[auto-sync] $TS — ${FILES:0:200}"
  fi
  git commit -m "$GIT_MSG"
  git push "$REMOTE" "$BRANCH" 2>&1
  echo "✅ Synced to GitHub ($(git rev-parse --short HEAD))"
else
  echo "⚡ No changes to sync"
fi