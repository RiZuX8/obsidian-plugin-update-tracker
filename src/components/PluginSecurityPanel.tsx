import * as React from 'react';
import { PluginSecurityReview } from '../domain/pluginSettings';

interface SecurityChecklistToolbarProps {
    totalPlugins: number;
    approvedCount: number;
    uncheckedCount: number;
    totalEstimatedUsd: number;
    isCheckingAll: boolean;
    hasApiKey: boolean;
    syncChecklistEnabled: boolean;
    requireApproval: boolean;
    onCheckAllWithJev: () => void;
    onSyncChecklist: () => void;
}

export const SecurityChecklistToolbar: React.FC<SecurityChecklistToolbarProps> = ({
    totalPlugins,
    approvedCount,
    uncheckedCount,
    totalEstimatedUsd,
    isCheckingAll,
    hasApiKey,
    syncChecklistEnabled,
    requireApproval,
    onCheckAllWithJev,
    onSyncChecklist,
}) => {
    const costLabel =
        totalEstimatedUsd > 0 ? ` · Jev cost: ~$${totalEstimatedUsd.toFixed(5)}` : '';

    return (
        <div className="oput-security-toolbar" role="region" aria-label="Security checklist controls">
            <div className="oput-security-toolbar-summary">
                <strong>
                    Checklist: {approvedCount}/{totalPlugins} approved
                </strong>
                <span>
                    {requireApproval
                        ? '(update gate active)'
                        : '(update gate off)'}
                    {costLabel}
                </span>
                {!hasApiKey && (
                    <span className="oput-security-error">
                        Add TypeSafe API key in settings to run Jev diff checks.
                    </span>
                )}
            </div>

            <div className="oput-security-toolbar-actions">
                {syncChecklistEnabled && (
                    <button
                        type="button"
                        className="oput-security-btn"
                        onClick={onSyncChecklist}
                        disabled={isCheckingAll}
                    >
                        Sync checklist
                    </button>
                )}
                <button
                    type="button"
                    className="oput-security-btn mod-cta"
                    onClick={onCheckAllWithJev}
                    disabled={isCheckingAll || uncheckedCount === 0}
                >
                    {isCheckingAll
                        ? 'Checking diffs...'
                        : uncheckedCount > 0
                        ? `Check ${uncheckedCount} with Jev`
                        : 'All checked'}
                </button>
            </div>
        </div>
    );
};

interface SecurityBadgeProps {
    review?: PluginSecurityReview;
    targetVersion: string;
    isChecking: boolean;
}

export const SecurityStatusBadge: React.FC<SecurityBadgeProps> = ({
    review,
    targetVersion,
    isChecking,
}) => {
    if (isChecking) {
        return (
            <span className="oput-security-badge oput-security-badge--unchecked">
                Checking...
            </span>
        );
    }

    const matching = review && review.reviewedVersion === targetVersion ? review : undefined;
    if (!matching) {
        return (
            <span
                className="oput-security-badge oput-security-badge--unchecked"
                aria-label="Update not yet reviewed"
                data-tooltip-position="top"
            >
                Unchecked
            </span>
        );
    }

    if (matching.approved) {
        return (
            <span
                className="oput-security-badge oput-security-badge--approved"
                aria-label="Approved for update"
                data-tooltip-position="top"
            >
                Approved
            </span>
        );
    }

    if (matching.recommendation === 'block') {
        return (
            <span
                className="oput-security-badge oput-security-badge--block"
                aria-label="High security risk detected by Jev"
                data-tooltip-position="top"
            >
                Blocked ({matching.riskScore.toFixed(1)}/3)
            </span>
        );
    }

    return (
        <span
            className="oput-security-badge oput-security-badge--review"
            aria-label="Needs review before updating"
            data-tooltip-position="top"
        >
            Needs review ({matching.riskScore.toFixed(1)}/3)
        </span>
    );
};

interface PluginSecurityPanelProps {
    pluginId: string;
    targetVersion: string;
    review?: PluginSecurityReview;
    isChecking: boolean;
    isBusyAll: boolean;
    onCheckWithJev: () => void;
    onToggleApproved: (nextApproved: boolean) => void;
}

export const PluginSecurityPanel: React.FC<PluginSecurityPanelProps> = ({
    targetVersion,
    review,
    isChecking,
    isBusyAll,
    onCheckWithJev,
    onToggleApproved,
}) => {
    const [showDetails, setShowDetails] = React.useState(false);
    const matching = review && review.reviewedVersion === targetVersion ? review : undefined;
    const isApproved = Boolean(matching?.approved);

    const netPct = matching ? Math.round(matching.newNetworkCalls * 100) : 0;
    const localPct = matching ? Math.round(matching.sensitiveLocalAccess * 100) : 0;
    const depsPct = matching ? Math.round(matching.supplyChainRisk * 100) : 0;

    return (
        <div className="oput-security-card-bar">
            <div className="oput-security-card-actions">
                <div className="oput-security-card-buttons">
                    <button
                        type="button"
                        className="oput-security-btn"
                        onClick={onCheckWithJev}
                        disabled={isChecking || isBusyAll}
                    >
                        {isChecking
                            ? 'Checking diff...'
                            : matching
                            ? 'Re-check with Jev'
                            : 'Check with Jev'}
                    </button>

                    <button
                        type="button"
                        className={`oput-security-btn ${
                            isApproved ? 'oput-security-btn--approved' : ''
                        }`}
                        aria-pressed={isApproved}
                        onClick={() => onToggleApproved(!isApproved)}
                        disabled={isChecking}
                    >
                        {isApproved ? 'Approved ✓' : 'Approve update'}
                    </button>

                    {matching && (matching.changedFiles.length > 0 || matching.signals.length > 0) && (
                        <button
                            type="button"
                            className="oput-security-btn"
                            onClick={() => setShowDetails(!showDetails)}
                        >
                            {showDetails ? 'Hide diff details' : 'Show diff details'}
                        </button>
                    )}
                </div>

                {matching && !matching.error && (
                    <span className="oput-security-metrics">
                        <span>Jev: {matching.recommendation}</span>
                        <span>Risk: {matching.riskScore.toFixed(2)}/3</span>
                        <span>Network: {netPct}%</span>
                        <span>Local: {localPct}%</span>
                        <span>Deps: {depsPct}%</span>
                        {matching.inputTokens > 0 && (
                            <span>
                                {matching.inputTokens.toLocaleString()} tok (~$
                                {matching.estimatedUsd.toFixed(5)})
                            </span>
                        )}
                    </span>
                )}
            </div>

            {matching?.error && <div className="oput-security-error">{matching.error}</div>}

            {matching && matching.sourceKind === 'release-notes-only' && !matching.error && (
                <div className="oput-security-signals">
                    Note: GitHub source compare tags were unavailable; Jev inspected release notes
                    only.
                </div>
            )}

            {showDetails && matching && (
                <>
                    {matching.signals.length > 0 && (
                        <div className="oput-security-signals">
                            <strong>Signals:</strong> {matching.signals.join(' · ')}
                        </div>
                    )}
                    {matching.changedFiles.length > 0 && (
                        <div className="oput-security-files">
                            <strong>Inspected files ({matching.changedFiles.length}):</strong>{' '}
                            {matching.changedFiles.join(', ')}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
