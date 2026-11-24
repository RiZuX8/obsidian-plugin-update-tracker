import { request, requestUrl } from 'obsidian';
import { NewPluginVersionRequest, PluginReleases } from 'oput-common';

type ReleaseApi = (request: NewPluginVersionRequest) => Promise<PluginReleases[]>;

const BACKEND_API_URL =
    (process.env['OBSIDIAN_APP_UPDATE_CHECKER_URL'] || '') + '/obsidian-plugin-update-tracker';

export const getReleases: ReleaseApi = async (newPluginVersionRequest: NewPluginVersionRequest) => {
    try {
        const res: string = await request({
            url: BACKEND_API_URL,
            method: 'POST',
            body: JSON.stringify(newPluginVersionRequest),
        });
        return JSON.parse(res);
    } catch (err) {
        console.warn(
            `Failed checking for plugin updates at ${BACKEND_API_URL}. Check your internet connection and security settings or file a bug at https://github.com/swar8080/obsidian-plugin-update-tracker/issues.\nError details are:\n`,
            err
        );
        throw err;
    }
};

export const getReleaseAsset = async (
    assetId: number,
    githubRepo: string,
    githubToken?: string
): Promise<{ success: boolean; fileContents?: string; rateLimitResetTimestamp?: number }> => {
    const headers: Record<string, string> = { Accept: 'application/octet-stream' };
    const token = githubToken?.trim();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await requestUrl({
        url: `https://api.github.com/repos/${githubRepo}/releases/assets/${assetId}`,
        method: 'GET',
        headers,
        throw: false,
    });

    if (res.status === 200) {
        const fileContents = res.text;
        return { success: true, fileContents };
    } else if (
        res.headers['x-ratelimit-remaining'] === '0' &&
        res.headers['x-ratelimit-reset'] != null
    ) {
        const rateLimitResetTimestamp = parseInt(res.headers['x-ratelimit-reset']) * 1000;
        return { success: false, rateLimitResetTimestamp };
    } else {
        throw res;
    }
};
