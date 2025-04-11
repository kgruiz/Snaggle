// Import module functions
import * as ChatExporter from './modules/chat_exporter';
import * as GitHubDownloader from './modules/github_downloader';
import * as GeneralExporter from './modules/general_exporter';

// Use declare for TurndownService loaded globally
declare var TurndownService: any; // Using 'any' type for simplicity

// Use chrome.* APIs with types
const api = chrome;

// --- Type Definitions (Unified Result Type) ---
interface GitHubFileItem { path: string; type: 'file' | 'dir'; name: string; }
interface RepoInfo { owner: string; repo: string; ref: string; apiPath: string; }
interface BackgroundMessage {
    action: 'downloadFile' | 'createAndDownloadZip';
    url?: string;
    filename?: string;
    filesToFetch?: GitHubFileItem[];
    repoInfo?: RepoInfo;
}
interface BackgroundResponse {
    success: boolean;
    error?: string;
    downloadId?: number;
}
// Base interface for results from content scripts
interface ExtractionResultBase {
    error?: string; // All results can potentially have an error
}
// Specific result type for chat extraction
interface ChatExtractionResult extends ExtractionResultBase {
    content: string;
    filename: string; // Chat exporter should always provide filename
    requiresMarkdownConversion?: boolean;
}
// Specific result type for general page extraction
interface PageExtractionResult extends ExtractionResultBase {
    content: string;
    requiresMarkdownConversion?: boolean;
}
// Combined type for executeScript results (adjust if needed)
type ScriptResultData = ChatExtractionResult | PageExtractionResult;

interface InjectionResult<T> {
    frameId: number;
    result: T | null; // The actual result from the executed function OR null if execution failed in frame
    error?: unknown; // Optional error property if injection itself failed? Check Chrome docs.
}
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

// --- Utility Functions ---
function showSection(sectionId: string): void {
    if (loadingDiv) loadingDiv.hidden = true;
    if (chatSection) chatSection.hidden = true;
    if (githubSection) githubSection.hidden = true;
    if (generalSection) generalSection.hidden = true;
    if (unsupportedSection) unsupportedSection.hidden = true;
    if (errorSection) errorSection.hidden = true;
    const section = document.getElementById(sectionId);
    if (section) section.hidden = false;
    else showError(`Internal error: Section ID "${sectionId}" not found.`);
}
function showError(message: string): void {
    if (errorMessageP) errorMessageP.textContent = message;
    const errSect = document.getElementById('error-section');
    if (errSect) errSect.hidden = false;
    else console.error("Snaggle Error: Error section element not found.");
    console.error("Snaggle Error:", message);
}
function showLoading(message: string = "Loading..."): void { if (loadingDiv) { loadingDiv.textContent = message; loadingDiv.hidden = false; } }
function getActiveTab(): Promise<chrome.tabs.Tab> {
    return api.tabs.query({ active: true, currentWindow: true })
        .then(tabs => {
            if (tabs?.[0]?.id && tabs?.[0]?.url) { return tabs[0]; }
            throw new Error("Could not get active tab information (missing ID or URL).");
        });
}
function sanitizeFilename(name: string | undefined | null): string {
    if (!name) return "untitled";
    const reserved = /[<>:"/\\|?*\u0000-\u001F]/g; const whitespaceAndDots = /[\s._]+/g; const trimEdges = /^[._\s]+|[._\s]+$/g;
    let sanitized = name.replace(reserved, '_').replace(whitespaceAndDots, '_').replace(trimEdges, '');
    return (sanitized || "untitled").substring(0, 150);
}

// --- Main Logic ---
document.addEventListener('DOMContentLoaded', async () => {
    showLoading("Detecting site...");
    let activeTab: chrome.tabs.Tab | undefined;
    try {
        activeTab = await getActiveTab();
        const url = activeTab.url as string; // Checked in getActiveTab
        console.log("Snaggle: Current URL:", url, "Tab ID:", activeTab.id);

        if (!url.startsWith('http:') && !url.startsWith('https:') && !url.startsWith('file:')) {
             showError(`Cannot operate on this page protocol. URL: ${url.substring(0, 50)}...`);
             return;
        }

        if (ChatExporter.isChatSite(url)) { showSection('chat-exporter'); setupChatListeners(activeTab); }
        else if (GitHubDownloader.isGitHubRepoPage(url)) { showSection('github-downloader'); setupGitHubListeners(activeTab, url); }
        else if (GeneralExporter.isGeneralSite(url)) { showSection('general-exporter'); setupGeneralListeners(activeTab); }
        else { showSection('unsupported-site'); }
    } catch (error: any) {
        showError(`Snaggle: Initialization failed: ${error?.message ?? 'Unknown error'}`);
    } finally {
        if (loadingDiv && loadingDiv.hidden === false && chatSection?.hidden && githubSection?.hidden && generalSection?.hidden && unsupportedSection?.hidden && errorSection?.hidden) {
             loadingDiv.hidden = true;
         }
         if (errorSection && !errorSection.hidden && loadingDiv) { loadingDiv.hidden = true; }
    }
});

// --- Event Listener Setups ---
function setupChatListeners(tab: chrome.tabs.Tab): void {
    document.getElementById('chat-txt')?.addEventListener('click', () => handleChatExport(tab, 'txt'));
    document.getElementById('chat-md')?.addEventListener('click', () => handleChatExport(tab, 'md'));
    document.getElementById('chat-json')?.addEventListener('click', () => handleChatExport(tab, 'json'));
}

function setupGitHubListeners(tab: chrome.tabs.Tab, url: string): void {
    // Get elements directly here, not via removed helper functions
    const downloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null;
    const selectAllCheckbox = document.getElementById('github-select-all') as HTMLInputElement | null;
    const fileTreeContainer = document.getElementById('github-file-tree') as HTMLDivElement | null;

    if(!downloadButton || !selectAllCheckbox || !fileTreeContainer) { showError("GitHub UI elements missing."); return; }

    downloadButton.addEventListener('click', () => handleGitHubDownload(tab, url));
    // Type the event parameter
    selectAllCheckbox.addEventListener('change', (event: Event) => {
        GitHubDownloader.toggleSelectAll((event.target as HTMLInputElement).checked);
        downloadButton.disabled = GitHubDownloader.getSelectedItems().length === 0;
    });
     // Type the event parameter
     fileTreeContainer.addEventListener('change', (event: Event) => {
         const target = event.target as HTMLElement | null; // Use type assertion
         if (target?.matches('input[type="checkbox"]') && target !== selectAllCheckbox) {
            const anySelected = GitHubDownloader.getSelectedItems().length > 0;
            downloadButton.disabled = !anySelected;
            selectAllCheckbox.checked = anySelected && GitHubDownloader.areAllSelected();
         }
     });
    GitHubDownloader.displayFileTree(tab, url);
}

function setupGeneralListeners(tab: chrome.tabs.Tab): void {
    document.getElementById('general-pdf')?.addEventListener('click', () => handleGeneralExport(tab, 'pdf'));
    document.getElementById('general-md')?.addEventListener('click', () => handleGeneralExport(tab, 'md'));
    document.getElementById('general-txt')?.addEventListener('click', () => handleGeneralExport(tab, 'txt'));
}

// --- Action Handlers ---

async function handleChatExport(tab: chrome.tabs.Tab, format: 'txt' | 'md' | 'json'): Promise<void> {
    showLoading(`Exporting chat as ${format.toUpperCase()}...`);
    if (!tab.id) { showError("Tab ID missing for chat export."); return; }
    try {
        // Expect ChatExtractionResult specifically
        const results = await api.scripting.executeScript<[typeof format], ChatExtractionResult>({
            target: { tabId: tab.id },
            func: (fmt) => ChatExporter.extractChatData(fmt),
            args: [format]
        });

        const injectionResult = results?.[0];
        const resultData = injectionResult?.result; // This is ChatExtractionResult | null | undefined

        // Check resultData existence before accessing its properties
        if (!resultData) {
             // Construct a more informative error if possible
             const errorDetail = (injectionResult as any)?.error?.message || "Chat script execution failed or returned no result.";
            throw new Error(errorDetail);
        }
        if (resultData.error) throw new Error(resultData.error);

        // Destructure - filename is guaranteed by ChatExtractionResult if no error
        const { content, filename, requiresMarkdownConversion } = resultData;

        let finalContent = content;
        if (format === 'md' && requiresMarkdownConversion) {
            if (typeof TurndownService !== 'undefined') {
                finalContent = GeneralExporter.convertHtmlToMarkdown(content);
            } else {
                console.warn("Snaggle: Turndown unavailable for chat MD.");
                finalContent = "<!-- Turndown library missing -->\n\n" + content;
            }
        }

        triggerDownload(finalContent, sanitizeFilename(filename));
        if (loadingDiv) loadingDiv.textContent = "Download started!";
        setTimeout(() => window.close(), 1500);

    } catch (error: any) {
        showError(`Snaggle: Chat export failed: ${error?.message ?? 'Unknown error'}`);
        if (loadingDiv) loadingDiv.hidden = true;
    }
}

async function handleGitHubDownload(tab: chrome.tabs.Tab, url: string): Promise<void> {
     const downloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null;
     if (!downloadButton) return; // Guard

     const selectedItems = GitHubDownloader.getSelectedItems();
     if (selectedItems.length === 0) { alert("Please select files/folders."); return; }
     downloadButton.disabled = true;
     downloadButton.textContent = 'Zipping...';
     showLoading("Preparing download...");
     try {
         const repoInfo = GitHubDownloader.parseRepoUrl(url);
         let baseName = repoInfo.repo + (selectedItems.length === 1 ? '-' + sanitizeFilename(selectedItems[0].name) : '-selection');
         const filename = sanitizeFilename(`${baseName}-${Date.now()}.zip`);

         const response = await api.runtime.sendMessage<BackgroundMessage, BackgroundResponse>({
             action: 'createAndDownloadZip',
             filesToFetch: selectedItems,
             repoInfo: repoInfo,
             filename: filename
         });

         if (response?.success) {
             console.log('Snaggle: ZIP download initiated.');
             if (loadingDiv) loadingDiv.textContent = "Download started!";
             setTimeout(() => window.close(), 1500);
         } else {
             if(api.runtime.lastError) throw new Error(api.runtime.lastError.message);
             throw new Error(response?.error || 'Unknown error during ZIP creation.');
         }
     } catch (error: any) {
         showError(`Snaggle: GitHub download error: ${error?.message ?? 'Unknown error'}`);
         // Check downloadButton still exists before accessing it
         const currentDownloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null;
         if(currentDownloadButton) {
             currentDownloadButton.disabled = GitHubDownloader.getSelectedItems().length === 0;
             currentDownloadButton.textContent = 'Download Selected (.zip)';
         }
     } finally {
        if (!window.closed && loadingDiv) { loadingDiv.hidden = true; }
     }
 }

async function handleGeneralExport(tab: chrome.tabs.Tab, format: 'pdf' | 'txt' | 'md'): Promise<void> {
     showLoading(`Exporting page as ${format.toUpperCase()}...`);
     if (!tab.id) { showError("Tab ID missing for general export."); return; }
     try {
         const pageTitle = tab.title || 'page';
         const baseFilename = sanitizeFilename(pageTitle);

         if (format === 'pdf') {
             showLoading("Opening Print Dialog...");
             await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.print(); } });
             console.log("Snaggle: Print dialog requested.");
             setTimeout(() => window.close(), 500);
             return;
         } else if (format === 'txt' || format === 'md') {
             // Use wrapper func, expect PageExtractionResult
             const results = await api.scripting.executeScript<[typeof format], PageExtractionResult>({
                 target: { tabId: tab.id },
                 func: (fmt) => GeneralExporter.extractPageData(fmt),
                 args: [format]
             });

             const injectionResult = results?.[0];
             const extracted = injectionResult?.result; // This is PageExtractionResult | null | undefined

              // Check extracted existence before accessing properties
             if (!extracted) {
                 const errorDetail = (injectionResult as any)?.error?.message || "General script execution failed or returned no result.";
                 throw new Error(errorDetail);
             }
             if (extracted.error) throw new Error(extracted.error);

             // Destructure from the result object
             let content = extracted.content; // Guaranteed if no error
             const requiresMarkdownConversion = extracted.requiresMarkdownConversion;

             if (format === 'md' && requiresMarkdownConversion) {
                 if (typeof TurndownService !== 'undefined') {
                     content = GeneralExporter.convertHtmlToMarkdown(content);
                 } else {
                      console.warn("Snaggle: Turndown unavailable for general MD.");
                      content = "<!-- Turndown library missing -->\n\n" + content;
                 }
             }
             const filename = `${baseFilename}.${format}`;
             const mimeType = format === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8';
             triggerDownload(content, filename, mimeType);
             if (loadingDiv) loadingDiv.textContent = "Download started!";
             setTimeout(() => window.close(), 1500);
         } else {
             // Should not be reachable due to format typing, but keep for safety
             throw new Error(`Unsupported export format: ${format}`);
         }
     } catch (error: any) {
         showError(`Snaggle: General export failed: ${error?.message ?? 'Unknown error'}`);
         if (loadingDiv) loadingDiv.hidden = true;
     }
 }

// triggerDownload (Types added previously)
function triggerDownload(content: string, filename: string, mimeType: string = 'text/plain;charset=utf-8'): void {
    try {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        api.runtime.sendMessage<BackgroundMessage, BackgroundResponse>({
            action: 'downloadFile', url: url, filename: filename
        }).then(response => {
            if (response?.success) {
                console.log(`Snaggle: Download ${filename} initiated via background.`);
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                if(api.runtime.lastError){ showError(`Download failed: ${api.runtime.lastError.message}`); }
                else { showError(`Download failed: ${response?.error || 'Unknown error'}`); }
                URL.revokeObjectURL(url);
            }
        }).catch((err: Error) => {
            showError(`Snaggle: Error sending download message: ${err.message}`);
            URL.revokeObjectURL(url);
        });
    } catch(error: any) {
         showError(`Snaggle: Failed to prepare download content: ${error?.message ?? 'Unknown error'}`);
    }
}