#!/bin/bash
# After the agent finishes, commit and push any repo changes to GitHub.

cat > /dev/null

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT"

LOG="$ROOT/.cursor/auto-push.log"
mkdir -p "$(dirname "$LOG")"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

BRANCH="$(git branch --show-current 2>/dev/null || true)"
if [ -z "$BRANCH" ]; then
  exit 0
fi

if git diff --quiet && git diff --cached --quiet; then
  exit 0
fi

git add -A

if git diff --cached --name-only | grep -qE '^\.env'; then
  log "blocked: refused to commit .env files"
  git reset HEAD
  exit 0
fi

if git diff --cached --quiet; then
  exit 0
fi

MSG="auto: sync changes ($(date '+%Y-%m-%d %H:%M'))"
if ! git commit -m "$MSG" >> "$LOG" 2>&1; then
  log "commit failed"
  exit 0
fi

if git push origin "$BRANCH" >> "$LOG" 2>&1; then
  log "pushed branch $BRANCH"
else
  log "push failed — check network or GitHub credentials"
fi

exit 0
