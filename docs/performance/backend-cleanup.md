# Conservative backend cleanup

The cleanup reviewed 244 unshared backend JavaScript modules with an AST inventory and repository searches. Public exports, executable entry points, dynamic tools and compatibility migrations were retained. No unreferenced private function was established by that review.

Two unused imports were removed: `readdirSync` from the installer engine and `randomUUID` from user tools. The engine's two imports from its download module were combined. Both imported modules remain loaded for their other used exports; no import-time behavior is removed.

The memory estimator's largest-dedicated-GPU selection now makes one stable pass instead of allocating and sorting a filtered array. It still selects one card, never sums VRAM, ignores shared/unknown/non-finite capacity, and preserves the first card when capacities tie. Frozen and sparse inventories remain supported.

## Measurements

A seven-round, alternating-order microbenchmark compared the previous source module with the current module using synthetic inventories. The table reports median total elapsed time for the complete loop, not the time for one UI interaction.

| Operation                | Inventory  | Iterations |  Previous |   Current |
| ------------------------ | ---------- | ---------: | --------: | --------: |
| Largest-card selection   | One card   |    200,000 |  7.854 ms |  2.834 ms |
| Complete memory estimate | One card   |     50,000 | 20.046 ms | 17.979 ms |
| Largest-card selection   | Four cards |    200,000 | 23.736 ms |  3.673 ms |
| Complete memory estimate | Four cards |     50,000 | 26.198 ms | 17.630 ms |

This removes temporary selection arrays and changes the selection from sorting to linear traversal. The absolute cost was already small; these measurements do not establish a comparable improvement in application startup, model inference or overall UI speed. No hardware query, polling loop or cache was added.

Focused checks compare the prior selection rule with 200 deterministic varied inventories and verify native Wizard/runtime estimate parity. Existing tool discovery, approval binding, AppContainer permissions, executable/Python execution, network denial and cancellation tests also pass. Installer output has a separate real Windows PowerShell check for UTF-8 status and warning text without trailing newlines.
