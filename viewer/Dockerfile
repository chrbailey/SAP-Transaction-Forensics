# Transaction Forensics - Pattern Card Viewer
# Node.js/Express server for serving pattern analysis results

FROM node:20-alpine

# Set environment variables
ENV PORT=8080 \
    NODE_ENV=production

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN adduser -D -u 1001 appuser

# Copy package files
COPY --chown=appuser:appuser package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY --chown=appuser:appuser . ./

# Create data directory for pattern_cards.json
RUN mkdir -p /app/data && chown appuser:appuser /app/data

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/api/patterns || exit 1

# Start the server
CMD ["node", "src/server.js"]

# Labels
LABEL maintainer="Transaction Forensics Team" \
      version="1.0.1" \
      description="Web viewer for transaction forensics pattern cards"
