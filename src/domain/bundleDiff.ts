export type BundleDiffAnalysis = {
    oldBytes: number;
    newBytes: number;
    addedHosts: string[];
    addedApiSignals: string[];
    addedSnippetsText: string;
    truncated: boolean;
};

const DEFAULT_MAX_BUNDLE_DIFF_CHARS = 12000;

const SENSITIVE_BUNDLE_PATTERNS: { label: string; critical: boolean; pattern: RegExp }[] = [
    { label: 'fetch()', critical: true, pattern: /\bfetch\s*\(/g },
    { label: 'requestUrl / request', critical: false, pattern: /\brequestUrl\s*\(/g },
    { label: 'XMLHttpRequest / WebSocket', critical: true, pattern: /\bXMLHttpRequest\b|\bnew\s+WebSocket\b/g },
    { label: 'eval / new Function', critical: true, pattern: /\beval\s*\(|\bnew\s+Function\b/g },
    {
        label: 'child_process / shell exec',
        critical: true,
        pattern: /\bchild_process\b|\bexecSync\b|\bspawnSync\b|\bspawn\s*\(/g,
    },
    { label: 'process.env access', critical: true, pattern: /\bprocess\.env\b/g },
    {
        label: 'Node fs access',
        critical: true,
        pattern: /['"](?:node:)?fs(?:\/promises)?['"]|\bfs\.(?:readFile|writeFile|unlink|rm)/g,
    },
    {
        label: 'Vault adapter / bulk read',
        critical: false,
        pattern: /\bvault\.adapter\b|\bgetMarkdownFiles\b|\bcachedRead\b/g,
    },
    {
        label: 'Base64 / dynamic decode',
        critical: false,
        pattern: /\batob\s*\(|Buffer\.from\s*\(/g,
    },
    {
        label: 'Browser storage / cookies',
        critical: true,
        pattern: /\bdocument\.cookie\b|\blocalStorage\b/g,
    },
];

/**
 * Split formatted or minified JS bundle text into comparable statement chunks.
 */
export function splitBundleStatements(code: string): string[] {
    const rawLines = code.split(/\r?\n/);
    const chunks: string[] = [];

    for (const rawLine of rawLines) {
        const line = rawLine.trim();
        if (!line) continue;

        const parts = line.split(/[;{}]+/);
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed) {
                chunks.push(trimmed);
            }
        }
    }

    return chunks;
}

function extractHosts(code: string): Set<string> {
    const hosts = new Set<string>();
    const matches = code.match(/https?:\/\/([a-zA-Z0-9.-]+)/g);
    if (!matches) return hosts;

    for (const url of matches) {
        const host = url.replace(/^https?:\/\//, '').toLowerCase();
        if (host) hosts.add(host);
    }
    return hosts;
}

function countPatternMatches(code: string, pattern: RegExp): number {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const clone = new RegExp(pattern.source, flags);
    let count = 0;
    while (clone.exec(code) !== null) {
        count++;
    }
    return count;
}

function isPrioritySecurityChunk(chunk: string): boolean {
    if (/https?:\/\//i.test(chunk)) return true;
    return SENSITIVE_BUNDLE_PATTERNS.some((entry) => {
        const clone = new RegExp(entry.pattern.source);
        return clone.test(chunk);
    });
}

function truncateChunk(chunk: string, maxLen: number = 360): string {
    if (chunk.length <= maxLen) return chunk;
    return `${chunk.slice(0, maxLen)} ... [trimmed ${chunk.length - maxLen} chars]`;
}

/**
 * Compute added hosts, API deltas, and newly introduced code chunks between
 * the currently installed `main.js` and the release `main.js` asset.
 */
export function analyzeMainJsBundleDiff(
    oldCode: string | null,
    newCode: string,
    maxChars: number = DEFAULT_MAX_BUNDLE_DIFF_CHARS
): BundleDiffAnalysis {
    const oldBytes = oldCode ? oldCode.length : 0;
    const newBytes = newCode.length;

    const oldHosts = oldCode ? extractHosts(oldCode) : new Set<string>();
    const newHosts = extractHosts(newCode);
    const addedHosts = Array.from(newHosts).filter((host) => !oldHosts.has(host));

    const addedApiSignals: string[] = [];
    for (const entry of SENSITIVE_BUNDLE_PATTERNS) {
        const oldCount = oldCode ? countPatternMatches(oldCode, entry.pattern) : 0;
        const newCount = countPatternMatches(newCode, entry.pattern);
        if (newCount > oldCount) {
            addedApiSignals.push(`${entry.label} (+${newCount - oldCount})`);
        }
    }

    const oldChunks = new Set(oldCode ? splitBundleStatements(oldCode) : []);
    const newChunks = splitBundleStatements(newCode);

    const priorityChunks: string[] = [];
    const regularChunks: string[] = [];
    const seenAdded = new Set<string>();

    for (const chunk of newChunks) {
        if (oldChunks.has(chunk) || seenAdded.has(chunk)) continue;
        seenAdded.add(chunk);

        if (isPrioritySecurityChunk(chunk)) {
            priorityChunks.push(chunk);
        } else {
            regularChunks.push(chunk);
        }
    }

    const ordered = [...priorityChunks, ...regularChunks];
    const outputLines: string[] = [];
    let currentLen = 0;
    let truncated = false;

    for (const chunk of ordered) {
        const line = `+ ${truncateChunk(chunk)}`;
        if (currentLen + line.length + 1 > maxChars) {
            truncated = true;
            break;
        }
        outputLines.push(line);
        currentLen += line.length + 1;
    }

    return {
        oldBytes,
        newBytes,
        addedHosts: addedHosts.slice(0, 20),
        addedApiSignals,
        addedSnippetsText: outputLines.join('\n'),
        truncated,
    };
}

/**
 * Cross-check GitHub source compare diff against the actual release `main.js` diff
 * to detect suspicious code injected directly into the release artifact outside git tags.
 */
export function detectBundleTamperMismatch(
    sourceDiffText: string | null,
    bundleAnalysis: BundleDiffAnalysis
): string[] {
    if (!sourceDiffText) return [];

    const warnings: string[] = [];
    const addedSourceLines = sourceDiffText
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .join('\n');
    const addedSourceLower = addedSourceLines.toLowerCase();

    for (const host of bundleAnalysis.addedHosts) {
        if (!addedSourceLower.includes(host.toLowerCase())) {
            warnings.push(
                `Release main.js introduces external host "${host}" not found in GitHub source diff`
            );
        }
    }

    for (const entry of SENSITIVE_BUNDLE_PATTERNS) {
        if (!entry.critical) continue;
        const bundleHasDelta = bundleAnalysis.addedApiSignals.some((sig) =>
            sig.startsWith(entry.label)
        );
        if (!bundleHasDelta) continue;

        const clone = new RegExp(entry.pattern.source);
        if (!clone.test(addedSourceLines)) {
            warnings.push(
                `Release main.js adds ${entry.label} not found in GitHub source diff`
            );
        }
    }

    return warnings;
}
