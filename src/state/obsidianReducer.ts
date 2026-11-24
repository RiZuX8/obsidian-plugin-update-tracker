import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import find from 'lodash/find';
import { App, PluginManifest } from 'obsidian';
import { DEFAULT_PLUGIN_SETTINGS, PluginSettings } from '../domain/pluginSettings';
import { dismissSelectedPluginVersions } from './actionProducers/dismissPluginVersions';
import {
    checkAllPluginsSecurityWithJev,
    checkPluginSecurityWithJev,
} from './actionProducers/checkPluginSecurity';
import { updatePlugins } from './actionProducers/updatePlugins';

export type ObsidianApp = App & {
    plugins?: {
        manifests?: Record<string, PluginManifest>;
        enabledPlugins?: Set<string>;
        plugins?: Record<
            string,
            {
                _loaded?: boolean;
            }
        >;
        disablePlugin?: (pluginId: string) => Promise<any>;
        enablePlugin?: (pluginId: string) => Promise<any>;
        loadManifests?: () => Promise<any>;
    };
};

export type ObsidianState = {
    thisPluginId: string;
    pluginManifests: PluginManifest[];
    enabledPlugins?: Record<string, boolean>;
    settings: PluginSettings;
    selectedPluginsById: Record<string, boolean>;
    isUpdatingPlugins: boolean;
    pluginUpdateProgress: PluginUpdateResult[];
    isUpdateResultAcknowledged: boolean;
    githubRateLimitResetTimestamp?: number;
    checkingSecurityByPluginId: Record<string, boolean>;
    isCheckingAllSecurity: boolean;
};

const DEFAULT_STATE: ObsidianState = {
    thisPluginId: '',
    pluginManifests: [],
    enabledPlugins: undefined,
    settings: DEFAULT_PLUGIN_SETTINGS,
    selectedPluginsById: {},
    isUpdatingPlugins: false,
    pluginUpdateProgress: [],
    isUpdateResultAcknowledged: true,
    checkingSecurityByPluginId: {},
    isCheckingAllSecurity: false,
};

export type PluginUpdateResult = {
    pluginId: string;
    pluginName: string;
    status: PluginUpdateStatus;
};

export type PluginUpdateStatus = 'loading' | 'success' | 'failure';

const obsidianStateSlice = createSlice({
    name: 'obsidian',
    initialState: DEFAULT_STATE,
    reducers: {
        syncPluginManifests(
            state,
            action: PayloadAction<{
                manifests: PluginManifest[];
                enabledPlugins?: Record<string, boolean>;
            }>
        ) {
            state.pluginManifests = action.payload.manifests;
            state.enabledPlugins = action.payload.enabledPlugins;
        },
        syncThisPluginId(state, action: PayloadAction<string>) {
            state.thisPluginId = action.payload;
        },
        syncSettings(state, action: PayloadAction<PluginSettings>) {
            state.settings = action.payload;
        },
        pluginUpdateStatusChange(state, action: PayloadAction<PluginUpdateResult>) {
            const update = action.payload;

            const existing = find(
                state.pluginUpdateProgress,
                (plugin) => plugin.pluginName === update.pluginName
            );
            if (existing) {
                existing.status = update.status;
            } else {
                state.pluginUpdateProgress.push(update);
            }
        },
        acknowledgedPluginUpdateResults(state) {
            state.isUpdateResultAcknowledged = true;
        },
        togglePluginSelection(
            state,
            action: PayloadAction<{ pluginId: string; selected: boolean }>
        ) {
            const { pluginId, selected } = action.payload;
            state.selectedPluginsById[pluginId] = selected;
        },
        toggleSelectAllPlugins(
            state,
            action: PayloadAction<{ select: boolean; pluginIds: string[] }>
        ) {
            const { select, pluginIds } = action.payload;
            state.selectedPluginsById = {};

            if (select) {
                pluginIds.forEach((pluginId) => (state.selectedPluginsById[pluginId] = true));
            }
        },
        githubRateLimit(state, action: PayloadAction<number>) {
            state.githubRateLimitResetTimestamp = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(updatePlugins.pending, (state) => {
                state.isUpdatingPlugins = true;
                state.pluginUpdateProgress = [];
                state.isUpdateResultAcknowledged = false;
                state.githubRateLimitResetTimestamp = undefined;
            })
            .addCase(updatePlugins.fulfilled, (state) => {
                state.isUpdatingPlugins = false;
                state.selectedPluginsById = {};
            })
            .addCase(updatePlugins.rejected, (state) => {
                state.isUpdatingPlugins = false;
                state.selectedPluginsById = {};
            })
            .addCase(dismissSelectedPluginVersions.fulfilled, (state, action) => {
                for (const dismissedVersion of action.payload) {
                    state.selectedPluginsById[dismissedVersion.pluginId] =
                        !dismissedVersion.isLastAvailableVersion;
                }
            })
            .addCase(checkPluginSecurityWithJev.pending, (state, action) => {
                state.checkingSecurityByPluginId[action.meta.arg.pluginId] = true;
            })
            .addCase(checkPluginSecurityWithJev.fulfilled, (state, action) => {
                delete state.checkingSecurityByPluginId[action.meta.arg.pluginId];
            })
            .addCase(checkPluginSecurityWithJev.rejected, (state, action) => {
                delete state.checkingSecurityByPluginId[action.meta.arg.pluginId];
            })
            .addCase(checkAllPluginsSecurityWithJev.pending, (state) => {
                state.isCheckingAllSecurity = true;
            })
            .addCase(checkAllPluginsSecurityWithJev.fulfilled, (state) => {
                state.isCheckingAllSecurity = false;
            })
            .addCase(checkAllPluginsSecurityWithJev.rejected, (state) => {
                state.isCheckingAllSecurity = false;
            });
    },
});

export const {
    syncThisPluginId,
    syncSettings,
    syncPluginManifests,
    togglePluginSelection,
    toggleSelectAllPlugins,
    pluginUpdateStatusChange,
    acknowledgedPluginUpdateResults,
    githubRateLimit,
} = obsidianStateSlice.actions;
export default obsidianStateSlice.reducer;
