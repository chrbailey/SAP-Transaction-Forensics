#Requires -Version 5.1
<#
.SYNOPSIS
    SAP Workflow Mining - One-Click Installer for Windows

.DESCRIPTION
    This script provides an easy way to get started with SAP Workflow Mining on Windows.
    It handles prerequisites, configuration, and verification automatically.

.PARAMETER NonInteractive
    Run with defaults, no prompts

.PARAMETER Mode
    Set mode: demo, csv, or rfc

.PARAMETER Directory
    Installation directory

.PARAMETER SkipDockerCheck
    Skip Docker installation check

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -NonInteractive -Mode demo

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install.ps1

.NOTES
    Version: 1.0.0
    Requires: PowerShell 5.1+, Docker Desktop for Windows
#>

[CmdletBinding()]
param(
    [switch]$NonInteractive,
    [ValidateSet("demo", "csv", "rfc")]
    [string]$Mode = "",
    [string]$Directory = "",
    [switch]$SkipDockerCheck,
    [switch]$Help
)

# =============================================================================
# Configuration
# =============================================================================

$Script:InstallerVersion = "1.0.0"
$Script:RepoUrl = "https://github.com/your-org/sap-workflow-mining.git"
$Script:MinDockerVersion = [version]"20.10.0"
$Script:ProjectDir = ""
$Script:DockerComposeCmd = ""

# =============================================================================
# Helper Functions
# =============================================================================

function Write-Banner {
    $banner = @"

   ____    _    ____   __        __         _    __ _
  / ___|  / \  |  _ \  \ \      / /__  _ __| | _/ _| | _____      __
  \___ \ / _ \ | |_) |  \ \ /\ / / _ \| '__| |/ / | |/ _ \ \ /\ / /
   ___) / ___ \|  __/    \ V  V / (_) | |  |   <| | | (_) \ V  V /
  |____/_/   \_\_|        \_/\_/ \___/|_|  |_|\_\_|_|\___/ \_/\_/

   __  __ _       _
  |  \/  (_)_ __ (_)_ __   __ _
  | |\/| | | '_ \| | '_ \ / _` |
  | |  | | | | | | | | | | (_| |
  |_|  |_|_|_| |_|_|_| |_|\__, |
                          |___/

"@
    Write-Host $banner -ForegroundColor Cyan
    Write-Host "  One-Click Installer v$Script:InstallerVersion" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    Write-Host ">>> " -ForegroundColor Magenta -NoNewline
    Write-Host $Message -ForegroundColor White
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Show-Help {
    Write-Host @"
SAP Workflow Mining - One-Click Installer for Windows

Usage: .\install.ps1 [OPTIONS]

Options:
  -NonInteractive    Run with defaults, no prompts
  -Mode MODE         Set mode: demo, csv, or rfc
  -Directory PATH    Installation directory
  -SkipDockerCheck   Skip Docker installation check
  -Help              Show this help message

Examples:
  # Interactive installation
  .\install.ps1

  # Non-interactive demo mode installation
  .\install.ps1 -NonInteractive -Mode demo

  # Run with bypass execution policy
  powershell -ExecutionPolicy Bypass -File install.ps1

"@
}

# =============================================================================
# Docker Functions
# =============================================================================

function Test-DockerInstalled {
    try {
        $null = Get-Command docker -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Test-DockerComposeInstalled {
    # Check for docker compose v2 (subcommand)
    try {
        $result = docker compose version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $Script:DockerComposeCmd = "docker compose"
            return $true
        }
    }
    catch {}

    # Check for docker-compose v1 (standalone)
    try {
        $null = Get-Command docker-compose -ErrorAction Stop
        $Script:DockerComposeCmd = "docker-compose"
        return $true
    }
    catch {
        return $false
    }
}

function Test-DockerRunning {
    try {
        $result = docker info 2>&1
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

function Get-DockerVersion {
    try {
        $version = docker version --format '{{.Server.Version}}' 2>&1
        if ($LASTEXITCODE -eq 0) {
            return $version.Trim()
        }
    }
    catch {}
    return "unknown"
}

function Get-DockerComposeVersion {
    try {
        if ($Script:DockerComposeCmd -eq "docker compose") {
            $version = docker compose version --short 2>&1
        }
        else {
            $version = docker-compose version --short 2>&1
        }
        if ($LASTEXITCODE -eq 0) {
            return $version.Trim()
        }
    }
    catch {}
    return "unknown"
}

function Install-DockerDesktop {
    Write-Step "Installing Docker Desktop..."

    # Check if winget is available
    $wingetAvailable = $false
    try {
        $null = Get-Command winget -ErrorAction Stop
        $wingetAvailable = $true
    }
    catch {}

    if ($wingetAvailable) {
        Write-Info "Installing via winget..."
        try {
            winget install Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
            Write-Success "Docker Desktop installed"
            Write-Warning "Please restart your computer and run this script again."
            Write-Info "After restart, Docker Desktop should start automatically."
            exit 0
        }
        catch {
            Write-Warning "winget installation failed, trying alternative method..."
        }
    }

    # Download and install manually
    Write-Info "Downloading Docker Desktop installer..."
    $installerUrl = "https://desktop.docker.com/win/stable/Docker%20Desktop%20Installer.exe"
    $installerPath = Join-Path $env:TEMP "DockerDesktopInstaller.exe"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

        Write-Info "Running Docker Desktop installer..."
        Start-Process -FilePath $installerPath -ArgumentList "install", "--quiet" -Wait

        Write-Success "Docker Desktop installed"
        Write-Warning "Please restart your computer and run this script again."
        exit 0
    }
    catch {
        Write-Error "Failed to download or install Docker Desktop."
        Write-Info "Please install manually from: https://docker.com/products/docker-desktop"
        exit 1
    }
}

function Test-Docker {
    Write-Step "Checking Docker installation..."

    if ($SkipDockerCheck) {
        Write-Warning "Skipping Docker check as requested."
        return
    }

    # Check if Docker is installed
    if (-not (Test-DockerInstalled)) {
        if ($NonInteractive) {
            Write-Error "Docker is not installed. Cannot proceed in non-interactive mode."
            exit 1
        }

        Write-Host ""
        Write-Host "Docker is not installed." -ForegroundColor Yellow
        Write-Host ""
        $response = Read-Host "Would you like to install Docker Desktop now? [Y/n]"
        if ($response -eq "" -or $response -match "^[Yy]") {
            Install-DockerDesktop
        }
        else {
            Write-Error "Docker is required. Please install it manually."
            exit 1
        }
    }

    # Check Docker version
    $dockerVersion = Get-DockerVersion
    Write-Success "Docker $dockerVersion installed"

    # Check Docker Compose
    if (-not (Test-DockerComposeInstalled)) {
        Write-Error "Docker Compose is not installed."
        Write-Info "Docker Desktop should include Docker Compose."
        exit 1
    }

    $composeVersion = Get-DockerComposeVersion
    Write-Success "Docker Compose $composeVersion installed ($Script:DockerComposeCmd)"

    # Check if Docker is running
    if (-not (Test-DockerRunning)) {
        Write-Warning "Docker is installed but not running."
        Write-Info "Starting Docker Desktop..."

        try {
            Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
        }
        catch {
            Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
        }

        Write-Info "Waiting for Docker to start (this may take a minute)..."
        $maxAttempts = 60
        $attempt = 0
        while (-not (Test-DockerRunning)) {
            $attempt++
            if ($attempt -ge $maxAttempts) {
                Write-Error "Timeout waiting for Docker to start."
                Write-Info "Please start Docker Desktop manually and re-run this script."
                exit 1
            }
            Start-Sleep -Seconds 2
            Write-Host "." -NoNewline
        }
        Write-Host ""
    }

    Write-Success "Docker is running"
}

# =============================================================================
# Project Setup
# =============================================================================

function Initialize-ProjectDirectory {
    Write-Step "Setting up project directory..."

    # Check if we're in the project directory
    if (Test-Path "docker-compose.yml") {
        $content = Get-Content "docker-compose.yml" -Raw -ErrorAction SilentlyContinue
        if ($content -match "sap-workflow-mining") {
            $Script:ProjectDir = Get-Location
            Write-Info "Using current directory: $Script:ProjectDir"
            return
        }
    }

    if ($Directory) {
        $Script:ProjectDir = $Directory
        Write-Info "Using specified directory: $Script:ProjectDir"
    }
    else {
        # Default location
        $Script:ProjectDir = Join-Path $env:USERPROFILE "sap-workflow-mining"

        if (-not (Test-Path $Script:ProjectDir)) {
            if ($NonInteractive) {
                Write-Info "Cloning repository to $Script:ProjectDir..."
                git clone $Script:RepoUrl $Script:ProjectDir
            }
            else {
                Write-Host ""
                Write-Host "Where would you like to install SAP Workflow Mining?"
                Write-Host ""
                $customDir = Read-Host "Directory [$Script:ProjectDir]"
                if ($customDir) {
                    $Script:ProjectDir = $customDir
                }

                if (-not (Test-Path $Script:ProjectDir)) {
                    Write-Info "Creating directory and cloning repository..."
                    $parentDir = Split-Path $Script:ProjectDir -Parent
                    if (-not (Test-Path $parentDir)) {
                        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
                    }
                    git clone $Script:RepoUrl $Script:ProjectDir
                }
            }
        }
    }

    # Verify project structure
    $dockerComposePath = Join-Path $Script:ProjectDir "docker-compose.yml"
    if (-not (Test-Path $dockerComposePath)) {
        Write-Error "docker-compose.yml not found in $Script:ProjectDir"
        Write-Error "The project directory appears to be incomplete."
        exit 1
    }

    Set-Location $Script:ProjectDir
    Write-Success "Project directory: $Script:ProjectDir"
}

# =============================================================================
# Interactive Setup Wizard
# =============================================================================

function Show-ModeMenu {
    Write-Host ""
    Write-Host "=== SAP Workflow Mining Setup Wizard ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Choose your deployment mode:"
    Write-Host ""
    Write-Host "  [1] Demo Mode" -ForegroundColor White -NoNewline
    Write-Host " (Recommended for first-time users)" -ForegroundColor DarkGray
    Write-Host "      Uses synthetic SAP data - no SAP connection required."
    Write-Host "      Perfect for exploring features and testing."
    Write-Host ""
    Write-Host "  [2] CSV Import Mode" -ForegroundColor White
    Write-Host "      Import your own CSV exports from SAP."
    Write-Host "      Use SE16 or similar to export VBAK, VBAP, LIKP, etc."
    Write-Host ""
    Write-Host "  [3] RFC Mode" -ForegroundColor White -NoNewline
    Write-Host " (Requires SAP access)" -ForegroundColor DarkGray
    Write-Host "      Connect directly to SAP ECC via RFC."
    Write-Host "      Requires SAP NW RFC SDK and credentials."
    Write-Host ""
}

function Get-InstallMode {
    if ($Mode) {
        $Script:InstallMode = $Mode
        Write-Info "Using mode: $Script:InstallMode"
        return
    }

    if ($NonInteractive) {
        $Script:InstallMode = "demo"
        Write-Info "Using default mode: demo"
        return
    }

    Show-ModeMenu

    while ($true) {
        $choice = Read-Host "Select mode [1-3]"
        switch ($choice) {
            "1" { $Script:InstallMode = "demo"; break }
            "demo" { $Script:InstallMode = "demo"; break }
            "2" { $Script:InstallMode = "csv"; break }
            "csv" { $Script:InstallMode = "csv"; break }
            "3" { $Script:InstallMode = "rfc"; break }
            "rfc" { $Script:InstallMode = "rfc"; break }
            default {
                Write-Host "Invalid selection. Please enter 1, 2, or 3."
                continue
            }
        }
        break
    }

    Write-Host ""
    Write-Info "Selected mode: $Script:InstallMode"
}

function Get-RfcConfig {
    Write-Host ""
    Write-Host "=== RFC Connection Configuration ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Enter your SAP connection details."
    Write-Host "(These will be stored in .env.rfc - never committed to git)" -ForegroundColor DarkGray
    Write-Host ""

    # SAP Host
    do {
        $Script:SapRfcAshost = Read-Host "SAP Application Server Host"
    } while (-not $Script:SapRfcAshost)

    # System Number
    $sysnr = Read-Host "System Number [00]"
    $Script:SapRfcSysnr = if ($sysnr) { $sysnr } else { "00" }

    # Client
    $client = Read-Host "Client [100]"
    $Script:SapRfcClient = if ($client) { $client } else { "100" }

    # Username
    do {
        $Script:SapRfcUser = Read-Host "RFC Username"
    } while (-not $Script:SapRfcUser)

    # Password (hidden)
    do {
        $securePassword = Read-Host "RFC Password" -AsSecureString
        $Script:SapRfcPasswd = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        )
    } while (-not $Script:SapRfcPasswd)

    # Language
    $lang = Read-Host "Language [EN]"
    $Script:SapRfcLang = if ($lang) { $lang } else { "EN" }

    Write-Host ""
    Write-Info "RFC configuration collected."
}

function Get-CsvConfig {
    Write-Host ""
    Write-Host "=== CSV Import Configuration ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Where are your CSV files located?"
    Write-Host "(Default: .\data\csv)" -ForegroundColor DarkGray
    Write-Host ""

    $csvDir = Read-Host "CSV Directory [.\data\csv]"
    $Script:CsvInputDir = if ($csvDir) { $csvDir } else { ".\data\csv" }

    # Create directory if needed
    if (-not (Test-Path $Script:CsvInputDir)) {
        New-Item -ItemType Directory -Path $Script:CsvInputDir -Force | Out-Null
    }

    Write-Host ""
    Write-Info "CSV input directory: $Script:CsvInputDir"
    Write-Host ""
    Write-Host "Place your CSV files in this directory with the following names:"
    Write-Host "  - vbak.csv (Sales Order Headers)"
    Write-Host "  - vbap.csv (Sales Order Items)"
    Write-Host "  - likp.csv (Delivery Headers)"
    Write-Host "  - lips.csv (Delivery Items)"
    Write-Host "  - vbrk.csv (Billing Headers)"
    Write-Host "  - vbrp.csv (Billing Items)"
    Write-Host ""
}

# =============================================================================
# Configuration Generation
# =============================================================================

function New-EnvFile {
    Write-Step "Generating configuration files..."

    $envFile = Join-Path $Script:ProjectDir ".env"

    # Backup existing .env
    if (Test-Path $envFile) {
        $backupName = ".env.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item $envFile (Join-Path $Script:ProjectDir $backupName)
        Write-Info "Backed up existing .env file"
    }

    # Generate main .env
    $envContent = @"
# SAP Workflow Mining Configuration
# Generated by install.ps1 on $(Get-Date)

# =============================================================================
# Adapter Configuration
# =============================================================================

# Data adapter: synthetic, csv, or ecc_rfc
SAP_ADAPTER=$Script:InstallMode

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
"@

    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Success "Generated .env file"

    # Generate RFC config if needed
    if ($Script:InstallMode -eq "rfc") {
        $rfcEnvFile = Join-Path $Script:ProjectDir ".env.rfc"

        $rfcContent = @"
# SAP RFC Connection Configuration
# Generated by install.ps1 on $(Get-Date)
#
# IMPORTANT: Never commit this file to version control!

# =============================================================================
# Required Settings
# =============================================================================

SAP_RFC_ASHOST=$Script:SapRfcAshost
SAP_RFC_SYSNR=$Script:SapRfcSysnr
SAP_RFC_CLIENT=$Script:SapRfcClient
SAP_RFC_USER=$Script:SapRfcUser
SAP_RFC_PASSWD=$Script:SapRfcPasswd

# =============================================================================
# Optional Settings
# =============================================================================

SAP_RFC_LANG=$Script:SapRfcLang
SAP_RFC_POOL_SIZE=5
SAP_RFC_TRACE=0
SAP_RFC_TIMEOUT=30000
"@

        Set-Content -Path $rfcEnvFile -Value $rfcContent -Encoding UTF8

        # Ensure .gitignore includes .env.rfc
        $gitignorePath = Join-Path $Script:ProjectDir ".gitignore"
        if (Test-Path $gitignorePath) {
            $gitignoreContent = Get-Content $gitignorePath -Raw
            if ($gitignoreContent -notmatch "\.env\.rfc") {
                Add-Content -Path $gitignorePath -Value "`n.env.rfc"
            }
        }

        Write-Success "Generated .env.rfc file"
    }

    # Generate CSV config if needed
    if ($Script:InstallMode -eq "csv") {
        $csvConfig = @"

# ==============================================================================
# CSV Import Configuration
# ==============================================================================

CSV_INPUT_DIR=$Script:CsvInputDir
"@
        Add-Content -Path $envFile -Value $csvConfig
        Write-Success "Added CSV configuration to .env"
    }
}

# =============================================================================
# Verification
# =============================================================================

function Test-Installation {
    Write-Step "Verifying installation..."
    Write-Host ""

    # Test 1: Docker Compose validation
    Write-Info "Validating Docker Compose configuration..."
    $configResult = & docker compose config 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker Compose configuration is valid"
    }
    else {
        Write-Error "Docker Compose configuration validation failed"
        exit 1
    }

    # Test 2: Build images
    Write-Info "Building Docker images (this may take a few minutes)..."
    $buildResult = & docker compose build synthetic-data pattern-engine 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker images built successfully"
    }
    else {
        Write-Warning "Image build had warnings, but continuing..."
    }

    # Test 3: Run synthetic data generation
    Write-Info "Testing synthetic data generation..."
    $genResult = & docker compose run --rm synthetic-data python src/generate_sd.py --count 100 --seed 42 --output /app/output 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Synthetic data generation works"
    }
    else {
        Write-Warning "Synthetic data generation test had issues"
    }

    Write-Host ""
}

# =============================================================================
# Summary
# =============================================================================

function Show-Summary {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  Installation Complete!" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Project Location: " -NoNewline
    Write-Host $Script:ProjectDir -ForegroundColor White
    Write-Host "Mode: " -NoNewline
    Write-Host $Script:InstallMode -ForegroundColor White
    Write-Host ""
    Write-Host "Quick Start Commands:" -ForegroundColor Cyan
    Write-Host ""

    switch ($Script:InstallMode) {
        "demo" {
            Write-Host "  # Generate synthetic data and run analysis"
            Write-Host "  docker compose up" -ForegroundColor White
            Write-Host ""
            Write-Host "  # Or run step by step:"
            Write-Host "  docker compose up synthetic-data    # Generate data"
            Write-Host "  docker compose up pattern-engine    # Analyze patterns"
            Write-Host "  docker compose up viewer            # View results at http://localhost:8080"
        }
        "csv" {
            Write-Host "  # 1. Place your CSV files in: $Script:CsvInputDir"
            Write-Host ""
            Write-Host "  # 2. Run the analysis"
            Write-Host "  docker compose up pattern-engine" -ForegroundColor White
            Write-Host ""
            Write-Host "  # 3. View results"
            Write-Host "  docker compose up viewer            # http://localhost:8080"
        }
        "rfc" {
            Write-Host "  # Connect to SAP and run analysis"
            Write-Host "  docker compose --profile rfc up mcp-server-rfc" -ForegroundColor White
            Write-Host ""
            Write-Host "  # Run pattern analysis"
            Write-Host "  docker compose up pattern-engine"
            Write-Host ""
            Write-Host "  # View results"
            Write-Host "  docker compose up viewer            # http://localhost:8080"
        }
    }

    Write-Host ""
    Write-Host "Other Useful Commands:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  docker compose down         # Stop all services"
    Write-Host "  docker compose logs -f      # View logs"
    Write-Host "  .\cli.sh status             # Check status (via WSL/Git Bash)"
    Write-Host ""
    Write-Host "Documentation: https://github.com/your-org/sap-workflow-mining" -ForegroundColor DarkGray
    Write-Host ""
}

# =============================================================================
# Main
# =============================================================================

function Main {
    if ($Help) {
        Show-Help
        exit 0
    }

    Write-Banner

    Write-Step "Starting SAP Workflow Mining installation..."
    Write-Host ""

    # Step 1: Check Docker
    Test-Docker

    # Step 2: Setup project directory
    Initialize-ProjectDirectory

    # Step 3: Get installation mode
    Get-InstallMode

    # Step 4: Collect mode-specific configuration
    switch ($Script:InstallMode) {
        "rfc" {
            if (-not $NonInteractive) {
                Get-RfcConfig
            }
            else {
                Write-Warning "RFC mode requires manual configuration of .env.rfc"
            }
        }
        "csv" {
            if (-not $NonInteractive) {
                Get-CsvConfig
            }
            else {
                $Script:CsvInputDir = ".\data\csv"
            }
        }
        "demo" {
            # No additional config needed
        }
    }

    # Step 5: Generate configuration
    New-EnvFile

    # Step 6: Verification
    Test-Installation

    # Step 7: Show summary
    Show-Summary
}

# Run main
try {
    Main
}
catch {
    Write-Host ""
    Write-Error "Installation failed: $_"
    Write-Host ""
    Write-Host "For help, please:"
    Write-Host "  1. Check the documentation"
    Write-Host "  2. Open an issue on GitHub"
    Write-Host ""
    exit 1
}
