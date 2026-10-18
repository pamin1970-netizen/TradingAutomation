import type { BrokerAdapter } from "../types";

// Not implemented. Robinhood's official API is crypto-only; options run through
// the Agentic MCP, whose auth flow is not yet verified. Always disabled here.
export const robinhoodAdapter: BrokerAdapter = {
  name: "robinhood",
  enabled: () => false,
  async dryRun() {
    throw new Error("Robinhood adapter is not implemented");
  },
  async place() {
    throw new Error("Robinhood adapter is not implemented");
  },
};

