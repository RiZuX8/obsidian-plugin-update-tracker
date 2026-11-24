import { requestUrl } from 'obsidian';
import { PluginDiffPayload } from './githubDiff';
import {
    DEFAULT_JEV_ENDPOINT_URL,
    DEFAULT_JEV_MODEL,
    JevRecommendation,
    PluginSecurityReview,
} from './pluginSettings';

const USD_PER_MILLION_INPUT_TOKENS = 0.042;

type RawSystemOneAnswer = {
    type?: string;
    noul?: number;
    score?: number;
    confidence?: number;
    choice?: string;
};

type RawSystemOneResponse = {
    model?: string;
    answers?: Record<string, RawSystemOneAnswer>;
    usage?: {
        input_tokens?: number;
    };
    error?: {
        message?: string;
    };
};

function clamp01(value: unknown, fallback: number = 0): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function normalizeRecommendation(value: unknown): JevRecommendation {
    if (value === 'approve' || value === 'review' || value === 'block') {
        return value;
    }
    return 'review';
}

/**
 * Build the state string passed to Jev System One from a fetched plugin diff.
 */
export function buildJevDiffState(
    pluginName: string,
    pluginId: string,
    diff: PluginDiffPayload
): string {
    const commitsBlock =
        diff.commitMessages.length > 0
            ? `Commits:\n- ${diff.commitMessages.join('\n- ')}\n\n`
            : '';
    const signalsBlock =
        diff.signals.length > 0 ? `Static diff markers:\n- ${diff.signals.join('\n- ')}\n\n` : '';
    const filesBlock =
        diff.changedFiles.length > 0
            ? `Included files (${diff.changedFiles.length}): ${diff.changedFiles.join(', ')}\n`
            : '';
    const skippedBlock =
        diff.skippedFiles.length > 0
            ? `Skipped lock/asset files (${diff.skippedFiles.length}): ${diff.skippedFiles.join(', ')}\n`
            : '';

    return [
        `Obsidian plugin update security inspection`,
        `Plugin: ${pluginName} (${pluginId})`,
        `Repository: ${diff.repoPath}`,
        `Version change: ${diff.fromVersion} -> ${diff.toVersion}`,
        `Diff source: ${diff.sourceKind}${diff.truncated ? ' (truncated)' : ''}`,
        filesBlock + skippedBlock,
        commitsBlock + signalsBlock + `Code diff / context:\n${diff.diffText}`,
    ]
        .filter(Boolean)
        .join('\n');
}

/**
 * Parse and validate TypeSafe `/v1/systemone` JSON output into a typed `PluginSecurityReview`.
 */
export function parseSystemOneResponse(
    rawText: string,
    meta: {
        pluginId: string;
        diff: PluginDiffPayload;
        autoApproveLowRiskUpdates: boolean;
        reviewedAt?: string;
    }
): PluginSecurityReview {
    let parsed: RawSystemOneResponse;
    try {
        const raw: unknown = JSON.parse(rawText);
        if (!raw || typeof raw !== 'object') {
            throw new Error('Response is not a JSON object');
        }
        parsed = raw as RawSystemOneResponse;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid Jev API JSON response: ${msg}`);
    }

    const answers = parsed.answers || {};
    const newNetworkCalls = clamp01(answers.new_network_calls?.noul, 0);
    const sensitiveLocalAccess = clamp01(answers.sensitive_local_access?.noul, 0);
    const supplyChainRisk = clamp01(answers.supply_chain_risk?.noul, 0);
    const riskScore =
        typeof answers.risk_score?.score === 'number' && !Number.isNaN(answers.risk_score.score)
            ? answers.risk_score.score
            : 1.5;
    const riskConfidence = clamp01(answers.risk_score?.confidence, 0);
    const recommendation = normalizeRecommendation(answers.recommendation?.choice);
    const recommendationConfidence = clamp01(answers.recommendation?.confidence, 0);
    const inputTokens =
        typeof parsed.usage?.input_tokens === 'number' && parsed.usage.input_tokens >= 0
            ? parsed.usage.input_tokens
            : 0;
    const estimatedUsd = (inputTokens * USD_PER_MILLION_INPUT_TOKENS) / 1_000_000;

    // Only allow auto-approval when source code diff was actually inspected and Jev approves with low risk.
    const canAutoApprove =
        meta.autoApproveLowRiskUpdates &&
        meta.diff.sourceKind === 'github-compare' &&
        recommendation === 'approve' &&
        riskScore <= 0.75;

    return {
        pluginId: meta.pluginId,
        fromVersion: meta.diff.fromVersion,
        reviewedVersion: meta.diff.toVersion,
        approved: canAutoApprove,
        approvedManually: false,
        recommendation,
        riskScore,
        riskConfidence,
        recommendationConfidence,
        newNetworkCalls,
        sensitiveLocalAccess,
        supplyChainRisk,
        inputTokens,
        estimatedUsd,
        sourceKind: meta.diff.sourceKind,
        compareUrl: meta.diff.compareUrl,
        changedFiles: meta.diff.changedFiles,
        signals: meta.diff.signals,
        reviewedAt: meta.reviewedAt || new Date().toISOString(),
    };
}

/**
 * Evaluate a plugin update diff via TypeSafe AI's System One API using Obsidian's `requestUrl`.
 */
export async function evaluatePluginDiffWithJev(params: {
    apiKey: string;
    endpointUrl?: string;
    model?: string;
    pluginId: string;
    pluginName: string;
    diff: PluginDiffPayload;
    autoApproveLowRiskUpdates: boolean;
}): Promise<PluginSecurityReview> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
        throw new Error('Configure a TypeSafe API key in Plugin Update Tracker (Custom) settings first.');
    }

    const endpointUrl = (params.endpointUrl || DEFAULT_JEV_ENDPOINT_URL).trim();
    const model = (params.model || DEFAULT_JEV_MODEL).trim();

    const payload = {
        model,
        state: buildJevDiffState(params.pluginName, params.pluginId, params.diff),
        questions: {
            new_network_calls: {
                type: 'noul',
                instructions:
                    'Does this plugin update introduce new outbound network endpoints, fetch/requestUrl calls, tracking/telemetry, or unknown external URLs?',
            },
            sensitive_local_access: {
                type: 'noul',
                instructions:
                    'Does this update read files outside expected plugin scope, access process.env/credentials/cookies, execute shell commands, or run dynamic code (eval/new Function)?',
            },
            supply_chain_risk: {
                type: 'noul',
                instructions:
                    'Does this update add suspicious dependencies, install scripts, or unexpected permission escalations (e.g. changing isDesktopOnly or adding Node built-ins)?',
            },
            risk_score: {
                type: 'score',
                instructions:
                    'How risky is this Obsidian plugin update from a security and vault-privacy perspective?',
                criteria: [
                    'Harmless UI, localization, docs, or internal refactor with no new permissions or network destinations',
                    'Minor functional change using standard Obsidian APIs or expected plugin endpoints',
                    'Notable change: new external domains, broad vault/filesystem access, shell commands, or new dependencies — human should inspect diff',
                    'Critical risk: data exfiltration, hidden telemetry, reading arbitrary notes/env secrets, or obfuscated code',
                ],
            },
            recommendation: {
                type: 'choice',
                instructions:
                    'What action should the user take for this Obsidian plugin update?',
                criteria: {
                    approve:
                        'Source diff is available and shows safe, expected maintenance or minor changes with no suspicious endpoints or secret access',
                    review:
                        'Source diff is missing/truncated or introduces new endpoints, dependencies, or local file/process access worth inspecting first',
                    block:
                        'Shows signs of exfiltration, unauthorized note/env reading, hidden telemetry, or dangerous code execution',
                },
            },
        },
    };

    const res = await requestUrl({
        url: endpointUrl,
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        throw: false,
    });

    if (res.status < 200 || res.status >= 300) {
        let details = res.text;
        try {
            const parsedErr: unknown = JSON.parse(res.text);
            if (parsedErr && typeof parsedErr === 'object' && 'error' in parsedErr) {
                const errObj = (parsedErr as RawSystemOneResponse).error;
                if (errObj?.message) details = errObj.message;
            }
        } catch {
            // Keep raw response text as fallback
        }
        throw new Error(`Jev API error (${res.status}): ${details}`);
    }

    return parseSystemOneResponse(res.text, {
        pluginId: params.pluginId,
        diff: params.diff,
        autoApproveLowRiskUpdates: params.autoApproveLowRiskUpdates,
    });
}
