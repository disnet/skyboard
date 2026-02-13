FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY . .

EXPOSE 3002
CMD ["bun", "run", "src/index.ts"]
