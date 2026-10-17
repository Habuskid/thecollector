# The Collector - Collector Crypt Plugin for PayBox

The Collector connects autonomous AI agents to **Collector Crypt** physical vaults via **PayBox**. It enables agents to inspect authenticated physical collectibles (graded Pokemon cards, sports slabs, vintage WOTC packs) and purchase them with PayBox USDC on Base or Solana.

Physical items are stored in insured, climate-controlled biometric vault facilities (Geneva FreePort, Switzerland and Delaware Vault, USA).

---

## Features

- **Live Vault Inventory Exploration (`explore_vault_packs`)**:
  - Filter by category: `pokemon`, `sports`, `vintage`, `gacha`, or `all`.
  - Filter by maximum budget in USDC (`maxPriceUsdc`).
  - View vault location, PSA/CGC grading standards, price, and current machine status.

- **Non-Custodial Pack Purchasing (`propose_pack_purchase`)**:
  - Creates an official, structured `io.paybox/transactionProposal` x402 payment challenge.
  - Supports Base USDC (`eip155:8453`) and Solana USDC (`solana:mainnet`).
  - Embeds target pack ID, vault destination, and timestamp.
  - Zero blind signing: PayBox retains execution and requires user approval.

---

## Tools

### 1. `explore_vault_packs`
Browse authenticated physical collectible packs, live gacha machines, and PSA 10 slabs in the Collector Crypt vault.

**Input parameters:**
- `category` (optional, string): `"all"`, `"pokemon"`, `"sports"`, `"vintage"`, or `"gacha"`.
- `maxPriceUsdc` (optional, number): Maximum price filter in USDC.

**Example Response:**
```json
{
  "packs": [
    {
      "id": "elite-pokemon-gacha-50",
      "name": "Elite Pokémon Gacha Pack",
      "category": "pokemon",
      "priceUsdc": "50.00",
      "priceAtomic": "50000000",
      "status": "live_machine",
      "description": "Contains 1 physical authenticated vintage or modern Pokémon holo card. Top hits include Base Set Charizard PSA 9/10, Umbreon VMAX Alt Art.",
      "vaultLocation": "Collector Crypt Delaware Vault, USA",
      "psaGrade": "PSA 9 - 10 Guaranteed"
    }
  ],
  "totalAvailable": 1,
  "vaultPartner": "Collector Crypt Vault Services"
}
```

### 2. `propose_pack_purchase`
Generates an official PayBox USDC transaction proposal to purchase or open a physical collectible pack from Collector Crypt on Base or Solana.

**Input parameters:**
- `packId` (required, string): ID of the vault pack (e.g., `elite-pokemon-gacha-50`, `psa10-only-500`).
- `chain` (optional, string): `"eip155:8453"` (Base, default) or `"solana:mainnet"`.

**Example Output:**
Generates a compliant `io.paybox/transactionProposal` with atomic price formatting and an unforgeable 4-minute expiry window.

---

## Development

```bash
# Install dependencies
pnpm install

# Typecheck
pnpm typecheck

# Build bundle
pnpm build
```

Bundle output is placed at `dist/plugin.mjs`.

---

## Protocol & Specification Compliance

- **Model Context Protocol (MCP)**: JSON-RPC 2.0 / `2026-07-28` protocol version.
- **PayBox Proposal Specification**: Valid `io.paybox/transactionProposal` with `x402` kind, strict ISO 8601 whole-second expiry, and chain validation.
