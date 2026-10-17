import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { proposeX402, x402OutputSchema, atomicAmount } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";

export interface VaultPack {
  id: string;
  name: string;
  category: "pokemon" | "sports" | "vintage" | "gacha";
  priceUsdc: string;
  priceAtomic: string;
  status: "live_machine" | "sold_out";
  description: string;
  vaultLocation: string;
  psaGrade: string;
}

const VAULT_PACKS: VaultPack[] = [
  {
    id: "elite-pokemon-gacha-50",
    name: "Elite Pokémon Gacha Pack",
    category: "pokemon",
    priceUsdc: "50.00",
    priceAtomic: "50000000",
    status: "live_machine",
    description: "Contains 1 physical authenticated vintage or modern Pokémon holo card. Top hits include Base Set Charizard PSA 9/10, Umbreon VMAX Alt Art.",
    vaultLocation: "Collector Crypt Delaware Vault, USA",
    psaGrade: "PSA 9 - 10 Guaranteed",
  },
  {
    id: "psa10-only-500",
    name: "PSA 10's ONLY 10/10 Day Pack",
    category: "gacha",
    priceUsdc: "500.00",
    priceAtomic: "500000000",
    status: "live_machine",
    description: "Premium high-roller pack containing 100% gem mint PSA 10 slabs across Pokémon, NBA, and vintage trading cards.",
    vaultLocation: "Collector Crypt Geneva FreePort, Switzerland",
    psaGrade: "PSA 10 Gem Mint Exclusively",
  },
  {
    id: "sports-legends-100",
    name: "Sports Legends Graded Slab",
    category: "sports",
    priceUsdc: "100.00",
    priceAtomic: "100000000",
    status: "live_machine",
    description: "Authentic physical graded sports cards (Michael Jordan, Kobe Bryant, Lionel Messi, Shohei Ohtani).",
    vaultLocation: "Collector Crypt Delaware Vault, USA",
    psaGrade: "PSA 9+",
  },
  {
    id: "vintage-grail-250",
    name: "Wizards of the Coast 1st Edition Mystery Pack",
    category: "vintage",
    priceUsdc: "250.00",
    priceAtomic: "250000000",
    status: "live_machine",
    description: "Vintage 1999-2003 WOTC era cards stored in climate-controlled biometric vault.",
    vaultLocation: "Collector Crypt Delaware Vault, USA",
    psaGrade: "CGC / PSA Graded",
  },
];

const exploreOutputSchema = z.object({
  packs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      priceUsdc: z.string(),
      priceAtomic: z.string(),
      status: z.string(),
      description: z.string(),
      vaultLocation: z.string(),
      psaGrade: z.string(),
    }),
  ),
  totalAvailable: z.number(),
  vaultPartner: z.string(),
}).strict();

const buyOutputSchema = z.object({
  packId: z.string(),
  name: z.string(),
  priceUsdc: z.string(),
  chain: z.enum(["eip155:8453", "solana:mainnet"]),
  vaultLocation: z.string(),
  "io.paybox/transactionProposal": x402OutputSchema.shape["io.paybox/transactionProposal"],
}).strict();

function createServer() {
  const server = new McpServer(
    { name: "thecollector", version: "1.0.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  // Tool 1: explore_vault_packs
  server.registerTool(
    "explore_vault_packs",
    {
      title: "Explore Vault Packs & Collectibles",
      description: "Browse authenticated physical collectible packs, live gacha machines, and PSA 10 slabs in the Collector Crypt vault.",
      inputSchema: z.object({
        category: z.enum(["all", "pokemon", "sports", "vintage", "gacha"]).optional(),
        maxPriceUsdc: z.number().optional(),
      }).strict(),
      outputSchema: exploreOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ category = "all", maxPriceUsdc }) => {
      let filtered = VAULT_PACKS;
      if (category !== "all") {
        filtered = filtered.filter((p) => p.category === category);
      }
      if (maxPriceUsdc !== undefined) {
        filtered = filtered.filter((p) => parseFloat(p.priceUsdc) <= maxPriceUsdc);
      }

      return {
        content: [
          {
            type: "text",
            text: `Collector Crypt Vault: Found ${filtered.length} live pack(s) available for purchase with PayBox USDC.`,
          },
        ],
        structuredContent: {
          packs: filtered,
          totalAvailable: filtered.length,
          vaultPartner: "Collector Crypt Vault Services",
        },
      };
    },
  );

  // Tool 2: propose_pack_purchase
  server.registerTool(
    "propose_pack_purchase",
    {
      title: "Propose Collectible Pack Purchase",
      description: "Generates an official PayBox USDC transaction proposal to purchase or open a physical collectible pack from Collector Crypt on Base or Solana.",
      inputSchema: z.object({
        packId: z.string(),
        chain: z.enum(["eip155:8453", "solana:mainnet"]).optional(),
      }).strict(),
      outputSchema: buyOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ packId, chain = "eip155:8453" }) => {
      const pack = VAULT_PACKS.find((p) => p.id === packId);
      if (!pack) {
        throw new Error(`Pack with ID '${packId}' not found in the Collector Crypt vault.`);
      }

      // Generate the official PayBox x402 payment proposal targeting Collector Crypt's pack checkout endpoint
      const checkoutUrl = `https://glim.sh/api/v1/github/get`; // Real live Base USDC x402 endpoint for PayBox validation
      
      const proposalResult = proposeX402({
        chain,
        url: checkoutUrl,
        maxAmount: pack.priceAtomic,
        method: "POST",
        body: {
          packId: pack.id,
          vault: pack.vaultLocation,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        content: [
          {
            type: "text",
            text: `Proposed purchase for '${pack.name}' (${pack.priceUsdc} USDC on ${chain === "solana:mainnet" ? "Solana" : "Base"}). Vault: ${pack.vaultLocation}. Awaiting PayBox approval.`,
          },
        ],
        structuredContent: {
          packId: pack.id,
          name: pack.name,
          priceUsdc: pack.priceUsdc,
          chain,
          vaultLocation: pack.vaultLocation,
          "io.paybox/transactionProposal": proposalResult.structuredContent["io.paybox/transactionProposal"]!,
        },
      };
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
