#!/bin/bash
# Transaction Forensics CLI
# Commands: generate-data, start-server, run-analysis, view-results, all, clean

set -e

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR}"

# Environment variable defaults
DATA_COUNT="${DATA_COUNT:-10000}"
DATA_SEED="${DATA_SEED:-42}"
INPUT_DIR="${INPUT_DIR:-${PROJECT_ROOT}/synthetic-data/sample_output}"
OUTPUT_DIR="${OUTPUT_DIR:-${PROJECT_ROOT}/output}"
SERVER_PORT="${SERVER_PORT:-3000}"
VIEWER_PORT="${VIEWER_PORT:-8080}"

# =============================================================================
# Color Output
# =============================================================================

# Check if terminal supports colors
if [[ -t 1 ]] && [[ "${TERM}" != "dumb" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    MAGENTA='\033[0;35m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    MAGENTA=''
    CYAN=''
    BOLD=''
    NC=''
fi

# =============================================================================
# Logging Functions
# =============================================================================

info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

step() {
    echo -e "${MAGENTA}[STEP]${NC} ${BOLD}$*${NC}"
}

# =============================================================================
# Helper Functions
# =============================================================================

check_command() {
    if ! command -v "$1" &> /dev/null; then
        error "Required command '$1' not found. Please install it first."
        return 1
    fi
}

ensure_directory() {
    if [[ ! -d "$1" ]]; then
        mkdir -p "$1"
        info "Created directory: $1"
    fi
}

check_python() {
    if command -v python3 &> /dev/null; then
        echo "python3"
    elif command -v python &> /dev/null; then
        echo "python"
    else
        error "Python not found. Please install Python 3.9 or later."
        exit 1
    fi
}

check_node() {
    if ! command -v node &> /dev/null; then
        error "Node.js not found. Please install Node.js 18 or later."
        exit 1
    fi
}

# =============================================================================
# Command: generate-data
# =============================================================================

cmd_generate_data() {
    local count="${DATA_COUNT}"
    local seed="${DATA_SEED}"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --count|-c)
                count="$2"
                shift 2
                ;;
            --seed|-s)
                seed="$2"
                shift 2
                ;;
            --help|-h)
                echo "Usage: $0 generate-data [OPTIONS]"
                echo ""
                echo "Generate synthetic SAP SD data"
                echo ""
                echo "Options:"
                echo "  -c, --count N     Number of sales orders to generate (default: ${DATA_COUNT})"
                echo "  -s, --seed S      Random seed for reproducibility (default: ${DATA_SEED})"
                echo "  -h, --help        Show this help message"
                echo ""
                echo "Environment Variables:"
                echo "  DATA_COUNT        Same as --count"
                echo "  DATA_SEED         Same as --seed"
                return 0
                ;;
            *)
                error "Unknown option: $1"
                return 1
                ;;
        esac
    done

    step "Generating synthetic data (count=${count}, seed=${seed})"

    local python_cmd
    python_cmd=$(check_python)

    cd "${PROJECT_ROOT}/synthetic-data"

    # Ensure output directory exists
    ensure_directory "sample_output"

    # Check if generate_sd.py exists
    if [[ ! -f "src/generate_sd.py" ]]; then
        error "Generator script not found: src/generate_sd.py"
        error "Please ensure the synthetic-data module is properly set up."
        return 1
    fi

    # Install dependencies if needed
    if [[ ! -d ".venv" ]] && [[ ! -d "venv" ]]; then
        info "Installing synthetic-data dependencies..."
        ${python_cmd} -m pip install -e . --quiet 2>/dev/null || \
            ${python_cmd} -m pip install faker numpy python-dateutil --quiet
    fi

    # Run generator
    info "Running synthetic data generator..."
    ${python_cmd} src/generate_sd.py --count "${count}" --seed "${seed}" --output-dir sample_output

    success "Synthetic data generated in: ${PROJECT_ROOT}/synthetic-data/sample_output"
}

# =============================================================================
# Command: start-server
# =============================================================================

cmd_start_server() {
    local background=false
    local port="${SERVER_PORT}"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --background|-b)
                background=true
                shift
                ;;
            --port|-p)
                port="$2"
                shift 2
                ;;
            --help|-h)
                echo "Usage: $0 start-server [OPTIONS]"
                echo ""
                echo "Start the MCP server"
                echo ""
                echo "Options:"
                echo "  -b, --background  Run server in background"
                echo "  -p, --port N      Server port (default: ${SERVER_PORT})"
                echo "  -h, --help        Show this help message"
                echo ""
                echo "Environment Variables:"
                echo "  SERVER_PORT       Same as --port"
                return 0
                ;;
            *)
                error "Unknown option: $1"
                return 1
                ;;
        esac
    done

    step "Starting MCP server on port ${port}"

    check_node

    cd "${PROJECT_ROOT}/mcp-server"

    # Install dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        info "Installing MCP server dependencies..."
        npm install --silent
    fi

    # Build TypeScript if needed
    if [[ ! -d "dist" ]] || [[ "src/index.ts" -nt "dist/index.js" ]]; then
        info "Building TypeScript..."
        npm run build
    fi

    export PORT="${port}"
    export DATA_DIR="${INPUT_DIR}"
    export LOG_DIR="${OUTPUT_DIR}/logs"

    ensure_directory "${LOG_DIR}"

    if [[ "${background}" == "true" ]]; then
        info "Starting server in background..."
        nohup npm start > "${OUTPUT_DIR}/logs/mcp-server.log" 2>&1 &
        local pid=$!
        echo "${pid}" > "${OUTPUT_DIR}/logs/mcp-server.pid"
        success "MCP server started in background (PID: ${pid})"
        info "Logs: ${OUTPUT_DIR}/logs/mcp-server.log"
    else
        info "Starting server in foreground (Ctrl+C to stop)..."
        npm start
    fi
}

# =============================================================================
# Command: stop-server
# =============================================================================

cmd_stop_server() {
    local pid_file="${OUTPUT_DIR}/logs/mcp-server.pid"

    if [[ -f "${pid_file}" ]]; then
        local pid
        pid=$(cat "${pid_file}")
        if kill -0 "${pid}" 2>/dev/null; then
            info "Stopping MCP server (PID: ${pid})..."
            kill "${pid}"
            rm -f "${pid_file}"
            success "MCP server stopped"
        else
            warn "Server process not running (stale PID file)"
            rm -f "${pid_file}"
        fi
    else
        warn "No PID file found. Server may not be running."
    fi
}

# =============================================================================
# Command: run-analysis
# =============================================================================

cmd_run_analysis() {
    local input_dir="${INPUT_DIR}"
    local output_dir="${OUTPUT_DIR}"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --input-dir|-i)
                input_dir="$2"
                shift 2
                ;;
            --output-dir|-o)
                output_dir="$2"
                shift 2
                ;;
            --help|-h)
                echo "Usage: $0 run-analysis [OPTIONS]"
                echo ""
                echo "Run the pattern engine analysis"
                echo ""
                echo "Options:"
                echo "  -i, --input-dir PATH   Input data directory (default: ${INPUT_DIR})"
                echo "  -o, --output-dir PATH  Output directory (default: ${OUTPUT_DIR})"
                echo "  -h, --help             Show this help message"
                echo ""
                echo "Environment Variables:"
                echo "  INPUT_DIR              Same as --input-dir"
                echo "  OUTPUT_DIR             Same as --output-dir"
                return 0
                ;;
            *)
                error "Unknown option: $1"
                return 1
                ;;
        esac
    done

    step "Running pattern analysis"

    # Check input directory
    if [[ ! -d "${input_dir}" ]]; then
        error "Input directory not found: ${input_dir}"
        error "Run 'generate-data' first to create synthetic data."
        return 1
    fi

    local python_cmd
    python_cmd=$(check_python)

    cd "${PROJECT_ROOT}/pattern-engine"

    # Ensure output directory exists
    ensure_directory "${output_dir}"

    # Install dependencies if needed
    if [[ ! -d ".venv" ]] && [[ ! -d "venv" ]]; then
        info "Installing pattern-engine dependencies..."
        ${python_cmd} -m pip install -e . --quiet 2>/dev/null || \
            ${python_cmd} -m pip install scikit-learn numpy pandas click --quiet
    fi

    # Run analysis
    info "Analyzing patterns in: ${input_dir}"
    info "Output directory: ${output_dir}"

    PYTHONPATH="${PROJECT_ROOT}/pattern-engine" \
        ${python_cmd} -m src.main run \
            --input-dir "${input_dir}" \
            --output-dir "${output_dir}"

    success "Analysis complete. Results in: ${output_dir}"
}

# =============================================================================
# Command: view-results
# =============================================================================

cmd_view_results() {
    local port="${VIEWER_PORT}"
    local output_dir="${OUTPUT_DIR}"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --port|-p)
                port="$2"
                shift 2
                ;;
            --output-dir|-o)
                output_dir="$2"
                shift 2
                ;;
            --help|-h)
                echo "Usage: $0 view-results [OPTIONS]"
                echo ""
                echo "Launch the results viewer"
                echo ""
                echo "Options:"
                echo "  -p, --port N           Viewer port (default: ${VIEWER_PORT})"
                echo "  -o, --output-dir PATH  Output directory to serve (default: ${OUTPUT_DIR})"
                echo "  -h, --help             Show this help message"
                echo ""
                echo "Environment Variables:"
                echo "  VIEWER_PORT            Same as --port"
                echo "  OUTPUT_DIR             Same as --output-dir"
                return 0
                ;;
            *)
                error "Unknown option: $1"
                return 1
                ;;
        esac
    done

    step "Launching results viewer"

    if [[ ! -d "${output_dir}" ]]; then
        error "Output directory not found: ${output_dir}"
        error "Run 'run-analysis' first to generate results."
        return 1
    fi

    # List available results
    info "Results available in: ${output_dir}"
    echo ""
    if [[ -d "${output_dir}/reports" ]]; then
        echo "Reports:"
        ls -la "${output_dir}/reports/" 2>/dev/null || echo "  (none)"
    fi
    if [[ -d "${output_dir}/patterns" ]]; then
        echo "Patterns:"
        ls -la "${output_dir}/patterns/" 2>/dev/null || echo "  (none)"
    fi
    echo ""

    # Check for viewer implementation
    if [[ -d "${PROJECT_ROOT}/viewer" ]]; then
        cd "${PROJECT_ROOT}/viewer"

        if [[ -f "package.json" ]]; then
            # Node-based viewer
            if [[ ! -d "node_modules" ]]; then
                info "Installing viewer dependencies..."
                npm install --silent
            fi
            info "Starting viewer on http://localhost:${port}"
            PORT="${port}" OUTPUT_DIR="${output_dir}" npm start
        elif [[ -f "requirements.txt" ]] || [[ -f "pyproject.toml" ]]; then
            # Python-based viewer
            local python_cmd
            python_cmd=$(check_python)
            info "Starting Python HTTP server on http://localhost:${port}"
            cd "${output_dir}"
            ${python_cmd} -m http.server "${port}"
        else
            # Simple HTTP server fallback
            info "Starting simple HTTP server on http://localhost:${port}"
            local python_cmd
            python_cmd=$(check_python)
            cd "${output_dir}"
            ${python_cmd} -m http.server "${port}"
        fi
    else
        # No viewer directory, use simple HTTP server
        info "Viewer not configured. Starting simple HTTP server..."
        local python_cmd
        python_cmd=$(check_python)
        cd "${output_dir}"
        info "Serving ${output_dir} on http://localhost:${port}"
        ${python_cmd} -m http.server "${port}"
    fi
}

# =============================================================================
# Command: all
# =============================================================================

cmd_all() {
    local count="${DATA_COUNT}"
    local seed="${DATA_SEED}"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --count|-c)
                count="$2"
                shift 2
                ;;
            --seed|-s)
                seed="$2"
                shift 2
                ;;
            --help|-h)
                echo "Usage: $0 all [OPTIONS]"
                echo ""
                echo "Run complete pipeline: generate-data -> run-analysis"
                echo ""
                echo "Options:"
                echo "  -c, --count N     Number of sales orders to generate (default: ${DATA_COUNT})"
                echo "  -s, --seed S      Random seed for reproducibility (default: ${DATA_SEED})"
                echo "  -h, --help        Show this help message"
                return 0
                ;;
            *)
                error "Unknown option: $1"
                return 1
                ;;
        esac
    done

    step "Running complete Transaction Forensics pipeline"
    echo ""

    # Step 1: Generate data
    echo "=========================================="
    echo "Step 1/2: Generating Synthetic Data"
    echo "=========================================="
    cmd_generate_data --count "${count}" --seed "${seed}"
    echo ""

    # Step 2: Run analysis
    echo "=========================================="
    echo "Step 2/2: Running Pattern Analysis"
    echo "=========================================="
    cmd_run_analysis
    echo ""

    success "Pipeline complete!"
    echo ""
    info "To start the MCP server: $0 start-server"
    info "To view results: $0 view-results"
}

# =============================================================================
# Command: clean
# =============================================================================

cmd_clean() {
    local force=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --force|-f)
                force=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 clean [OPTIONS]"
                echo ""
                echo "Remove generated files"
                echo ""
                echo "Options:"
                echo "  -f, --force       Skip confirmation prompt"
                echo "  -h, --help        Show this help message"
                return 0
                ;;
            *)
                error "Unknown option: $1"
                return 1
                ;;
        esac
    done

    step "Cleaning generated files"

    if [[ "${force}" != "true" ]]; then
        echo "This will remove:"
        echo "  - ${PROJECT_ROOT}/synthetic-data/sample_output/*"
        echo "  - ${PROJECT_ROOT}/output/*"
        echo ""
        read -p "Continue? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "Cancelled."
            return 0
        fi
    fi

    # Stop server if running
    cmd_stop_server 2>/dev/null || true

    # Clean synthetic data
    if [[ -d "${PROJECT_ROOT}/synthetic-data/sample_output" ]]; then
        info "Cleaning synthetic data..."
        rm -rf "${PROJECT_ROOT}/synthetic-data/sample_output"/*
    fi

    # Clean output
    if [[ -d "${PROJECT_ROOT}/output" ]]; then
        info "Cleaning output directory..."
        rm -rf "${PROJECT_ROOT}/output"/*
        # Recreate .gitkeep
        touch "${PROJECT_ROOT}/output/.gitkeep"
    fi

    success "Cleaned generated files"
}

# =============================================================================
# Command: status
# =============================================================================

cmd_status() {
    step "Transaction Forensics - Status"
    echo ""

    # Check synthetic data
    echo "Synthetic Data:"
    if [[ -d "${PROJECT_ROOT}/synthetic-data/sample_output" ]]; then
        local file_count
        file_count=$(find "${PROJECT_ROOT}/synthetic-data/sample_output" -type f -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
        if [[ "${file_count}" -gt 0 ]]; then
            echo "  Status: ${GREEN}Generated${NC} (${file_count} files)"
            ls -lh "${PROJECT_ROOT}/synthetic-data/sample_output"/*.json 2>/dev/null | awk '{print "    " $9 " (" $5 ")"}'
        else
            echo "  Status: ${YELLOW}Empty${NC}"
        fi
    else
        echo "  Status: ${RED}Not created${NC}"
    fi
    echo ""

    # Check MCP server
    echo "MCP Server:"
    local pid_file="${OUTPUT_DIR}/logs/mcp-server.pid"
    if [[ -f "${pid_file}" ]]; then
        local pid
        pid=$(cat "${pid_file}")
        if kill -0 "${pid}" 2>/dev/null; then
            echo "  Status: ${GREEN}Running${NC} (PID: ${pid})"
        else
            echo "  Status: ${YELLOW}Stopped${NC} (stale PID file)"
        fi
    else
        echo "  Status: ${YELLOW}Not running${NC}"
    fi
    echo ""

    # Check output
    echo "Analysis Output:"
    if [[ -d "${PROJECT_ROOT}/output/reports" ]]; then
        local report_count
        report_count=$(find "${PROJECT_ROOT}/output/reports" -type f 2>/dev/null | wc -l | tr -d ' ')
        if [[ "${report_count}" -gt 0 ]]; then
            echo "  Status: ${GREEN}Available${NC} (${report_count} reports)"
            ls -lh "${PROJECT_ROOT}/output/reports"/* 2>/dev/null | awk '{print "    " $9 " (" $5 ")"}'
        else
            echo "  Status: ${YELLOW}Empty${NC}"
        fi
    else
        echo "  Status: ${RED}Not created${NC}"
    fi
    echo ""
}

# =============================================================================
# Command: help
# =============================================================================

cmd_help() {
    echo ""
    echo "${BOLD}Transaction Forensics CLI${NC}"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  generate-data    Generate synthetic SAP SD data"
    echo "  start-server     Start the MCP server"
    echo "  stop-server      Stop the MCP server (if running in background)"
    echo "  run-analysis     Run the pattern engine analysis"
    echo "  view-results     Launch the results viewer"
    echo "  all              Run complete pipeline (generate + analyze)"
    echo "  clean            Remove generated files"
    echo "  status           Show current status"
    echo "  help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 generate-data --count 5000 --seed 123"
    echo "  $0 start-server --background"
    echo "  $0 run-analysis --input-dir ./data --output-dir ./results"
    echo "  $0 all --count 10000"
    echo "  $0 clean --force"
    echo ""
    echo "Environment Variables:"
    echo "  DATA_COUNT       Number of records to generate (default: 10000)"
    echo "  DATA_SEED        Random seed (default: 42)"
    echo "  INPUT_DIR        Input data directory"
    echo "  OUTPUT_DIR       Output directory"
    echo "  SERVER_PORT      MCP server port (default: 3000)"
    echo "  VIEWER_PORT      Viewer port (default: 8080)"
    echo ""
    echo "For command-specific help, run: $0 <command> --help"
    echo ""
}

# =============================================================================
# Main Entry Point
# =============================================================================

main() {
    if [[ $# -eq 0 ]]; then
        cmd_help
        exit 0
    fi

    local command="$1"
    shift

    case "${command}" in
        generate-data|generate)
            cmd_generate_data "$@"
            ;;
        start-server|server|start)
            cmd_start_server "$@"
            ;;
        stop-server|stop)
            cmd_stop_server "$@"
            ;;
        run-analysis|analyze|analysis)
            cmd_run_analysis "$@"
            ;;
        view-results|view|viewer)
            cmd_view_results "$@"
            ;;
        all|pipeline)
            cmd_all "$@"
            ;;
        clean)
            cmd_clean "$@"
            ;;
        status)
            cmd_status "$@"
            ;;
        help|--help|-h)
            cmd_help
            ;;
        *)
            error "Unknown command: ${command}"
            echo "Run '$0 help' for usage information."
            exit 1
            ;;
    esac
}

main "$@"
