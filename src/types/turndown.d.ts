// src/types/turndown.d.ts
// Type declarations for the 'turndown' module
// Provides basic typing for converting HTML to Markdown.
declare module 'turndown' {
  /** Converts HTML strings to Markdown. */
  export default class TurndownService {
    /**
     * Create a TurndownService instance.
     * @param options Optional configuration object.
     */
    constructor(options?: any);

    /**
     * Convert an HTML string to Markdown string.
     * @param input HTML content to convert.
     */
    turndown(input: string): string;
  }
}