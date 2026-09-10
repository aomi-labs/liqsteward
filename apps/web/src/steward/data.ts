export const products = [
  { name: 'NAV Oracle', category: 'Portfolio intelligence', headline: 'A clear view of every underlying position.', description: 'Trace nested holdings and liabilities to their underlying assets. Review valuations against approved sources, with the assumptions and exceptions in view.', features: ['Look-through exposure across nested positions', 'Source-aware, deterministic valuation', 'Reproducible reports with explicit exceptions'], output: 'Portfolio valuation report', color: 'lime' },
  { name: 'Incident Playground', category: 'Scenario analysis', headline: 'Examine the conditions that challenge your mandate.', description: 'Assess portfolio sensitivity, liquidity constraints, and response options under defined stress scenarios—before an incident requires a decision.', features: ['Forward scenarios and constraint-led analysis', 'Position-level effects and liquidity impacts', 'Explicit assumptions and execution evidence'], output: 'Scenario assessment', color: 'blue' },
  { name: 'Transaction Builder', category: 'Controlled execution', headline: 'From investment intent to a reviewable transaction.', description: 'Compare reallocation alternatives against your mandate. Inspect the proposed changes and validation results before the package reaches your signing process.', features: ['Alternative plans with explicit trade-offs', 'Mandate and transaction validation', 'Unsigned packages for manager-controlled signing'], output: 'Transaction approval package', color: 'peach' },
] as const;

// Synthetic, internally consistent data. Not a live vault, price feed, or fork receipt.
export const fixture = {
  id: 'steward-reference-01', vault: 'Reference USDC Vault', nav: 10_000_000,
  positions: [
    { label: 'cbBTC / USDC lending', amount: 3_840_000, share: 38.4, detail: 'USDC supplied to a cbBTC-collateralized market. Exposure denotes lending-market allocation, not direct cbBTC ownership.' },
    { label: 'WETH / USDC lending', amount: 3_160_000, share: 31.6, detail: 'USDC supplied to a WETH-collateralized market. Borrower collateral is not an additional vault asset.' },
    { label: 'Nested USDC vault', amount: 2_000_000, share: 20, detail: 'Look-through claims: $1.2m USDC lending and $0.8m USDC reserve. The parent share and its underlying claims are not double-counted.' },
    { label: 'Unallocated USDC', amount: 1_000_000, share: 10, detail: 'Unallocated balance, valued at the illustrative approved assumption of $1 per USDC.' },
  ],
  scenarios: [
    { label: 'Baseline', shock: 0, collateral: 6_000_000, ltv: 75, capacity: 1_400_000, liquidity: 0, verdict: 'Below liquidation threshold', breach: false },
    { label: 'Collateral −12%', shock: 12, collateral: 5_280_000, ltv: 85.23, capacity: 770_000, liquidity: 45, verdict: 'Near liquidation threshold', breach: false },
    { label: 'Collateral −15%', shock: 15, collateral: 5_100_000, ltv: 88.24, capacity: 770_000, liquidity: 45, verdict: 'Liquidation threshold exceeded', breach: true },
  ],
  plans: [
    { name: 'Targeted reallocation', move: 940_000, residual: 29, idle: 19.4, status: 'Within example mandate', allowed: true, note: 'Withdraw $940,000 from the cbBTC market and allocate it to the reserve. Reduces concentration below 30% while remaining within the 15% per-action limit.' },
    { name: 'Full market exit', move: 3_840_000, residual: 0, idle: 48.4, status: 'Movement limit exceeded', allowed: false, note: 'A full exit moves 38.4% of NAV. The illustrative per-action bound is 15%; this candidate is rejected.' },
    { name: 'Maintain allocation', move: 0, residual: 38.4, idle: 10, status: 'Concentration unresolved', allowed: false, note: 'No transaction is proposed. The cbBTC market remains above the illustrative 30% concentration limit.' },
  ],
};

export const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export type Relationship = { operator: string; venue: string; tool: string; source: string; supported?: boolean; note: string };
const vaultURL = (chain: string, address: string) => `https://app.morpho.org/${chain}/vault/${address}`;
export const relationships: Relationship[] = [
  { operator: 'Gauntlet', venue: 'Morpho', tool: 'Morpho roles + Safe', source: vaultURL('ethereum', '0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458'), note: 'Curator relationship and vault role holders are inspectable on the vault page. Permissions remain specific to each vault.' },
  { operator: 'MEV Capital', venue: 'Morpho', tool: 'Morpho roles + Safe', source: vaultURL('ethereum', '0x9480034D908989B006D78bDBBd7bD509c92E8bbC'), note: 'Morpho curation with native permissions and Safe role holders. This does not imply a Steward integration or customer relationship.' },
  { operator: 'Re7 Labs', venue: 'Morpho', tool: 'Morpho roles + Safe', source: vaultURL('base', '0xB7890CEE6CF4792cdCC13489D36D9d42726ab863'), note: 'An example of Re7 curation on Morpho. Role assignments are vault-specific.' },
  { operator: 'Block Analitica', venue: 'Morpho', tool: 'Morpho roles / caps / queues', source: vaultURL('opmainnet', '0x3520E1a10038131A3C00Bf2158835A75e929642d'), note: 'Native Morpho roles, caps, and queues govern allocation. The source identifies the curator relationship.' },
  { operator: 'Steakhouse Financial', venue: 'Morpho', tool: 'Morpho roles + Safe', source: vaultURL('ethereum', '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB'), note: 'Steakhouse curation on Morpho, with vault-specific governance and allocator controls.' },
  { operator: 'Steakhouse Financial', venue: 'Veda', tool: 'BoringVault Manager', source: 'https://veda.tech/solutions/exchanges', note: 'Veda-powered products use the BoringVault architecture. Manager permissions constrain strategy calls.' },
  { operator: 'Sentora', venue: 'Veda', tool: 'BoringVault Manager', source: 'https://veda.tech/solutions/exchanges', note: 'Sentora is a curator in the Veda ecosystem. The Manager contract is an execution-control component, not the curator.' },
  { operator: 'Gauntlet', venue: 'Aera', tool: 'Aera Guardian / hooks', source: 'https://vaultbook.gauntlet.xyz/', note: 'Aera is listed in Gauntlet’s vault ecosystem. Guardian operations use the venue’s permissioned execution architecture.' },
  { operator: 'Steakhouse Financial', venue: 'Upshift', tool: 'August subaccounts', source: 'https://www.upshift.finance/', supported: true, note: 'Upshift lists Steakhouse in its curator network. August is a venue-supported operating option, not a confirmed assignment for every curator vault.' },
  { operator: 'Sentora', venue: 'Upshift', tool: 'August subaccounts', source: 'https://www.upshift.finance/', supported: true, note: 'Upshift lists Sentora in its network. The route illustrates a supported architecture, not a specific account deployment.' },
  { operator: 'Steakhouse Financial', venue: 'Upshift', tool: 'Fordefi MPC', source: 'https://docs.upshift.finance/architecture/vault-flow-and-strategy', supported: true, note: 'Fordefi is an alternative execution model documented by Upshift. It is not necessarily used by each Steakhouse vault.' },
  { operator: 'Sentora', venue: 'Upshift', tool: 'Fordefi MPC', source: 'https://docs.upshift.finance/architecture/vault-flow-and-strategy', supported: true, note: 'A venue-supported option; this does not establish Sentora’s specific signing provider.' },
  { operator: 'Chaos Labs', venue: 'Veda', tool: 'BoringVault Manager', source: 'https://docs.veda.tech/architecture-and-flow-of-funds/manager', note: 'Veda’s published architecture describes the common Manager control layer. See the curator’s individual product for its configured permissions.' },
  { operator: 'Gauntlet', venue: 'Kamino', tool: 'Kamino native controls', source: 'https://www.gauntlet.xyz/resources/gauntlet-vaults-on-kamino-sol-usdc', note: 'Gauntlet lending vaults on Kamino use the venue’s Solana-native vault system.' },
  { operator: 'Gauntlet', venue: 'Drift', tool: 'Drift vault program', source: 'https://vaultbook.gauntlet.xyz/vaults/drift-vaults/drift-vaults-overview', note: 'Drift strategies have trading and vault-program controls distinct from lending vaults.' },
  { operator: 'Gauntlet', venue: 'Symbiotic', tool: 'Delegator hooks / roles', source: 'https://vaultbook.gauntlet.xyz/vaults/symbiotic-vaults/symbiotic-vaults-overview', note: 'Restaking allocation involves network and operator exposure, with vault-specific delegation controls.' },
  { operator: 'Arrakis Labs', venue: 'Arrakis Modular', tool: 'DEX modules / strategies', source: 'https://docs.arrakis.finance/text/arrakisPro/integrations.html', note: 'Modular strategies manage concentrated-liquidity positions through venue modules.' },
  { operator: 'Beefy strategists', venue: 'Beefy Vaults', tool: 'Strategies / governance', source: 'https://docs.beefy.finance/developer-documentation/strategy-contract', note: 'Vaults route deposits to strategy contracts that harvest and compound. Strategy changes are governed by protocol controls.' },
];
