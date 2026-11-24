import { createAsyncThunk } from '@reduxjs/toolkit';
import { App, Notice } from 'obsidian';
import { State } from '..';
import { fetchPluginUpdateDiff } from '../../domain/githubDiff';
import { evaluatePluginDiffWithJev } from '../../domain/jevSecurityCheck';
import pluginFilter from '../../domain/pluginFilter';
import { PluginSecurityReview, PluginSettings } from '../../domain/pluginSettings';
import { syncSecurityChecklistNoteInVault } from '../../domain/securityChecklist';

type BaseSecurityParams = {
    app: App;
    persistPluginSettings: (settings: PluginSettings) => Promise<void>;
};

function getFilteredUpdateById(state: State, pluginId: string) {
    const filtered = pluginFilter(
        {},
        state.obsidian.settings,
        state.obsidian.pluginManifests,
        state.obsidian.enabledPlugins,
        state.releases.releases
    );
    return {
        allFiltered: filtered,
        target: filtered.find((item) => item.getPluginId() === pluginId),
    };
}

export const checkPluginSecurityWithJev = createAsyncThunk(
    'obsidian/checkPluginSecurityWithJev',
    async (params: BaseSecurityParams & { pluginId: string }, thunkAPI) => {
        const state = thunkAPI.getState() as State;
        const settings = state.obsidian.settings;
        const { allFiltered, target } = getFilteredUpdateById(state, params.pluginId);

        if (!target) {
            throw new Error(`No pending update found for ${params.pluginId}.`);
        }

        const repoPath = target.getRepoPath() || target.getPluginRepositoryUrl();
        const fromVersion = target.getInstalledVersionNumber();
        const toVersion = target.getLatestVersionNumber();
        const fallbackNotes = target
            .getReleaseVersions()
            .map((v) => `## ${v.versionName}\n${v.notes}`)
            .join('\n\n');

        let review: PluginSecurityReview;
        try {
            const diff = await fetchPluginUpdateDiff({
                repoPath,
                fromVersion,
                toVersion,
                githubToken: settings.githubToken,
                fallbackNotes,
            });

            review = await evaluatePluginDiffWithJev({
                apiKey: settings.typesafeApiKey,
                endpointUrl: settings.jevEndpointUrl,
                model: settings.jevModel,
                pluginId: params.pluginId,
                pluginName: target.getPluginName(),
                diff,
                autoApproveLowRiskUpdates: settings.autoApproveLowRiskUpdates,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Jev check failed for ${target.getPluginName()}: ${message}`);
            const compareRepo = repoPath.replace(/^https?:\/\/github\.com\//i, '');
            review = {
                pluginId: params.pluginId,
                fromVersion,
                reviewedVersion: toVersion,
                approved: false,
                approvedManually: false,
                recommendation: 'review',
                riskScore: 1.5,
                riskConfidence: 0,
                recommendationConfidence: 0,
                newNetworkCalls: 0,
                sensitiveLocalAccess: 0,
                supplyChainRisk: 0,
                inputTokens: 0,
                estimatedUsd: 0,
                sourceKind: 'release-notes-only',
                compareUrl: compareRepo
                    ? `https://github.com/${compareRepo}/compare/${fromVersion}...${toVersion}#files_bucket`
                    : '',
                changedFiles: [],
                signals: [],
                reviewedAt: new Date().toISOString(),
                error: message,
            };
        }

        const latestSettings = (thunkAPI.getState() as State).obsidian.settings;
        let nextReviews: Record<string, PluginSecurityReview> = {
            ...latestSettings.securityReviewsByPluginId,
            [params.pluginId]: review,
        };

        if (latestSettings.syncMarkdownChecklist) {
            try {
                nextReviews = await syncSecurityChecklistNoteInVault({
                    app: params.app,
                    notePath: latestSettings.checklistNotePath,
                    updates: allFiltered,
                    reviews: nextReviews,
                });
            } catch (syncErr) {
                console.warn('Failed syncing security checklist note:', syncErr);
            }
        }

        await params.persistPluginSettings({
            ...latestSettings,
            securityReviewsByPluginId: nextReviews,
        });

        return review;
    }
);

export const checkAllPluginsSecurityWithJev = createAsyncThunk(
    'obsidian/checkAllPluginsSecurityWithJev',
    async (params: BaseSecurityParams & { pluginIds: string[] }, thunkAPI) => {
        const settings = (thunkAPI.getState() as State).obsidian.settings;
        if (!settings.typesafeApiKey.trim()) {
            new Notice('Add your TypeSafe API key in Plugin Update Tracker (Custom) settings first.');
            return;
        }

        for (const pluginId of params.pluginIds) {
            await thunkAPI.dispatch(
                checkPluginSecurityWithJev({
                    pluginId,
                    app: params.app,
                    persistPluginSettings: params.persistPluginSettings,
                })
            );
        }
    }
);

export const togglePluginSecurityApproval = createAsyncThunk(
    'obsidian/togglePluginSecurityApproval',
    async (
        params: BaseSecurityParams & {
            pluginId: string;
            fromVersion: string;
            version: string;
            compareUrl: string;
            approved: boolean;
        },
        thunkAPI
    ) => {
        const state = thunkAPI.getState() as State;
        const settings = state.obsidian.settings;
        const { allFiltered } = getFilteredUpdateById(state, params.pluginId);
        const existing = settings.securityReviewsByPluginId[params.pluginId];
        const sameVersion = existing && existing.reviewedVersion === params.version;

        const updatedReview: PluginSecurityReview = sameVersion
            ? {
                  ...existing,
                  approved: params.approved,
                  approvedManually: true,
                  reviewedAt: new Date().toISOString(),
              }
            : {
                  pluginId: params.pluginId,
                  fromVersion: params.fromVersion,
                  reviewedVersion: params.version,
                  approved: params.approved,
                  approvedManually: true,
                  recommendation: params.approved ? 'approve' : 'review',
                  riskScore: 0,
                  riskConfidence: 0,
                  recommendationConfidence: 0,
                  newNetworkCalls: 0,
                  sensitiveLocalAccess: 0,
                  supplyChainRisk: 0,
                  inputTokens: 0,
                  estimatedUsd: 0,
                  sourceKind: 'release-notes-only',
                  compareUrl: params.compareUrl,
                  changedFiles: [],
                  signals: params.approved ? ['Manually approved'] : [],
                  reviewedAt: new Date().toISOString(),
              };

        let nextReviews: Record<string, PluginSecurityReview> = {
            ...settings.securityReviewsByPluginId,
            [params.pluginId]: updatedReview,
        };

        if (settings.syncMarkdownChecklist) {
            try {
                nextReviews = await syncSecurityChecklistNoteInVault({
                    app: params.app,
                    notePath: settings.checklistNotePath,
                    updates: allFiltered,
                    reviews: nextReviews,
                });
            } catch (syncErr) {
                console.warn('Failed syncing security checklist note:', syncErr);
            }
        }

        await params.persistPluginSettings({
            ...settings,
            securityReviewsByPluginId: nextReviews,
        });
    }
);

export const syncSecurityChecklistFromVault = createAsyncThunk(
    'obsidian/syncSecurityChecklistFromVault',
    async (params: BaseSecurityParams, thunkAPI) => {
        const state = thunkAPI.getState() as State;
        const settings = state.obsidian.settings;
        if (!settings.syncMarkdownChecklist) return;

        const updates = pluginFilter(
            {},
            settings,
            state.obsidian.pluginManifests,
            state.obsidian.enabledPlugins,
            state.releases.releases
        );

        const nextReviews = await syncSecurityChecklistNoteInVault({
            app: params.app,
            notePath: settings.checklistNotePath,
            updates,
            reviews: settings.securityReviewsByPluginId,
        });

        await params.persistPluginSettings({
            ...settings,
            securityReviewsByPluginId: nextReviews,
        });
    }
);
