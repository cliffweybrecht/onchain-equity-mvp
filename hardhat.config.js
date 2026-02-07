import "dotenv/config";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";


// Load plugin modules (side-effect + explicit plugin objects)
import "@nomicfoundation/hardhat-viem";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";

import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

/** @type {import("hardhat/config").HardhatUserConfig} */
export default {
  plugins: [hardhatNodeTestRunner, hardhatViem, hardhatEthers, hardhatVerify],

  solidity: "0.8.20",

  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    baseSepolia: {
      type: "http",
      chainType: "l1",
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
