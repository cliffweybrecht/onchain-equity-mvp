import "dotenv/config";

import { defineConfig } from "hardhat/config";

import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

export default defineConfig({
  plugins: [hardhatViem, hardhatEthers, hardhatVerify],

  solidity: "0.8.20",

  networks: {
    baseSepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
});
