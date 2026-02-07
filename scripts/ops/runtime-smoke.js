import { network } from "hardhat";

const conn = await network.connect();
const { viem } = conn;

const publicClient = await viem.getPublicClient();
console.log("blockNumber:", await publicClient.getBlockNumber());

const [wc] = await viem.getWalletClients();
console.log("wallet:", wc.account.address);
