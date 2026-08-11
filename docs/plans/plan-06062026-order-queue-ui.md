# Plan: BullMQ Order Sync Queue UI

## Environment
- Worker repo: /srv/price-insight
- Current branch: feature/load_orders
- Coordination repo: /srv/price-insight

## Source Task File
- Task file: task-06062026-order-queue-ui.md (previous UI mock task)
- Note: The queue backend task was provided inline, not as a file.

## Task Summary
Build /queue/orders frontend page for monitoring BullMQ Shopify order sync jobs.
Mock data only in this pass — no real BullMQ backend integration.
COMPLETED 2026-06-06.

## Approval Status
APPROVED TO IMPLEMENT — implemented 2026-06-06.

## Implementation Notes
- 4 files changed: AppNav.vue (1 line), + 3 new files
- Lint: 1 pre-existing error in competitor-products.vue, 24 pre-existing warnings — no new issues
- typecheck task not available in frontend package; lint is the available validator
- Refresh simulates 300ms async delay; lastRefreshed updates to current time
- Status filter uses USelect with value-key="value" to match existing orders page pattern
