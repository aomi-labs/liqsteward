import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 4310);
const app = buildApp({
  rpcUrl: process.env.ETHEREUM_RPC_URL,
  webOrigin: process.env.WEB_ORIGIN,
  nav: {
    databaseUrl: process.env.DATABASE_URL,
    serviceToken: process.env.LIQSTEWARD_SERVICE_TOKEN,
  },
});

await app.listen({ port, host: "127.0.0.1" });
