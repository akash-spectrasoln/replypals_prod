$ErrorActionPreference = "Stop"

Write-Host "== ReplyPals complete test run =="

Write-Host "`n[1/6] Python unit tests (billing identity)..."
pytest "tests/unit/" -v --tb=short

Write-Host "`n[2/6] Extension unit tests..."
node "tests/extension/test_extension.js"
node "tests/extension/test-logic.js"
node "tests/extension/test_background_format.js"

Write-Host "`n[3/6] Backend API health tests..."
pytest "tests/api/test_api.py::TestHealth" -vv

Write-Host "`n[4/6] Integration admin journey tests..."
pytest "tests/integration/test_integration.py::TestAdminJourney" -vv

Write-Host "`n[5/6] Frontend smoke tests..."
npm --prefix "tests/playwright" run test:frontend

Write-Host "`n[6/6] Extension UI e2e tests (R/bulb/selection icons)..."
npm --prefix "tests/playwright" run test:extension-ui

Write-Host "`nAll configured tests completed."
