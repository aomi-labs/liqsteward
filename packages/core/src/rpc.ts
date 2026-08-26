import { createPublicClient, fallback, http, keccak256, stringToHex, type Hex } from "viem";
import { mainnet } from "viem/chains";
import type { TransactionVerification } from "./types.js";

function ethereumClient(rpcUrl?: string) {
  const transport = rpcUrl
    ? http(rpcUrl, { retryCount: 3, retryDelay: 350, timeout: 12_000 })
    : fallback([
        http("https://1rpc.io/eth", { retryCount: 2, timeout: 10_000 }),
        http("https://ethereum-rpc.publicnode.com", { retryCount: 2, timeout: 10_000 }),
      ], { retryCount: 1 });
  return createPublicClient({ chain: mainnet, transport });
}

export async function verifyTransaction(
  hash: Hex,
  rpcUrl?: string,
  expected?: { eventEmitter?: string; allocatorCaller?: string; blockNumber?: number },
): Promise<TransactionVerification> {
  const client = ethereumClient(rpcUrl);
  const transaction = await client.getTransaction({ hash }).catch(() => null);
  if (!transaction) {
    return { hash, chainId: 1, status: "not-found", assertions: [] };
  }

  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  const block = receipt
    ? await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null)
    : null;
  const assertions: TransactionVerification["assertions"] = [];
  if (expected?.eventEmitter && expected.allocatorCaller && receipt) {
    const signatures = new Set([
      keccak256(stringToHex("ReallocateSupply(address,bytes32,uint256,uint256)")),
      keccak256(stringToHex("ReallocateWithdraw(address,bytes32,uint256,uint256)")),
    ]);
    const paddedCaller = `0x${expected.allocatorCaller.toLowerCase().slice(2).padStart(64, "0")}`;
    const matchingLogs = receipt.logs.filter((log) =>
      log.address.toLowerCase() === expected.eventEmitter!.toLowerCase()
      && !!log.topics[0]
      && signatures.has(log.topics[0])
      && log.topics[1]?.toLowerCase() === paddedCaller,
    );
    assertions.push({
      label: "Receipt contains vault reallocation event for indexed allocator",
      passed: matchingLogs.length > 0,
      evidence: `vault=${expected.eventEmitter} allocator=${expected.allocatorCaller} matching_logs=${matchingLogs.length}`,
    });
  }
  if (expected?.blockNumber) {
    assertions.push({
      label: "Block number matches indexed event",
      passed: transaction.blockNumber === BigInt(expected.blockNumber),
      evidence: `expected=${expected.blockNumber} observed=${transaction.blockNumber?.toString() ?? "pending"}`,
    });
  }
  assertions.push({
    label: "Transaction receipt succeeded",
    passed: receipt?.status === "success",
    evidence: receipt ? `status=${receipt.status} logs=${receipt.logs.length}` : "receipt not found",
  });

  return {
    hash,
    chainId: 1,
    status: !receipt ? "pending" : receipt.status === "success" ? "confirmed" : "reverted",
    from: transaction.from,
    to: transaction.to ?? undefined,
    blockNumber: transaction.blockNumber?.toString(),
    blockTimestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : undefined,
    inputSelector: transaction.input.slice(0, 10),
    value: transaction.value.toString(),
    receiptLogs: receipt?.logs.length,
    authorityPath: transaction.to ? {
      envelopeSigner: transaction.from,
      executionContract: transaction.to,
      indexedAllocator: expected?.allocatorCaller,
      vaultEventEmitter: expected?.eventEmitter,
    } : undefined,
    assertions,
  };
}
