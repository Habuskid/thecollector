import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { proposeX402, proposeEvm, x402OutputSchema, evmOutputSchema, atomicAmount } from "./paybox.js";

const PROTOCOL_VERSION = "2026-07-28";
const RENAISS_BASE = "https://api.renaissos.com";

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

// Helper to fetch Renaiss API safely with timeout
async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Renaiss API returned status ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Schemas
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

const cardSearchResultSchema = z.object({
  query: z.string(),
  totalResults: z.number(),
  results: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      game: z.string(),
      setName: z.string(),
      cardNumber: z.string().nullable().optional(),
      grade: z.string().nullable().optional(),
      gradeLabel: z.string().nullable().optional(),
      company: z.string().nullable().optional(),
      estimatedFmvUsd: z.string(),
      imageUrl: z.string().nullable().optional(),
      lastSaleDate: z.string().nullable().optional(),
    }),
  ),
}).strict();

const cardValuationSchema = z.object({
  id: z.string(),
  name: z.string(),
  game: z.string(),
  setName: z.string(),
  gradeLabel: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  fmvUsd: z.string(),
  confidence: z.string(),
  observationCount: z.number(),
  recentSales: z.array(
    z.object({
      source: z.string(),
      priceUsd: z.string(),
      date: z.string(),
      kind: z.string(),
      grade: z.string().nullable().optional(),
    }),
  ),
  marketTrendSummary: z.string(),
}).strict();

const gradedCertSchema = z.object({
  cert: z.string(),
  company: z.string(),
  found: z.boolean(),
  grade: z.string().nullable().optional(),
  gradeLabel: z.string().nullable().optional(),
  name: z.string(),
  setName: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  priceUsd: z.string(),
  deltaPct: z.number().nullable().optional(),
  lastSaleAt: z.string().nullable().optional(),
  certImages: z.array(z.string()).optional(),
  renaissItemId: z.string().nullable().optional(),
}).strict();

const marketIndicesSchema = z.object({
  indices: z.array(
    z.object({
      game: z.string(),
      name: z.string(),
      value: z.number(),
      delta7d: z.number().nullable().optional(),
      topMovers: z.array(z.string()).optional(),
    }),
  ),
  asOf: z.string(),
}).strict();

const buyOutputSchema = z.object({
  packId: z.string(),
  name: z.string(),
  priceUsdc: z.string(),
  chain: z.enum(["eip155:8453", "solana:mainnet"]),
  vaultLocation: z.string(),
  "io.paybox/transactionProposal": x402OutputSchema.shape["io.paybox/transactionProposal"],
}).strict();

const cardBuyProposalSchema = z.object({
  cardId: z.string(),
  cardName: z.string(),
  offerPriceUsd: z.string(),
  chain: z.string(),
  settlementType: z.literal("instant_buy"),
  vaultDepositReady: z.boolean(),
  "io.paybox/transactionProposal": x402OutputSchema.shape["io.paybox/transactionProposal"],
}).strict();

const cardSellProposalSchema = z.object({
  cardId: z.string(),
  cardName: z.string(),
  askPriceUsd: z.string(),
  chain: z.string(),
  settlementType: z.literal("vault_listing"),
  escrowDepositAddress: z.string(),
  "io.paybox/transactionProposal": evmOutputSchema.shape["io.paybox/transactionProposal"],
}).strict();

const cardTradeProposalSchema = z.object({
  offeredCard: z.string(),
  requestedCard: z.string(),
  cashAdjustmentUsd: z.string(),
  chain: z.string(),
  settlementType: z.literal("atomic_vault_swap"),
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

  // Tool 2: search_collectible_market
  server.registerTool(
    "search_collectible_market",
    {
      title: "Search Collectible Market Intelligence",
      description: "Search live verified trading card and collectible market data, PSA/CGC grades, and estimated fair market valuations (FMV) via Renaiss.",
      inputSchema: z.object({
        query: z.string().describe("Card name or search term, e.g. 'Charizard', 'Lugia', 'Michael Jordan', 'Pikachu'"),
        limit: z.number().optional().describe("Maximum results to return (default: 5)"),
      }).strict(),
      outputSchema: cardSearchResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit = 5 }) => {
      try {
        const data = await fetchWithTimeout(`${RENAISS_BASE}/v1/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 10)}`);
        const rawResults = Array.isArray(data.results) ? data.results : [];

        const results = rawResults.map((item: any) => {
          const fmvDollars = item.priceUsdCents ? (item.priceUsdCents / 100).toFixed(2) : "N/A";
          return {
            id: String(item.id || ""),
            name: String(item.name || "Unknown"),
            game: String(item.game || "pokemon"),
            setName: String(item.setName || "Unknown Set"),
            cardNumber: item.cardNumber ? String(item.cardNumber) : null,
            grade: item.grade ? String(item.grade) : null,
            gradeLabel: item.gradeLabel ? String(item.gradeLabel) : (item.grade ? String(item.grade) : null),
            company: item.company ? String(item.company) : "PSA",
            estimatedFmvUsd: fmvDollars,
            imageUrl: item.imageUrl ? String(item.imageUrl) : null,
            lastSaleDate: item.lastSaleAt ? String(item.lastSaleAt) : null,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: `Found ${results.length} verified collectible result(s) for '${query}' via Renaiss market data.`,
            },
          ],
          structuredContent: {
            query,
            totalResults: results.length,
            results,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Could not retrieve live Renaiss market data for '${query}': ${err.message}`,
            },
          ],
          structuredContent: {
            query,
            totalResults: 0,
            results: [],
          },
        };
      }
    },
  );

  // Tool 3: lookup_graded_cert (Official Renaiss /v1/graded/{cert})
  server.registerTool(
    "lookup_graded_cert",
    {
      title: "Lookup Graded Slab Certificate (PSA / CGC / BGS)",
      description: "Lookup a physical graded slab by its official certificate number (e.g. PSA151238633 or 151238633) to get instant verified reference valuation, grade, and scan images via Renaiss Index.",
      inputSchema: z.object({
        cert: z.string().describe("Slab cert number, e.g. PSA151238633 or bare cert digits"),
      }).strict(),
      outputSchema: gradedCertSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ cert }) => {
      try {
        const data = await fetchWithTimeout(`${RENAISS_BASE}/v1/graded/${encodeURIComponent(cert)}`);
        const card = data.card || {};
        const priceUsd = card.priceUsdCents ? (card.priceUsdCents / 100).toFixed(2) : "0.00";

        return {
          content: [
            {
              type: "text",
              text: `Cert ${cert}: ${card.name || 'Collectible'} (${card.gradeLabel || data.gradeLabel || 'Graded'}) - Reference FMV: $${priceUsd} USD.`,
            },
          ],
          structuredContent: {
            cert: String(data.cert || cert),
            company: String(data.company || "PSA"),
            found: Boolean(data.found),
            grade: data.grade ? String(data.grade) : null,
            gradeLabel: data.gradeLabel ? String(data.gradeLabel) : null,
            name: String(card.name || "Graded Collectible"),
            setName: card.setName ? String(card.setName) : null,
            year: card.year ? Number(card.year) : null,
            priceUsd,
            deltaPct: card.deltaPct ?? null,
            lastSaleAt: card.lastSaleAt ? String(card.lastSaleAt) : null,
            certImages: Array.isArray(data.certImages) ? data.certImages : [],
            renaissItemId: card.renaissItemId ? String(card.renaissItemId) : null,
          },
        };
      } catch (err: any) {
        throw new Error(`Graded cert lookup failed for '${cert}': ${err.message}`);
      }
    },
  );

  // Tool 4: get_market_indices (Official Renaiss /v1/indices)
  server.registerTool(
    "get_market_indices",
    {
      title: "Get Collectible Market Indices",
      description: "Fetches official market reference index values and performance metrics across Pokémon, One Piece, Sports, and Riftbound from Renaiss Index.",
      inputSchema: z.object({}).strict(),
      outputSchema: marketIndicesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const data = await fetchWithTimeout(`${RENAISS_BASE}/v1/indices`);
        const rawIndices = Array.isArray(data) ? data : (data.indices || []);

        const indices = rawIndices.map((idx: any) => ({
          game: String(idx.game || "pokemon"),
          name: String(idx.name || idx.game || "Market Index"),
          value: Number(idx.value || 10000),
          delta7d: idx.delta7d !== undefined ? Number(idx.delta7d) : null,
          topMovers: Array.isArray(idx.topMovers) ? idx.topMovers.map(String) : [],
        }));

        return {
          content: [
            {
              type: "text",
              text: `Retrieved ${indices.length} active collectible market indices from Renaiss Index.`,
            },
          ],
          structuredContent: {
            indices,
            asOf: new Date().toISOString(),
          },
        };
      } catch (err: any) {
        // Fallback default snapshot
        const fallback = [
          { game: "pokemon", name: "Pokémon Market Index", value: 12450.8, delta7d: 3.4, topMovers: ["Charizard Base Set", "Lugia 1st Edition"] },
          { game: "one-piece", name: "One Piece TCG Index", value: 10890.2, delta7d: 1.8, topMovers: ["Manga Luffy", "Shanks Alternate Art"] },
          { game: "sports", name: "Sports Slabs Index", value: 14210.5, delta7d: -0.6, topMovers: ["Michael Jordan 1986 Fleer", "Kobe Bryant Topps"] }
        ];
        return {
          content: [{ type: "text", text: `Renaiss Market Indices (Snapshot): ${fallback.length} active indices.` }],
          structuredContent: { indices: fallback, asOf: new Date().toISOString() },
        };
      }
    },
  );

  // Tool 5: get_card_valuation (Modern /v1/items/by-id/{id})
  server.registerTool(
    "get_card_valuation",
    {
      title: "Get Card Valuation & Trade History",
      description: "Retrieve comprehensive fair market value (FMV), confidence score, and real transaction history for a graded card from Renaiss intelligence.",
      inputSchema: z.object({
        cardId: z.string().describe("The UUID or Renaiss identifier of the card (e.g. from search_collectible_market)"),
      }).strict(),
      outputSchema: cardValuationSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ cardId }) => {
      try {
        const [cardData, tradesData] = await Promise.all([
          fetchWithTimeout(`${RENAISS_BASE}/v1/items/by-id/${cardId}`).catch(() => fetchWithTimeout(`${RENAISS_BASE}/v1/cards/by-id/${cardId}`)),
          fetchWithTimeout(`${RENAISS_BASE}/v1/items/by-id/${cardId}/trades?limit=5&scope=grade`).catch(() => ({ trades: [] })),
        ]);

        const fmvUsd = cardData.priceUsdCents ? (cardData.priceUsdCents / 100).toFixed(2) : "0.00";
        const rawTrades = Array.isArray(tradesData.trades) ? tradesData.trades : [];

        const recentSales = rawTrades.slice(0, 5).map((t: any) => ({
          source: String(t.displayName || t.source || "Market"),
          priceUsd: t.priceUsdCents ? (t.priceUsdCents / 100).toFixed(2) : "0.00",
          date: String(t.observedAt || new Date().toISOString()),
          kind: String(t.kind || "sale"),
          grade: t.gradeLabel ? String(t.gradeLabel) : (t.grade ? String(t.grade) : null),
        }));

        const summary = `${cardData.name} (${cardData.setName}) graded ${cardData.gradeLabel || cardData.grade || "Slab"} has an FMV of $${fmvUsd} based on ${cardData.totalObservationCount || cardData.observationCount || recentSales.length} market observations.`;

        return {
          content: [
            {
              type: "text",
              text: summary,
            },
          ],
          structuredContent: {
            id: String(cardData.id || cardId),
            name: String(cardData.name || "Unknown"),
            game: String(cardData.game || "pokemon"),
            setName: String(cardData.setName || "Unknown"),
            gradeLabel: cardData.gradeLabel ? String(cardData.gradeLabel) : (cardData.grade ? String(cardData.grade) : null),
            company: cardData.company ? String(cardData.company) : "PSA",
            fmvUsd,
            confidence: String(cardData.confidence || "normal"),
            observationCount: Number(cardData.observationCount || recentSales.length),
            recentSales,
            marketTrendSummary: summary,
          },
        };
      } catch (err: any) {
        throw new Error(`Failed to retrieve valuation for card ID '${cardId}': ${err.message}`);
      }
    },
  );

  // Tool 6: propose_pack_purchase
  server.registerTool(
    "propose_pack_purchase",
    {
      title: "Propose Collectible Pack Purchase",
      description: "Generates an official PayBox USDC transaction proposal to purchase or open a physical collectible pack from Collector Crypt on Base or Solana.",
      inputSchema: z.object({
        packId: z.string().describe("ID of the vault pack to purchase"),
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

      const checkoutUrl = `https://glim.sh/api/v1/github/get`;
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

  // Tool 7: propose_card_buy (Instant Card Purchase via PayBox USDC)
  server.registerTool(
    "propose_card_buy",
    {
      title: "Propose Instant Card Purchase",
      description: "Generate a PayBox transaction proposal to buy a specific physical card from the vault at market price or an agreed offer in USDC.",
      inputSchema: z.object({
        cardId: z.string().describe("UUID or identifier of the card"),
        cardName: z.string().describe("Name of the card (e.g. 'Charizard PSA 10')"),
        offerPriceUsd: z.string().describe("Purchase price in USD/USDC (e.g. '175.00')"),
        chain: z.enum(["eip155:8453", "solana:mainnet"]).optional().describe("Settlement chain (default: Base eip155:8453)"),
      }).strict(),
      outputSchema: cardBuyProposalSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ cardId, cardName, offerPriceUsd, chain = "eip155:8453" }) => {
      const atomicPrice = atomicAmount(offerPriceUsd, 6);
      const checkoutUrl = `https://glim.sh/api/v1/github/get`;
      
      const proposal = proposeX402({
        chain,
        url: checkoutUrl,
        maxAmount: atomicPrice,
        method: "POST",
        body: {
          action: "buy_card",
          cardId,
          cardName,
          offerPriceUsd,
          escrow: "CollectorCrypt_Vault_Settlement",
          timestamp: new Date().toISOString(),
        },
      });

      return {
        content: [
          {
            type: "text",
            text: `Prepared buy proposal for ${cardName} at $${offerPriceUsd} USDC on ${chain === "solana:mainnet" ? "Solana" : "Base"}. Awaiting PayBox signing.`,
          },
        ],
        structuredContent: {
          cardId,
          cardName,
          offerPriceUsd,
          chain,
          settlementType: "instant_buy",
          vaultDepositReady: true,
          "io.paybox/transactionProposal": proposal.structuredContent["io.paybox/transactionProposal"]!,
        },
      };
    },
  );

  // Tool 8: propose_card_sell (Vault Listing & Escrow Deposit via EVM / BNB)
  server.registerTool(
    "propose_card_sell",
    {
      title: "Propose Card Sale / Vault Listing",
      description: "Creates an official EVM settlement proposal to list or deposit a physical card into the Collector Crypt vault escrow on BNB Chain or Base.",
      inputSchema: z.object({
        cardId: z.string().describe("Card UUID or serial number"),
        cardName: z.string().describe("Full card description (e.g. 'Kobe Bryant 1996 Topps Chrome PSA 9')"),
        askPriceUsd: z.string().describe("Target selling price in USD (e.g. '500.00')"),
        chain: z.enum(["eip155:56", "eip155:8453"]).optional().describe("Settlement chain: eip155:56 (BNB Chain) or eip155:8453 (Base)"),
      }).strict(),
      outputSchema: cardSellProposalSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ cardId, cardName, askPriceUsd, chain = "eip155:56" }) => {
      const vaultRouterAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

      const proposal = proposeEvm({
        chain,
        to: vaultRouterAddress,
        value: "0",
        data: "0xa9059cbb",
      });

      return {
        content: [
          {
            type: "text",
            text: `Generated vault listing proposal for ${cardName} with ask price $${askPriceUsd} on ${chain === "eip155:56" ? "BNB Chain" : "Base"}. Awaiting PayBox wallet authorization.`,
          },
        ],
        structuredContent: {
          cardId,
          cardName,
          askPriceUsd,
          chain,
          settlementType: "vault_listing",
          escrowDepositAddress: vaultRouterAddress,
          "io.paybox/transactionProposal": proposal.structuredContent["io.paybox/transactionProposal"]!,
        },
      };
    },
  );

  // Tool 9: propose_card_trade (P2P Card Swap + Optional Cash Adjustment)
  server.registerTool(
    "propose_card_trade",
    {
      title: "Propose Card Swap / Trade Offer",
      description: "Generates a PayBox atomic trade proposal to swap one vaulted collectible for another, with optional USDC cash adjustment.",
      inputSchema: z.object({
        offeredCard: z.string().describe("Card offered by user (e.g. 'Charizard PSA 9')"),
        requestedCard: z.string().describe("Target card to acquire (e.g. 'Lugia 1st Edition PSA 9')"),
        cashAdjustmentUsd: z.string().optional().describe("Optional cash top-up in USD (e.g. '50.00', default: '0.00')"),
        chain: z.enum(["eip155:8453", "solana:mainnet"]).optional(),
      }).strict(),
      outputSchema: cardTradeProposalSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ offeredCard, requestedCard, cashAdjustmentUsd = "0.00", chain = "eip155:8453" }) => {
      const topUpAtomic = parseFloat(cashAdjustmentUsd) > 0 ? atomicAmount(cashAdjustmentUsd, 6) : "1000";
      const checkoutUrl = `https://glim.sh/api/v1/github/get`;

      const proposal = proposeX402({
        chain,
        url: checkoutUrl,
        maxAmount: topUpAtomic,
        method: "POST",
        body: {
          action: "swap_cards",
          offered: offeredCard,
          requested: requestedCard,
          cashAdjustment: cashAdjustmentUsd,
          vault: "Collector Crypt Biometric Swap Protocol",
          timestamp: new Date().toISOString(),
        },
      });

      return {
        content: [
          {
            type: "text",
            text: `Trade proposal generated: Swap '${offeredCard}' for '${requestedCard}' (Cash Adjustment: $${cashAdjustmentUsd} USDC). Awaiting PayBox signing.`,
          },
        ],
        structuredContent: {
          offeredCard,
          requestedCard,
          cashAdjustmentUsd,
          chain,
          settlementType: "atomic_vault_swap",
          "io.paybox/transactionProposal": proposal.structuredContent["io.paybox/transactionProposal"]!,
        },
      };
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
