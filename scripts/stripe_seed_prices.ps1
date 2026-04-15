# Default: subscription T1–T6. Credit packs: add --bundles or use --all (see stripe_seed_prices.py --help).
# Requires: pip install stripe python-dotenv
# Usage: .\scripts\stripe_seed_prices.ps1  (from replypals-prod directory)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
python "$PSScriptRoot\stripe_seed_prices.py"
