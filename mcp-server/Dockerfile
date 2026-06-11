# Transaction Forensics - MCP Server
# Node.js 20 base image for MCP protocol server

FROM node:20-alpine AS build

# Set environment variables
ENV NODE_ENV=development

# Set working directory
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files first (for layer caching)
COPY package.json package-lock.json* ./

# Install the complete dependency graph needed to compile TypeScript.
RUN npm ci

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript to JavaScript
RUN npm run build

FROM node:20-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && apk del python3 make g++

COPY --from=build /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup \
    && adduser -S appuser -u 1001 -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

# Create directories for data and logs
RUN mkdir -p /app/data /app/logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

# Default command
CMD ["node", "dist/index.js"]

# Labels
LABEL maintainer="Transaction Forensics Team" \
      version="1.0.1" \
      description="MCP server for transaction forensics"
