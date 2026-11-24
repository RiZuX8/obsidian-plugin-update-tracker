import { App, normalizePath, TFile } from 'obsidian';
import InstalledPluginReleases from './InstalledPluginReleases';
import { PluginSecurityReview } from './pluginSettings';

export type ParsedChecklistItem = {
    pluginId: string;
    version: string;
    checked: boolean;
};

export type ChecklistRenderEntry = {
    pluginId: string;
    pluginName: string;
    fromVersion: string;
    toVersion: string;
    approved: boolean;
    compareUrl: string;
    review?: PluginSecurityReview;
};

type VaultWithProcess = {
    process: (file: TFile, fn: (data: string) => string) => Promise<string>;
};

function hasVaultProcess(vault: App['vault']): vault is App['vault'] & VaultWithProcess {
    return typeof (vault as unknown as Partial<VaultWithProcess>).process === 'function';
}

/**
 * Parse `- [x]` / `- [ ]` checklist entries formatted as:
 * `- [x] \`plugin-id\` (\`1.0.0\` -> \`1.0.1\`) ...` or `- [x] \`plugin-id\` (\`1.0.1\`)`
 * Uses simple line-level matching without regex lookbehinds for iOS compatibility.
 */
export function parseSecurityChecklistMarkdown(
    markdown: string
): Record<string, ParsedChecklistItem> {
    const items: Record<string, ParsedChecklistItem> = {};
    const lines = markdown.split(/\r?\n/);

    for (const line of lines) {
        const match =
            /^\s*-\s+\[([ xX])\]\s+`([^`]+)`\s+\((?:`[^`]*`\s*(?:→|->)\s*)?`([^`]+)`\)/.exec(
                line
            );
        if (!match) continue;

        const checked = match[1].toLowerCase() === 'x';
        const pluginId = match[2].trim();
        const version = match[3].trim();
        if (pluginId && version) {
            items[pluginId] = { pluginId, version, checked };
        }
    }

    return items;
}

/**
 * Render the Markdown security checklist note so both humans and AI tools can inspect and toggle updates.
 */
export function renderSecurityChecklistMarkdown(entries: ChecklistRenderEntry[]): string {
    const sorted = [...entries].sort((a, b) => a.pluginId.localeCompare(b.pluginId));

    const header = [
        '# Plugin Update Security Checklist',
        '',
        'Pending Obsidian plugin updates tracked by **Plugin Update Tracker (Custom)**.',
        'Check (`[x]`) an item here or in the plugin UI to allow updating that version.',
        '',
    ];

    if (sorted.length === 0) {
        return [...header, '_No pending plugin updates right now._', ''].join('\n');
    }

    const lines = sorted.map((entry) => {
        const box = entry.approved ? 'x' : ' ';
        const compareLink = entry.compareUrl ? ` · [Diff](${entry.compareUrl})` : '';

        if (!entry.review) {
            return `- [${box}] \`${entry.pluginId}\` (\`${entry.fromVersion}\` → \`${entry.toVersion}\`) — _Not checked with Jev yet_${compareLink}`;
        }

        if (entry.review.error) {
            return `- [${box}] \`${entry.pluginId}\` (\`${entry.fromVersion}\` → \`${entry.toVersion}\`) — Error: ${entry.review.error}${compareLink}`;
        }

        const r = entry.review;
        const netPct = Math.round(r.newNetworkCalls * 100);
        const secPct = Math.round(r.sensitiveLocalAccess * 100);
        const scPct = Math.round(r.supplyChainRisk * 100);
        const sourceTag = r.sourceKind === 'release-notes-only' ? ' · notes-only' : '';
        return `- [${box}] \`${entry.pluginId}\` (\`${entry.fromVersion}\` → \`${entry.toVersion}\`) — **${entry.pluginName}** · Jev: \`${r.recommendation}\` (risk \`${r.riskScore.toFixed(2)}/3\`, net \`${netPct}%\`, local \`${secPct}%\`, deps \`${scPct}%\`${sourceTag})${compareLink}`;
    });

    return [...header, ...lines, ''].join('\n');
}

function isProtectedDiaryPath(normalizedPath: string): boolean {
    return normalizedPath === 'Diary' || normalizedPath.startsWith('Diary/');
}

/**
 * Merge any `[x]` / `[ ]` checkbox edits from an existing Markdown checklist note when
 * the note was modified more recently than the stored review timestamp.
 */
export function mergeChecklistApprovals(params: {
    parsedFromNote: Record<string, ParsedChecklistItem>;
    noteMtimeMs: number;
    updates: InstalledPluginReleases[];
    existingReviews: Record<string, PluginSecurityReview>;
}): Record<string, PluginSecurityReview> {
    const updatedReviews: Record<string, PluginSecurityReview> = { ...params.existingReviews };

    for (const update of params.updates) {
        const pluginId = update.getPluginId();
        const targetVersion = update.getLatestVersionNumber();
        const fromVersion = update.getInstalledVersionNumber();
        const noteEntry = params.parsedFromNote[pluginId];
        if (!noteEntry || noteEntry.version !== targetVersion) continue;

        const existing = updatedReviews[pluginId];
        const existingForSameVersion = existing && existing.reviewedVersion === targetVersion;

        if (!existingForSameVersion) {
            if (noteEntry.checked) {
                const repoPath = update.getRepoPath() || '';
                const compareUrl = repoPath
                    ? `https://github.com/${repoPath}/compare/${fromVersion}...${targetVersion}#files_bucket`
                    : '';
                updatedReviews[pluginId] = {
                    pluginId,
                    fromVersion,
                    reviewedVersion: targetVersion,
                    approved: true,
                    approvedManually: true,
                    recommendation: 'review',
                    riskScore: 0,
                    riskConfidence: 0,
                    recommendationConfidence: 0,
                    newNetworkCalls: 0,
                    sensitiveLocalAccess: 0,
                    supplyChainRisk: 0,
                    inputTokens: 0,
                    estimatedUsd: 0,
                    sourceKind: 'release-notes-only',
                    compareUrl,
                    changedFiles: [],
                    signals: ['Approved via Markdown security checklist'],
                    reviewedAt: new Date(params.noteMtimeMs).toISOString(),
                };
            }
            continue;
        }

        const reviewTimeMs = Date.parse(existing.reviewedAt) || 0;
        if (params.noteMtimeMs > reviewTimeMs && existing.approved !== noteEntry.checked) {
            updatedReviews[pluginId] = {
                ...existing,
                approved: noteEntry.checked,
                approvedManually: true,
                reviewedAt: new Date(params.noteMtimeMs).toISOString(),
            };
        }
    }

    return updatedReviews;
}

/**
 * Synchronize approvals from/to the configured Markdown checklist note in the vault.
 */
export async function syncSecurityChecklistNoteInVault(params: {
    app: App;
    notePath: string;
    updates: InstalledPluginReleases[];
    reviews: Record<string, PluginSecurityReview>;
}): Promise<Record<string, PluginSecurityReview>> {
    const normalizedPath = normalizePath(params.notePath.trim() || 'Plugin Update Security Checklist.md');
    if (isProtectedDiaryPath(normalizedPath)) {
        throw new Error('Checklist note path cannot target the Diary folder.');
    }

    const abstractFile = params.app.vault.getAbstractFileByPath(normalizedPath);
    let mergedReviews = params.reviews;

    if (abstractFile instanceof TFile) {
        const existingContent = await params.app.vault.read(abstractFile);
        const parsedFromNote = parseSecurityChecklistMarkdown(existingContent);
        mergedReviews = mergeChecklistApprovals({
            parsedFromNote,
            noteMtimeMs: abstractFile.stat.mtime,
            updates: params.updates,
            existingReviews: params.reviews,
        });
    }

    const entries: ChecklistRenderEntry[] = params.updates.map((update) => {
        const pluginId = update.getPluginId();
        const toVersion = update.getLatestVersionNumber();
        const fromVersion = update.getInstalledVersionNumber();
        const review = mergedReviews[pluginId];
        const matchingReview = review && review.reviewedVersion === toVersion ? review : undefined;
        const repoPath = update.getRepoPath() || '';
        const compareUrl =
            matchingReview?.compareUrl ||
            (repoPath
                ? `https://github.com/${repoPath}/compare/${fromVersion}...${toVersion}#files_bucket`
                : '');

        return {
            pluginId,
            pluginName: update.getPluginName(),
            fromVersion,
            toVersion,
            approved: Boolean(matchingReview?.approved),
            compareUrl,
            review: matchingReview,
        };
    });

    const nextMarkdown = renderSecurityChecklistMarkdown(entries);

    if (abstractFile instanceof TFile) {
        if (hasVaultProcess(params.app.vault)) {
            await params.app.vault.process(abstractFile, () => nextMarkdown);
        } else {
            await params.app.vault.modify(abstractFile, nextMarkdown);
        }
    } else if (!abstractFile) {
        await params.app.vault.create(normalizedPath, nextMarkdown);
    }

    return mergedReviews;
}
