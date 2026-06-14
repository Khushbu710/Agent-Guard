import "dotenv/config";

function require(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3001"), 10),
  nodeEnv: optional("NODE_ENV", "development"),

  llm: {
    baseUrl: optional("LLM_BASE_URL", "https://api.groq.com/openai/v1"),
    apiKey: require("LLM_API_KEY"),
    model: optional("LLM_MODEL", "qwen/qwen3-32b"),
  },

  blockchain: {
    rpcUrl: optional("ARB_SEPOLIA_RPC", "https://sepolia-rollup.arbitrum.io/rpc"),
    privateKey: require("AGENT_SIGNER_PRIVATE_KEY"),
    contractAddress: require("AGENTGUARD_CONTRACT_ADDRESS"),
  },
} as const;
