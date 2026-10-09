# Base (8453) explorer verification files

Exact Standard-JSON inputs for the contracts deployed on Base mainnet (Oct 2026),
built with Foundry v1.8.5 and solc 0.8.26. The Base hook launched with a 30% fee
falling to 2% over five minutes; later chains use 10% over two minutes, so the
current `src/` no longer matches Base byte for byte. Use these files to verify
Base contracts on BaseScan (Standard-Json-Input, v0.8.26+commit.8a97fa7a, MIT).
