import TurndownService from 'turndown'; // Import type

// Ensure TurndownService is loaded globally via script tag in popup.html
declare var TurndownService: typeof import('turndown');

// Interface for return type
interface PageExtractionResult {
    content: string;
    error?: string;
    requiresMarkdownConversion?: boolean;
}

// Typed parameter
export function isGeneralSite(url: string): boolean {
     try {
        const protocol = new URL(url).protocol;
        return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
    } catch (e) {
        return false; // Invalid URL
    }
}

// Function executed IN THE CONTEXT OF THE WEBPAGE
// Add type for parameter and return value
export function extractPageData(format: 'txt' | 'md'): PageExtractionResult {
    try {
        let content: string = "";
        let requiresMarkdownConversion: boolean = false;

        if (format === 'txt') {
            // Use optional chaining and nullish coalescing
            content = (document.body?.innerText ?? document.documentElement?.innerText ?? "").trim();
        } else if (format === 'md') {
            // Type the source element
            const contentNodeSource: Element | null =
                document.querySelector('main') ||
                document.querySelector('article') ||
                document.querySelector('[role="main"]') ||
                document.body; // Fallback to body

            if (contentNodeSource) {
                 // Type the cloned node
                 const contentNode: Node = contentNodeSource.cloneNode(true);

                 // Basic Cleaning (Type querySelectorAll elements)
                 const selectorsToRemove: string[] = [ /* ... same selectors ... */ ];
                 contentNode.querySelectorAll<Element>(selectorsToRemove.join(', ')).forEach(el => el.remove());

                 // Need to assert type to HTMLElement to access innerHTML
                 if (contentNode instanceof HTMLElement) {
                     content = contentNode.innerHTML.trim();
                 } else {
                      // Fallback for non-element nodes? Unlikely for body/main/article
                      console.warn("Snaggle: Content node was not an HTMLElement, cannot get innerHTML.");
                      content = contentNode.textContent?.trim() ?? ""; // Use textContent as fallback
                 }
                 requiresMarkdownConversion = true;
            } else {
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
// Add types for parameter and return value
export function convertHtmlToMarkdown(htmlContent: string): string {
    // Check if Turndown library is loaded (should be included in popup.html)
    if (typeof TurndownService === 'undefined') {
        console.error("Snaggle: Turndown library is not loaded.");
        return "```html\n<!-- Turndown library was not available -->\n" + htmlContent + "\n```";
    }

    try {
         // Initialize Turndown Service with options
         // Use the TurndownService type for constructor options
         const turndownService = new TurndownService({
             headingStyle: 'atx',
             hr: '---',
             bulletListMarker: '*',
             codeBlockStyle: 'fenced',
             emDelimiter: '_',
             strongDelimiter: '**',
             linkStyle: 'inlined'
             // Add more options from TurndownService.Options if needed
         } as TurndownService.Options); // Cast options if needed or ensure interface matches

         const markdown: string = turndownService.turndown(htmlContent);
         return markdown;

    } catch (error: any) {
         console.error("Snaggle: Turndown HTML to Markdown conversion failed:", error);
         return `## Markdown Conversion Failed\n\nError: ${error?.message ?? 'Unknown error'}\n\n### Raw HTML:\n\n` + "```html\n" + htmlContent + "\n```";
    }
}