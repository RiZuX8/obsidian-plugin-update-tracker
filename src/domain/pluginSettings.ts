export type JevRecommendation = 'approve' | 'review' | 'block';

export type DiffSourceKind = 'github-compare' | 'release-notes-only';

export type PluginSecurityReview = {
    pluginId: string;
    fromVersion: string;
    reviewedVersion: string;
    approved: boolean;
    approvedManually?: boolean;
    recommendation: JevRecommendation;
    riskScore: number;
    riskConfidence: number;
    recommendationConfidence: number;
    newNetworkCalls: number;
    sensitiveLocalAccess: number;
    supplyChainRisk: number;
    inputTokens: number;
    estimatedUsd: number;
    sourceKind: DiffSourceKind;
    compareUrl: string;
    changedFiles: string[];
    signals: string[];
    reviewedAt: string;
    error?: string;
};

export type PluginSettings = {
    daysToSuppressNewUpdates: number;
    dismissedVersionsByPluginId: Record<string, PluginDismissedVersions>;
    excludeBetaVersions: boolean;
    excludeDisabledPlugins: boolean;
    showIconOnMobile: boolean;
    showNotificationOnNewUpdate: boolean;
    // Deprecated for minUpdateCountToShowIcon
    hideIconIfNoUpdatesAvailable?: boolean;
    minUpdateCountToShowIcon: number;
    hoursBetweenCheckingForUpdates: number;
    typesafeApiKey: string;
    jevEndpointUrl: string;
    jevModel: string;
    githubToken: string;
    requireApprovalBeforeUpdate: boolean;
    autoApproveLowRiskUpdates: boolean;
    syncMarkdownChecklist: boolean;
    checklistNotePath: string;
    securityReviewsByPluginId: Record<string, PluginSecurityReview>;
};

export type PluginDismissedVersions = {
    pluginId: string;
    pluginRepoPath: string;
    dismissedVersions: DismissedPluginVersion[];
};

export type DismissedPluginVersion = {
    versionNumber: string;
    versionName: string;
    publishedAt: string;
};

export const DEFAULT_JEV_ENDPOINT_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_JEV_MODEL = 'jev-1.14.0';
export const DEFAULT_CHECKLIST_NOTE_PATH = 'Plugin Update Security Checklist.md';

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
    daysToSuppressNewUpdates: 0,
    dismissedVersionsByPluginId: {},
    showIconOnMobile: true,
    showNotificationOnNewUpdate: false,
    excludeBetaVersions: true,
    excludeDisabledPlugins: false,
    minUpdateCountToShowIcon: 0,
    hoursBetweenCheckingForUpdates: 0.5,
    typesafeApiKey: '',
    jevEndpointUrl: DEFAULT_JEV_ENDPOINT_URL,
    jevModel: DEFAULT_JEV_MODEL,
    githubToken: '',
    requireApprovalBeforeUpdate: true,
    autoApproveLowRiskUpdates: false,
    syncMarkdownChecklist: true,
    checklistNotePath: DEFAULT_CHECKLIST_NOTE_PATH,
    securityReviewsByPluginId: {},
};
