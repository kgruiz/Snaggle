// src/modules/general_exporter.ts

// Interface for return type
interface PageExtractionResult {
    content: string;
    error?: string;
    requiresMarkdownConversion?: boolean;
}

// isGeneralSite function removed - it's now in src/utils/site_checkers.ts
// convertHtmlToMarkdown function removed - it's now in src/utils/markdown_converter.ts

// Function executed IN THE CONTEXT OF THE WEBPAGE via scripting.executeScript
export function extractPageData(format: 'txt' | 'md'): PageExtractionResult {
    console.log(`Snaggle Content Script: extractPageData called with format: ${format}`);
    try {
        let content: string = "";
        let requiresMarkdownConversion: boolean = false;

        // Check if running in a context with 'document'
        if (typeof document === 'undefined' || !document.body) {
            console.error("Snaggle Content Script: document.body is not accessible!");
            throw new Error("Document body not found or not accessible.");
        }

        if (format === 'txt') {
            console.log("Snaggle Content Script: Extracting as TXT using body.innerText");
            // Use optional chaining for safety, although document.body check should cover it
            content = (document.body?.innerText ?? document.documentElement?.innerText ?? "").trim();
             if (!content) {
                 console.warn("Snaggle Content Script: TXT extraction resulted in empty content.");
             }
             requiresMarkdownConversion = false; // TXT format never needs conversion
        } else if (format === 'md') {
             console.log("Snaggle Content Script: Extracting as MD, searching for main content node...");
            // Attempt to find the most relevant content area
            const contentNodeSource: Element | null =
                document.querySelector('main') ||
                document.querySelector('article') ||
                document.querySelector('[role="main"]') ||
                document.body; // Fallback to the entire body

            if (contentNodeSource) {
                 console.log(`Snaggle Content Script: Found content node source: ${contentNodeSource.tagName}${contentNodeSource.id ? '#'+contentNodeSource.id : ''}`);
                 // Clone the node to avoid modifying the live page
                 const contentNode: Node = contentNodeSource.cloneNode(true);
                 console.log("Snaggle Content Script: Cloned content node.");

                 // Selectors for elements to remove from the cloned node
                 const selectorsToRemove: string[] = [
                     'script', 'style', 'link', 'meta', 'noscript', 'svg', 'iframe',
                     'header', 'footer', 'nav', 'aside', '[role="banner"]',
                     '[role="contentinfo"]', '[role="navigation"]', '[role="complementary"]',
                     'button', 'input', 'select', 'textarea', '.advertisement', '.ad',
                     '#ad', '[class*="banner"]', '.popup', '.modal', '#cookie-notice',
                     '.cookie-consent',
                     // Add more selectors for common noise if needed
                     '.sidebar', '#sidebar', '.related-posts', '.comments', '#comments',
                     '.social-share', '.print-button'
                 ];

                 // Ensure contentNode is an Element before using querySelectorAll
                 if (contentNode instanceof Element) {
                    console.log("Snaggle Content Script: Cleaning cloned Element node...");
                    let removedCount = 0;
                    contentNode.querySelectorAll<Element>(selectorsToRemove.join(', '))
                               .forEach((el: Element) => {
                                   el.remove();
                                   removedCount++;
                                });
                    console.log(`Snaggle Content Script: Removed ${removedCount} elements during cleaning.`);

                    // Get the innerHTML of the cleaned node for Markdown conversion
                    content = contentNode.innerHTML.trim();
                    requiresMarkdownConversion = true; // Signal that Turndown conversion is needed
                    console.log(`Snaggle Content Script: Extracted HTML content length: ${content.length}`);

                 } else {
                     // Fallback if the cloned node isn't an element (should be rare)
                     console.warn("Snaggle Content Script: Cloned content node was not an Element. Attempting textContent.");
                     content = contentNode.textContent?.trim() ?? "";
                     requiresMarkdownConversion = false; // No conversion needed for textContent
                     console.log(`Snaggle Content Script: Extracted textContent length: ${content.length}`);
                 }

            } else {
                // This should not happen if document.body exists
                console.error("Snaggle Content Script: Could not identify any content node source (main, article, body).");
                throw new Error("Could not identify page content (body/main/article not found?).");
            }
        } else {
             // Should not be reachable with current background logic
             console.warn(`Snaggle Content Script: Received unexpected format: ${format}`);
             return { content: "", error: `Unsupported format requested: ${format}` };
        }

        // Check if extraction resulted in empty content
        if (!content) {
            console.warn("Snaggle Content Script: Extraction resulted in empty content after processing.");
        }

        console.log("Snaggle Content Script: Extraction successful.");
        return {
            content: content,
            requiresMarkdownConversion: requiresMarkdownConversion
        };

    } catch (error: any) {
        console.error("Snaggle Content Script: Error during extraction:", error);
        return { content: "", error: `Failed to extract page data: ${error?.message ?? 'Unknown error'}` };
    }
}