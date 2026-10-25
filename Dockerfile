FROM oven/bun:1.3.14

# git for the agent's tools, build tools for node-pty's native module
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile

EXPOSE 4096

# 0.0.0.0 so Docker's port mapping can reach the server; the host side is still bound to 127.0.0.1 in docker-compose.yml
CMD ["bun", "run", "--cwd", "packages/opencode", "--conditions=browser", "src/index.ts", "web", "--hostname", "0.0.0.0", "--port", "4096"]
