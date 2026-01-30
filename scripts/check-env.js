import "dotenv/config";

console.log("RPC:", process.env.BASE_SEPOLIA_RPC_URL);
console.log("PK set?", Boolean(process.env.PRIVATE_KEY));
