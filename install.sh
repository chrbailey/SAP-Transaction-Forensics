#!/usr/bin/env bash
#
# SAP Workflow Mining - One-Click Installer
#
# This script provides an easy way to get started with SAP Workflow Mining.
# It handles prerequisites, configuration, and verification automatically.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/[repo]/main/install.sh | bash
#
#   Or download and run:
#   chmod +x install.sh && ./install.sh
#
# Options:
#   --non-interactive    Run with defaults, no prompts
#   --mode MODE          Set mode: demo, csv, or rfc
#   --skip-docker-check  Skip Docker installation check
#   --help               Show this help message
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

INSTALLER_VERSION="1.0.0"
REPO_URL="https://github.com/your-org/sap-workflow-mining.git"
MIN_DOCKER_VERSION="20.10.0"
MIN_DOCKER_COMPOSE_VERSION="2.0.0"

# Default settings
NON_INTERACTIVE=false
INSTALL_MODE=""
SKIP_DOCKER_CHECK=false
PROJECT_DIR=""

# =============================================================================
# Color and Formatting
# =============================================================================

setup_colors() {
    if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
        RED='\033[0;31m'
        GREEN='\033[0;32m'
        YELLOW='\033[0;33m'
        BLUE='\033[0;34m'
        MAGENTA='\033[0;35m'
        CYAN='\033[0;36m'
        BOLD='\033[1m'
        DIM='\033[2m'
        NC='\033[0m'
    else
        RED=''
        GREEN=''
        YELLOW=''
        BLUE=''
        MAGENTA=''
        CYAN=''
        BOLD=''
        DIM=''
        NC=''
    fi
}

# =============================================================================
# Logging Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

log_step() {
    echo -e "${MAGENTA}>>>${NC} ${BOLD}$*${NC}"
}

print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}"
    echo "  ____    _    ____   __        __         _    __ _               "
    echo " / ___|  / \  |  _ \  \ \      / /__  _ __| | _/ _| | _____      __"
    echo " \___ \ / _ \ | |_) |  \ \ /\ / / _ \| '__| |/ / | |/ _ \ \ /\ / /"
    echo "  ___) / ___ \|  __/    \ V  V / (_) | |  |   <| | | (_) \ V  V / "
    echo " |____/_/   \_\_|        \_/\_/ \___/|_|  |_|\_\_|_|\___/ \_/\_/  "
    echo "                                                                   "
    echo "  __  __ _       _                                                 "
    echo " |  \/  (_)_ __ (_)_ __   __ _                                     "
    echo " | |\/| | | '_ \| | '_ \ / _\` |                                    "
    echo " | |  | | | | | | | | | | (_| |                                    "
    echo " |_|  |_|_|_| |_|_|_| |_|\__, |                                    "
    echo "                         |___/                                     "
    echo -e "${NC}"
    echo -e "${DIM}One-Click Installer v${INSTALLER_VERSION}${NC}"
    echo ""
}

# =============================================================================
# OS Detection
# =============================================================================

detect_os() {
    OS_TYPE=""
    OS_DIST=""
    OS_VERSION=""
    PACKAGE_MANAGER=""

    case "$(uname -s)" in
        Darwin)
            OS_TYPE="macos"
            OS_DIST="macos"
            OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "unknown")
            PACKAGE_MANAGER="brew"
            ;;
        Linux)
            OS_TYPE="linux"
            if [[ -f /etc/os-release ]]; then
                . /etc/os-release
                OS_DIST="${ID:-unknown}"
                OS_VERSION="${VERSION_ID:-unknown}"

                case "${OS_DIST}" in
                    ubuntu|debian|pop|linuxmint)
                        PACKAGE_MANAGER="apt"
                        ;;
                    rhel|centos|fedora|rocky|almalinux|amzn)
                        if command -v dnf &>/dev/null; then
                            PACKAGE_MANAGER="dnf"
                        else
                            PACKAGE_MANAGER="yum"
                        fi
                        ;;
                    arch|manjaro)
                        PACKAGE_MANAGER="pacman"
                        ;;
                    opensuse*|sles)
                        PACKAGE_MANAGER="zypper"
                        ;;
                    alpine)
                        PACKAGE_MANAGER="apk"
                        ;;
                    *)
                        PACKAGE_MANAGER="unknown"
                        ;;
                esac
            else
                OS_DIST="unknown"
                PACKAGE_MANAGER="unknown"
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*)
            OS_TYPE="windows"
            OS_DIST="windows"
            log_error "Windows detected. Please use install.ps1 instead."
            log_info "Run: powershell -ExecutionPolicy Bypass -File install.ps1"
            exit 1
            ;;
        *)
            OS_TYPE="unknown"
            OS_DIST="unknown"
            ;;
    esac

    log_info "Detected OS: ${OS_DIST} ${OS_VERSION} (${OS_TYPE})"
}

# =============================================================================
# Prerequisite Checks
# =============================================================================

check_docker_installed() {
    if command -v docker &>/dev/null; then
        return 0
    fi
    return 1
}

check_docker_compose_installed() {
    # Check for docker compose v2 (subcommand)
    if docker compose version &>/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
        return 0
    fi

    # Check for docker-compose v1 (standalone)
    if command -v docker-compose &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
        return 0
    fi

    return 1
}

check_docker_running() {
    if docker info &>/dev/null 2>&1; then
        return 0
    fi
    return 1
}

get_docker_version() {
    docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown"
}

get_docker_compose_version() {
    if [[ "${DOCKER_COMPOSE_CMD:-}" == "docker compose" ]]; then
        docker compose version --short 2>/dev/null || echo "unknown"
    else
        docker-compose version --short 2>/dev/null || echo "unknown"
    fi
}

version_gte() {
    # Compare version strings: version_gte "2.1.0" "2.0.0" returns 0 (true)
    local v1="${1%%-*}"  # Remove pre-release suffix
    local v2="${2%%-*}"

    if [[ "${v1}" == "${v2}" ]]; then
        return 0
    fi

    local IFS=.
    local i v1_parts=($v1) v2_parts=($v2)

    for ((i=0; i<${#v1_parts[@]}; i++)); do
        local v1_part="${v1_parts[i]:-0}"
        local v2_part="${v2_parts[i]:-0}"

        if ((10#$v1_part > 10#$v2_part)); then
            return 0
        elif ((10#$v1_part < 10#$v2_part)); then
            return 1
        fi
    done

    return 0
}

# =============================================================================
# Docker Installation
# =============================================================================

install_docker_macos() {
    log_step "Installing Docker on macOS..."

    if command -v brew &>/dev/null; then
        log_info "Installing via Homebrew..."
        brew install --cask docker

        log_info "Starting Docker Desktop..."
        open -a Docker

        log_info "Waiting for Docker to start (this may take a minute)..."
        local max_attempts=60
        local attempt=0
        while ! docker info &>/dev/null 2>&1; do
            ((attempt++))
            if ((attempt >= max_attempts)); then
                log_error "Timeout waiting for Docker to start."
                log_info "Please start Docker Desktop manually and re-run this script."
                exit 1
            fi
            sleep 2
            printf "."
        done
        echo ""
        log_success "Docker is running!"
    else
        log_error "Homebrew is required to install Docker on macOS."
        log_info "Install Homebrew first: https://brew.sh"
        log_info "Or install Docker Desktop manually: https://docker.com/products/docker-desktop"
        exit 1
    fi
}

install_docker_ubuntu_debian() {
    log_step "Installing Docker on ${OS_DIST}..."

    # Remove old versions
    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Install prerequisites
    sudo apt-get update
    sudo apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker's official GPG key
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${OS_DIST}/gpg" | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    # Set up repository
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${OS_DIST} \
        $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add user to docker group
    sudo usermod -aG docker "${USER}" || true

    # Start Docker
    sudo systemctl start docker
    sudo systemctl enable docker

    log_success "Docker installed successfully!"
    log_warn "You may need to log out and back in for group changes to take effect."
}

install_docker_rhel_centos() {
    log_step "Installing Docker on ${OS_DIST}..."

    # Remove old versions
    sudo "${PACKAGE_MANAGER}" remove -y docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null || true

    # Install prerequisites
    sudo "${PACKAGE_MANAGER}" install -y yum-utils

    # Add Docker repository
    sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

    # Install Docker Engine
    sudo "${PACKAGE_MANAGER}" install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add user to docker group
    sudo usermod -aG docker "${USER}" || true

    # Start Docker
    sudo systemctl start docker
    sudo systemctl enable docker

    log_success "Docker installed successfully!"
    log_warn "You may need to log out and back in for group changes to take effect."
}

install_docker_fedora() {
    log_step "Installing Docker on Fedora..."

    # Remove old versions
    sudo dnf remove -y docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-selinux docker-engine-selinux docker-engine 2>/dev/null || true

    # Install prerequisites
    sudo dnf install -y dnf-plugins-core

    # Add Docker repository
    sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo

    # Install Docker Engine
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add user to docker group
    sudo usermod -aG docker "${USER}" || true

    # Start Docker
    sudo systemctl start docker
    sudo systemctl enable docker

    log_success "Docker installed successfully!"
}

install_docker() {
    log_step "Docker not found. Attempting to install..."

    case "${OS_DIST}" in
        macos)
            install_docker_macos
            ;;
        ubuntu|debian|pop|linuxmint)
            install_docker_ubuntu_debian
            ;;
        rhel|centos|rocky|almalinux)
            install_docker_rhel_centos
            ;;
        fedora)
            install_docker_fedora
            ;;
        *)
            log_error "Automatic Docker installation not supported for ${OS_DIST}."
            log_info "Please install Docker manually: https://docs.docker.com/engine/install/"
            exit 1
            ;;
    esac
}

verify_docker() {
    log_step "Checking Docker installation..."

    if [[ "${SKIP_DOCKER_CHECK}" == "true" ]]; then
        log_warn "Skipping Docker check as requested."
        return 0
    fi

    # Check if Docker is installed
    if ! check_docker_installed; then
        if [[ "${NON_INTERACTIVE}" == "true" ]]; then
            log_error "Docker is not installed. Cannot proceed in non-interactive mode."
            exit 1
        fi

        echo ""
        echo -e "${YELLOW}Docker is not installed.${NC}"
        echo ""
        read -p "Would you like to install Docker now? [Y/n] " -r response
        response="${response:-Y}"

        if [[ "${response}" =~ ^[Yy]$ ]]; then
            install_docker
        else
            log_error "Docker is required. Please install it manually."
            exit 1
        fi
    fi

    # Check Docker version
    local docker_version
    docker_version=$(get_docker_version)
    if [[ "${docker_version}" != "unknown" ]] && ! version_gte "${docker_version}" "${MIN_DOCKER_VERSION}"; then
        log_warn "Docker version ${docker_version} is older than recommended ${MIN_DOCKER_VERSION}."
    fi
    log_success "Docker ${docker_version} installed"

    # Check Docker Compose
    if ! check_docker_compose_installed; then
        log_error "Docker Compose is not installed."
        log_info "If using Docker Desktop, it should be included."
        log_info "For standalone installation: https://docs.docker.com/compose/install/"
        exit 1
    fi

    local compose_version
    compose_version=$(get_docker_compose_version)
    log_success "Docker Compose ${compose_version} installed (${DOCKER_COMPOSE_CMD})"

    # Check if Docker is running
    if ! check_docker_running; then
        log_error "Docker is installed but not running."

        if [[ "${OS_TYPE}" == "macos" ]]; then
            log_info "Starting Docker Desktop..."
            open -a Docker

            log_info "Waiting for Docker to start..."
            local max_attempts=60
            local attempt=0
            while ! docker info &>/dev/null 2>&1; do
                ((attempt++))
                if ((attempt >= max_attempts)); then
                    log_error "Timeout waiting for Docker to start."
                    exit 1
                fi
                sleep 2
                printf "."
            done
            echo ""
        else
            log_info "Try: sudo systemctl start docker"
            exit 1
        fi
    fi

    log_success "Docker is running"
}

# =============================================================================
# Project Setup
# =============================================================================

setup_project_directory() {
    log_step "Setting up project directory..."

    # Determine if we're already in the project directory
    if [[ -f "docker-compose.yml" ]] && grep -q "sap-workflow-mining" docker-compose.yml 2>/dev/null; then
        PROJECT_DIR="$(pwd)"
        log_info "Using current directory: ${PROJECT_DIR}"
    elif [[ -n "${PROJECT_DIR}" ]]; then
        log_info "Using specified directory: ${PROJECT_DIR}"
    else
        # Default location
        PROJECT_DIR="${HOME}/sap-workflow-mining"

        if [[ ! -d "${PROJECT_DIR}" ]]; then
            if [[ "${NON_INTERACTIVE}" == "true" ]]; then
                log_info "Cloning repository to ${PROJECT_DIR}..."
                git clone "${REPO_URL}" "${PROJECT_DIR}"
            else
                echo ""
                echo "Where would you like to install SAP Workflow Mining?"
                echo ""
                read -p "Directory [${PROJECT_DIR}]: " -r custom_dir

                if [[ -n "${custom_dir}" ]]; then
                    PROJECT_DIR="${custom_dir}"
                fi

                if [[ ! -d "${PROJECT_DIR}" ]]; then
                    log_info "Creating directory and cloning repository..."
                    mkdir -p "$(dirname "${PROJECT_DIR}")"
                    git clone "${REPO_URL}" "${PROJECT_DIR}"
                fi
            fi
        fi
    fi

    # Verify project structure
    if [[ ! -f "${PROJECT_DIR}/docker-compose.yml" ]]; then
        log_error "docker-compose.yml not found in ${PROJECT_DIR}"
        log_error "The project directory appears to be incomplete."
        exit 1
    fi

    cd "${PROJECT_DIR}"
    log_success "Project directory: ${PROJECT_DIR}"
}

# =============================================================================
# Interactive Setup Wizard
# =============================================================================

show_mode_menu() {
    echo ""
    echo -e "${BOLD}${CYAN}=== SAP Workflow Mining Setup Wizard ===${NC}"
    echo ""
    echo "Choose your deployment mode:"
    echo ""
    echo -e "  ${BOLD}[1] Demo Mode${NC} ${DIM}(Recommended for first-time users)${NC}"
    echo "      Uses synthetic SAP data - no SAP connection required."
    echo "      Perfect for exploring features and testing."
    echo ""
    echo -e "  ${BOLD}[2] CSV Import Mode${NC}"
    echo "      Import your own CSV exports from SAP."
    echo "      Use SE16 or similar to export VBAK, VBAP, LIKP, etc."
    echo ""
    echo -e "  ${BOLD}[3] RFC Mode${NC} ${DIM}(Requires SAP access)${NC}"
    echo "      Connect directly to SAP ECC via RFC."
    echo "      Requires SAP NW RFC SDK and credentials."
    echo ""
}

prompt_mode() {
    if [[ -n "${INSTALL_MODE}" ]]; then
        case "${INSTALL_MODE}" in
            demo|1) INSTALL_MODE="demo" ;;
            csv|2)  INSTALL_MODE="csv" ;;
            rfc|3)  INSTALL_MODE="rfc" ;;
            *)
                log_error "Invalid mode: ${INSTALL_MODE}"
                exit 1
                ;;
        esac
        log_info "Using mode: ${INSTALL_MODE}"
        return
    fi

    if [[ "${NON_INTERACTIVE}" == "true" ]]; then
        INSTALL_MODE="demo"
        log_info "Using default mode: demo"
        return
    fi

    show_mode_menu

    while true; do
        read -p "Select mode [1-3]: " -r mode_choice

        case "${mode_choice}" in
            1|demo)
                INSTALL_MODE="demo"
                break
                ;;
            2|csv)
                INSTALL_MODE="csv"
                break
                ;;
            3|rfc)
                INSTALL_MODE="rfc"
                break
                ;;
            *)
                echo "Invalid selection. Please enter 1, 2, or 3."
                ;;
        esac
    done

    echo ""
    log_info "Selected mode: ${INSTALL_MODE}"
}

collect_rfc_config() {
    echo ""
    echo -e "${BOLD}${CYAN}=== RFC Connection Configuration ===${NC}"
    echo ""
    echo "Enter your SAP connection details."
    echo -e "${DIM}(These will be stored in .env.rfc - never committed to git)${NC}"
    echo ""

    # SAP Host
    read -p "SAP Application Server Host: " -r SAP_RFC_ASHOST
    while [[ -z "${SAP_RFC_ASHOST}" ]]; do
        echo "Host is required."
        read -p "SAP Application Server Host: " -r SAP_RFC_ASHOST
    done

    # System Number
    read -p "System Number [00]: " -r SAP_RFC_SYSNR
    SAP_RFC_SYSNR="${SAP_RFC_SYSNR:-00}"

    # Client
    read -p "Client [100]: " -r SAP_RFC_CLIENT
    SAP_RFC_CLIENT="${SAP_RFC_CLIENT:-100}"

    # Username
    read -p "RFC Username: " -r SAP_RFC_USER
    while [[ -z "${SAP_RFC_USER}" ]]; do
        echo "Username is required."
        read -p "RFC Username: " -r SAP_RFC_USER
    done

    # Password (hidden)
    echo -n "RFC Password: "
    read -rs SAP_RFC_PASSWD
    echo ""
    while [[ -z "${SAP_RFC_PASSWD}" ]]; do
        echo "Password is required."
        echo -n "RFC Password: "
        read -rs SAP_RFC_PASSWD
        echo ""
    done

    # Language
    read -p "Language [EN]: " -r SAP_RFC_LANG
    SAP_RFC_LANG="${SAP_RFC_LANG:-EN}"

    echo ""
    log_info "RFC configuration collected."
}

collect_csv_config() {
    echo ""
    echo -e "${BOLD}${CYAN}=== CSV Import Configuration ===${NC}"
    echo ""
    echo "Where are your CSV files located?"
    echo -e "${DIM}(Default: ./data/csv)${NC}"
    echo ""

    read -p "CSV Directory [./data/csv]: " -r CSV_INPUT_DIR
    CSV_INPUT_DIR="${CSV_INPUT_DIR:-./data/csv}"

    # Create directory if needed
    mkdir -p "${CSV_INPUT_DIR}"

    echo ""
    log_info "CSV input directory: ${CSV_INPUT_DIR}"
    echo ""
    echo "Place your CSV files in this directory with the following names:"
    echo "  - vbak.csv (Sales Order Headers)"
    echo "  - vbap.csv (Sales Order Items)"
    echo "  - likp.csv (Delivery Headers)"
    echo "  - lips.csv (Delivery Items)"
    echo "  - vbrk.csv (Billing Headers)"
    echo "  - vbrp.csv (Billing Items)"
    echo ""
}

# =============================================================================
# Configuration Generation
# =============================================================================

generate_env_file() {
    log_step "Generating configuration files..."

    local env_file="${PROJECT_DIR}/.env"

    # Backup existing .env
    if [[ -f "${env_file}" ]]; then
        cp "${env_file}" "${env_file}.backup.$(date +%Y%m%d_%H%M%S)"
        log_info "Backed up existing .env file"
    fi

    # Generate main .env
    cat > "${env_file}" << EOF
# SAP Workflow Mining Configuration
# Generated by install.sh on $(date)

# =============================================================================
# Adapter Configuration
# =============================================================================

# Data adapter: synthetic, csv, or ecc_rfc
SAP_ADAPTER=${INSTALL_MODE}

# =============================================================================
# Data Generation (Demo Mode)
# =============================================================================

# Number of synthetic records to generate
DATA_COUNT=10000

# Random seed for reproducible data
DATA_SEED=42

# =============================================================================
# Server Configuration
# =============================================================================

# MCP Server port
SERVER_PORT=3000

# RFC Server port (when using RFC mode)
RFC_SERVER_PORT=3001

# Viewer port
VIEWER_PORT=8080

# =============================================================================
# Output Configuration
# =============================================================================

# Pattern analysis output mode: full, shareable, or minimal
OUTPUT_MODE=shareable
EOF

    log_success "Generated .env file"

    # Generate RFC config if needed
    if [[ "${INSTALL_MODE}" == "rfc" ]]; then
        local rfc_env_file="${PROJECT_DIR}/.env.rfc"

        cat > "${rfc_env_file}" << EOF
# SAP RFC Connection Configuration
# Generated by install.sh on $(date)
#
# IMPORTANT: Never commit this file to version control!

# =============================================================================
# Required Settings
# =============================================================================

SAP_RFC_ASHOST=${SAP_RFC_ASHOST}
SAP_RFC_SYSNR=${SAP_RFC_SYSNR}
SAP_RFC_CLIENT=${SAP_RFC_CLIENT}
SAP_RFC_USER=${SAP_RFC_USER}
SAP_RFC_PASSWD=${SAP_RFC_PASSWD}

# =============================================================================
# Optional Settings
# =============================================================================

SAP_RFC_LANG=${SAP_RFC_LANG}
SAP_RFC_POOL_SIZE=5
SAP_RFC_TRACE=0
SAP_RFC_TIMEOUT=30000
EOF

        # Secure the file
        chmod 600 "${rfc_env_file}"

        # Ensure .gitignore includes .env.rfc
        if ! grep -q "^\.env\.rfc$" "${PROJECT_DIR}/.gitignore" 2>/dev/null; then
            echo ".env.rfc" >> "${PROJECT_DIR}/.gitignore"
        fi

        log_success "Generated .env.rfc file (permissions: 600)"
    fi

    # Generate CSV config if needed
    if [[ "${INSTALL_MODE}" == "csv" ]]; then
        echo "" >> "${env_file}"
        echo "# ==============================================================================" >> "${env_file}"
        echo "# CSV Import Configuration" >> "${env_file}"
        echo "# ==============================================================================" >> "${env_file}"
        echo "" >> "${env_file}"
        echo "CSV_INPUT_DIR=${CSV_INPUT_DIR}" >> "${env_file}"

        log_success "Added CSV configuration to .env"
    fi
}

# =============================================================================
# Installation Verification
# =============================================================================

run_verification() {
    log_step "Verifying installation..."

    echo ""

    # Test 1: Docker Compose validation
    log_info "Validating Docker Compose configuration..."
    if ${DOCKER_COMPOSE_CMD} config --quiet 2>/dev/null; then
        log_success "Docker Compose configuration is valid"
    else
        log_error "Docker Compose configuration validation failed"
        exit 1
    fi

    # Test 2: Build images
    log_info "Building Docker images (this may take a few minutes)..."
    if ${DOCKER_COMPOSE_CMD} build --quiet synthetic-data pattern-engine 2>/dev/null; then
        log_success "Docker images built successfully"
    else
        log_warn "Image build had warnings, but continuing..."
    fi

    # Test 3: Run synthetic data generation
    log_info "Testing synthetic data generation..."
    if ${DOCKER_COMPOSE_CMD} run --rm synthetic-data python src/generate_sd.py --count 100 --seed 42 --output /app/output 2>/dev/null; then
        log_success "Synthetic data generation works"
    else
        log_warn "Synthetic data generation test had issues"
    fi

    # Test 4: Verify pattern engine
    log_info "Verifying pattern engine..."
    if ${DOCKER_COMPOSE_CMD} run --rm pattern-engine python -c "from src.main import main; print('Pattern engine OK')" 2>/dev/null; then
        log_success "Pattern engine is functional"
    else
        log_warn "Pattern engine verification had issues"
    fi

    echo ""
}

# =============================================================================
# Post-Installation Summary
# =============================================================================

show_summary() {
    echo ""
    echo -e "${GREEN}${BOLD}"
    echo "============================================================"
    echo "  Installation Complete!"
    echo "============================================================"
    echo -e "${NC}"
    echo ""
    echo -e "Project Location: ${BOLD}${PROJECT_DIR}${NC}"
    echo -e "Mode: ${BOLD}${INSTALL_MODE}${NC}"
    echo ""
    echo -e "${CYAN}${BOLD}Quick Start Commands:${NC}"
    echo ""

    case "${INSTALL_MODE}" in
        demo)
            echo "  # Generate synthetic data and run analysis"
            echo -e "  ${BOLD}${DOCKER_COMPOSE_CMD} up${NC}"
            echo ""
            echo "  # Or run step by step:"
            echo "  ${DOCKER_COMPOSE_CMD} up synthetic-data    # Generate data"
            echo "  ${DOCKER_COMPOSE_CMD} up pattern-engine    # Analyze patterns"
            echo "  ${DOCKER_COMPOSE_CMD} up viewer            # View results at http://localhost:8080"
            ;;
        csv)
            echo "  # 1. Place your CSV files in: ${CSV_INPUT_DIR}"
            echo ""
            echo "  # 2. Run the analysis"
            echo -e "  ${BOLD}${DOCKER_COMPOSE_CMD} up pattern-engine${NC}"
            echo ""
            echo "  # 3. View results"
            echo "  ${DOCKER_COMPOSE_CMD} up viewer            # http://localhost:8080"
            ;;
        rfc)
            echo "  # Connect to SAP and run analysis"
            echo -e "  ${BOLD}${DOCKER_COMPOSE_CMD} --profile rfc up mcp-server-rfc${NC}"
            echo ""
            echo "  # Run pattern analysis"
            echo "  ${DOCKER_COMPOSE_CMD} up pattern-engine"
            echo ""
            echo "  # View results"
            echo "  ${DOCKER_COMPOSE_CMD} up viewer            # http://localhost:8080"
            ;;
    esac

    echo ""
    echo -e "${CYAN}${BOLD}Other Useful Commands:${NC}"
    echo ""
    echo "  ${DOCKER_COMPOSE_CMD} down         # Stop all services"
    echo "  ${DOCKER_COMPOSE_CMD} logs -f      # View logs"
    echo "  ./cli.sh status             # Check status"
    echo "  ./cli.sh --help             # Show CLI help"
    echo ""
    echo -e "${DIM}Documentation: https://github.com/your-org/sap-workflow-mining${NC}"
    echo ""
}

# =============================================================================
# Cleanup and Error Handling
# =============================================================================

cleanup() {
    # Called on script exit
    if [[ $? -ne 0 ]]; then
        echo ""
        log_error "Installation failed. Please check the errors above."
        echo ""
        echo "For help, please:"
        echo "  1. Check the documentation"
        echo "  2. Open an issue on GitHub"
        echo ""
    fi
}

trap cleanup EXIT

# =============================================================================
# Command Line Argument Parsing
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --non-interactive|-y)
                NON_INTERACTIVE=true
                shift
                ;;
            --mode|-m)
                INSTALL_MODE="$2"
                shift 2
                ;;
            --directory|-d)
                PROJECT_DIR="$2"
                shift 2
                ;;
            --skip-docker-check)
                SKIP_DOCKER_CHECK=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            --version|-v)
                echo "SAP Workflow Mining Installer v${INSTALLER_VERSION}"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information."
                exit 1
                ;;
        esac
    done
}

show_help() {
    echo "SAP Workflow Mining - One-Click Installer"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -y, --non-interactive    Run with defaults, no prompts"
    echo "  -m, --mode MODE          Set mode: demo, csv, or rfc"
    echo "  -d, --directory PATH     Installation directory"
    echo "      --skip-docker-check  Skip Docker installation check"
    echo "  -h, --help               Show this help message"
    echo "  -v, --version            Show version"
    echo ""
    echo "Examples:"
    echo "  # Interactive installation"
    echo "  $0"
    echo ""
    echo "  # Non-interactive demo mode installation"
    echo "  $0 --non-interactive --mode demo"
    echo ""
    echo "  # Install from curl"
    echo "  curl -sSL https://raw.githubusercontent.com/[repo]/main/install.sh | bash"
    echo ""
}

# =============================================================================
# Main Installation Flow
# =============================================================================

main() {
    setup_colors
    parse_args "$@"

    print_banner

    log_step "Starting SAP Workflow Mining installation..."
    echo ""

    # Step 1: Detect OS
    detect_os

    # Step 2: Verify Docker
    verify_docker

    # Step 3: Setup project directory
    setup_project_directory

    # Step 4: Interactive mode selection
    prompt_mode

    # Step 5: Collect mode-specific configuration
    case "${INSTALL_MODE}" in
        rfc)
            if [[ "${NON_INTERACTIVE}" != "true" ]]; then
                collect_rfc_config
            else
                log_warn "RFC mode requires manual configuration of .env.rfc"
            fi
            ;;
        csv)
            if [[ "${NON_INTERACTIVE}" != "true" ]]; then
                collect_csv_config
            else
                CSV_INPUT_DIR="./data/csv"
            fi
            ;;
        demo)
            # No additional config needed
            ;;
    esac

    # Step 6: Generate configuration
    generate_env_file

    # Step 7: Verification
    run_verification

    # Step 8: Show summary
    show_summary
}

# Run main function
main "$@"
