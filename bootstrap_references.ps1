# Run from the repository root in PowerShell.
# Clones external repos for read-only inspection; does not execute their code.
$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git not found. Install Git for Windows first.'
}
if (-not (Test-Path '.gitignore')) {
    New-Item -ItemType File '.gitignore' | Out-Null
}
$ignore = Get-Content '.gitignore' -Raw
if ($ignore -notmatch '(?m)^references/$') {
    Add-Content '.gitignore' "`n# External source references (not tracked)`nreferences/"
}
New-Item -ItemType Directory -Force 'references' | Out-Null
$repos = @(
    @{name='SJTU-Course-Block'; url='https://github.com/Labyrinth0419/SJTU-Course-Block.git'},
    @{name='SJTU-Canvas-Helper'; url='https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper.git'}
)
foreach ($repo in $repos) {
    $target = Join-Path 'references' $repo.name
    if (-not (Test-Path $target)) {
        & git clone --depth 1 $repo.url $target
        if ($LASTEXITCODE -ne 0) { throw "Clone failed: $($repo.name)" }
    } else {
        Write-Host "Already exists, not overwriting: $target"
    }
    if (Test-Path (Join-Path $target '.git')) {
        $sha = (& git -C $target rev-parse HEAD)
        Write-Host "$($repo.name) SHA: $sha"
    }
}
Write-Host 'References ready. Review LICENSE and source before copying any code.'
