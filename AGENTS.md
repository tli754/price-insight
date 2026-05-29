# Price Insight AI Workflow

The main repo is:
/srv/price-insight

Do not edit implementation files there.

Allowed worktrees:
- /home/tao/workers/pi-manager
- /home/tao/workers/pi-implementer
- /home/tao/workers/pi-tester

Testing worker must only edit:
/home/tao/workers/pi-tester

Before editing, every worker must report:
- pwd
- git branch
- git status --short

If not inside the assigned worktree, stop.

Rules:
- Never edit .env files.
- Never push, merge, or deploy without approval.
- Investigation comes before coding.
- Every worker must summarize files changed, risks, and test results.

Workers:
- pi-manager: planning, task files, review coordination
- pi-implementer: code changes only after approval
- pi-tester: tests, coverage, regression checks