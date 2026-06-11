# SAP Workflow Mining - Makefile
# Alternative to cli.sh for common operations
#
# Usage:
#   make help          Show available targets
#   make all           Run complete pipeline (generate + analyze)
#   make generate      Generate synthetic data
#   make server        Start MCP server
#   make analyze       Run pattern analysis
#   make view          Start results viewer
#   make docker-up     Build and run with Docker Compose
#   make docker-down   Stop Docker containers
#   make clean         Remove generated files

.PHONY: all generate server analyze view clean docker-up docker-down docker-build \
        docker-logs docker-ps help install-deps check-deps test lint format \
        test-python test-node test-viewer

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# One-Command Demo (deterministic, reproducible)
# =============================================================================

## demo: One-command deterministic bootstrap — generates data, runs analysis, prints report
demo: check-python check-node demo-install demo-generate demo-analyze
	@echo ""
	@echo "$(GREEN)═══════════════════════════════════════$(NC)"
	@echo "$(GREEN)  Demo complete. Run 'make test' to verify.$(NC)"
	@echo "$(GREEN)═══════════════════════════════════════$(NC)"

demo-install:
	@echo "$(BLUE)[1/3] Installing dependencies...$(NC)"
	@cd $(MCP_SERVER_DIR) && npm ci --silent 2>/dev/null || npm install --silent

demo-generate:
	@echo "$(BLUE)[2/3] Generating synthetic SFDC data (seed=42, deterministic)...$(NC)"
	@cd $(SYNTHETIC_DATA_DIR) && $(PYTHON) src/generate_sfdc.py \
		--count 200 --accounts 50 --output sfdc_output/ --seed 42
	@echo "$(GREEN)  → 200+ opportunities with 10 planted anomaly patterns$(NC)"

demo-analyze:
	@echo "$(BLUE)[3/3] Running forensic analysis...$(NC)"
	@cd $(PATTERN_ENGINE_DIR) && $(PYTHON) scripts/analyze_sfdc.py
	@echo ""

## demo-kaggle: Full demo with real Kaggle CRM data (requires data/kaggle-crm/)
demo-kaggle: check-python
	@if [ ! -f "data/kaggle-crm/sales_pipeline.csv" ]; then \
		echo "$(RED)Kaggle data not found. Download first:$(NC)"; \
		echo "  kaggle datasets download -d innocentmfa/crm-sales-opportunities --unzip -p data/kaggle-crm/"; \
		exit 1; \
	fi
	@echo "$(BLUE)Converting Kaggle CSV → SFDC JSON...$(NC)"
	@cd $(PATTERN_ENGINE_DIR) && $(PYTHON) scripts/convert_kaggle_crm.py
	@echo "$(BLUE)Running analysis on 8,800 real CRM records...$(NC)"
	@cd $(PATTERN_ENGINE_DIR) && $(PYTHON) scripts/analyze_kaggle_crm.py

# =============================================================================
# Configuration
# =============================================================================

# Directories
PROJECT_ROOT := $(shell pwd)
SYNTHETIC_DATA_DIR := $(PROJECT_ROOT)/synthetic-data
MCP_SERVER_DIR := $(PROJECT_ROOT)/mcp-server
PATTERN_ENGINE_DIR := $(PROJECT_ROOT)/pattern-engine
VIEWER_DIR := $(PROJECT_ROOT)/viewer
OUTPUT_DIR := $(PROJECT_ROOT)/output

# Environment defaults
DATA_COUNT ?= 10000
DATA_SEED ?= 42
SERVER_PORT ?= 3000
VIEWER_PORT ?= 8080

# Python command
PYTHON := $(shell command -v python3 2>/dev/null || command -v python 2>/dev/null)

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[0;33m
BLUE := \033[0;34m
NC := \033[0m

# =============================================================================
# Main Targets
# =============================================================================

## all: Run complete pipeline (generate data + analyze patterns)
all: generate analyze
	@echo "$(GREEN)Pipeline complete!$(NC)"
	@echo "Run 'make view' to see results or 'make server' to start the MCP server"

## generate: Generate synthetic SAP SD data
generate: check-python
	@echo "$(BLUE)Generating synthetic data (count=$(DATA_COUNT), seed=$(DATA_SEED))...$(NC)"
	@mkdir -p $(SYNTHETIC_DATA_DIR)/sample_output
	@cd $(SYNTHETIC_DATA_DIR) && \
		$(PYTHON) src/generate_sd.py \
			--count $(DATA_COUNT) \
			--seed $(DATA_SEED) \
			--output-dir sample_output
	@echo "$(GREEN)Data generated in $(SYNTHETIC_DATA_DIR)/sample_output$(NC)"

## server: Start MCP server (foreground)
server: check-node
	@echo "$(BLUE)Starting MCP server on port $(SERVER_PORT)...$(NC)"
	@cd $(MCP_SERVER_DIR) && \
		PORT=$(SERVER_PORT) \
		DATA_DIR=$(SYNTHETIC_DATA_DIR)/sample_output \
		LOG_DIR=$(OUTPUT_DIR)/logs \
		npm start

## server-bg: Start MCP server in background
server-bg: check-node
	@echo "$(BLUE)Starting MCP server in background...$(NC)"
	@mkdir -p $(OUTPUT_DIR)/logs
	@cd $(MCP_SERVER_DIR) && \
		PORT=$(SERVER_PORT) \
		DATA_DIR=$(SYNTHETIC_DATA_DIR)/sample_output \
		LOG_DIR=$(OUTPUT_DIR)/logs \
		nohup npm start > $(OUTPUT_DIR)/logs/mcp-server.log 2>&1 & \
		echo $$! > $(OUTPUT_DIR)/logs/mcp-server.pid
	@echo "$(GREEN)Server started. PID: $$(cat $(OUTPUT_DIR)/logs/mcp-server.pid)$(NC)"
	@echo "Logs: $(OUTPUT_DIR)/logs/mcp-server.log"

## server-stop: Stop background MCP server
server-stop:
	@if [ -f $(OUTPUT_DIR)/logs/mcp-server.pid ]; then \
		kill $$(cat $(OUTPUT_DIR)/logs/mcp-server.pid) 2>/dev/null || true; \
		rm -f $(OUTPUT_DIR)/logs/mcp-server.pid; \
		echo "$(GREEN)Server stopped$(NC)"; \
	else \
		echo "$(YELLOW)No PID file found$(NC)"; \
	fi

## analyze: Run pattern engine analysis
analyze: check-python
	@echo "$(BLUE)Running pattern analysis...$(NC)"
	@mkdir -p $(OUTPUT_DIR)
	@cd $(PATTERN_ENGINE_DIR) && \
		PYTHONPATH=$(PATTERN_ENGINE_DIR) \
		$(PYTHON) -m src.main run \
			--input-dir $(SYNTHETIC_DATA_DIR)/sample_output \
			--output-dir $(OUTPUT_DIR)
	@echo "$(GREEN)Analysis complete. Results in $(OUTPUT_DIR)$(NC)"

## view: Start results viewer
view: check-python
	@echo "$(BLUE)Starting viewer on http://localhost:$(VIEWER_PORT)$(NC)"
	@cd $(OUTPUT_DIR) && $(PYTHON) -m http.server $(VIEWER_PORT)

## status: Show current status
status:
	@echo "$(BLUE)Transaction Forensics Status$(NC)"
	@echo ""
	@echo "Synthetic Data:"
	@if [ -d "$(SYNTHETIC_DATA_DIR)/sample_output" ] && [ "$$(ls -A $(SYNTHETIC_DATA_DIR)/sample_output 2>/dev/null)" ]; then \
		echo "  $(GREEN)Generated$(NC)"; \
		ls -lh $(SYNTHETIC_DATA_DIR)/sample_output/*.json 2>/dev/null | awk '{print "    " $$9 " (" $$5 ")"}'; \
	else \
		echo "  $(YELLOW)Not generated$(NC)"; \
	fi
	@echo ""
	@echo "MCP Server:"
	@if [ -f "$(OUTPUT_DIR)/logs/mcp-server.pid" ] && kill -0 $$(cat $(OUTPUT_DIR)/logs/mcp-server.pid) 2>/dev/null; then \
		echo "  $(GREEN)Running$(NC) (PID: $$(cat $(OUTPUT_DIR)/logs/mcp-server.pid))"; \
	else \
		echo "  $(YELLOW)Not running$(NC)"; \
	fi
	@echo ""
	@echo "Analysis Output:"
	@if [ -d "$(OUTPUT_DIR)/reports" ] && [ "$$(ls -A $(OUTPUT_DIR)/reports 2>/dev/null)" ]; then \
		echo "  $(GREEN)Available$(NC)"; \
		ls -lh $(OUTPUT_DIR)/reports/* 2>/dev/null | awk '{print "    " $$9 " (" $$5 ")"}'; \
	else \
		echo "  $(YELLOW)Not generated$(NC)"; \
	fi

# =============================================================================
# Docker Targets
# =============================================================================

## docker-up: Build and start all services with Docker Compose
docker-up:
	@echo "$(BLUE)Starting Docker services...$(NC)"
	DATA_COUNT=$(DATA_COUNT) DATA_SEED=$(DATA_SEED) \
		docker-compose up --build

## docker-up-d: Start services in detached mode
docker-up-d:
	@echo "$(BLUE)Starting Docker services in background...$(NC)"
	DATA_COUNT=$(DATA_COUNT) DATA_SEED=$(DATA_SEED) \
		docker-compose up --build -d

## docker-down: Stop Docker services
docker-down:
	@echo "$(BLUE)Stopping Docker services...$(NC)"
	docker-compose down

## docker-build: Build Docker images
docker-build:
	@echo "$(BLUE)Building Docker images...$(NC)"
	docker-compose build

## docker-logs: View Docker logs
docker-logs:
	docker-compose logs -f

## docker-ps: Show running containers
docker-ps:
	docker-compose ps

## docker-clean: Remove Docker containers, images, and volumes
docker-clean:
	@echo "$(YELLOW)Removing Docker resources...$(NC)"
	docker-compose down --rmi local --volumes --remove-orphans

# =============================================================================
# Development Targets
# =============================================================================

## install-deps: Install all dependencies
install-deps: install-python-deps install-node-deps
	@echo "$(GREEN)All dependencies installed$(NC)"

## install-python-deps: Install Python dependencies
install-python-deps: check-python
	@echo "$(BLUE)Installing Python dependencies...$(NC)"
	@cd $(SYNTHETIC_DATA_DIR) && $(PYTHON) -m pip install -e . --quiet
	@cd $(PATTERN_ENGINE_DIR) && $(PYTHON) -m pip install -e . --quiet

## install-node-deps: Install Node.js dependencies
install-node-deps: check-node
	@echo "$(BLUE)Installing Node.js dependencies...$(NC)"
	@cd $(MCP_SERVER_DIR) && npm install

## test: Run all tests
test: test-python test-node test-viewer
	@echo "$(GREEN)All tests passed$(NC)"

## test-python: Run Python tests
test-python: check-python
	@echo "$(BLUE)Running Python tests...$(NC)"
	@cd $(SYNTHETIC_DATA_DIR) && $(PYTHON) -m pytest tests/ -v
	@cd $(PATTERN_ENGINE_DIR) && $(PYTHON) -m pytest tests/ -v
	@cd $(PROJECT_ROOT)/pattern-discovery && $(PYTHON) -m pytest tests/ -v

## test-node: Run Node.js tests
test-node: check-node
	@echo "$(BLUE)Running Node.js tests...$(NC)"
	@cd $(MCP_SERVER_DIR) && npm test

## test-viewer: Run viewer tests
test-viewer: check-node
	@echo "$(BLUE)Running viewer tests...$(NC)"
	@cd $(VIEWER_DIR) && npm test

## lint: Run linters
lint: check-python
	@echo "$(BLUE)Running linters...$(NC)"
	@cd $(SYNTHETIC_DATA_DIR) && $(PYTHON) -m ruff check src/ || true
	@cd $(PATTERN_ENGINE_DIR) && $(PYTHON) -m ruff check src/ || true

## format: Format code
format: check-python
	@echo "$(BLUE)Formatting code...$(NC)"
	@cd $(SYNTHETIC_DATA_DIR) && $(PYTHON) -m ruff format src/ || true
	@cd $(PATTERN_ENGINE_DIR) && $(PYTHON) -m ruff format src/ || true

# =============================================================================
# Cleanup Targets
# =============================================================================

## clean: Remove generated files
clean:
	@echo "$(YELLOW)Cleaning generated files...$(NC)"
	@rm -rf $(SYNTHETIC_DATA_DIR)/sample_output/*
	@rm -rf $(OUTPUT_DIR)/*
	@touch $(OUTPUT_DIR)/.gitkeep
	@echo "$(GREEN)Cleaned$(NC)"

## clean-all: Remove generated files and dependencies
clean-all: clean
	@echo "$(YELLOW)Removing dependencies...$(NC)"
	@rm -rf $(SYNTHETIC_DATA_DIR)/.venv $(SYNTHETIC_DATA_DIR)/venv
	@rm -rf $(PATTERN_ENGINE_DIR)/.venv $(PATTERN_ENGINE_DIR)/venv
	@rm -rf $(MCP_SERVER_DIR)/node_modules $(MCP_SERVER_DIR)/dist
	@rm -rf $(VIEWER_DIR)/node_modules
	@echo "$(GREEN)All cleaned$(NC)"

# =============================================================================
# Utility Targets
# =============================================================================

## check-python: Check if Python is available
check-python:
	@if [ -z "$(PYTHON)" ]; then \
		echo "$(RED)Error: Python not found$(NC)"; \
		exit 1; \
	fi

## check-node: Check if Node.js is available
check-node:
	@if ! command -v node >/dev/null 2>&1; then \
		echo "$(RED)Error: Node.js not found$(NC)"; \
		exit 1; \
	fi

## check-docker: Check if Docker is available
check-docker:
	@if ! command -v docker >/dev/null 2>&1; then \
		echo "$(RED)Error: Docker not found$(NC)"; \
		exit 1; \
	fi
	@if ! command -v docker-compose >/dev/null 2>&1; then \
		echo "$(RED)Error: Docker Compose not found$(NC)"; \
		exit 1; \
	fi

## check-deps: Check all dependencies
check-deps: check-python check-node
	@echo "$(GREEN)All required tools available$(NC)"
	@echo "  Python: $(PYTHON) ($$($(PYTHON) --version))"
	@echo "  Node.js: $$(node --version)"
	@echo "  npm: $$(npm --version)"

## help: Show this help message
help:
	@echo ""
	@echo "$(BLUE)Transaction Forensics - Makefile$(NC)"
	@echo ""
	@echo "Usage: make [target] [VAR=value]"
	@echo ""
	@echo "$(YELLOW)Main Targets:$(NC)"
	@grep -E '^## ' $(MAKEFILE_LIST) | grep -E '^## (all|generate|server|analyze|view|status):' | \
		sed 's/## /  /' | sed 's/: /\t/'
	@echo ""
	@echo "$(YELLOW)Docker Targets:$(NC)"
	@grep -E '^## docker' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/: /\t/'
	@echo ""
	@echo "$(YELLOW)Development Targets:$(NC)"
	@grep -E '^## (install|test|lint|format):' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/: /\t/'
	@echo ""
	@echo "$(YELLOW)Cleanup Targets:$(NC)"
	@grep -E '^## clean' $(MAKEFILE_LIST) | sed 's/## /  /' | sed 's/: /\t/'
	@echo ""
	@echo "$(YELLOW)Variables:$(NC)"
	@echo "  DATA_COUNT    Number of records (default: 10000)"
	@echo "  DATA_SEED     Random seed (default: 42)"
	@echo "  SERVER_PORT   MCP server port (default: 3000)"
	@echo "  VIEWER_PORT   Viewer port (default: 8080)"
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  make all"
	@echo "  make generate DATA_COUNT=5000"
	@echo "  make docker-up DATA_COUNT=20000"
	@echo "  make server-bg && make view"
	@echo ""
