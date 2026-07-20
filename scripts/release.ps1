param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# Prüfen ob gh installiert ist
if (!(Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/"
    exit 1
}

# Prüfen ob gh authentifiziert ist
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Not authenticated with gh. Run 'gh auth login' first."
    exit 1
}

$Tag = "v$Version"

# 1. version in package.json setzen
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 10 | Set-Content package.json
Write-Output "✔ package.json version set to $Version"

# 2. Commit und Tag
git add package.json
git commit -m "$Tag"
git push origin main
git tag -f "$Tag"
git push origin "$Tag" --force
Write-Output "✔ Pushed tag $Tag to crux-client"

# 3. Release auf crux-client erstellen (triggert die GitHub Action)
gh release create "$Tag" --title "$Tag" --notes "Crux Client $Tag" -R "Dev-Reds/crux-client"
Write-Output "✔ Release $Tag created on crux-client (build + upload will run automatically)"

Write-Output "`nDone! Check:"
Write-Output "  Build: https://github.com/Dev-Reds/crux-client/actions"
Write-Output "  Zip:   https://github.com/Dev-Reds/crux-code/releases/latest/download/crux_code.zip"
