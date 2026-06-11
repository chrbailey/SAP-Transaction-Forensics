# Transaction Forensics - Synthetic Data Generator
# Python 3.11 base image for generating synthetic SAP SD documents

FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Set working directory
WORKDIR /app

# Install system dependencies (minimal for slim image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first (for layer caching)
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --no-cache-dir \
    faker>=22.0.0 \
    numpy>=1.26.0 \
    python-dateutil>=2.8.2

# Copy source code
COPY src/ ./src/

# Create output directory
RUN mkdir -p /app/output

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser \
    && chown -R appuser:appuser /app
USER appuser

# Default command
CMD ["python", "src/generate_sd.py", "--count", "10000", "--output-dir", "/app/output"]

# Labels
LABEL maintainer="Transaction Forensics Team" \
      version="1.0.0" \
      description="Synthetic data generator for SAP SD documents"
