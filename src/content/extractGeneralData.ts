// src/content/extractGeneralData.ts

// Define the expected result structure directly in this file
interface PageExtractionResult {
    content: string;
    error?: string;
    requiresMarkdownConversion?: boolean;
}

// This function runs in the content script context of the target page.
// It must return the data that chrome.scripting.executeScript expects.
// NOTE: Currently hardcoded to 'md' format for testing file injection.
// Dynamic format passing requires messaging (a more advanced pattern).
function extractDataForInjection(): PageExtractionResult {
    const format = 'md'; // Hardcoded format for this test
    console.log(`Snaggle Content Script (File): extractDataForInjection called with format: ${format}`);

    try {
        let content: string = "";
        let requiresMarkdownConversion: boolean = false;

        if (!document.body) {
            console.error("Snaggle Content Script (File): document.body not found!");
            throw new Error("Document body not found.");
        }

        // --- Removed unnecessary check since format is hardcoded ---
        // if (format === 'txt') {
        //     // Although format is hardcoded to 'md', keep txt logic for completeness
        //     console.log("Snaggle Content Script (File): Extracting as TXT using body.innerText");
        //     content = (document.body.innerText ?? document.documentElement?.innerText ?? "").trim();
        //      if (!content) {
        //          console.warn("Snaggle Content Script (File): TXT extraction resulted in empty content.");
        //      }
        // } else
        // --- End Removed Check ---

        // Logic will always run the 'md' path currently
        if (format === 'md') {
             console.log("Snaggle Content Script (File): Extracting as MD, searching for main content node...");
            const contentNodeSource: Element | null =
                document.querySelector('main') ||
                document.querySelector('article') ||
                document.querySelector('[role="main"]') ||
                document.body;

            if (contentNodeSource) {
                 console.log(`Snaggle Content Script (File): Found content node source: ${contentNodeSource.tagName}${contentNodeSource.id ? '#'+contentNodeSource.id : ''}`);
                 const contentNode: Node = contentNodeSource.cloneNode(true);
                 console.log("Snaggle Content Script (File): Cloned content node.");

                 const selectorsToRemove: string[] = [
                     'script', 'style', 'link', 'meta', 'noscript', 'svg', 'iframe',
                     'header', 'footer', 'nav', 'aside', '[role="banner"]',
                     '[role="contentinfo"]', '[role="navigation"]', '[role="complementary"]',
                     'button', 'input', 'select', 'textarea', '.advertisement', '.ad',
                     '#ad', '[class*="banner"]', '.popup', '.modal', '#cookie-notice',
                     '.cookie-consent'
                 ];

                 if (contentNode instanceof Element) {
                    console.log("Snaggle Content Script (File): Cleaning cloned Element node...");
                    let removedCount = 0;
                    contentNode.querySelectorAll<Element>(selectorsToRemove.join(', '))
                               .forEach((el: Element) => { el.remove(); removedCount++; });
                    console.log(`Snaggle Content Script (File): Removed ${removedCount} elements during cleaning.`);
                    content = contentNode.innerHTML.trim();
                    requiresMarkdownConversion = true;
                    console.log(`Snaggle Content Script (File): Extracted HTML content length: ${content.length}`);
                 } else {
                     console.warn("Snaggle Content Script (File): Cloned content node was not an Element. Attempting textContent.");
                     content = contentNode.textContent?.trim() ?? "";
                     requiresMarkdownConversion = false;
                 }
            } else {
                console.error("Snaggle Content Script (File): Could not identify any content node source (main, article, body).");
                throw new Error("Could not identify page content (body/main/article not found?).");
            }
        } else {
             // Fallback for other formats if format wasn't hardcoded
             console.warn(`Snaggle Content Script (File): Unexpected format encountered: ${format}`);
             return { content: "", error: `Unsupported format: ${format}` };
        }

        console.log("Snaggle Content Script (File): Extraction successful.");
        return { content, requiresMarkdownConversion }; // Return the result

    } catch (error: any) {
        console.error("Snaggle Content Script (File): Error during extraction:", error);
        // Return error within the object
        return { content: "", error: `Failed to extract page data: ${error?.message ?? 'Unknown error'}` };
    }
}

// IMPORTANT: To return the result from executeScript using file injection,
// the *last expression evaluated* in the file should be the value you want to return.
extractDataForInjection();