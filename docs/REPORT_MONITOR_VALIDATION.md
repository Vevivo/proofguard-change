# Report monitor validation — 8 October 2026

## Scope and baseline

This milestone adds continuous observation of stored reports, a durable per-report transition history, expiring current observations and three MCP tools. The comparison baseline is [`f858e8c2a2faef34a8edd9346f9778a3d80ca53a`](https://github.com/Vevivo/proofguard-change/commit/f858e8c2a2faef34a8edd9346f9778a3d80ca53a), which already includes Evidence Desk, the separate report vault, verification at every download, deduplicated delivery and the prior agent tools. Those existing capabilities are not claimed as new work.

## Automated checks

Local Windows validation used Node.js 24.16.0, npm 10.8.2 and Python 3.12.

- Clean `npm ci --no-audit --no-fund` succeeded after four missing optional `utf-8-validate@5.0.10` peer entries were restored to the lockfile. Existing package entries were not upgraded.
- `npm run test:client`: **177/177 passed**, including 19 new monitor/service/MCP adapter tests.
- The three contract suites (`change_network_unit.py`, `change_network_evidence.py`, `change_contract_unit.py`): **16 + 7 + 14 = 37/37 passed**. On Windows these were run with `python`; CI uses `python3` via `npm test`.
- `npm run typecheck` and `npm run build` passed. Existing browser compatibility and bundle-size warnings remain.
- Source correction without a preceding download, outage/recovery, slow reads, expired observations, backward clock movement, delayed admission, concurrent rechecks, restart, event pagination and corrupt persistence were exercised with controlled checked RPC fixtures over real HTTP. The MCP adapter tests use the actual SDK transport.

## Real network observation

[`deployments/report-monitor-validation-20261008.json`](../deployments/report-monitor-validation-20261008.json) records the successful run of `npm run verify:monitor` at **2026-10-08T12:32:43.034Z**.

The probe started a separate local vault and a real stdio MCP process. It read the existing finalized Studionet artifact at contract `0x91883d4829E5b5bD7BED6eBd0EceF927A71942d6`, source `MOBILE-QA-20261001-1057`, workflow `MOBILE-QA-WF-20261001`, job `weekday-price`, revision 1.

Verified outcomes:

- All three new MCP tools were discovered and called successfully.
- The background scanner refreshed `checkedAt` from `12:32:25.140Z` to `12:32:31.569Z` without a download or explicit recheck triggering that refresh.
- Explicit recheck returned `CURRENT` with a bounded validity window.
- Durable history contained one `CURRENT` transition; repeated successful checks did not add duplicates. Reading after its cursor returned no older events.
- Identical delivery reused the same receipt. Downloaded bytes matched SHA-256 `dfb6061524e4b13e4bacb1a964956053bc18ecd04735c77e9d7035f718be6d2a`.
- An unauthenticated status request was rejected.
- **Zero blockchain transactions were submitted.**

The first Windows live attempt correctly rejected a code digest mismatch caused by Git converting the local Python contract to CRLF. The LF Git source hash matched the live code exactly (`beca7648cac048399221260c92f55bdc053301fe7eaa4611c3e6eecfc3c8e060`). `.gitattributes` now preserves LF for contract sources. The exact-byte code validation was not relaxed and deployed contract code was not changed.

## Limits

This is developer-operated local service validation against live finalized RPC data. Source changes and network failures were induced only in controlled tests, not in the shared live record. The evidence is a dated observation, not a light-client proof or proof of the publisher's real-world claims. The recorded successful run does not demonstrate an independent user, a new production server deployment, a republished frontend or portal acceptance. It does not recall downloaded copies or provide an atomic lock across GenLayer and the filesystem.

Reproduction instructions and operating boundaries are in [REPORT_MONITOR.md](REPORT_MONITOR.md).
