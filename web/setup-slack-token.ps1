# Run this file to connect Slack. It does everything except the one step
# only you can do: pasting your token. It never sends the token anywhere
# except your own .env.local file and your own Cloudflare account.
#
# How to run: right-click this file in File Explorer -> "Run with PowerShell".
# If Explorer only offers "Run with PowerShell" grayed out or nothing happens,
# open PowerShell in this folder instead and type: .\setup-slack-token.ps1

Write-Host ""
Write-Host "This will set up your Slack bot token for both local testing and production."
Write-Host ""

$secure = Read-Host "Paste your Slack Bot Token (starts with xoxb-)" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host ""
    Write-Host "Nothing was entered, so nothing was changed. Run this again when you have the token." -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 1
}

if (-not $token.StartsWith("xoxb-")) {
    Write-Host ""
    Write-Host "That doesn't look like a Bot Token (it should start with 'xoxb-')." -ForegroundColor Yellow
    Write-Host "Find it under Slack app -> OAuth & Permissions -> Bot User OAuth Token." -ForegroundColor Yellow
    Write-Host "Continuing anyway in case this is intentional..." -ForegroundColor Yellow
}

# --- Step 1: .env.local ---
$envPath = Join-Path $PSScriptRoot ".env.local"
$line = "SLACK_BOT_TOKEN=$token"

if (Test-Path $envPath) {
    $content = Get-Content $envPath
    if ($content -match "^SLACK_BOT_TOKEN=") {
        $content = $content -replace "^SLACK_BOT_TOKEN=.*", $line
        Set-Content -Path $envPath -Value $content -Encoding utf8
        Write-Host "Updated SLACK_BOT_TOKEN in .env.local" -ForegroundColor Green
    } else {
        Add-Content -Path $envPath -Value $line -Encoding utf8
        Write-Host "Added SLACK_BOT_TOKEN to .env.local" -ForegroundColor Green
    }
} else {
    Set-Content -Path $envPath -Value $line -Encoding utf8
    Write-Host "Created .env.local with SLACK_BOT_TOKEN" -ForegroundColor Green
}

# --- Step 2: Cloudflare Worker secret ---
Write-Host ""
Write-Host "Now setting the production secret via wrangler..."
Set-Location $PSScriptRoot
$token | npx wrangler secret put SLACK_BOT_TOKEN

Write-Host ""
Write-Host "Done. Both local and production are set." -ForegroundColor Green
Read-Host "Press Enter to close this window"
