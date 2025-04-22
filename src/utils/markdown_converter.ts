// src/utils/markdown_converter.ts

// Import TurndownService statically from npm package
import TurndownService from 'turndown';

/**
 * Converts HTML string to Markdown using TurndownService.
 * Assumes TurndownService is available in the execution context (background script).
 * @param htmlContent HTML string to convert.
 * @returns Markdown string or an error message with raw HTML on failure.
 */
export function convertHtmlToMarkdown(htmlContent: string): string {
    // Skip conversion if no DOM is available (e.g., background service worker)
    if (typeof document === 'undefined') {
        console.warn("Snaggle Background: document is not available, skipping Markdown conversion.");
        return htmlContent;
    }
    if (typeof TurndownService === 'undefined') {
        console.error("Snaggle Background: Turndown library is not loaded for Markdown conversion.");
        // Return original HTML wrapped in a code block as a fallback
        return "```html\n<!-- Turndown library was not available for conversion -->\n" + htmlContent + "\n```";
    }
    try {
         const turndownOptions: any = {
             headingStyle: 'atx', hr: '---', bulletListMarker: '*',
             codeBlockStyle: 'fenced', emDelimiter: '_', strongDelimiter: '**',
             linkStyle: 'inlined'
             // Add more options here if needed, e.g., for tables, code blocks, etc.
         };
         const turndownService = new TurndownService(turndownOptions);

         // Optional: Add rules for specific elements if needed
         // turndownService.addRule('strikethrough', {
         //   filter: ['del', 's', 'strike'],
         //   replacement: function (content) {
         //     return '~~' + content + '~~';
         //   }
         // });

         const markdown: string = turndownService.turndown(htmlContent);
         console.log("Snaggle Background: Markdown conversion successful.");
         return markdown;
    } catch (error: any) {
         console.error("Snaggle Background: Turndown HTML to Markdown conversion failed:", error);
         // Return an error message including the raw HTML for debugging
         return `## Markdown Conversion Failed\n\nError: ${error?.message ?? 'Unknown error'}\n\n### Raw HTML:\n\n` + "```html\n" + htmlContent + "\n```";
    }
}