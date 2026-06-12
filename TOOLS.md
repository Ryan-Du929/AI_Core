# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

### Render API
- **API Key:** `rnd_QERWnDLfxgLnzPgtfx0dCc1kE1XZ`
- **服務列表:**
  - `lucas-dashboard` (static_site) — id: `srv-d8bc6kmk1jcs73as9i40`
  - `AI-agent` (web_service) — id: `srv-d84apcjeo5us73e6f8d0`
  - `AI_Line_bot` (web_service) — id: `srv-d84a6leq1p3s738q8dd0`

### GitHub 同步
- **Repo:** https://github.com/Ryan-Du929/MyAI_Setting.git
- **Branch:** main
- **Token:** 從 /app/workspace/.env 的 GITHUB_TOKEN 讀取
- **同步腳本:** /home/node/.openclaw/workspace-your/sync_git.sh
- **規則:** 每次有檔案變更時，記得 commit + push

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)
