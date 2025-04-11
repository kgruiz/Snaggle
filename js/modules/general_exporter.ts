// Declare TurndownService as loaded globally via script tag in popup.html
// Using 'any' for simplicity if precise types from @types/turndown cause issues
declare var TurndownService: any;

// Interface for return type
interface PageExtractionResult {
    content: string;
    error?: string;
    requiresMarkdownConversion?: boolean;
}

export function isGeneralSite(url: string): boolean {
     try {
        const protocol = new URL(url).protocol;
        return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
    } catch (e) { return false; }
}

// Function executed IN THE CONTEXT OF THE WEBPAGE
export function extractPageData(format: 'txt' | 'md'): PageExtractionResult {
    try {
        let content: string = "";
        let requiresMarkdownConversion: boolean = false;

        if (format === 'txt') {
            content = (document.body?.innerText ?? document.documentElement?.innerText ?? "").trim();
        } else if (format === 'md') {
            const contentNodeSource: Element | null =
                document.querySelector('main') ||
                document.querySelector('article') ||
                document.querySelector('[role="main"]') ||
                document.body;

            if (contentNodeSource) {
                 const contentNode: Node = contentNodeSource.cloneNode(true);
                 const selectorsToRemove: string[] = [
                     'script', 'style', 'link', 'meta', 'noscript', 'svg', 'iframe',
                     'header', 'footer', 'nav', 'aside', '[role="banner"]',
                     '[role="contentinfo"]', '[role="navigation"]', '[role="complementary"]',
                     'button', 'input', 'select', 'textarea', '.advertisement', '.ad',
                     '#ad', '[class*="banner"]', '.popup', '.modal', '#cookie-notice',
                     '.cookie-consent'
                 ];

                 // Check if contentNode is an Element before calling DOM methods
                 if (contentNode instanceof Element) {
                    contentNode.querySelectorAll<Element>(selectorsToRemove.join(', '))
                               .forEach((el: Element) => el.remove()); // Type 'el'
                    content = contentNode.innerHTML.trim(); // Access innerHTML safely
                    requiresMarkdownConversion = true;
                 } else if (contentNode instanceof HTMLElement) { // Fallback for other node types?
                     console.warn("Snaggle: Content node was not an Element, using textContent.");
                     content = contentNode.textContent?.trim() ?? "";
                     requiresMarkdownConversion = false; // Probably don't convert textContent
                 } else {
                     console.warn("Snaggle: Cloned content node was not an Element or HTMLElement.");
                     content = ""; // Default to empty
                 }
            } else {
                // This should theoretically not happen if document.body exists
                throw new Error("Could not identify page content (body not found?).");
            }
        } else {
             // This case should technically not be reachable if called correctly
             return { content: "", error: `Unsupported format requested: ${format}` };
        }

        return {
            content: content,
            requiresMarkdownConversion: requiresMarkdownConversion
        };

    } catch (error: any) {
        console.error("Snaggle General Extraction Error:", error);
        return { content: "", error: `Failed to extract page data: ${error?.message ?? 'Unknown error'}` };
    }
}


// This function runs in popup.js AFTER getting HTML content from extractPageData
export function convertHtmlToMarkdown(htmlContent: string): string {
    if (typeof TurndownService === 'undefined') {
        console.error("Snaggle: Turndown library is not loaded.");
        return "```html\n<!-- Turndown library was not available -->\n" + htmlContent + "\n```";
    }
    try {
         // Type options explicitly if possible, or use 'any' if types conflict
         const turndownOptions: any = { // Using any for simplicity here
             headingStyle: 'atx', hr: '---', bulletListMarker: '*',
             codeBlockStyle: 'fenced', emDelimiter: '_', strongDelimiter: '**',
             linkStyle: 'inlined'
         };
         const turndownService = new TurndownService(turndownOptions);
         const markdown: string = turndownService.turndown(htmlContent);
         return markdown;
    } catch (error: any) {
         console.error("Snaggle: Turndown HTML to Markdown conversion failed:", error);
         return `## Markdown Conversion Failed\n\nError: ${error?.message ?? 'Unknown error'}\n\n### Raw HTML:\n\n` + "```html\n" + htmlContent + "\n```";
    }
}