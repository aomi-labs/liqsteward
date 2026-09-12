export type ProblemId = 'nav' | 'response' | 'stress' | 'withdrawals' | 'execution';

export type Problem = {
  id: ProblemId;
  topic: string;
  question: readonly [string, string, string];
  example: string;
  date: string;
  evidence: string;
  happened: string;
  implication: string;
  boundary: string;
  sources: { label: string; kind: string; url: string }[];
};

const volatility = 'https://vaultbook.gauntlet.xyz/resources/market-volatility';
const ezethReport = 'https://forum.morpho.org/t/gauntlet-lrt-core-vault-market-update-4-24-2024-ezeth-price-volatility/578';

export const problems: Problem[] = [
  {
    id: 'nav', topic: 'Valuation credibility',
    question: ['Can we', 'independently verify', 'this NAV?'],
    example: 'Stream Finance / xUSD', date: 'November 2025', evidence: 'Historical incident',
    happened: 'Stream disclosed approximately $93 million in losses attributed to an external fund manager and suspended deposits and withdrawals. The incident exposed the importance of verifying the assets behind a reported value.',
    implication: 'An onchain balance is not independent evidence of the value of every underlying claim. Operators need to reconcile assets, liabilities, pricing assumptions, and external manager statements—and identify where evidence stops.',
    boundary: 'This is a backing-verification case, not a finding that a particular NAV report was false. Hidden offchain assets cannot be independently verified from onchain data alone.',
    sources: [
      { label: 'Stream’s loss disclosure', kind: 'Original announcement · X', url: 'https://x.com/StreamDefi/status/1985556360507822093' },
      { label: 'Loss disclosure and withdrawal suspension', kind: 'News · The Block · 4 Nov 2025', url: 'https://www.theblock.co/news/ecosystems/2025-11-04-stream-finance-halts-withdrawals-93-million-loss-377400' },
      { label: 'Collateral and contagion review', kind: 'Curator retrospective · Gauntlet', url: volatility },
    ],
  },
  {
    id: 'response', topic: 'Incident response',
    question: ['Redemption terms just', 'changed. What is our', 'risk-off response?'],
    example: 'Usual / USD0++', date: '9–10 January 2025', evidence: 'Historical incident',
    happened: 'Usual announced a 0.87 USD0 redemption floor and a separate early-unstaking mechanism. Gauntlet reports exiting the affected markets in its USDC Balanced vault through nine transactions.',
    implication: 'Identify the affected positions, check immediately available liquidity, and compare permitted exits. A decision must account for execution cost, residual exposure, and where withdrawn assets can be held.',
    boundary: 'The diagram describes a decision process, not a recommended trade or a replay of those nine transactions. Gauntlet already had an active incident-response capability.',
    sources: [
      { label: 'The redemption-mechanism announcement', kind: 'Protocol announcement · Usual · 9 Jan 2025', url: 'https://usual.money/blog/usual-s-next-leap-solidifying-a-4-year-horizon-for-sustainable-growth' },
      { label: 'Gauntlet’s exit from affected markets', kind: 'Curator incident account', url: volatility },
      { label: 'USD0++ market reaction', kind: 'News · The Block · 10 Jan 2025', url: 'https://www.theblock.co/news/defi/2025-01-10-usual-money-protocol-update-333995' },
    ],
  },
  {
    id: 'stress', topic: 'Scenario analysis',
    question: ['How would Gauntlet’s LRT Core', 'vault respond to an ezETH', 'price and liquidity shock?'],
    example: 'Gauntlet LRT Core / ezETH', date: '24 April 2024', evidence: 'Historical incident + hypothetical stress',
    happened: 'Gauntlet’s incident report records WETH liquidity in a major ezETH pool declining from about 4,000 to 500 WETH. The highest-LLTV market incurred insolvent debt; 7.12 WETH was allocated to LRT Core.',
    implication: 'Test a 10% ezETH price decline against WETH alongside a 50% reduction in relevant DEX liquidity. Examine liquidation demand, feasible exits, and potential remaining debt using the historical vault configuration.',
    boundary: 'The 10% / 50% combination is a proposed hypothetical scenario, not an executed simulation or the measured historical shock. The bars below show reported pool liquidity, not vault NAV or withdrawal capacity.',
    sources: [
      { label: 'Liquidity, allocations, and insolvency figures', kind: 'Historical market data · Gauntlet incident report', url: ezethReport },
      { label: 'First reported liquidation · block 19,722,269', kind: 'Historical transaction · Etherscan', url: 'https://etherscan.io/tx/0x1db42f2f538137669c3a8502066007fd27ba6c6d0578f7f42844b8887a69a8f2' },
      { label: 'ezETH / WETH · 86% LLTV market', kind: 'Current market interface · not a historical snapshot', url: 'https://app.morpho.org/market?id=0x49bb2d114be9041a787432952927f6f144f05ad3e83196a7d062f374ee11d0ee' },
    ],
  },
  {
    id: 'withdrawals', topic: 'Liquidity & concentration',
    question: ['If other depositors', 'exit first, what', 'exposure remains?'],
    example: 'A vault with an illiquid allocation', date: 'Illustrative balance sheet', evidence: 'Illustrative example',
    happened: 'A $100m vault holds $20m in an illiquid market. If depositors withdraw $40m entirely from its other, liquid positions, the vault retains the same $20m exposure inside a smaller $60m portfolio.',
    implication: 'Concentration rises from 20% to 33.3% without any new allocation. Assess what remains after redemptions—not only whether the next withdrawal can be paid.',
    boundary: 'These numbers are illustrative, not the holdings or losses of a named vault. Asset values are held constant; no fees, losses, or new deposits are assumed. The linked report provides real liquidity context, not evidence for these example balances.',
    sources: [
      { label: 'Liquidity stress during the xUSD incident', kind: 'Related historical context · Gauntlet', url: volatility },
      { label: 'Liquidity constraints and supplier withdrawals', kind: 'Historical vault report · Morpho forum', url: ezethReport },
    ],
  },
  {
    id: 'execution', topic: 'Execution permissions',
    question: ['Can this plan actually', 'execute under our vault’s', 'permissions?'],
    example: 'Veda / BoringVault Manager', date: 'Documented architecture', evidence: 'Operational example',
    happened: 'Veda documents a curator-to-Manager workflow in which a rebalance message includes a Merkle proof. The Manager checks the action against pre-approved onchain permissions before deploying vault assets.',
    implication: 'Translate the intended change into exact calls and a valid sequence. Check permissions, proofs, available liquidity, token approvals, and the resulting exposure before requesting a signature.',
    boundary: 'This illustrates an execution requirement, not a Veda incident or security failure. Permission checks alone do not establish economic safety; approvals and postconditions require their own validation.',
    sources: [
      { label: 'Manager permissions and the flow of funds', kind: 'Protocol documentation · Veda', url: 'https://docs.veda.tech/architecture-and-flow-of-funds' },
      { label: 'Roles, permissions, and security controls', kind: 'Protocol documentation · Veda', url: 'https://veda.tech/security' },
    ],
  },
];
