// Import module functions - TS resolves .ts automatically
import * as ChatExporter from './modules/chat_exporter';
import * as GitHubDownloader from './modules/github_downloader';
import * as GeneralExporter from './modules/general_exporter';
import TurndownService from 'turndown'; // Import type if possible

// Ensure TurndownService is loaded globally via script tag in popup.html
declare var TurndownService: typeof import('turndown');

// Use chrome.* APIs with types
const api = chrome;

// Interfaces for data structures (can be shared)
interface ExtractionResult {
    content: string;
    filename?: string; // Optional from chat extractor
    error?: string;
    requiresMarkdownConversion?: boolean;
}

// Type DOM Elements more specifically
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
    // Add null checks for elements
    if (loadingDiv) loadingDiv.hidden = true;
    if (chatSection) chatSection.hidden = true;
    if (githubSection) githubSection.hidden = true;
    if (generalSection) generalSection.hidden = true;
    if (unsupportedSection) unsupportedSection.hidden = true;
    if (errorSection) errorSection.hidden = true;

    const section = document.getElementById(sectionId);
    if (section) {
        section.hidden = false;
    } else {
        // Call showError which handles null checks for its elements
        showError(`Internal error: Section ID "${sectionId}" not found.`);
    }
}

function showError(message: string): void {
    if (errorMessageP) errorMessageP.textContent = message;
    showSection('error-section'); // Show the error section element
    console.error("Snaggle Error:", message);
}

function showLoading(message: string = "Loading..."): void {
    if (loadingDiv) {
        loadingDiv.textContent = message;
        loadingDiv.hidden = false;
    }
}

function getActiveTab(): Promise<chrome.tabs.Tab> {
    return api.tabs.query({ active: true, currentWindow: true })
        .then(tabs => {
            // Ensure tab and tab.id are valid
            if (tabs?.[0]?.id) {
                return tabs[0];
            }
            throw new Error("Could not get active tab information.");
        });
}

function sanitizeFilename(name: string | undefined | null): string {
    if (!name) return "untitled";
    // eslint-disable-next-line no-control-regex
    const reserved = /[<>:"/\\|?*\u0000-\u001F]/g;
    const whitespaceAndDots = /[\s._]+/g;
    const trimEdges = /^[._\s]+|[._\s]+$/g;
    let sanitized = name.replace(reserved, '_');
    sanitized = sanitized.replace(whitespaceAndDots, '_');
    sanitized = sanitized.replace(trimEdges, '');
    return (sanitized || "untitled").substring(0, 150);
}

// --- Main Logic ---

document.addEventListener('DOMContentLoaded', async () => {
    showLoading("Detecting site...");
    let activeTab: chrome.tabs.Tab | undefined;

    try {
        activeTab = await getActiveTab();
        // Type guard for URL
        const url = activeTab?.url;
        if (!url || (!url.startsWith('http:') && !url.startsWith('https:') && !url.startsWith('file:'))) {
             showError(`Cannot operate on this page protocol. URL: ${url ? url.substring(0, 50)+'...' : 'N/A'}`);
             return;
        }
        console.log("Snaggle: Current URL:", url, "Tab ID:", activeTab?.id);

        // Determine Site Type and Initialize UI
        if (ChatExporter.isChatSite(url)) {
            showSection('chat-exporter'); setupChatListeners(activeTab);
        } else if (GitHubDownloader.isGitHubRepoPage(url)) {
            showSection('github-downloader'); setupGitHubListeners(activeTab, url);
        } else if (GeneralExporter.isGeneralSite(url)) {
            showSection('general-exporter'); setupGeneralListeners(activeTab);
        } else {
            showSection('unsupported-site');
        }
    } catch (error: any) { // Catch error as any or unknown
        showError(`Snaggle: Initialization failed: ${error?.message ?? 'Unknown error'}`);
    } finally {
        // Ensure loading indicator is hidden if it wasn't replaced by a section/error
         if (loadingDiv && loadingDiv.hidden === false && // Only hide if still visible
            chatSection?.hidden && githubSection?.hidden && generalSection?.hidden &&
            unsupportedSection?.hidden && errorSection?.hidden)
        {
             loadingDiv.hidden = true;
         }
         if (errorSection && !errorSection.hidden) { // Ensure loading is hidden if error is shown
            if(loadingDiv) loadingDiv.hidden = true;
         }
    }
});

// --- Event Listener Setups ---
// Add type for tab parameter
function setupChatListeners(tab: chrome.tabs.Tab): void {
    document.getElementById('chat-txt')?.addEventListener('click', () => handleChatExport(tab, 'txt'));
    document.getElementById('chat-md')?.addEventListener('click', () => handleChatExport(tab, 'md'));
    document.getElementById('chat-json')?.addEventListener('click', () => handleChatExport(tab, 'json'));
}

function setupGitHubListeners(tab: chrome.tabs.Tab, url: string): void {
    const downloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null;
    const selectAllCheckbox = document.getElementById('github-select-all') as HTMLInputElement | null;
    const fileTreeContainer = document.getElementById('github-file-tree') as HTMLDivElement | null;

    if(!downloadButton || !selectAllCheckbox || !fileTreeContainer) {
        console.error("Snaggle: Missing GitHub UI elements.");
        showError("GitHub UI elements not found.");
        return;
    }

    downloadButton.addEventListener('click', () => handleGitHubDownload(tab, url));
    selectAllCheckbox.addEventListener('change', (event) => {
        GitHubDownloader.toggleSelectAll((event.target as HTMLInputElement).checked);
        downloadButton.disabled = GitHubDownloader.getSelectedItems().length === 0;
    });
     fileTreeContainer.addEventListener('change', (event) => {
         if ((event.target as HTMLElement)?.matches('input[type="checkbox"]') && event.target !== selectAllCheckbox) {
            const anySelected = GitHubDownloader.getSelectedItems().length > 0;
            downloadButton.disabled = !anySelected;
            selectAllCheckbox.checked = anySelected && GitHubDownloader.areAllSelected();
         }
     });
    GitHubDownloader.displayFileTree(tab, url); // Pass tab if needed by module, otherwise just url
}

function setupGeneralListeners(tab: chrome.tabs.Tab): void {
    document.getElementById('general-pdf')?.addEventListener('click', () => handleGeneralExport(tab, 'pdf'));
    document.getElementById('general-md')?.addEventListener('click', () => handleGeneralExport(tab, 'md'));
    document.getElementById('general-txt')?.addEventListener('click', () => handleGeneralExport(tab, 'txt'));
}

// --- Action Handlers ---

async function handleChatExport(tab: chrome.tabs.Tab, format: 'txt' | 'md' | 'json'): Promise<void> {
    showLoading(`Exporting chat as ${format.toUpperCase()}...`);
    if (!tab.id) { showError("Tab ID missing."); return; }
    try {
        const results = await api.scripting.executeScript<[string], ExtractionResult[]>({
            target: { tabId: tab.id },
            func: ChatExporter.extractChatData,
            args: [format]
        });

        // Note: Chrome's executeScript returns an array of InjectionResult objects
        const injectionResult = results?.[0];
        if (!injectionResult?.result) throw new Error(injectionResult?.result?.error || "Chat script execution failed.");

        const { content, filename = "chat-export." + format, error, requiresMarkdownConversion } = injectionResult.result;
        if (error) throw new Error(error);

        let finalContent = content;
        if (format === 'md' && requiresMarkdownConversion) {
            if (typeof TurndownService !== 'undefined') {
                finalContent = GeneralExporter.convertHtmlToMarkdown(content);
            } else {
                console.warn("Snaggle: Turndown unavailable for chat MD.");
                finalContent = "<!-- Turndown library missing -->\n\n" + content;
            }
        }

        triggerDownload(finalContent, sanitizeFilename(filename)); // Sanitize filename from content script
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

         // Type the expected response
         const response = await api.runtime.sendMessage<BackgroundMessage, { success: boolean; error?: string; downloadId?: number }>({
             action: 'createAndDownloadZip',
             filesToFetch: selectedItems,
             repoInfo: repoInfo,
             filename: filename
         });

         if (response?.success) { // Check for success property
             console.log('Snaggle: ZIP download initiated.');
             if (loadingDiv) loadingDiv.textContent = "Download started!";
             setTimeout(() => window.close(), 1500);
         } else {
             // Check lastError as well, although response should contain error ideally
             if(api.runtime.lastError) throw new Error(api.runtime.lastError.message);
             throw new Error(response?.error || 'Unknown error during ZIP creation.');
         }
     } catch (error: any) {
         showError(`Snaggle: GitHub download error: ${error?.message ?? 'Unknown error'}`);
         if(downloadButton) {
             downloadButton.disabled = GitHubDownloader.getSelectedItems().length === 0;
             downloadButton.textContent = 'Download Selected (.zip)';
         }
     } finally {
        // Ensure loadingDiv is checked for null before accessing hidden
        if (!window.closed && loadingDiv) { loadingDiv.hidden = true; }
     }
 }

async function handleGeneralExport(tab: chrome.tabs.Tab, format: 'pdf' | 'txt' | 'md'): Promise<void> {
     showLoading(`Exporting page as ${format.toUpperCase()}...`);
     if (!tab.id) { showError("Tab ID missing."); return; }
     try {
         const pageTitle = tab.title || 'page';
         const baseFilename = sanitizeFilename(pageTitle);

         if (format === 'pdf') {
             showLoading("Opening Print Dialog...");
             await api.scripting.executeScript({
                 target: { tabId: tab.id },
                 func: () => { window.print(); }
             });
             console.log("Snaggle: Print dialog requested.");
             setTimeout(() => window.close(), 500);
             return;

         } else if (format === 'txt' || format === 'md') {
             const results = await api.scripting.executeScript<[string], ExtractionResult[]>({
                 target: { tabId: tab.id },
                 func: GeneralExporter.extractPageData,
                 args: [format]
             });

             const injectionResult = results?.[0];
             if (!injectionResult?.result) throw new Error(injectionResult?.result?.error || "General script execution failed.");

             const extracted = injectionResult.result;
             if (extracted.error) throw new Error(extracted.error);

             let content = extracted.content;
             if (format === 'md' && extracted.requiresMarkdownConversion) {
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
             throw new Error(`Unsupported export format: ${format}`);
         }
     } catch (error: any) {
         showError(`Snaggle: General export failed: ${error?.message ?? 'Unknown error'}`);
         if (loadingDiv) loadingDiv.hidden = true;
     }
 }


function triggerDownload(content: string, filename: string, mimeType: string = 'text/plain;charset=utf-8'): void {
    try {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        api.runtime.sendMessage<BackgroundMessage, { success: boolean; error?: string }>({
            action: 'downloadFile',
            url: url,
            filename: filename
        }).then(response => {
            if (response?.success) { // Check success property
                console.log(`Snaggle: Download ${filename} initiated via background.`);
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                if(api.runtime.lastError){ showError(`Download failed: ${api.runtime.lastError.message}`); }
                else { showError(`Download failed: ${response?.error || 'Unknown error'}`); }
                URL.revokeObjectURL(url);
            }
        }).catch((err: Error) => { // Catch comms errors or promise rejections
            showError(`Snaggle: Error sending download message: ${err.message}`);
            URL.revokeObjectURL(url);
        });
    } catch(error: any) { // Catch Blob creation errors
         showError(`Snaggle: Failed to prepare download content: ${error?.message ?? 'Unknown error'}`);
    }
}