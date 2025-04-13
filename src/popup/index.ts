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
function showSection(sectionId: string): void {
    console.log(`Snaggle Popup: Attempting to show section: ${sectionId}`);
    if (loadingDiv) loadingDiv.hidden = true;
    if (chatSection) chatSection.hidden = true;
    if (githubSection) githubSection.hidden = true;
    if (generalSection) generalSection.hidden = true;
    if (unsupportedSection) unsupportedSection.hidden = true;
    if (errorSection) errorSection.hidden = true;
    const section = document.getElementById(sectionId);
    if (section) { section.hidden = false; console.log(`Snaggle Popup: Successfully displayed section: ${sectionId}`); }
    else { showError(`Internal error: Section ID "${sectionId}" not found.`); }
}
function showError(message: string): void {
    console.error("Snaggle Popup: Showing error - ", message);
    if (errorMessageP) errorMessageP.textContent = message;
    const errSect = document.getElementById('error-section');
    if (errSect) errSect.hidden = false; else console.error("Snaggle Error: Error section element not found.");
    if (loadingDiv) loadingDiv.hidden = true;
}
function showLoading(message: string = "Loading..."): void {
    console.log("Snaggle Popup: Showing loading state:", message);
    if (loadingDiv) {
        loadingDiv.textContent = message; loadingDiv.hidden = false;
        if (chatSection) chatSection.hidden = true; if (githubSection) githubSection.hidden = true; if (generalSection) generalSection.hidden = true; if (unsupportedSection) unsupportedSection.hidden = true; if (errorSection) errorSection.hidden = true;
    } else { console.error("Snaggle Error: Loading div element not found."); }
}
function getActiveTab(): Promise<chrome.tabs.Tab> {
    console.log("Snaggle Popup: Calling api.tabs.query...");
    return api.tabs.query({ active: true, currentWindow: true })
        .then(tabs => {
            console.log("Snaggle Popup: api.tabs.query result:", tabs);
            if (tabs?.[0]?.id && tabs?.[0]?.url) { console.log("Snaggle Popup: Active tab found:", tabs[0]); return tabs[0]; }
            if (!tabs || tabs.length === 0) console.error("Snaggle Popup: api.tabs.query returned no tabs."); else if (!tabs[0].id) console.error("Snaggle Popup: Active tab missing ID.", tabs[0]); else if (!tabs[0].url) console.error("Snaggle Popup: Active tab missing URL.", tabs[0]); else console.error("Snaggle Popup: api.tabs.query returned invalid tab data.", tabs[0]);
            throw new Error("Could not get valid active tab information.");
        })
        .catch(error => { console.error("Snaggle Popup: Error during api.tabs.query:", error); throw error; });
}
function sanitizeFilename(name: string | undefined | null): string {
    if (!name) return "untitled"; const reserved = /[<>:"/\\|?*\u0000-\u001F]/g; const whitespaceAndDots = /[\s._]+/g; const trimEdges = /^[._\s]+|[._\s]+$/g;
    let sanitized = name.replace(reserved, '_').replace(whitespaceAndDots, '_').replace(trimEdges, ''); return (sanitized || "untitled").substring(0, 150);
}

// --- Main Logic --- (No changes needed)
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Snaggle Popup: DOMContentLoaded event fired."); showLoading("Detecting site..."); let activeTab: chrome.tabs.Tab | undefined;
    try {
        console.log("Snaggle Popup: Entering main try block."); console.log("Snaggle Popup: About to call getActiveTab()..."); activeTab = await getActiveTab(); console.log("Snaggle Popup: getActiveTab() resolved successfully:", activeTab);
        if (!activeTab?.id || !activeTab?.url) { console.error("Snaggle Popup: ActiveTab became invalid after await?"); throw new Error("Lost active tab information."); }
        const url = activeTab.url; console.log("Snaggle Popup: Checking URL:", url);
        if (!url.startsWith('http:') && !url.startsWith('https:') && !url.startsWith('file:')) { console.log(`Snaggle Popup: URL protocol (${url.substring(0,10)}...) not supported.`); showError(`Cannot operate on this page protocol.`); }
        else {
            console.log("Snaggle Popup: Determining site type..."); const isChat = ChatExporter.isChatSite(url); const isGitHub = GitHubDownloader.isGitHubRepoPage(url); const isGeneral = GeneralExporter.isGeneralSite(url); console.log(`Snaggle Popup: Site Type Checks - isChat: ${isChat}, isGitHub: ${isGitHub}, isGeneral: ${isGeneral}`);
            if (isChat) { console.log("Snaggle Popup: Detected Chat Site..."); setupChatListeners(activeTab); showSection('chat-exporter'); console.log("Snaggle Popup: Chat setup complete."); }
            else if (isGitHub) { console.log("Snaggle Popup: Detected GitHub Repo..."); setupGitHubListeners(activeTab, url); showSection('github-downloader'); console.log("Snaggle Popup: GitHub setup complete."); }
            else if (isGeneral) { console.log("Snaggle Popup: Detected General Site..."); setupGeneralListeners(activeTab); showSection('general-exporter'); console.log("Snaggle Popup: General setup complete."); }
            else { console.log("Snaggle Popup: Site type not supported (failed all checks)."); showSection('unsupported-site'); }
        }
        console.log("Snaggle Popup: Exiting main try block normally.");
    } catch (error: any) { console.error("Snaggle Popup: Error caught in DOMContentLoaded handler:", error); showError(`Snaggle: Initialization failed: ${error?.message ?? 'Unknown error'}`); }
    finally { console.log("Snaggle Popup: Reached finally block."); }
});

// --- Event Listener Setups --- (No changes needed)
function setupChatListeners(tab: chrome.tabs.Tab): void { document.getElementById('chat-txt')?.addEventListener('click', () => handleChatExport(tab, 'txt')); document.getElementById('chat-md')?.addEventListener('click', () => handleChatExport(tab, 'md')); document.getElementById('chat-json')?.addEventListener('click', () => handleChatExport(tab, 'json')); }
function setupGitHubListeners(tab: chrome.tabs.Tab, url: string): void { const downloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null; const selectAllCheckbox = document.getElementById('github-select-all') as HTMLInputElement | null; const fileTreeContainer = document.getElementById('github-file-tree') as HTMLDivElement | null; if(!downloadButton || !selectAllCheckbox || !fileTreeContainer) { showError("GitHub UI elements missing."); return; } downloadButton.addEventListener('click', () => handleGitHubDownload(tab, url)); selectAllCheckbox.addEventListener('change', (event: Event) => { GitHubDownloader.toggleSelectAll((event.target as HTMLInputElement).checked); downloadButton.disabled = GitHubDownloader.getSelectedItems().length === 0; }); fileTreeContainer.addEventListener('change', (event: Event) => { const target = event.target as HTMLElement | null; if (target?.matches('input[type="checkbox"]') && target !== selectAllCheckbox) { const anySelected = GitHubDownloader.getSelectedItems().length > 0; downloadButton.disabled = !anySelected; selectAllCheckbox.checked = anySelected && GitHubDownloader.areAllSelected(); } }); GitHubDownloader.displayFileTree(tab, url); }
function setupGeneralListeners(tab: chrome.tabs.Tab): void { document.getElementById('general-pdf')?.addEventListener('click', () => handleGeneralExport(tab, 'pdf')); document.getElementById('general-md')?.addEventListener('click', () => handleGeneralExport(tab, 'md')); document.getElementById('general-txt')?.addEventListener('click', () => handleGeneralExport(tab, 'txt')); }

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
     downloadButton.disabled = true; downloadButton.textContent = 'Zipping...'; showLoading("Preparing download...");
     try {
         const repoInfo = GitHubDownloader.parseRepoUrl(url);
         let baseName = repoInfo.repo + (selectedItems.length === 1 ? '-' + sanitizeFilename(selectedItems[0].name) : '-selection');
         const filename = sanitizeFilename(`${baseName}-${Date.now()}.zip`);
         const response = await api.runtime.sendMessage({ action: 'createAndDownloadZip', filesToFetch: selectedItems, repoInfo: repoInfo, filename: filename });
         const typedResponse = response as BackgroundResponse | undefined;
         if (typedResponse?.success) {
             console.log('Snaggle: ZIP download initiated.'); if (loadingDiv) loadingDiv.textContent = "Download started!"; setTimeout(() => window.close(), 1500);
         } else { throw new Error(typedResponse?.error || 'Unknown error during ZIP creation (promise resolved).'); }
     } catch (error: any) {
         showError(`Snaggle: GitHub download error: ${error?.message ?? 'Unknown error'}`);
         const currentDownloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null;
         if(currentDownloadButton) { currentDownloadButton.disabled = GitHubDownloader.getSelectedItems().length === 0; currentDownloadButton.textContent = 'Download Selected (.zip)'; }
     } finally { if (!window.closed && loadingDiv) { loadingDiv.hidden = true; } }
 }

async function handleGeneralExport(tab: chrome.tabs.Tab, format: 'pdf' | 'txt' | 'md'): Promise<void> {
     console.log(`Snaggle Popup: Initiating general export for format: ${format}, Tab ID: ${tab.id}, URL: ${tab.url}`);
     showLoading(`Exporting page as ${format.toUpperCase()}...`);
     if (!tab.id) { showError("Tab ID missing for general export."); return; }
     try {
         const pageTitle = tab.title || 'page';
         const baseFilename = sanitizeFilename(pageTitle);

         if (format === 'pdf') {
             console.log("Snaggle Popup: Requesting print dialog via script injection."); showLoading("Opening Print Dialog...");
             await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.print(); } });
             console.log("Snaggle Popup: Print dialog script injected."); setTimeout(() => window.close(), 500); return;
         } else if (format === 'txt' || format === 'md') {
             console.log(`Snaggle Popup: Injecting script FILE to extract ${format} content...`);
             // --- Corrected executeScript call using ABSOLUTE path from root ---
             const results: ScriptInjectionResults = await api.scripting.executeScript({
                 target: { tabId: tab.id },
                 // Path MUST be relative to the root of the built extension (dist folder)
                 // Start with "/" to indicate root.
                 files: ['/src/content/extractGeneralData.js'] // <-- Added leading slash
             });
             // --- End Correction ---

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

             if (requiresMarkdownConversion) {
                 if (typeof TurndownService !== 'undefined') {
                     console.log("Snaggle Popup: Converting HTML to Markdown...");
                     content = GeneralExporter.convertHtmlToMarkdown(content);
                 } else {
                      console.warn("Snaggle: Turndown unavailable for general MD.");
                      content = "<!-- Turndown library missing -->\n\n" + content;
                 }
             }
             const filename = `${baseFilename}.${format}`;
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

// triggerDownload (No changes needed)
function triggerDownload(content: string, filename: string, mimeType: string = 'text/plain;charset=utf-8'): void {
    try {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        api.runtime.sendMessage({ action: 'downloadFile', url: url, filename: filename })
        .then(response => {
            const typedResponse = response as BackgroundResponse | undefined;
            if (typedResponse?.success) {
                console.log(`Snaggle: Download ${filename} initiated via background.`);
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                showError(`Download failed: ${typedResponse?.error || 'Unknown error (promise resolved)'}`);
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

console.log("Snaggle Popup Script Loaded (Vite/TS - Final).");