jest.mock('obsidian', () => {
    class MockTFile {
        path: string;
        constructor(path: string) {
            this.path = path;
        }
    }
    class MockTFolder {
        path: string;
        private rootFlag: boolean;
        constructor(path: string, isRoot = false) {
            this.path = path;
            this.rootFlag = isRoot;
        }
        isRoot() {
            return this.rootFlag;
        }
    }
    abstract class MockAbstractInputSuggest<T> {
        app: any;
        inputEl: any;
        constructor(app: any, inputEl: any) {
            this.app = app;
            this.inputEl = inputEl;
        }
        setValue(val: string) {
            this.inputEl.value = val;
        }
        close() {}
    }
    return {
        AbstractInputSuggest: MockAbstractInputSuggest,
        TFile: MockTFile,
        TFolder: MockTFolder,
    };
});

import { App, TFile, TFolder } from 'obsidian';
import { ChecklistPathSuggest } from './ChecklistPathSuggest';

describe('ChecklistPathSuggest', () => {
    function createSuggest(onSelect = jest.fn()) {
        const files = [
            new (TFile as any)('Assets/Plugin Update Security Checklist.md'),
            new (TFile as any)('Diary/2026-11-24.md'),
            new (TFile as any)('Todo OB.md'),
        ];
        const folders = [
            new (TFolder as any)('', true),
            new (TFolder as any)('Assets'),
            new (TFolder as any)('Diary'),
            new (TFolder as any)('Diary/Algemeen'),
            new (TFolder as any)('Notes'),
        ];

        const app = {
            vault: {
                getMarkdownFiles: () => files,
                getAllLoadedFiles: () => [...files, ...folders],
            },
        } as unknown as App;

        const inputEl = { value: '' } as unknown as HTMLInputElement;
        const suggest = new ChecklistPathSuggest(app, inputEl, onSelect);
        return { suggest, inputEl, onSelect };
    }

    it('excludes Diary files and Diary folders from suggestions', () => {
        const { suggest } = createSuggest();
        const results = suggest.getSuggestions('');
        const paths = results.map((r) => r.path);

        expect(paths).toContain('Assets/Plugin Update Security Checklist.md');
        expect(paths).toContain('Todo OB.md');
        expect(paths).toContain('Notes/Plugin Update Security Checklist.md');
        expect(paths.some((p) => p.startsWith('Diary'))).toBe(false);
    });

    it('filters suggestions by query and triggers callback on selection', () => {
        const onSelect = jest.fn();
        const { suggest, inputEl } = createSuggest(onSelect);

        const filtered = suggest.getSuggestions('notes');
        expect(filtered).toEqual([
            {
                path: 'Notes/Plugin Update Security Checklist.md',
                label: 'Notes/Plugin Update Security Checklist.md (new in Notes/)',
            },
        ]);

        suggest.selectSuggestion(filtered[0]);
        expect(inputEl.value).toBe('Notes/Plugin Update Security Checklist.md');
        expect(onSelect).toHaveBeenCalledWith('Notes/Plugin Update Security Checklist.md');
    });
});
