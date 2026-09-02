export type SocialDraftStatus =
  | "DRAFT"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "REJECTED"
  | "FAILED"
  | (string & {});

export type SocialFormat =
  | "SINGLE_IMAGE"
  | "CAROUSEL"
  | "REEL"
  | "VIDEO_FEED"
  | "STORY"
  | "INFOGRAPHIC"
  | "MEME"
  | "POLL"
  | "POLL_CONCEPT"
  | "QUIZ"
  | "PRODUCT_FEATURE"
  | "RESOURCE_PROMOTION"
  | "EVENT_OR_WORKSHOP_PROMOTION"
  | "WORKSHOP_PROMOTION";

export type SocialFormatPreference = "AUTO_CHOOSE" | SocialFormat;

export type SocialVisualMode = "AI_VISUAL_WITH_EXACT_OVERLAY" | "AI_ARTWORK_ONLY" | "FULL_AI_GRAPHIC";

export type SocialStoredVisualMode = SocialVisualMode | "MANUAL_TEMPLATE";

export type SocialVisualModeResolution = {
  requested: SocialVisualMode;
  effective: SocialVisualMode;
  eligible: boolean;
  reasons: string[];
};

export type SocialGenerationScope = "FULL_POST" | "STRATEGY" | "COPY" | "IMAGE" | "FORMAT_CHANGE" | "COMPLIANCE";

export type SocialRegenerationScope = "strategy" | "copy" | "format" | "revision" | "compliance" | "image";

export type SocialGenerationRequest = {
  generation_type: "TODAY" | "SINGLE_POST" | "CAROUSEL" | "PRODUCT_POST";
  requested_format: SocialFormatPreference;
  requested_post_type?: string;
  generation_scope: SocialGenerationScope;
  visual_mode: SocialVisualMode;
  admin_instructions?: string;
  verified_product_id?: string;
  request_id?: string;
  force?: boolean;
};

export type SocialRegenerationRequest = {
  scope: SocialRegenerationScope;
  instructions?: string;
  target_format?: SocialFormat;
  visual_mode?: SocialVisualMode;
  asset_sequence?: number;
};

export type SocialRunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "FAILED_RESEARCH"
  | "FAILED_GENERATION"
  | "FAILED_IMAGE"
  | "FAILED_COMPLIANCE"
  | "FAILED_IMAGE_GENERATION"
  | "FAILED_PUBLISHING";

export type SocialRunStage =
  | "QUEUED"
  | "COLLECTING_INTERNAL_SIGNALS"
  | "RESEARCHING"
  | "ANALYZING_MARKET"
  | "GENERATING_CANDIDATES"
  | "SCORING_CANDIDATES"
  | "WRITING_CONTENT"
  | "CHECKING_COMPLIANCE"
  | "REVISING_CONTENT"
  | "BUILDING_VISUAL_BRIEF"
  | "GENERATING_IMAGES"
  | "VALIDATING_IMAGES"
  | "COMPOSING_FINAL_ASSETS"
  | "ASSEMBLING_RESULT"
  | "CREATING_DRAFT"
  | "AWAITING_REVIEW"
  | "COMPLETED"
  | "FAILED";

export type SocialGenerationRequestSnapshot = {
  requestedFormat: SocialFormatPreference;
  requestedPostType: string;
  generationScope: SocialGenerationScope;
  visualMode: SocialVisualMode;
  adminInstructions: string;
  verifiedProductId: string;
  requestId: string;
};

export type SocialRunStageExecution = {
  stage: SocialRunStage | string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "SKIPPED" | "FAILED" | string;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  costCurrency: string;
  attemptCount: number;
  errorCode: string;
  errorMessage: string;
};

export type SocialCandidateSummary = {
  id: string;
  topic: string;
  contentPillar: string;
  format: string;
  totalScore: number | null;
  disposition: string;
  rejectionReason: string;
  riskFlags: string[];
  hook: string;
  objective: string;
  targetAudience: string;
  whyToday: string;
  visualModeResolution?: SocialVisualModeResolution | null;
};

export type SocialGenerationRun = {
  id: string;
  status: SocialRunStatus;
  currentStage: SocialRunStage | string;
  generationRequest: SocialGenerationRequestSnapshot | null;
  generationMode: string;
  fullAiGeneration: boolean;
  imageGenerationStatus: string;
  generationDate: string;
  triggerType: string;
  attemptCount: number;
  retryCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  retryOfGenerationRunId: string;
  supersededByGenerationRunId: string;
  supersededAt: string | null;
  recoveryArchivedAt: string | null;
  recoveryArchiveReason: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  candidateCount: number;
  candidates: SocialCandidateSummary[];
  stages: SocialRunStageExecution[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    costCurrency: string;
  };
  lastError: {
    stage: string;
    code: string;
    message: string;
    isRetriable: boolean;
    occurredAt: string | null;
    details: unknown;
  } | null;
};

export type SocialSource = {
  id?: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string | null;
  accessedAt: string | null;
  claimSupported: string;
  summary: string;
  confidence: number | null;
  freshness: string;
  sourceType: string;
  influenced: boolean | null;
  influenceReason: string;
  relevanceToPinkPaisa: string;
  validationFlags: string[];
};

export type SocialSignal = {
  id?: string;
  label: string;
  summary: string;
  relevance: string;
  freshness: string;
  confidence: number | null;
  included: boolean | null;
  reason: string;
};

export type SocialSlide = {
  slideNumber: number;
  headline: string;
  body: string;
  visualInstruction: string;
  imagePrompt: string;
  overlayInstructions: string;
};

export type SocialRecommendation = {
  internalTitle: string;
  whyToday: string;
  objective: string;
  format: string;
  formatReason: string;
  postType: string;
  contentPillar: string;
  targetAudienceSegment: string;
  topic: string;
  verifiedProductId: string;
  verifiedProductTitle: string;
  verifiedProductFacts: {
    id: string;
    title: string;
    brand: string;
    category: string;
    subcategory: string;
    asin: string;
    imageUrl: string;
    description: string;
    affiliateUrl: string;
    landingPage: string;
  } | null;
  formatContent: Record<string, unknown>;
  visualBrief: Record<string, unknown>;
  hooks: string[];
  headline: string;
  supportingCopy: string;
  slides: SocialSlide[];
  storyFrames: Array<Record<string, unknown>>;
  reelScenes: Array<Record<string, unknown>>;
  caption: string;
  cta: string;
  hashtags: string[];
  visualConcept: Record<string, string>;
  imageGenerationPrompt: string;
  negativeVisualInstructions: string[];
  overlayInstructions: Record<string, string>;
  altText: string;
  financialDisclaimer: string;
  affiliateDisclosure: string;
  recommendedLandingPage: string;
  utmParameters: {
    source: string;
    medium: string;
    campaign: string;
    content: string;
  };
  sources: SocialSource[];
  confidence: number | null;
  riskFlags: string[];
  scoreBreakdown: Record<string, number>;
  score: number | null;
  rationale: string;
};

export type SocialAlternative = SocialRecommendation & {
  id?: string;
};

export type SocialAsset = {
  id?: string;
  type: string;
  role: string;
  slideNumber: number | null;
  url: string;
  previewUrl: string;
  originalUrl: string;
  finalUrl: string;
  aspectRatio: string;
  width: number | null;
  height: number | null;
  mediaKind: string;
  mimeType: string;
  durationSeconds: number | null;
  renderer: string;
  visualMode: SocialStoredVisualMode;
  provider: string;
  model: string;
  responseId: string;
  prompt: string;
  generationStatus: string;
  generationAttempts: number;
  sourceProvenance: string;
  provenance: Record<string, unknown>;
  status: string;
  manualReviewRequired: boolean;
  manualReviewStatus: string;
  validationFlags: string[];
};

export type SocialAudioTrack = {
  id: string;
  title: string;
  source: string;
  originalFilename: string;
  streamPath: string;
  checksumSha256: string;
  mimeType: string;
  extension: string;
  fileSizeBytes: number;
  durationSeconds: number;
  audioCodec: string;
  licenseStatus: "OWNED" | "LICENSED" | "PUBLIC_DOMAIN" | "ADMIN_APPROVED" | "REVOKED" | string;
  licenseReference: string;
  rightsConfirmed: boolean;
  rightsConfirmationStatement: string;
  rightsConfirmedAt: string | null;
  active: boolean;
  usable: boolean;
  createdAt: string | null;
};

export type SocialManualAction = {
  id: string;
  actionKey: string;
  actionType: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  title: string;
  description: string;
  instructions: string[];
  provider: string;
  draftId: string;
  weeklyPlanId: string;
  generationRunId: string;
  publicationId: string;
  communityItemId: string;
  connectionHealthId: string;
  externalReferenceId: string;
  dueAt: string | null;
  resolutionNote: string;
  cancellationReason: string;
  completionSource: "ADMIN" | "SYSTEM" | string;
  resolutionEvidence: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SocialAuditEvent = {
  id?: string;
  action: string;
  actor: string;
  summary: string;
  createdAt: string | null;
  metadata: Record<string, unknown>;
};

export type SocialMetricSnapshot = {
  id?: string;
  source: string;
  capturedAt: string | null;
  notes: string;
  metrics: Record<string, number>;
};

export type SocialReadiness = {
  generationEnabled: boolean;
  manualGenerationEnabled: boolean;
  researchMode: string;
  aiConfigured: boolean;
  publishingEnabled: boolean;
  instagramConnected: boolean;
  blockers: string[];
  warnings: string[];
};

export type SocialConnectionCapability = {
  key: string;
  label: string;
  supported: boolean | null;
  status: string;
  detail: string;
};

export type SocialConnection = {
  key: string;
  label: string;
  status: string;
  connected: boolean;
  configured: boolean;
  accountLabel: string;
  lastCheckedAt: string | null;
  expiresAt: string | null;
  error: string;
  warnings: string[];
  capabilities: SocialConnectionCapability[];
  metadata: Record<string, unknown>;
};

export type SocialConnectionsSnapshot = {
  items: SocialConnection[];
  checkedAt: string | null;
  blockers: string[];
  warnings: string[];
};

export type SocialWeeklyPlanItem = {
  id: string;
  order: number;
  status: SocialDraftStatus;
  topic: string;
  internalTitle: string;
  objective: string;
  primaryKpi: string;
  secondaryKpi: string;
  targetAudience: string;
  contentPillar: string;
  format: string;
  whyThisWeek: string;
  whyThisFormat: string;
  pinkPaisaConnection: string;
  recommendedLandingPage: string;
  promotionalIntensity: string;
  confidence: number | null;
  riskFlags: string[];
  scheduledFor: string | null;
  draftId: string;
  sources: SocialSource[];
  visualModeResolution: SocialVisualModeResolution | null;
  bundleId: string;
  bundleRole: string;
  parentCandidateId: string;
};

export type SocialWeeklyStoryItem = SocialWeeklyPlanItem & {
  parentDraftId: string;
};

export type SocialWeeklyGenerationError = {
  stage: string;
  code: string;
  message: string;
  isRetriable: boolean;
  occurredAt: string | null;
  validationErrors: string[];
};

export type SocialContentMixSnapshot = {
  windowWeeks: number;
  historyWeeksFound: number;
  historicalPosts: number;
  currentWeekPosts: number;
  totalPosts: number;
  counts: Record<string, number>;
  targetPercentages: Record<string, number>;
  actualPercentages: Record<string, number>;
  deltaPercentages: Record<string, number>;
  hardQuotaEnforced: boolean;
  enforcement: string;
  limitation: string;
};

export type SocialWeeklyPlan = {
  id: string;
  status: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  maxFeedPosts: number;
  rationale: string;
  version: number;
  items: SocialWeeklyPlanItem[];
  storyPlan: SocialWeeklyStoryItem[];
  contentMixSnapshot: SocialContentMixSnapshot | null;
  candidates: SocialCandidateSummary[];
  sources: SocialSource[];
  generationError: SocialWeeklyGenerationError | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SocialWeeklyResearch = {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  summary: string;
  marketSignals: SocialSignal[];
  internalSignals: SocialSignal[];
  audienceQuestions: string[];
  audienceThemes: string[];
  hashtagObservations: string[];
  competitorObservations: string[];
  topicsToAvoid: string[];
  sources: SocialSource[];
  generatedAt: string | null;
  error: string;
  metaState: string;
  metaMessage: string;
  metaErrors: string[];
};

export type SocialAnalyticsPost = {
  id: string;
  title: string;
  format: string;
  contentPillar: string;
  publishedAt: string | null;
  permalink: string;
  metrics: Record<string, number>;
  attribution: SocialAnalyticsPostAttribution | null;
  baselines: SocialAnalyticsBaseline[];
  learningSummary: string;
};

export type SocialAnalyticsBaseline = {
  postId: string;
  metric: string;
  baseline: string;
  observedValue: number;
  baselineValue: number;
  delta: number;
  ratio: number | null;
  sampleSize: number;
};

export type SocialAnalyticsAttributionRow = {
  date: string | null;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  landingPage: string;
  eventName: string;
  metrics: Record<string, number>;
};

export type SocialAnalyticsAttribution = {
  provider: string;
  source: string;
  medium: string;
  metrics: Record<string, number>;
  attributionRows: SocialAnalyticsAttributionRow[];
  conversionEventRows: SocialAnalyticsAttributionRow[];
  capturedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type SocialAnalyticsPostAttribution = {
  metrics: Record<string, number>;
  landingPages: string[];
  matchedRows: number;
};

export type SocialAnalyticsRefreshConnection = {
  provider: string;
  status: string;
  message: string;
};

export type SocialAnalyticsSummary = {
  rangeLabel: string;
  refreshedAt: string | null;
  metrics: Record<string, number>;
  rates: Record<string, number>;
  attribution: SocialAnalyticsAttribution | null;
  baselines: SocialAnalyticsBaseline[];
  posts: SocialAnalyticsPost[];
  learnings: string[];
  warnings: string[];
};

export type SocialCommunityItem = {
  id: string;
  sourceType: string;
  status: string;
  classification: string;
  authorLabel: string;
  message: string;
  permalink: string;
  receivedAt: string | null;
  confidence: number | null;
  riskFlags: string[];
  suggestedReply: string;
  approvedReply: string;
  approvedReplyChecksum: string;
  recommendationStatus: string;
  sendIntentStatus: string;
  sendIntent: Record<string, unknown> | null;
  escalationReason: string;
  escalationState: string;
  escalationAcknowledgedAt: string | null;
  escalationResolvedAt: string | null;
  sendReconciliation: Record<string, unknown> | null;
  availableActions: {
    approveAndSend: boolean;
    reconcileSend: boolean;
    acknowledgeEscalation: boolean;
    resolveEscalation: boolean;
  };
  relatedMediaTitle: string;
  metadata: Record<string, unknown>;
};

export type SocialCaptionContract = {
  policy: string;
  caption: string | null;
  checksumSha256: string;
  components: {
    affiliateDisclosure: string;
    caption: string;
    cta: string;
    financialDisclaimer: string;
    hashtags: string;
  };
  componentOrder: string[];
  length: number;
  violations: string[];
  valid: boolean;
};

export type SocialDraft = {
  id: string;
  status: SocialDraftStatus;
  generationDate: string;
  timezone: string;
  revision: number | null;
  generationMode: string;
  visualMode: SocialStoredVisualMode;
  fullAiReady: boolean;
  visualModeResolution: SocialVisualModeResolution | null;
  primary: SocialRecommendation;
  captionContract: SocialCaptionContract | null;
  alternatives: SocialAlternative[];
  rejectedIdeas: Array<{ topic: string; reasonRejected: string }>;
  assets: SocialAsset[];
  audioTrackId: string;
  selectedAudioTrack: Record<string, unknown> | null;
  approval: Record<string, unknown> | null;
  schedule: Record<string, unknown> | null;
  publication: Record<string, unknown> | null;
  compliance: Record<string, unknown> | null;
  generationRunId: string;
  weeklyPlanId: string;
  weeklyPlanItemId: string;
  candidateId: string;
  bundleId: string;
  bundleRole: string;
  parentDraftId: string;
  weeklySlotNumber: number | null;
  weekStart: string;
  weekEnd: string;
  lastError: Record<string, unknown> | null;
  duplicateAnalysis: Record<string, unknown> | null;
  marketAnalysis: Record<string, unknown> | null;
  strategySelection: Record<string, unknown> | null;
  sources: SocialSource[];
  internalSignals: SocialSignal[];
  externalSignals: SocialSignal[];
  auditLogs: SocialAuditEvent[];
  metricSnapshots: SocialMetricSnapshot[];
  manualActions: SocialManualAction[];
  scheduledFor: string;
  promptVersion: string;
  model: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SocialWorkSummary = {
  counts: {
    strategy: number;
    content: number;
    results: number;
    community: number;
    setup: number;
  };
  breakdown: Record<string, unknown>;
  terminalFailures: {
    content: SocialWorkFailureItem[];
    results: SocialWorkFailureItem[];
  };
  terminalFailuresTruncated: {
    content: boolean;
    results: boolean;
  };
  priorityOrder: string[];
  nextReviewDraftId: string;
  generatedAt: string | null;
};

export type SocialWorkFailureItem = {
  type: "DRAFT" | "GENERATION_RUN" | "PUBLICATION" | string;
  id: string;
  draftId: string;
  generationRunId: string;
  publicationId: string;
  weeklyPlanId: string;
  status: string;
  code: string;
  message: string;
  occurredAt: string | null;
  recoveryAvailable: boolean;
};

export type SocialGeneratedContentCounts = {
  drafts: number;
  assets: number;
  generationRuns: number;
  weeklyPlans: number;
  researchSources: number;
  manualActions: number;
};

export type SocialGeneratedContentCleanupBlocker = {
  code: string;
  count: number;
  message: string;
};

export type SocialGeneratedContentCleanupPreview = {
  confirmationPhrase: string;
  purgeToken: string;
  generatedAt: string | null;
  expiresAt: string | null;
  counts: SocialGeneratedContentCounts;
  totalCount: number;
  localFiles: { count: number; bytes: number };
  blockers: SocialGeneratedContentCleanupBlocker[];
  preserved: Record<string, number>;
  exclusions: string[];
};

export type SocialGeneratedContentCleanupResult = {
  reused: boolean;
  deleted: SocialGeneratedContentCounts;
  totalDeleted: number;
  usageLedgersCreated: number;
  fileCleanup: {
    requested: number;
    deleted: number;
    missing: number;
    failed: number;
    failures: Array<{ storageKey: string; message: string }>;
  };
  retainedAuditEventId: string;
  completedAt: string | null;
  exclusions: string[];
};

export type SocialPillarSetting = {
  name: string;
  ratio: number;
  enabled: boolean;
};

export type SocialSettings = {
  raw: Record<string, unknown>;
  brandProfile: string;
  targetAudience: string;
  contentPillars: SocialPillarSetting[];
  dailyGenerationTime: string;
  defaultPostingTime: string;
  timezone: string;
  researchDomains: string[];
  blockedDomains: string[];
  autoPublish: boolean;
  approvalRequired: boolean;
  aiModel: string;
  researchModel: string;
  strategyModel: string;
  copyModel: string;
  complianceModel: string;
  visualDirectionModel: string;
  assemblyModel: string;
  imageModel: string;
  fullAiGeneration: boolean;
  allowDeterministicFallback: boolean;
  allowTemplateVisualFallback: boolean;
  maxContentRevisions: number;
  maxImageRetries: number;
  defaultVisualMode: SocialVisualMode;
  monthlyCostLimit: number;
  duplicateLookbackDays: number;
  financialDisclaimer: string;
  affiliateDisclosure: string;
  utmSource: string;
  utmMedium: string;
  utmCampaignPrefix: string;
  notificationRecipients: string[];
  weeklyPublicationMaximum: number;
  companionStoriesEnabled: boolean;
  postingDays: string[];
  weeklyPlanningTime: string;
  prePublicationLeadHours: number;
  candidateCount: number;
  researchResultLimit: number;
  competitorWatchlist: string[];
  hashtagWatchlist: string[];
  supervisorModel: string;
  audienceModel: string;
  growthModel: string;
  communityModel: string;
  analyticsIntervalsHours: number[];
  autoReply: boolean;
  autoDm: boolean;
  autoHideSpam: boolean;
};

export const EMPTY_READINESS: SocialReadiness = {
  generationEnabled: true,
  manualGenerationEnabled: true,
  researchMode: "evergreen",
  aiConfigured: false,
  publishingEnabled: false,
  instagramConnected: false,
  blockers: [],
  warnings: [],
};

export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  raw: {},
  brandProfile: "Wealth | Wellness | Women. Simple, warm and practical financial education for Indian women.",
  targetAudience: "Indian women, young professionals, first-time investors and women building financial confidence.",
  contentPillars: [
    { name: "Money Education", ratio: 25, enabled: true },
    { name: "Money Psychology", ratio: 15, enabled: true },
    { name: "Wealth and Wellness", ratio: 15, enabled: true },
    { name: "Relatable Money Moments", ratio: 15, enabled: true },
    { name: "Interactive", ratio: 10, enabled: true },
    { name: "Pink Paisa Resources", ratio: 15, enabled: true },
    { name: "Curated Wellness and Affiliate Products", ratio: 5, enabled: true },
  ],
  dailyGenerationTime: "08:00",
  defaultPostingTime: "18:30",
  timezone: "Asia/Kolkata",
  researchDomains: [],
  blockedDomains: [],
  autoPublish: false,
  approvalRequired: true,
  aiModel: "gpt-5.6-luna",
  researchModel: "gpt-5.6-luna",
  strategyModel: "gpt-5.6-luna",
  copyModel: "gpt-5.6-luna",
  complianceModel: "gpt-5.6-luna",
  visualDirectionModel: "gpt-5.6-luna",
  assemblyModel: "gpt-5.6-luna",
  imageModel: "gpt-image-2",
  fullAiGeneration: true,
  allowDeterministicFallback: false,
  allowTemplateVisualFallback: false,
  maxContentRevisions: 3,
  maxImageRetries: 3,
  defaultVisualMode: "FULL_AI_GRAPHIC",
  monthlyCostLimit: 0,
  duplicateLookbackDays: 90,
  financialDisclaimer: "For educational purposes only. This is not personalised financial advice.",
  affiliateDisclosure: "This post may contain affiliate links. Pink Paisa may earn a commission at no extra cost to you.",
  utmSource: "instagram",
  utmMedium: "organic_social",
  utmCampaignPrefix: "pink_paisa",
  notificationRecipients: [],
  weeklyPublicationMaximum: 5,
  companionStoriesEnabled: true,
  postingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  weeklyPlanningTime: "18:00",
  prePublicationLeadHours: 24,
  candidateCount: 8,
  researchResultLimit: 20,
  competitorWatchlist: [],
  hashtagWatchlist: [],
  supervisorModel: "gpt-5.6-luna",
  audienceModel: "gpt-5.6-luna",
  growthModel: "gpt-5.6-luna",
  communityModel: "gpt-5.6-luna",
  analyticsIntervalsHours: [1, 24, 72, 168, 672],
  autoReply: false,
  autoDm: false,
  autoHideSpam: false,
};
