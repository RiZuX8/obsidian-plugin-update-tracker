import { AbstractInputSuggest, App, TFile, TFolder } from 'obsidian';
import { DEFAULT_CHECKLIST_NOTE_PATH } from '../domain/pluginSettings';

export type ChecklistPathSuggestion = {
    path: string;
    label: string;
};

function isProtectedDiaryPath(path: string): boolean {
    return path === 'Diary' || path.startsWith('Diary/');
}

function getDefaultChecklistFilename(defaultNotePath: string): string {
    const slashIdx = defaultNotePath.lastIndexOf('/');
    return slashIdx >= 0 ? defaultNotePath.slice(slashIdx + 1) : defaultNotePath;
}

/**
 * Autocomplete vault Markdown files and folders for the security checklist note path setting.
 * Excludes Diary paths for privacy.
 */
export class ChecklistPathSuggest extends AbstractInputSuggest<ChecklistPathSuggestion> {
    private readonly vaultApp: App;
    private readonly onSelectPath: (path: string) => void;
    private readonly defaultFilename: string;

    constructor(
        app: App,
        inputEl: HTMLInputElement,
        onSelectPath: (path: string) => void
    ) {
        super(app, inputEl);
        this.vaultApp = app;
        this.onSelectPath = onSelectPath;
        this.defaultFilename = getDefaultChecklistFilename(DEFAULT_CHECKLIST_NOTE_PATH);
    }

    getSuggestions(inputStr: string): ChecklistPathSuggestion[] {
        const query = inputStr.trim().toLowerCase();
        const suggestions: ChecklistPathSuggestion[] = [];
        const seenPaths = new Set<string>();

        const markdownFiles = this.vaultApp.vault.getMarkdownFiles();
        for (const file of markdownFiles) {
            if (isProtectedDiaryPath(file.path)) continue;
            if (!query || file.path.toLowerCase().includes(query)) {
                seenPaths.add(file.path);
                suggestions.push({ path: file.path, label: file.path });
            }
        }

        const loadedFiles = this.vaultApp.vault.getAllLoadedFiles();
        for (const entry of loadedFiles) {
            if (!(entry instanceof TFolder) || entry.isRoot()) continue;
            if (isProtectedDiaryPath(entry.path)) continue;

            const candidatePath = `${entry.path}/${this.defaultFilename}`;
            if (seenPaths.has(candidatePath)) continue;

            if (
                !query ||
                entry.path.toLowerCase().includes(query) ||
                candidatePath.toLowerCase().includes(query)
            ) {
                seenPaths.add(candidatePath);
                suggestions.push({
                    path: candidatePath,
                    label: `${candidatePath} (new in ${entry.path}/)`,
                });
            }
        }

        return suggestions.slice(0, 25);
    }

    renderSuggestion(item: ChecklistPathSuggestion, el: HTMLElement): void {
        el.setText(item.label);
    }

    selectSuggestion(item: ChecklistPathSuggestion): void {
        this.setValue(item.path);
        this.onSelectPath(item.path);
        this.close();
    }
}
