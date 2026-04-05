# Default: subscriptions T1–T6. Add --bundles or --all: python scripts\stripe_seed_prices.py --help
# Requires: pip install stripe python-dotenv
# Usage: .\scripts\stripe_seed_usd_prices.ps1   OR   .\scripts\stripe_seed_prices.ps1
#        (from replypals-prod directory)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
python "$PSScriptRoot\stripe_seed_prices.py"
