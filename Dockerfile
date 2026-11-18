# Cloudflare Containers runs linux/amd64. node:22-slim (Debian) gives sharp and
# @resvg/resvg-js their prebuilt glibc binaries, so there is nothing to compile.
FROM --platform=linux/amd64 node:22-slim

WORKDIR /app

# deps first so Docker caches them across code changes
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

# fonts come from npm, demo mockups are generated — neither ships in the image layer above
RUN node scripts/fetch-fonts.js \
 && node scripts/gen-assets.js \
 && npm prune --omit=dev \
 && rm -rf /root/.npm

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["node", "server.js"]
