jest.mock('obsidian', () => ({
    requestUrl: jest.fn(),
}));

import { requestUrl } from 'obsidian';
import { PluginDiffPayload } from './githubDiff';
import { evaluatePluginDiffWithJev, parseSystemOneResponse } from './jevSecurityCheck';

const SAMPLE_DIFF: PluginDiffPayload = {
    repoPath: 'org/sample-plugin',
    fromVersion: '1.0.0',
    toVersion: '1.0.1',
    compareUrl: 'https://github.com/org/sample-plugin/compare/1.0.0...1.0.1',
    sourceKind: 'github-compare',
    commitMessages: ['fix: minor css tweak'],
    changedFiles: ['styles.css'],
    skippedFiles: [],
    signals: [],
    tamperWarnings: [],
    diffText: '--- styles.css ---\n+color: var(--text-normal);',
    truncated: false,
};

describe('jevSecurityCheck', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('auto-approves low-risk github-compare updates when enabled', () => {
        const review = parseSystemOneResponse(
            JSON.stringify({
                model: 'jev-1.14.0',
                answers: {
                    new_network_calls: { type: 'noul', noul: 0.02 },
                    sensitive_local_access: { type: 'noul', noul: 0.01 },
                    supply_chain_risk: { type: 'noul', noul: 0.01 },
                    risk_score: { type: 'score', score: 0.15, confidence: 0.92 },
                    recommendation: { type: 'choice', choice: 'approve', confidence: 0.95 },
                },
                usage: { input_tokens: 1000 },
            }),
            {
                pluginId: 'sample-plugin',
                diff: SAMPLE_DIFF,
                autoApproveLowRiskUpdates: true,
                reviewedAt: '2026-11-24T15:00:00.000Z',
            }
        );

        expect(review.approved).toBe(true);
        expect(review.recommendation).toBe('approve');
        expect(review.riskScore).toBe(0.15);
        expect(review.estimatedUsd).toBeCloseTo(0.000042, 8);
    });

    it('never auto-approves when only release notes were available or tamper warnings exist', () => {
        const notesOnly = parseSystemOneResponse(
            JSON.stringify({
                answers: {
                    new_network_calls: { type: 'noul', noul: 0.02 },
                    sensitive_local_access: { type: 'noul', noul: 0.01 },
                    supply_chain_risk: { type: 'noul', noul: 0.01 },
                    risk_score: { type: 'score', score: 0.1, confidence: 0.9 },
                    recommendation: { type: 'choice', choice: 'approve', confidence: 0.9 },
                },
                usage: { input_tokens: 200 },
            }),
            {
                pluginId: 'sample-plugin',
                diff: { ...SAMPLE_DIFF, sourceKind: 'release-notes-only' },
                autoApproveLowRiskUpdates: true,
            }
        );

        expect(notesOnly.approved).toBe(false);

        const tampered = parseSystemOneResponse(
            JSON.stringify({
                answers: {
                    new_network_calls: { type: 'noul', noul: 0.02 },
                    sensitive_local_access: { type: 'noul', noul: 0.01 },
                    supply_chain_risk: { type: 'noul', noul: 0.01 },
                    risk_score: { type: 'score', score: 0.1, confidence: 0.9 },
                    recommendation: { type: 'choice', choice: 'approve', confidence: 0.9 },
                },
                usage: { input_tokens: 200 },
            }),
            {
                pluginId: 'sample-plugin',
                diff: {
                    ...SAMPLE_DIFF,
                    sourceKind: 'github-compare+bundle',
                    tamperWarnings: ['Release main.js introduces external host "evil.test"'],
                },
                autoApproveLowRiskUpdates: true,
            }
        );

        expect(tampered.approved).toBe(false);
    });

    it('auto-approves release-bundle-diff when within risk score threshold', () => {
        const review = parseSystemOneResponse(
            JSON.stringify({
                answers: {
                    new_network_calls: { type: 'noul', noul: 0.08 },
                    sensitive_local_access: { type: 'noul', noul: 0.07 },
                    supply_chain_risk: { type: 'noul', noul: 0.05 },
                    risk_score: { type: 'score', score: 1.1, confidence: 0.85 },
                    recommendation: { type: 'choice', choice: 'approve', confidence: 0.9 },
                },
                usage: { input_tokens: 450 },
            }),
            {
                pluginId: 'bases-lock',
                diff: { ...SAMPLE_DIFF, sourceKind: 'release-bundle-diff' },
                autoApproveLowRiskUpdates: true,
                maxAutoApproveRiskScore: 1.5,
            }
        );

        expect(review.approved).toBe(true);
    });

    it('calls TypeSafe System One via requestUrl with Bearer header', async () => {
        const mockedRequestUrl = requestUrl as jest.Mock;
        mockedRequestUrl.mockResolvedValueOnce({
            status: 200,
            headers: {},
            text: JSON.stringify({
                answers: {
                    new_network_calls: { type: 'noul', noul: 0.91 },
                    sensitive_local_access: { type: 'noul', noul: 0.88 },
                    supply_chain_risk: { type: 'noul', noul: 0.5 },
                    risk_score: { type: 'score', score: 2.9, confidence: 0.99 },
                    recommendation: { type: 'choice', choice: 'block', confidence: 0.99 },
                },
                usage: { input_tokens: 500 },
            }),
        });

        const result = await evaluatePluginDiffWithJev({
            apiKey: 'ts_test_key',
            pluginId: 'sample-plugin',
            pluginName: 'Sample Plugin',
            diff: SAMPLE_DIFF,
            autoApproveLowRiskUpdates: true,
        });

        expect(result.recommendation).toBe('block');
        expect(result.approved).toBe(false);
        expect(mockedRequestUrl).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://api.typesafe.ai/v1/systemone',
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer ts_test_key',
                }),
            })
        );
    });
});
