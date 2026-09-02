param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$OutputZip = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "pinkpaisa-lightsail-deploy.zip")
)

$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath($Root)
$OutputZip = [System.IO.Path]::GetFullPath($OutputZip)

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
    "uploads",
    "private",
    "coverage",
    ".cache",
    "test",
    "tests",
    "__tests__"
  )

  $excludedFileNames = @(
    "tsconfig.tsbuildinfo",
    "AGENTS.md",
    "CLAUDE.md"
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null

  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    $normalizedPath = $_.FullName.Replace("\", "/").ToLowerInvariant()
    $isPrivateEnvFile = -not $_.PSIsContainer -and $_.Name -like ".env*" -and $_.Name -notlike "*.example"
    $isPrivateKeyFile = -not $_.PSIsContainer -and $_.Extension -match "^\.(pem|key|p12|pfx|jks|keystore)$"
    $isDevelopmentScriptDirectory = $_.PSIsContainer -and $normalizedPath.EndsWith("/server/scripts/dev")
    if ($excludedFileNames -contains $_.Name -or $isPrivateEnvFile -or $isPrivateKeyFile -or $isDevelopmentScriptDirectory) {
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

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$staging = Join-Path $tempRoot ("pinkpaisa-lightsail-package-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging | Out-Null

$outputDirectory = Split-Path -Parent $OutputZip
if (-not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
$temporaryZip = Join-Path $outputDirectory (".pinkpaisa-lightsail-deploy-" + [Guid]::NewGuid().ToString("N") + ".tmp.zip")

$itemsToCopy = @(
  "frontend-next",
  "server",
  "deploy",
  "docs"
)

try {
  foreach ($item in $itemsToCopy) {
    $sourcePath = Join-Path $Root $item
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "Missing required path: $sourcePath"
    }

    $destPath = Join-Path $staging $item
    Copy-FilteredTree -Source $sourcePath -Destination $destPath
  }

  $requiredPackagePaths = @(
    "server/package.json",
    "server/package-lock.json",
    "server/.env.example",
    "server/ecosystem.config.cjs",
    "server/scripts/migrate/social-media-manager-foundation.js",
    "server/scripts/migrate/social-growth-team.js",
    "server/scripts/verify/social-reel-runtime.js",
    "server/models/SocialGenerationRun.js",
    "server/models/SocialPaidCallUsageLedger.js",
    "server/models/SocialPaidOperation.js",
    "server/models/SocialPostDraft.js",
    "server/models/SocialAsset.js",
    "server/models/SocialAudioTrack.js",
    "server/models/SocialOAuthState.js",
    "server/services/social/socialAudioLibraryService.js",
    "server/services/social/socialAiImageService.js",
    "server/services/social/socialBrandLogoPolicy.js",
    "server/services/social/socialContentIntegrity.js",
    "server/services/social/socialFailureRecoveryService.js",
    "server/services/social/socialManagerService.js",
    "server/services/social/socialResearchService.js",
    "server/services/social/socialCommunityWorkflowService.js",
    "server/services/social/socialWorkSummaryService.js",
    "server/services/socialCreativeService.js",
    "server/controllers/socialAudioLibraryController.js",
    "server/models/SocialPromptVersion.js",
    "server/models/SocialResearchSource.js",
    "server/utils/socialManagerSettings.js",
    "server/routes/socialMediaManager.js",
    "frontend-next/src/assets/pink-paisa-logo.png",
    "frontend-next/public/pink-paisa-logo.png",
    "deploy/lightsail/server.env.production.example",
    "deploy/lightsail/scripts/backup-social-audio.sh",
    "deploy/lightsail/scripts/restore-social-audio.sh",
    "deploy/n8n/pink-paisa-weekly-plan-trigger.json",
    "deploy/n8n/pink-paisa-prepublication-trigger.json",
    "deploy/n8n/pink-paisa-metric-refresh-and-failure-alert.json",
    "deploy/n8n/README.md",
    "docs/fully-ai-social-manager-correction-plan.md",
    "docs/social-media-manager-setup.md",
    "docs/pink-paisa-social-growth-system-audit.md",
    "docs/pink-paisa-social-growth-architecture.md",
    "docs/pink-paisa-meta-instagram-setup.md",
    "docs/pink-paisa-social-manager-admin-guide.md",
    "docs/pink-paisa-social-manager-security.md",
    "docs/pink-paisa-social-manager-deployment.md"
  )
  foreach ($relativePath in $requiredPackagePaths) {
    $stagedPath = Join-Path $staging ($relativePath.Replace("/", [System.IO.Path]::DirectorySeparatorChar))
    if (-not (Test-Path -LiteralPath $stagedPath -PathType Leaf)) {
      throw "Deployment archive is missing required fully-AI Social Manager file: $relativePath"
    }
  }

  $expectedBadgeHash = "0cf39611014a2e674bec396a43335f023c803aaffb61256c004bfcb6fabc92e9"
  $badgePaths = @(
    "frontend-next/src/assets/pink-paisa-logo.png",
    "frontend-next/public/pink-paisa-logo.png"
  )
  foreach ($relativePath in $badgePaths) {
    $stagedPath = Join-Path $staging ($relativePath.Replace("/", [System.IO.Path]::DirectorySeparatorChar))
    $actualBadgeHash = (Get-FileHash -LiteralPath $stagedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualBadgeHash -ne $expectedBadgeHash) {
      throw "Deployment archive contains a non-canonical Pink Paisa badge at ${relativePath}: ${actualBadgeHash}"
    }
  }

  Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $temporaryZip -Force
  if (-not (Test-Path -LiteralPath $temporaryZip) -or (Get-Item -LiteralPath $temporaryZip).Length -le 0) {
    throw "Deployment archive verification failed: $temporaryZip"
  }
  Move-Item -LiteralPath $temporaryZip -Destination $OutputZip -Force

  Write-Host "Created deployment archive:"
  Write-Host $OutputZip
}
finally {
  if (Test-Path -LiteralPath $temporaryZip) {
    Remove-Item -LiteralPath $temporaryZip -Force
  }
  if (Test-Path -LiteralPath $staging) {
    $resolvedStaging = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $staging).Path)
    $resolvedTempRoot = $tempRoot.TrimEnd("\") + "\"
    if (-not $resolvedStaging.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove staging outside the temporary directory: $resolvedStaging"
    }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
  }
}
