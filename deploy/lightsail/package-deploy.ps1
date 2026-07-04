param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$OutputZip = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "pinkpaisa-lightsail-deploy.zip")
)

$ErrorActionPreference = "Stop"

function Reset-Dir {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Path $Path | Out-Null
}

function Copy-FilteredTree {
  param(
    [string]$Source,
    [string]$Destination
  )

  $excludedDirNames = @(
    "node_modules",
    "dist",
    ".git",
    ".next",
    "uploads"
  )

  $excludedFileNames = @(
    ".env",
    ".env.local",
    ".env.production",
    ".env.development"
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null

  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($excludedFileNames -contains $_.Name) {
      return
    }

    $target = Join-Path $Destination $_.Name

    if ($_.PSIsContainer) {
      if ($excludedDirNames -contains $_.Name) {
        return
      }
      Copy-FilteredTree -Source $_.FullName -Destination $target
      return
    }

    Copy-Item -LiteralPath $_.FullName -Destination $target -Force
  }
}

$staging = Join-Path $env:TEMP "pinkpaisa-lightsail-package"
Reset-Dir -Path $staging

$itemsToCopy = @(
  "frontend-next",
  "server",
  "deploy"
)

foreach ($item in $itemsToCopy) {
  $sourcePath = Join-Path $Root $item
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Missing required path: $sourcePath"
  }

  $destPath = Join-Path $staging $item
  Copy-FilteredTree -Source $sourcePath -Destination $destPath
}

if (Test-Path -LiteralPath $OutputZip) {
  Remove-Item -LiteralPath $OutputZip -Force
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $OutputZip -Force

Write-Host "Created deployment archive:"
Write-Host $OutputZip
