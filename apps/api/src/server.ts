import { createApp } from "./app.js";
const app = await createApp({ logger: true, autoReviewWorker: true });
const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
});
