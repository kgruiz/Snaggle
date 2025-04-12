// Declare TurndownService as loaded globally via script tag in popup.html
declare var TurndownService: any; // Using 'any' type for simplicity

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
    // --- Log entry into the content script function ---
    console.log(`Snaggle Content Script: extractPageData called with format: ${format}`);
    try {
        let content: string = "";
        let requiresMarkdownConversion: boolean = false;

        if (!document.body) {
            console.error("Snaggle Content Script: document.body is null or undefined!");
            throw new Error("Document body not found.");
        }

        if (format === 'txt') {
            console.log("Snaggle Content Script: Extracting as TXT using body.innerText");
            content = (document.body.innerText ?? document.documentElement?.innerText ?? "").trim();
             if (!content) {
                 console.warn("Snaggle Content Script: TXT extraction resulted in empty content.");
             }
        } else if (format === 'md') {
             console.log("Snaggle Content Script: Extracting as MD, searching for main content node...");
            // Type the source element
            const contentNodeSource: Element | null =
                document.querySelector('main') ||
                document.querySelector('article') ||
                document.querySelector('[role="main"]') ||
                document.body; // Fallback to body

            if (contentNodeSource) {
                 console.log(`Snaggle Content Script: Found content node source: ${contentNodeSource.tagName}${contentNodeSource.id ? '#'+contentNodeSource.id : ''}`);
                 const contentNode: Node = contentNodeSource.cloneNode(true);
                 console.log("Snaggle Content Script: Cloned content node.");

                 const selectorsToRemove: string[] = [
                     'script', 'style', 'link', 'meta', 'noscript', 'svg', 'iframe',
                     'header', 'footer', 'nav', 'aside', '[role="banner"]',
                     '[role="contentinfo"]', '[role="navigation"]', '[role="complementary"]',
                     'button', 'input', 'select', 'textarea', '.advertisement', '.ad',
                     '#ad', '[class*="banner"]', '.popup', '.modal', '#cookie-notice',
                     '.cookie-consent'
                 ];

                 // Ensure contentNode is an Element before calling querySelectorAll
                 if (contentNode instanceof Element) {
                    console.log("Snaggle Content Script: Cleaning cloned Element node...");
                    let removedCount = 0;
                    contentNode.querySelectorAll<Element>(selectorsToRemove.join(', '))
                               .forEach((el: Element) => {
                                   el.remove();
                                   removedCount++;
                                });
                    console.log(`Snaggle Content Script: Removed ${removedCount} elements during cleaning.`);
                    content = contentNode.innerHTML.trim();
                    requiresMarkdownConversion = true;
                    console.log(`Snaggle Content Script: Extracted HTML content length: ${content.length}`);

                 } else {
                     // This case should be rare if we start from body/main/article
                     console.warn("Snaggle Content Script: Cloned content node was not an Element. Attempting textContent.");
                     content = contentNode.textContent?.trim() ?? "";
                     requiresMarkdownConversion = false;
                     console.log(`Snaggle Content Script: Extracted textContent length: ${content.length}`);
                 }

            } else {
                // Should not happen as document.body should exist
                console.error("Snaggle Content Script: Could not identify any content node source (main, article, body).");
                throw new Error("Could not identify page content (body/main/article not found?).");
            }
        } else {
             // This case should technically not be reachable if called correctly
             console.warn(`Snaggle Content Script: Received unexpected format: ${format}`);
             return { content: "", error: `Unsupported format requested: ${format}` };
        }

        console.log("Snaggle Content Script: Extraction successful.");
        return {
            content: content,
            requiresMarkdownConversion: requiresMarkdownConversion
        };

    } catch (error: any) {
        // --- Log the specific error occurring inside the content script ---
        console.error("Snaggle Content Script: Error during extraction:", error);
        return { content: "", error: `Failed to extract page data: ${error?.message ?? 'Unknown error'}` };
    }
}


// This function runs in popup.js AFTER getting HTML content from extractPageData
export function convertHtmlToMarkdown(htmlContent: string): string {
    // No changes needed here, but keep for completeness
    if (typeof TurndownService === 'undefined') {
        console.error("Snaggle: Turndown library is not loaded.");
        return "```html\n<!-- Turndown library was not available -->\n" + htmlContent + "\n```";
    }
    try {
         const turndownOptions: any = {
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