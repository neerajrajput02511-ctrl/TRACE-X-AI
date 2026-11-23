param([switch]$Lan,[switch]$Install,[ValidateRange(1024,65535)][int]$Port=4318)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Install Node.js 22.16 or newer from nodejs.org, then reopen the terminal.'
    }
    $version = [version]((& node.exe -p 'process.versions.node').Trim())
    if ($version -lt [version]'22.16.0') { throw "Node $version is too old. Install Node.js 22.16 or newer." }
    if ($Install -or -not (Test-Path -LiteralPath 'node_modules/pdfkit/package.json') -or -not (Test-Path -LiteralPath 'node_modules/read-excel-file/package.json')) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check your network and the npm error above.' }
    }
    if ($PSBoundParameters.ContainsKey('Port')) { $env:TRACEX_PORT = [string]$Port }
    if ($Lan) { $env:TRACEX_HOST = '0.0.0.0' }
    $resolvedPort = & node.exe --env-file-if-exists=.env -p 'process.env.TRACEX_PORT || 4318'
    $loopback = "http://127.0.0.1:$resolvedPort"
    Write-Host "Website    $loopback/"
    Write-Host "Workspace  $loopback/console.html"
    Write-Host "Health     $loopback/healthz"
    if ($Lan) {
        Write-Host 'Android debug app on the same private network may use one of these laptop addresses:'
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' -and $_.AddressState -eq 'Preferred' } |
            ForEach-Object { Write-Host ("  http://" + $_.IPAddress + ":" + $resolvedPort) }
    }
    & node.exe --env-file-if-exists=.env server/start.mjs
    if ($LASTEXITCODE -ne 0) { throw "The server exited ($LASTEXITCODE). Check the port and configuration above." }
} catch {
    Write-Error $_.Exception.Message -ErrorAction Continue
    exit 1
}
