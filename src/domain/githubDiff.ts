import { requestUrl } from 'obsidian';
import { getReleaseAsset } from './api';
import {
    analyzeMainJsBundleDiff,
    BundleDiffAnalysis,
    detectBundleTamperMismatch,
} from './bundleDiff';
import { DiffSourceKind } from './pluginSettings';

export type GithubCompareFile = {
    filename: string;
    status?: string;
    additions?: number;
    deletions?: number;
    patch?: string;
};

export type PluginDiffPayload = {
    repoPath: string;
    fromVersion: string;
    toVersion: string;
    compareUrl: string;
    sourceKind: DiffSourceKind;
    commitMessages: string[];
    changedFiles: string[];
    skippedFiles: string[];
    signals: string[];
    tamperWarnings: string[];
    diffText: string;
    truncated: boolean;
};

const DEFAULT_MAX_DIFF_CHARS = 22000;

const LOCKFILE_NAMES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'bun.lockb',
    'npm-shrinkwrap.json',
]);

const SIGNAL_PATTERNS: { label: string; pattern: RegExp }[] = [
    { label: 'fetch()', pattern: /\bfetch\s*\(/ },
    { label: 'requestUrl / request', pattern: /\brequestUrl\s*\(|\brequest\s*\(/ },
    { label: 'XMLHttpRequest / WebSocket', pattern: /\bXMLHttpRequest\b|\bnew\s+WebSocket\b/ },
    { label: 'eval / new Function', pattern: /\beval\s*\(|\bnew\s+Function\b/ },
    { label: 'child_process / shell exec', pattern: /\bchild_process\b|\bexecSync\b|\bexec\s*\(|\bspawn\s*\(/ },
    { label: 'process.env access', pattern: /\bprocess\.env\b/ },
    { label: 'Node fs access', pattern: /['"](?:node:)?fs(?:\/promises)?['"]|\bfs\.(?:readFile|writeFile|unlink|rm)/ },
    { label: 'Vault adapter / bulk read', pattern: /\bvault\.adapter\b|\bgetMarkdownFiles\b|\bcachedRead\b/ },
    { label: 'Browser storage / cookies', pattern: /\bdocument\.cookie\b|\blocalStorage\b/ },
];

/**
 * Normalize a GitHub repo URL or `owner/repo` string into `owner/repo`.
 */
export function parseGithubRepoPath(repoUrlOrPath: string): string | null {
    const trimmed = repoUrlOrPath.trim();
    if (!trimmed) return null;

    const githubMatch = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+\/[^/\s#?]+)/i.exec(trimmed);
    if (githubMatch) {
        return githubMatch[1].replace(/\.git$/i, '');
    }

    if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
        return trimmed.replace(/\.git$/i, '');
    }

    return null;
}

/**
 * Generate tag name candidates (`1.2.3` vs `v1.2.3`) for GitHub compare lookups.
 */
export function buildTagCandidates(version: string): string[] {
    const clean = version.trim();
    if (!clean) return [];
    if (clean.startsWith('v') || clean.startsWith('V')) {
        const bare = clean.slice(1);
        return bare ? [clean, bare] : [clean];
    }
    return [clean, `v${clean}`];
}

function getBaseFilename(filePath: string): string {
    const idx = filePath.lastIndexOf('/');
    return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

function isLockOrMapOrBinary(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    const base = getBaseFilename(lower);
    if (LOCKFILE_NAMES.has(base)) return true;
    if (lower.endsWith('.map') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.svg')) {
        return true;
    }
    return false;
}

function isBundledOutputFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (
        lower === 'main.js' ||
        lower.endsWith('.min.js') ||
        lower.startsWith('dist/') ||
        lower.startsWith('build/')
    );
}

function isSourceCodeFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    if (isBundledOutputFile(lower) || isLockOrMapOrBinary(lower)) return false;
    return (
        lower.endsWith('.ts') ||
        lower.endsWith('.tsx') ||
        lower.endsWith('.svelte') ||
        lower.endsWith('.js') ||
        lower.endsWith('.mjs') ||
        lower.endsWith('.cjs') ||
        lower === 'manifest.json' ||
        lower === 'package.json'
    );
}

function filePriority(filePath: string): number {
    const lower = filePath.toLowerCase();
    if (lower === 'manifest.json' || lower === 'package.json') return 0;
    if (lower.startsWith('src/')) return 1;
    if (isSourceCodeFile(lower)) return 2;
    if (lower.endsWith('.css') || lower.endsWith('.json')) return 3;
    return 4;
}

/**
 * Filter, prioritize, and truncate changed files from GitHub Compare so Jev inspects real source code.
 */
export function selectRelevantChangedFiles(
    files: GithubCompareFile[],
    maxDiffChars: number = DEFAULT_MAX_DIFF_CHARS
): {
    diffText: string;
    includedFiles: string[];
    skippedFiles: string[];
    truncated: boolean;
} {
    const hasUnbundledSource = files.some((f) => isSourceCodeFile(f.filename));
    const candidates: GithubCompareFile[] = [];
    const skippedFiles: string[] = [];

    for (const file of files) {
        if (isLockOrMapOrBinary(file.filename)) {
            skippedFiles.push(file.filename);
            continue;
        }
        if (hasUnbundledSource && isBundledOutputFile(file.filename)) {
            skippedFiles.push(file.filename);
            continue;
        }
        candidates.push(file);
    }

    candidates.sort((a, b) => {
        const pDiff = filePriority(a.filename) - filePriority(b.filename);
        if (pDiff !== 0) return pDiff;
        return a.filename.localeCompare(b.filename);
    });

    const parts: string[] = [];
    const includedFiles: string[] = [];
    let currentLen = 0;
    let truncated = false;

    for (const file of candidates) {
        const header = `--- ${file.filename} (${file.status || 'modified'}, +${file.additions ?? 0}/-${file.deletions ?? 0}) ---`;
        const body = file.patch
            ? file.patch
            : '[Patch unavailable from GitHub for this file (likely binary or oversized)]';
        const block = `${header}\n${body}\n`;

        if (currentLen + block.length > maxDiffChars) {
            const remaining = maxDiffChars - currentLen;
            if (remaining > 350) {
                parts.push(block.slice(0, remaining) + '\n... [truncated for token budget]');
                includedFiles.push(file.filename);
            } else {
                skippedFiles.push(file.filename);
            }
            truncated = true;
            break;
        }

        parts.push(block);
        includedFiles.push(file.filename);
        currentLen += block.length + 1;
    }

    return {
        diffText: parts.join('\n'),
        includedFiles,
        skippedFiles,
        truncated,
    };
}

/**
 * Scan added (`+`) diff lines for concrete security/network/execution markers.
 */
export function extractSecuritySignalsFromDiff(diffText: string): string[] {
    const foundSignals = new Set<string>();
    const externalHosts = new Set<string>();
    const lines = diffText.split('\n');

    for (const line of lines) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        const content = line.slice(1);

        for (const entry of SIGNAL_PATTERNS) {
            if (entry.pattern.test(content)) {
                foundSignals.add(entry.label);
            }
        }

        const urlMatches = content.match(/https?:\/\/([a-zA-Z0-9.-]+)/g);
        if (urlMatches) {
            for (const url of urlMatches) {
                const host = url.replace(/^https?:\/\//, '');
                if (host) externalHosts.add(host);
            }
        }
    }

    if (externalHosts.size > 0) {
        const hostList = Array.from(externalHosts).slice(0, 6).join(', ');
        foundSignals.add(`Added URL hosts: ${hostList}`);
    }

    return Array.from(foundSignals);
}

type GithubCompareApiResponse = {
    html_url?: string;
    commits?: { commit?: { message?: string } }[];
    files?: GithubCompareFile[];
};

type GithubReleaseTagEntry = {
    tag_name?: string;
};

function parseGithubCompareJson(rawText: string): GithubCompareApiResponse {
    const parsed: unknown = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Unexpected GitHub compare response format');
    }
    return parsed as GithubCompareApiResponse;
}

function buildGithubHeaders(githubToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'obsidian-plugin-update-tracker-custom',
    };
    const token = githubToken?.trim();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function tryGithubCompare(
    repoPath: string,
    baseTag: string,
    headTag: string,
    headers: Record<string, string>
): Promise<{ status: number; data?: GithubCompareApiResponse; rateLimitReset?: string }> {
    const url = `https://api.github.com/repos/${repoPath}/compare/${encodeURIComponent(
        baseTag
    )}...${encodeURIComponent(headTag)}`;
    const res = await requestUrl({
        url,
        method: 'GET',
        headers,
        throw: false,
    });

    if (res.status === 200) {
        return { status: 200, data: parseGithubCompareJson(res.text) };
    }
    if (res.status === 403 || res.status === 429) {
        return {
            status: res.status,
            rateLimitReset: res.headers['x-ratelimit-reset'],
        };
    }
    return { status: res.status };
}

async function resolveCompareTagsFromReleases(
    repoPath: string,
    fromVersion: string,
    toVersion: string,
    headers: Record<string, string>
): Promise<{ baseTag: string; headTag: string } | null> {
    const res = await requestUrl({
        url: `https://api.github.com/repos/${repoPath}/releases?per_page=30`,
        method: 'GET',
        headers,
        throw: false,
    });
    if (res.status !== 200) return null;

    const parsed: unknown = JSON.parse(res.text);
    if (!Array.isArray(parsed)) return null;

    const matchVersion = (tag: string, target: string): boolean => {
        const normTag = tag.replace(/^v/i, '');
        const normTarget = target.replace(/^v/i, '');
        return normTag === normTarget;
    };

    let baseTag: string | undefined;
    let headTag: string | undefined;
    for (const item of parsed as GithubReleaseTagEntry[]) {
        if (!item.tag_name) continue;
        if (!baseTag && matchVersion(item.tag_name, fromVersion)) baseTag = item.tag_name;
        if (!headTag && matchVersion(item.tag_name, toVersion)) headTag = item.tag_name;
    }

    if (baseTag && headTag) return { baseTag, headTag };
    return null;
}

function formatBundleSection(bundle: BundleDiffAnalysis): string {
    const parts = [
        `Installed vs release main.js size: ${bundle.oldBytes} -> ${bundle.newBytes} bytes`,
        bundle.addedHosts.length > 0
            ? `New hosts in release main.js: ${bundle.addedHosts.join(', ')}`
            : 'New hosts in release main.js: none',
        bundle.addedApiSignals.length > 0
            ? `API count deltas in release main.js: ${bundle.addedApiSignals.join(', ')}`
            : 'API count deltas in release main.js: none',
        bundle.addedSnippetsText
            ? `Added statements in release main.js:\n${bundle.addedSnippetsText}`
            : 'No new executable statements detected in release main.js.',
    ];
    return parts.join('\n');
}

/**
 * Fetch source changes between `fromVersion` and `toVersion` via GitHub Compare API,
 * and cross-check the shipped release `main.js` asset against the installed `main.js`
 * so code injected outside git tags or missing tags is still inspected.
 */
export async function fetchPluginUpdateDiff(params: {
    repoPath: string;
    fromVersion: string;
    toVersion: string;
    githubToken?: string;
    fallbackNotes?: string;
    mainJsAssetId?: number;
    installedMainJs?: string | null;
}): Promise<PluginDiffPayload> {
    const normalizedRepo = parseGithubRepoPath(params.repoPath);
    if (!normalizedRepo) {
        throw new Error(`Invalid GitHub repository path: ${params.repoPath}`);
    }

    const headers = buildGithubHeaders(params.githubToken);
    const fromCandidates = buildTagCandidates(params.fromVersion);
    const toCandidates = buildTagCandidates(params.toVersion);

    const pairsToTry: { baseTag: string; headTag: string }[] = [];
    for (let i = 0; i < Math.max(fromCandidates.length, toCandidates.length); i++) {
        const baseTag = fromCandidates[i] ?? fromCandidates[0];
        const headTag = toCandidates[i] ?? toCandidates[0];
        if (baseTag && headTag) {
            pairsToTry.push({ baseTag, headTag });
        }
    }

    let compareData: GithubCompareApiResponse | undefined;
    for (const pair of pairsToTry) {
        const attempt = await tryGithubCompare(
            normalizedRepo,
            pair.baseTag,
            pair.headTag,
            headers
        );
        if (attempt.status === 403 || attempt.status === 429) {
            throw new Error(
                'GitHub API rate limit reached. Add an optional GitHub token in settings to inspect more diffs.'
            );
        }
        if (attempt.data) {
            compareData = attempt.data;
            break;
        }
    }

    if (!compareData) {
        const resolved = await resolveCompareTagsFromReleases(
            normalizedRepo,
            params.fromVersion,
            params.toVersion,
            headers
        );
        if (resolved) {
            const attempt = await tryGithubCompare(
                normalizedRepo,
                resolved.baseTag,
                resolved.headTag,
                headers
            );
            if (attempt.data) {
                compareData = attempt.data;
            }
        }
    }

    let bundleAnalysis: BundleDiffAnalysis | undefined;
    if (params.mainJsAssetId) {
        try {
            const assetRes = await getReleaseAsset(
                params.mainJsAssetId,
                normalizedRepo,
                params.githubToken
            );
            if (assetRes.success && typeof assetRes.fileContents === 'string') {
                bundleAnalysis = analyzeMainJsBundleDiff(
                    params.installedMainJs ?? null,
                    assetRes.fileContents
                );
            }
        } catch {
            // Release asset download failed; continue with compare/notes fallback
        }
    }

    const defaultCompareUrl = `https://github.com/${normalizedRepo}/compare/${params.fromVersion}...${params.toVersion}#files_bucket`;

    if (compareData && Array.isArray(compareData.files)) {
        const commitMessages = (compareData.commits || [])
            .map((c) => c.commit?.message?.split('\n')[0]?.trim() || '')
            .filter(Boolean)
            .slice(0, 25);

        const selected = selectRelevantChangedFiles(compareData.files);
        const sourceDiff = selected.diffText || '[No source file patches available in GitHub compare]';
        const signals = extractSecuritySignalsFromDiff(selected.diffText);
        const tamperWarnings = bundleAnalysis
            ? detectBundleTamperMismatch(selected.diffText, bundleAnalysis)
            : [];

        if (bundleAnalysis) {
            for (const apiSig of bundleAnalysis.addedApiSignals) {
                if (!signals.includes(apiSig)) signals.push(`Bundle ${apiSig}`);
            }
            if (bundleAnalysis.addedHosts.length > 0) {
                signals.push(`Bundle new hosts: ${bundleAnalysis.addedHosts.slice(0, 6).join(', ')}`);
            }
        }

        const combinedDiffText = bundleAnalysis
            ? `${sourceDiff}\n\n=== Release main.js bundle cross-check ===\n${formatBundleSection(bundleAnalysis)}`
            : sourceDiff;

        return {
            repoPath: normalizedRepo,
            fromVersion: params.fromVersion,
            toVersion: params.toVersion,
            compareUrl: compareData.html_url || defaultCompareUrl,
            sourceKind: bundleAnalysis ? 'github-compare+bundle' : 'github-compare',
            commitMessages,
            changedFiles: bundleAnalysis
                ? [...selected.includedFiles, 'release-asset/main.js']
                : selected.includedFiles,
            skippedFiles: selected.skippedFiles,
            signals: [...tamperWarnings, ...signals],
            tamperWarnings,
            diffText: combinedDiffText,
            truncated: selected.truncated || Boolean(bundleAnalysis?.truncated),
        };
    }

    const fallbackBody = (params.fallbackNotes || '').trim() || 'No release notes provided.';
    if (bundleAnalysis) {
        const signals: string[] = [
            'GitHub source compare tags unavailable; inspected executable release main.js diff directly',
            ...bundleAnalysis.addedApiSignals.map((sig) => `Bundle ${sig}`),
        ];
        if (bundleAnalysis.addedHosts.length > 0) {
            signals.push(`Bundle new hosts: ${bundleAnalysis.addedHosts.slice(0, 6).join(', ')}`);
        }

        return {
            repoPath: normalizedRepo,
            fromVersion: params.fromVersion,
            toVersion: params.toVersion,
            compareUrl: defaultCompareUrl,
            sourceKind: 'release-bundle-diff',
            commitMessages: [],
            changedFiles: ['release-asset/main.js'],
            skippedFiles: [],
            signals,
            tamperWarnings: [],
            diffText: `=== Release main.js bundle diff (tags unavailable) ===\n${formatBundleSection(
                bundleAnalysis
            )}\n\nRelease notes:\n${fallbackBody.slice(0, 3000)}`,
            truncated: bundleAnalysis.truncated || fallbackBody.length > 3000,
        };
    }

    return {
        repoPath: normalizedRepo,
        fromVersion: params.fromVersion,
        toVersion: params.toVersion,
        compareUrl: defaultCompareUrl,
        sourceKind: 'release-notes-only',
        commitMessages: [],
        changedFiles: [],
        skippedFiles: [],
        signals: ['Source code diff and release main.js unavailable'],
        tamperWarnings: [],
        diffText: `Source code diff unavailable between ${params.fromVersion} and ${params.toVersion}.\nRelease notes:\n${fallbackBody.slice(0, 8000)}`,
        truncated: fallbackBody.length > 8000,
    };
}
