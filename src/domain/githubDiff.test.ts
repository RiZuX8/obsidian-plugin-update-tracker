jest.mock('obsidian', () => ({
    requestUrl: jest.fn(),
}));

import { requestUrl } from 'obsidian';
import {
    buildTagCandidates,
    extractSecuritySignalsFromDiff,
    fetchPluginUpdateDiff,
    parseGithubRepoPath,
    selectRelevantChangedFiles,
} from './githubDiff';

describe('githubDiff', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('normalizes GitHub repository URLs and owner/repo paths', () => {
        expect(parseGithubRepoPath('swar8080/obsidian-plugin-update-tracker')).toBe(
            'swar8080/obsidian-plugin-update-tracker'
        );
        expect(
            parseGithubRepoPath('https://github.com/blacksmithgu/obsidian-dataview.git')
        ).toBe('blacksmithgu/obsidian-dataview');
        expect(parseGithubRepoPath('https://gitlab.com/foo/bar')).toBeNull();
    });

    it('builds tag candidates with and without v prefix', () => {
        expect(buildTagCandidates('1.5.2')).toEqual(['1.5.2', 'v1.5.2']);
        expect(buildTagCandidates('v1.5.2')).toEqual(['v1.5.2', '1.5.2']);
    });

    it('skips lockfiles and bundled main.js when unbundled source files exist', () => {
        const result = selectRelevantChangedFiles([
            { filename: 'package-lock.json', patch: '+lockfile noise' },
            { filename: 'main.js', patch: '+minified bundle' },
            { filename: 'src/main.ts', patch: '+console.log("hi")' },
            { filename: 'manifest.json', patch: '+"version": "1.2.0"' },
        ]);

        expect(result.includedFiles).toEqual(['manifest.json', 'src/main.ts']);
        expect(result.skippedFiles).toContain('package-lock.json');
        expect(result.skippedFiles).toContain('main.js');
        expect(result.diffText).toContain('src/main.ts');
        expect(result.truncated).toBe(false);
    });

    it('includes main.js when no unbundled source files changed', () => {
        const result = selectRelevantChangedFiles([
            { filename: 'main.js', patch: '+requestUrl("https://example.com")' },
        ]);

        expect(result.includedFiles).toEqual(['main.js']);
        expect(result.diffText).toContain('requestUrl');
    });

    it('extracts concrete security and network signals from added lines only', () => {
        const diff = [
            '- fetch("https://old.example/ignored")',
            '+ const res = await fetch("https://telemetry.evil.test/ping");',
            '+ const secret = process.env.MY_KEY;',
            '+ execSync("whoami");',
        ].join('\n');

        const signals = extractSecuritySignalsFromDiff(diff);
        expect(signals).toContain('fetch()');
        expect(signals).toContain('process.env access');
        expect(signals).toContain('child_process / shell exec');
        expect(signals).toContain('Added URL hosts: telemetry.evil.test');
    });

    it('falls back to v-prefixed tag compare when bare version compare returns 404', async () => {
        const mockedRequestUrl = requestUrl as jest.Mock;
        mockedRequestUrl
            .mockResolvedValueOnce({ status: 404, headers: {}, text: '' })
            .mockResolvedValueOnce({
                status: 200,
                headers: {},
                text: JSON.stringify({
                    html_url: 'https://github.com/org/repo/compare/v1.0.0...v1.0.1',
                    commits: [{ commit: { message: 'fix: handle edge case' } }],
                    files: [
                        {
                            filename: 'src/main.ts',
                            status: 'modified',
                            additions: 2,
                            deletions: 1,
                            patch: '@@ -1 +1 @@\n+const ok = true;',
                        },
                    ],
                }),
            });

        const diff = await fetchPluginUpdateDiff({
            repoPath: 'org/repo',
            fromVersion: '1.0.0',
            toVersion: '1.0.1',
        });

        expect(diff.sourceKind).toBe('github-compare');
        expect(diff.changedFiles).toEqual(['src/main.ts']);
        expect(diff.commitMessages).toEqual(['fix: handle edge case']);
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
    });

    it('falls back gracefully to release-notes-only when compare tags do not exist', async () => {
        const mockedRequestUrl = requestUrl as jest.Mock;
        mockedRequestUrl
            .mockResolvedValueOnce({ status: 404, headers: {}, text: '' })
            .mockResolvedValueOnce({ status: 404, headers: {}, text: '' })
            .mockResolvedValueOnce({ status: 200, headers: {}, text: '[]' });

        const diff = await fetchPluginUpdateDiff({
            repoPath: 'org/repo',
            fromVersion: '1.0.0',
            toVersion: '1.0.1',
            fallbackNotes: 'Bugfixes only.',
        });

        expect(diff.sourceKind).toBe('release-notes-only');
        expect(diff.diffText).toContain('Bugfixes only.');
    });
});
