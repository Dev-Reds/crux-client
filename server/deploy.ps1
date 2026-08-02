# Crux Chat Server auf Deno Deploy deployen (deployctl 1.13, API-Token)
#
# Vorbereitung (einmalig):
#   1. API-Token erstellen:  https://dash.deno.com/account/access-tokens
#      (Account -> Tokens -> "New Token", Scope: all)
#   2. Token setzen (eine der beiden Varianten):
#        $env:DENO_DEPLOY_TOKEN = "ddp_..."
#        powershell -File server\deploy.ps1 -Token ddp_...
#
# Danach jedes Mal:
#   npm run deploy-chat
param(
    [string]$Project = "crux-chat",
    [string]$Token = ""
)

$ErrorActionPreference = "Continue"
$ServerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ServerDir

# Deno-Bin in PATH (deployctl landet dort)
if (Test-Path "$env:USERPROFILE\.deno\bin") {
    $env:PATH = "$env:USERPROFILE\.deno\bin;" + $env:PATH
}

# Token aus env uebernehmen falls nicht per Parameter
if (-not $Token) { $Token = $env:DENO_DEPLOY_TOKEN }
if (-not $Token) {
    Write-Output "Deno-Deploy-API-Token fehlt!"
    Write-Output ""
    Write-Output "1. Erstelle einen Token: https://dash.deno.com/account/access-tokens"
    Write-Output "   (Account -> Tokens -> New Token, Scope: all)"
    Write-Output "2. Setze ihn:  `$env:DENO_DEPLOY_TOKEN = 'ddp_...'"
    Write-Output "   oder:        powershell -File server\deploy.ps1 -Token ddp_..."
    exit 1
}

# deployctl installieren falls fehlt
if (!(Get-Command deployctl -ErrorAction SilentlyContinue)) {
    Write-Output "deployctl wird installiert (einmalig)..."
    if (!(Get-Command deno -ErrorAction SilentlyContinue)) {
        Write-Error "Deno fehlt. Installiere es zuerst: https://deno.com"
        exit 1
    }
    deno install -gA --reload -n deployctl jsr:@deno/deployctl
}

# Deployen (legt das Projekt automatisch an, wenn es nicht existiert)
Write-Output "Deploying '$Project' ..."
deployctl deploy --project=$Project --prod --entrypoint=chat-server.ts --token=$Token
if ($LASTEXITCODE -ne 0) {
    Write-Error "Deploy fehlgeschlagen (Exit $LASTEXITCODE)."
    exit $LASTEXITCODE
}

Write-Output ""
Write-Output "Fertig! URL: https://$Project.deno.dev"
Write-Output "Test:    curl https://$Project.deno.dev/v1/health"
Write-Output "Dann im Launcher unter Einstellungen -> Friends & Bug Reports -> Chat server URL eintragen."
