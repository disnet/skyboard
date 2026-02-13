export const config = {
  port: Number(process.env.PORT) || 3002,
  dbPath: process.env.DB_PATH || "./data/skyboard.db",
  jetstreamUrl:
    process.env.JETSTREAM_URL ||
    "wss://jetstream2.us-east.bsky.network/subscribe",
};
