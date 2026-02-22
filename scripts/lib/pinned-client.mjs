import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

export function getChainByName(name) {
  if (name === "baseSepolia") return baseSepolia;
  throw new Error(`Unsupported chain: ${name}`);
}

export async function makePinnedClient({ chainName, rpcUrl, pinnedBlockNumber }) {
  const chain = getChainByName(chainName);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const blockNumber = BigInt(pinnedBlockNumber);
  const block = await client.getBlock({ blockNumber });
  if (!block?.timestamp) throw new Error("Could not load pinned block timestamp");

  return {
    client,
    chain,
    pinned: {
      blockNumber,
      blockTimestamp: Number(block.timestamp)
    }
  };
}

export async function readPinned(client, params, pinnedBlockNumber) {
  return client.readContract({ ...params, blockNumber: BigInt(pinnedBlockNumber) });
}
