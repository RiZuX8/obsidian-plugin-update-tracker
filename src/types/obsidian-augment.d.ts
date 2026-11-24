import 'obsidian';

declare module 'obsidian' {
    export abstract class AbstractInputSuggest<T> extends PopoverSuggest<T> {
        limit: number;
        protected app: App;
        constructor(app: App, textInputEl: HTMLInputElement | HTMLDivElement);
        setValue(value: string): void;
        getValue(): string;
        abstract getSuggestions(query: string): T[] | Promise<T[]>;
    }
}
