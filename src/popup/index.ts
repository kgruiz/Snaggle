import './popup.css'; // Import CSS - Vite will handle this
// Import module functions
import * as ChatExporter from '../modules/chat_exporter';
import * as GitHubDownloader from '../modules/github_downloader';
import * as GeneralExporter from '../modules/general_exporter';

// Use declare for TurndownService loaded globally
declare var TurndownService: any;

// Use chrome.* APIs with types
const api = chrome;

// --- Type Definitions ---
interface GitHubFileItem { path: string; type: 'file' | 'dir'; name: string; }
interface RepoInfo { owner: string; repo: string; ref: string; apiPath: string; }
interface BackgroundMessage { action: 'downloadFile' | 'createAndDownloadZip'; url?: string; filename?: string; filesToFetch?: GitHubFileItem[]; repoInfo?: RepoInfo; }
interface BackgroundResponse { success: boolean; error?: string; downloadId?: number; }
interface ExtractionResultBase { error?: string; }
interface ChatExtractionResult extends ExtractionResultBase { content: string; filename: string; requiresMarkdownConversion?: boolean; }
interface PageExtractionResult extends ExtractionResultBase { content: string; requiresMarkdownConversion?: boolean; }
type ContentScriptResult = ChatExtractionResult | PageExtractionResult | { error: string };
type ScriptInjectionResults = chrome.scripting.InjectionResult[];
// --- End Type Definitions ---


// DOM Elements (Typed with null checks where accessed)
const loadingDiv = document.getElementById('loading') as HTMLDivElement | null;
const contentDiv = document.getElementById('content') as HTMLElement | null;
const chatSection = document.getElementById('chat-exporter') as HTMLDivElement | null;
const githubSection = document.getElementById('github-downloader') as HTMLDivElement | null;
const generalSection = document.getElementById('general-exporter') as HTMLDivElement | null;
const unsupportedSection = document.getElementById('unsupported-site') as HTMLDivElement | null;
const errorSection = document.getElementById('error-section') as HTMLDivElement | null;
const errorMessageP = document.getElementById('error-message') as HTMLParagraphElement | null;

// --- Utility Functions --- (No changes needed)
function showSection(sectionId: string): void { /* ... */ }
function showError(message: string): void { /* ... */ }
function showLoading(message: string = "Loading..."): void { /* ... */ }
function getActiveTab(): Promise<chrome.tabs.Tab> { /* ... */ return Promise.reject("Dummy"); }
function sanitizeFilename(name: string | undefined | null): string { /* ... */ return "untitled"; }

// --- Main Logic --- (No changes needed)
document.addEventListener('DOMContentLoaded', async () => { /* ... */ });

// --- Event Listener Setups --- (No changes needed)
function setupChatListeners(tab: chrome.tabs.Tab): void { /* ... */ }
function setupGitHubListeners(tab: chrome.tabs.Tab, url: string): void { /* ... */ }
function setupGeneralListeners(tab: chrome.tabs.Tab): void { /* ... */ }

// --- Action Handlers ---

async function handleChatExport(tab: chrome.tabs.Tab, format: 'txt' | 'md' | 'json'): Promise<void> {
    console.log(`Snaggle Popup: Initiating chat export for format: ${format}, Tab ID: ${tab.id}`);
    showLoading(`Exporting chat as ${format.toUpperCase()}...`);
    if (!tab.id) { showError("Tab ID missing for chat export."); return; }
    try {
        const results: ScriptInjectionResults = await api.scripting.executeScript({
            target: { tabId: tab.id },
            func: ChatExporter.extractChatData as any, // Type assertion
            args: [format]
        });

        console.log("Snaggle Popup: Chat executeScript result received:", results);
        const injectionResult = results?.[0];
        const resultData = injectionResult?.result as ChatExtractionResult | null; // Assert result type

        if (!resultData || resultData.error) {
            throw new Error(resultData?.error || "Chat script execution failed or returned no/null result.");
        }

        const { content, filename, requiresMarkdownConversion } = resultData;
        let finalContent = content;
        if (format === 'md' && requiresMarkdownConversion) { /* ... turndown logic ... */ }

        triggerDownload(finalContent, sanitizeFilename(filename));
        if (loadingDiv) loadingDiv.textContent = "Download started!";
        setTimeout(() => window.close(), 1500);

    } catch (error: any) {
        console.error("Snaggle Popup: Error in handleChatExport:", error);
        showError(`Snaggle: Chat export failed: ${error?.message ?? 'Unknown error'}`);
        if (loadingDiv) loadingDiv.hidden = true;
    }
}

async function handleGitHubDownload(tab: chrome.tabs.Tab, url: string): Promise<void> {
     const downloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null;
     if (!downloadButton) return;

     const selectedItems = GitHubDownloader.getSelectedItems();
     if (selectedItems.length === 0) { alert("Please select files/folders."); return; }
     downloadButton.disabled = true;
     downloadButton.textContent = 'Zipping...';
     showLoading("Preparing download...");
     try {
         const repoInfo = GitHubDownloader.parseRepoUrl(url);
         let baseName = repoInfo.repo + (selectedItems.length === 1 ? '-' + sanitizeFilename(selectedItems[0].name) : '-selection');
         const filename = sanitizeFilename(`${baseName}-${Date.now()}.zip`);

         // Corrected sendMessage call (no generics)
         const response = await api.runtime.sendMessage({
             action: 'createAndDownloadZip',
             filesToFetch: selectedItems,
             repoInfo: repoInfo,
             filename: filename
         });

         // Assert the type of the response received
         const typedResponse = response as BackgroundResponse | undefined;

         // Check response success based on promise resolution and response content
         if (typedResponse?.success) {
             console.log('Snaggle: ZIP download initiated.');
             if (loadingDiv) loadingDiv.textContent = "Download started!";
             setTimeout(() => window.close(), 1500);
         } else {
             // If promise resolved but success wasn't true, use the error from response
             // Removed api.runtime.lastError check
             throw new Error(typedResponse?.error || 'Unknown error during ZIP creation (promise resolved).');
         }
     } catch (error: any) { // Catch promise rejections or thrown errors
         showError(`Snaggle: GitHub download error: ${error?.message ?? 'Unknown error'}`);
         const currentDownloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null;
         if(currentDownloadButton) { /* ... reset button ... */ }
     } finally {
        if (!window.closed && loadingDiv) { loadingDiv.hidden = true; }
     }
 }

async function handleGeneralExport(tab: chrome.tabs.Tab, format: 'pdf' | 'txt' | 'md'): Promise<void> {
     console.log(`Snaggle Popup: Initiating general export for format: ${format}, Tab ID: ${tab.id}, URL: ${tab.url}`);
     showLoading(`Exporting page as ${format.toUpperCase()}...`);
     if (!tab.id) { showError("Tab ID missing for general export."); return; }
     try {
         const pageTitle = tab.title || 'page';
         const baseFilename = sanitizeFilename(pageTitle);

         if (format === 'pdf') { /* ... pdf logic ... */ return; }
         else if (format === 'txt' || format === 'md') {
             console.log(`Snaggle Popup: Injecting script FILE to extract ${format} content...`);
             // Using file injection
             const results: ScriptInjectionResults = await api.scripting.executeScript({
                 target: { tabId: tab.id },
                 files: ['src/content/extractGeneralData.ts'] // Compiled path resolved by Vite/CRXJS
             });

             console.log("Snaggle Popup: General executeScript result received:", results);
             const injectionResult = results?.[0];
             const extracted = injectionResult?.result as PageExtractionResult | null; // Assert type

             if (!extracted || extracted.error) {
                  const injectionError = (injectionResult as any)?.error;
                  throw new Error(extracted?.error || injectionError?.message || "General script execution failed or returned no/null result.");
             }

             console.log("Snaggle Popup: Script execution successful, processing content.");
             let content = extracted.content;
             const requiresMarkdownConversion = extracted.requiresMarkdownConversion;

             if (requiresMarkdownConversion) { // Check flag even if format was hardcoded in script
                 if (typeof TurndownService !== 'undefined') {
                     console.log("Snaggle Popup: Converting HTML to Markdown...");
                     content = GeneralExporter.convertHtmlToMarkdown(content);
                 } else { /* ... fallback ... */ }
             }
             const filename = `${baseFilename}.${format}`; // Use requested format for filename
             const mimeType = format === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8';
             console.log(`Snaggle Popup: Triggering download for ${filename}`);
             triggerDownload(content, filename, mimeType);
             if (loadingDiv) loadingDiv.textContent = "Download started!";
             setTimeout(() => window.close(), 1500);
         } else { throw new Error(`Unsupported export format: ${format}`); }
     } catch (error: any) {
         console.error("Snaggle Popup: Error in handleGeneralExport:", error);
         showError(`Snaggle: General export failed: ${error?.message ?? 'Unknown error'}`);
         if (loadingDiv) loadingDiv.hidden = true;
     }
 }

// triggerDownload
function triggerDownload(content: string, filename: string, mimeType: string = 'text/plain;charset=utf-8'): void {
    try {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        // Corrected sendMessage call (no generics)
        api.runtime.sendMessage({
            action: 'downloadFile', url: url, filename: filename
        })
        .then(response => {
            // Assert the type of the response received
            const typedResponse = response as BackgroundResponse | undefined;

            // Check response success based on promise resolution and response content
            if (typedResponse?.success) {
                console.log(`Snaggle: Download ${filename} initiated via background.`);
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                // If promise resolved but success wasn't true, use the error from response
                // Removed api.runtime.lastError check here
                showError(`Download failed: ${typedResponse?.error || 'Unknown error (promise resolved)'}`);
                URL.revokeObjectURL(url); // Clean up immediately on failure
            }
        }).catch((err: Error) => { // Catch promise rejections
            showError(`Snaggle: Error sending download message: ${err.message}`);
            URL.revokeObjectURL(url);
        });
    } catch(error: any) { // Catch Blob creation errors
         showError(`Snaggle: Failed to prepare download content: ${error?.message ?? 'Unknown error'}`);
    }
}

console.log("Snaggle Popup Script Loaded (Vite/TS).");