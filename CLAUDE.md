# Working Notes for Claude Code — Iron & Ink

## Verification / testing
- Do NOT start the dev server or run live browser tests unless I explicitly ask.
- Verify changes with `node --check` and code review only.
- If you believe a live/browser test is genuinely necessary, STOP and ask me first before doing it — do not launch it on your own.

## Deploys
- I deploy to production myself via `git pull && pm2 reload ironandink` on the server. You commit and push to master; I handle the deploy.
