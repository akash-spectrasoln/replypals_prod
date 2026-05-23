# ReplyPals — local smoke tests (no API required for most checks).
# Usage: .\scripts\smoke-test-local.ps1
# Optional: .\scripts\smoke-test-local.ps1 -WithApi   (also hits http://127.0.0.1:8150 if running)

param(
    [switch]$WithApi
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$failed = 0

function Run-Step {
    param([string]$Name, [scriptblock]$Block)
    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
    try {
        & $Block
        if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "exit $LASTEXITCODE" }
        Write-Host "OK: $Name" -ForegroundColor Green
    } catch {
        Write-Host "FAIL: $Name" -ForegroundColor Red
        Write-Host $_.Exception.Message
        $script:failed++
    }
}

Write-Host "ReplyPals local smoke test" -ForegroundColor Yellow
Write-Host "Repo: $Root"

Run-Step "Extension tests" {
    node "$Root\tests\extension\test_extension.js"
    node "$Root\tests\extension\test_quota_merge.js"
    if (Test-Path "$Root\tests\extension\test-logic.js") { node "$Root\tests\extension\test-logic.js" }
    if (Test-Path "$Root\tests\extension\test_background_format.js") { node "$Root\tests\extension\test_background_format.js" }
}

Run-Step "Python unit tests" {
    python -m pytest (Join-Path $Root "tests\unit") -q --tb=line
}

Run-Step "Website unit tests" {
    Push-Location "$Root\website"
    npm test --silent
    Pop-Location
}

Run-Step "Admin dashboard unit tests" {
    Push-Location "$Root\admin-dashboard"
    npx vitest run src/tests/unit --silent
    Pop-Location
}

if ($WithApi) {
    $base = $env:REPLYPALS_API_URL
    if (-not $base) { $base = "http://127.0.0.1:8150" }
    $env:REPLYPALS_API_URL = $base
    Run-Step "API tests (server at $base)" {
        try {
            $r = Invoke-WebRequest -Uri "$base/health" -TimeoutSec 5 -UseBasicParsing
            if ($r.StatusCode -ne 200) { throw "health returned $($r.StatusCode)" }
        } catch {
            throw "API not running. Start: cd api; python main.py"
        }
        python -m pytest (Join-Path $Root "tests\api\test_api.py") -q -m "not ai" --tb=line
    }
} else {
    Write-Host ""
    Write-Host "Tip: Start API (cd api; python main.py) then run:" -ForegroundColor DarkYellow
    Write-Host "  .\scripts\smoke-test-local.ps1 -WithApi" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "Manual checklist: docs/10-test-and-market-playbook.md (Part A, Level 2)" -ForegroundColor DarkYellow
Write-Host "Marketing guide:  docs/10-test-and-market-playbook.md (Part B)" -ForegroundColor DarkYellow

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "$failed step(s) failed." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "All automated smoke steps passed." -ForegroundColor Green
