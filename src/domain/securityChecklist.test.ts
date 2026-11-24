jest.mock('obsidian', () => ({
    normalizePath: (p: string) => p,
    TFile: class TFile {},
}));

import { PluginManifest } from 'obsidian';
import InstalledPluginReleases from './InstalledPluginReleases';
import { PluginSecurityReview } from './pluginSettings';
import {
    mergeChecklistApprovals,
    parseSecurityChecklistMarkdown,
    renderSecurityChecklistMarkdown,
} from './securityChecklist';

describe('securityChecklist', () => {
    it('renders and parses checklist items round-trip', () => {
        const review: PluginSecurityReview = {
            pluginId: 'dataview',
            fromVersion: '0.5.44',
            reviewedVersion: '0.5.46',
            approved: true,
            recommendation: 'approve',
            riskScore: 0.25,
            riskConfidence: 0.9,
            recommendationConfidence: 0.92,
            newNetworkCalls: 0.05,
            sensitiveLocalAccess: 0.02,
            supplyChainRisk: 0.01,
            inputTokens: 1200,
            estimatedUsd: 0.00005,
            sourceKind: 'github-compare',
            compareUrl: 'https://github.com/blacksmithgu/obsidian-dataview/compare/0.5.44...0.5.46',
            changedFiles: ['src/main.ts'],
            signals: [],
            reviewedAt: '2026-11-24T15:00:00.000Z',
        };

        const md = renderSecurityChecklistMarkdown([
            {
                pluginId: 'dataview',
                pluginName: 'Dataview',
                fromVersion: '0.5.44',
                toVersion: '0.5.46',
                approved: true,
                compareUrl: review.compareUrl,
                review,
            },
            {
                pluginId: 'templater-obsidian',
                pluginName: 'Templater',
                fromVersion: '2.0.0',
                toVersion: '2.1.0',
                approved: false,
                compareUrl: '',
            },
        ]);

        const parsed = parseSecurityChecklistMarkdown(md);
        expect(parsed['dataview']).toEqual({
            pluginId: 'dataview',
            version: '0.5.46',
            checked: true,
        });
        expect(parsed['templater-obsidian']).toEqual({
            pluginId: 'templater-obsidian',
            version: '2.1.0',
            checked: false,
        });
    });

    it('adopts checklist [x] edits made after the last review timestamp', () => {
        const manifests: PluginManifest[] = [
            {
                id: 'dataview',
                name: 'Dataview',
                version: '0.5.44',
                minAppVersion: '0.15.0',
                author: '',
                description: '',
            },
        ];
        const updates = InstalledPluginReleases.create(manifests, [
            {
                obsidianPluginId: 'dataview',
                pluginName: 'Dataview',
                pluginRepositoryUrl: 'https://github.com/blacksmithgu/obsidian-dataview',
                pluginRepoPath: 'blacksmithgu/obsidian-dataview',
                newVersions: [
                    {
                        releaseId: 1,
                        versionName: '0.5.46',
                        versionNumber: '0.5.46',
                        notes: '',
                        areNotesTruncated: false,
                        downloads: 100,
                        isBetaVersion: false,
                        publishedAt: '2026-11-20T00:00:00Z',
                        updatedAt: '2026-11-20T00:00:00Z',
                        fileAssetIds: { mainJs: 1, manifestJson: 2 },
                    },
                ],
            },
        ]);

        const merged = mergeChecklistApprovals({
            parsedFromNote: {
                dataview: { pluginId: 'dataview', version: '0.5.46', checked: true },
            },
            noteMtimeMs: Date.parse('2026-11-24T16:00:00.000Z'),
            updates,
            existingReviews: {
                dataview: {
                    pluginId: 'dataview',
                    fromVersion: '0.5.44',
                    reviewedVersion: '0.5.46',
                    approved: false,
                    recommendation: 'review',
                    riskScore: 1.2,
                    riskConfidence: 0.7,
                    recommendationConfidence: 0.8,
                    newNetworkCalls: 0.6,
                    sensitiveLocalAccess: 0.1,
                    supplyChainRisk: 0.05,
                    inputTokens: 900,
                    estimatedUsd: 0.000038,
                    sourceKind: 'github-compare',
                    compareUrl: 'https://github.com/blacksmithgu/obsidian-dataview/compare/0.5.44...0.5.46',
                    changedFiles: ['src/api.ts'],
                    signals: [],
                    reviewedAt: '2026-11-24T15:00:00.000Z',
                },
            },
        });

        expect(merged['dataview'].approved).toBe(true);
        expect(merged['dataview'].approvedManually).toBe(true);
    });
});
