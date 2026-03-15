import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is running via stdio — it will process messages until the transport closes.
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
