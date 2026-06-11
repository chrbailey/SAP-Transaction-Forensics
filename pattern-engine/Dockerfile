# Transaction Forensics - Pattern Engine
# Python 3.11 base image for pattern discovery and correlation

FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first (for layer caching)
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --no-cache-dir \
    scikit-learn>=1.3.0 \
    numpy>=1.24.0 \
    pandas>=2.0.0 \
    click>=8.1.0

# Optional: Install sentence-transformers for better embeddings
# Uncomment if needed (adds significant image size)
# RUN pip install --no-cache-dir sentence-transformers>=2.2.0

# Remove build dependencies to reduce image size
RUN apt-get purge -y --auto-remove build-essential

# Copy source code
COPY src/ ./src/

# Create directories
RUN mkdir -p /app/data /app/output

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser \
    && chown -R appuser:appuser /app
USER appuser

# Set Python path for module imports
ENV PYTHONPATH=/app

# Default command
CMD ["python", "-m", "src.main", "run", "--input-dir", "/app/data", "--output-dir", "/app/output", "--mode", "shareable"]

# Labels
LABEL maintainer="Transaction Forensics Team" \
      version="0.1.1" \
      description="Pattern discovery engine for transaction forensics"
