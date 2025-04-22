// src/popup/index.ts

// Globals loaded via script tags in popup.html
// declare var TurndownService: any; // Not needed directly in popup anymore
// declare var JSZip: typeof import('jszip'); // Only if popup uses it directly

// Import types and UI helper functions from the specific module
import type { GitHubFileItem, RepoInfo } from '../modules/github_downloader.js';
import {
    parseRepoUrl, // Function to parse URL is specific to GitHub logic
    toggleSelectAll, // UI helper for the popup's checkboxes
    getSelectedItems, // Gets selected items based on popup DOM
    areAllSelected    // Checks selection state based on popup DOM
} from '../modules/github_downloader.js';
// html2pdf is loaded globally via script tag in popup.html

const api = chrome;

// --- UI Elements Cache ---
interface UIElementsCache {
    loadingDiv: HTMLElement | null;
    chatSection: HTMLElement | null;
    githubSection: HTMLElement | null;
    generalSection: HTMLElement | null;
    unsupported: HTMLElement | null;
    errorSection: HTMLElement | null;
    errorP: HTMLElement | null;
    githubDownloadBtn: HTMLButtonElement | null;
    githubSelectAll: HTMLInputElement | null;
    githubTree: HTMLElement | null;
    chatTxtBtn: HTMLButtonElement | null;
    chatMdBtn: HTMLButtonElement | null;
    chatJsonBtn: HTMLButtonElement | null;
    generalPdfBtn: HTMLButtonElement | null;
    generalMdBtn: HTMLButtonElement | null;
    generalTxtBtn: HTMLButtonElement | null;
}
// --- Background Response Interface ---
interface BackgroundResponse {
    success: boolean;
    error?: string;
    downloadId?: number;
    siteType?: 'chat' | 'github' | 'general' | 'unsupported';
    extractedData?: {
        content: string;
        filename?: string;
        error?: string;
        requiresMarkdownConversion?: boolean;
    };
    githubTreeData?: GitHubFileItem[];
    url?: string;
}

let ui: UIElementsCache = {
    loadingDiv: null, chatSection: null, githubSection: null, generalSection: null,
    unsupported: null, errorSection: null, errorP: null, githubDownloadBtn: null,
    githubSelectAll: null, githubTree: null, chatTxtBtn: null, chatMdBtn: null,
    chatJsonBtn: null, generalPdfBtn: null, generalMdBtn: null, generalTxtBtn: null
};

// --- Helper Functions ---
function sanitizeFilename(name: string = 'untitled'): string {
    const sanitized = name
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') // Replace forbidden chars
        .replace(/[\s._]+/g, '_') // Collapse whitespace/dots/underscores
        .replace(/^[._\s]+|[._\s]+$/g, '') // Trim leading/trailing separators
        .slice(0, 150); // Limit length
    return sanitized || 'download'; // Fallback if empty
}

// Request download from background script (using async/await)
async function requestDownload(data: string | ArrayBuffer, filename: string, saveAs: boolean = true) {
    const blob = new Blob([data], { type: 'application/octet-stream' }); // Generic type
    const url = URL.createObjectURL(blob);
    const sanitizedName = sanitizeFilename(filename);
    console.log(`Snaggle Popup: Requesting download for "${sanitizedName}" (saveAs: ${saveAs})`);
    try {
        const response: BackgroundResponse = await api.runtime.sendMessage({
            action: 'downloadFile',
            url: url, // Send blob URL
            filename: sanitizedName,
            saveAs: saveAs
        });

        if (!response?.success) {
            console.error("Snaggle Popup: Background reported download failure:", response?.error);
            showError(`Download failed: ${response?.error || 'Unknown reason'}`);
        } else {
             console.log("Snaggle Popup: Background started download:", response.downloadId);
             // Maybe provide feedback like a temporary "Download started!" message
        }
    } catch (error: any) {
        console.error("Snaggle Popup: Download request failed:", error);
        if (error.message?.includes('Extension context invalidated')) {
            console.log("Snaggle Popup: Context invalidated (likely closed). Cannot show error.");
        } else if (error.message?.includes('Receiving end does not exist')) {
             showError(`Download request failed: Background script is not responding. Please try reloading the page or extension.`);
        } else {
            showError(`Download request failed: ${error.message || error}`);
        }
    } finally {
        // Revoke the object URL after a short delay to allow the download to start
        setTimeout(() => {
            console.log("Snaggle Popup: Revoking blob URL:", url);
            URL.revokeObjectURL(url);
        }, 10000); // 10 seconds should be safe
    }
}

// --- UI Management ---
function cacheUI() {
    ui = {
        loadingDiv: document.getElementById('loading'),
        chatSection: document.getElementById('chat-exporter'),
        githubSection: document.getElementById('github-downloader'),
        generalSection: document.getElementById('general-exporter'),
        unsupported: document.getElementById('unsupported-site'),
        errorSection: document.getElementById('error-section'),
        errorP: document.getElementById('error-message'),
        githubDownloadBtn: document.getElementById('github-download-zip') as HTMLButtonElement | null,
        githubSelectAll: document.getElementById('github-select-all') as HTMLInputElement | null,
        githubTree: document.getElementById('github-file-tree'),
        chatTxtBtn: document.getElementById('chat-txt') as HTMLButtonElement | null,
        chatMdBtn: document.getElementById('chat-md') as HTMLButtonElement | null,
        chatJsonBtn: document.getElementById('chat-json') as HTMLButtonElement | null,
        generalPdfBtn: document.getElementById('general-pdf') as HTMLButtonElement | null,
        generalMdBtn: document.getElementById('general-md') as HTMLButtonElement | null,
        generalTxtBtn: document.getElementById('general-txt') as HTMLButtonElement | null,
    };
    // Validate critical elements
    const criticalElements = [ui.loadingDiv, ui.errorSection, ui.errorP, ui.githubTree, ui.chatSection, ui.githubSection, ui.generalSection, ui.unsupported];
    if (criticalElements.some(el => !el)) {
        console.error("Snaggle Popup: Critical UI elements missing! Check popup.html IDs.", ui);
        throw new Error("Popup UI critical elements missing.");
    }
}

function showSection(id: 'loading' | 'chat-exporter' | 'github-downloader' | 'general-exporter' | 'unsupported-site' | 'error-section') {
    const sections: Record<string, HTMLElement | null> = {
        'loading': ui.loadingDiv,
        'chat-exporter': ui.chatSection,
        'github-downloader': ui.githubSection,
        'general-exporter': ui.generalSection,
        'unsupported-site': ui.unsupported,
        'error-section': ui.errorSection,
    };
    // Hide all sections first
    Object.values(sections).forEach(el => el && (el.hidden = true));
    // Show the target section
    if (sections[id]) {
        sections[id]!.hidden = false;
    } else {
        console.warn("showSection: Tried to show unknown section ID:", id);
    }
     // Always hide loading when showing another section (except error)
    if (id !== 'loading' && id !== 'error-section' && ui.loadingDiv) {
        ui.loadingDiv.hidden = true;
    }
}

function showError(msg: string) {
    console.error("Snaggle Popup Error:", msg);
    if (!ui.errorP || !ui.errorSection) {
        // Attempt to cache again if elements are missing (e.g., error during initial cache)
        try { cacheUI(); } catch { /* Ignore secondary caching error */ }
    }

    if (ui.errorP && ui.errorSection) {
        ui.errorP.textContent = msg;
        showSection('error-section'); // Automatically hides other sections
    } else {
        console.error("Cannot display error in UI, elements missing.");
        alert(`Snaggle Error: ${msg}`); // Fallback alert
    }
    if (ui.loadingDiv) ui.loadingDiv.hidden = true; // Ensure loading is hidden
}

// --- Initialization ---
async function initPopup() {
    try {
        cacheUI(); // Cache elements first
    } catch (error: any) {
         document.body.innerHTML = `<div style='padding: 15px; color: red;'>Error initializing popup: ${error.message || "UI elements missing."}</div>`;
         return; // Stop initialization
    }

    if (!ui.loadingDiv) return; // Should be caught by cacheUI, but double-check

    showSection('loading');
    console.log("Snaggle Popup: Initializing...");

    try {
        // Get site data from background script
        const response: BackgroundResponse = await api.runtime.sendMessage({ action: 'getSiteData' });

        if (!response?.success) {
            throw new Error(response?.error || "Failed to get site data from background.");
        }

        const siteType = response.siteType;
        const url = response.url; // URL determined by background script

        if (!url) {
             throw new Error("Background script did not return page URL.");
        }

        console.log(`Snaggle Popup: Site type '${siteType}', URL: ${url}`);
        disableAllButtons(); // Start with all buttons disabled

        // Setup UI based on site type
        switch (siteType) {
            case 'chat':
                setupChat();
                break;
            case 'github':
                await setupGitHub(url); // Needs URL for parsing
                break;
            case 'general':
                setupGeneral();
                break;
            default:
                showSection('unsupported-site');
                break;
        }

    } catch (error: any) {
        if (error.message?.includes("Could not establish connection") || error.message?.includes("Receiving end does not exist")) {
             showError(`Initialization failed: Cannot connect to background script. It might be loading or has encountered an error. Please try reloading the extension or the page.`);
        } else {
            showError(`Initialization failed: ${error.message}`);
        }
    } finally {
        // Hide loading ONLY if no error is being shown
        if (ui.loadingDiv && ui.errorSection?.hidden) {
             ui.loadingDiv.hidden = true;
        }
    }
}

function disableAllButtons() {
    const buttons = [
        ui.chatTxtBtn, ui.chatMdBtn, ui.chatJsonBtn,
        ui.githubDownloadBtn, ui.generalPdfBtn, ui.generalMdBtn, ui.generalTxtBtn
    ];
    buttons.forEach(btn => { if (btn) btn.disabled = true; });
    if (ui.githubSelectAll) ui.githubSelectAll.disabled = true;
}

// --- Setup Functions ---
function setupChat() {
    if (!ui.chatSection || !ui.chatTxtBtn || !ui.chatMdBtn || !ui.chatJsonBtn) { showError("Chat UI elements missing."); return; }
    showSection('chat-exporter');
    ui.chatTxtBtn.onclick = () => requestExtraction('chat', 'txt');
    ui.chatMdBtn.onclick = () => requestExtraction('chat', 'md');
    ui.chatJsonBtn.onclick = () => requestExtraction('chat', 'json');
    // Enable buttons
    ui.chatTxtBtn.disabled = false;
    ui.chatMdBtn.disabled = false;
    ui.chatJsonBtn.disabled = false;
}

async function setupGitHub(url: string) {
    if (!ui.githubSection || !ui.githubTree || !ui.githubSelectAll || !ui.githubDownloadBtn) {
        showError("GitHub UI elements missing."); return;
    }
    showSection('github-downloader');
    // Reset UI state
    ui.githubTree.innerHTML = '<div class="loading-tree">Loading file tree...</div>';
    ui.githubSelectAll.checked = false;
    ui.githubSelectAll.disabled = true;
    ui.githubDownloadBtn.disabled = true;
    ui.githubDownloadBtn.textContent = 'Download Selected (.zip)';
    // Clear previous listeners to avoid duplicates if re-initialized
    ui.githubSelectAll.onchange = null;
    ui.githubTree.onchange = null; // Use event delegation below
    ui.githubDownloadBtn.onclick = null;

    try {
        // Use the imported parseRepoUrl from the github module
        const repoInfo = parseRepoUrl(url);

        console.log("Snaggle Popup: Requesting GitHub tree for", repoInfo);
        const response: BackgroundResponse = await api.runtime.sendMessage({ action: 'fetchGitHubData', repoInfo: repoInfo });

        if (!response?.success) {
             throw new Error(response?.error || "Failed to fetch GitHub tree data.");
        }

        const fileTreeData = response.githubTreeData;

        if (!fileTreeData || fileTreeData.length === 0) {
            const pathMsg = repoInfo.apiPath ? `'${repoInfo.apiPath}'` : 'root directory';
            ui.githubTree.innerHTML = `<div class="error-message">Directory ${pathMsg} is empty or not found. Check URL/branch/path.</div>`;
             // Keep Select All and Download disabled
        } else {
            renderFileTree(fileTreeData, ui.githubTree); // Render tree in popup
            ui.githubSelectAll.disabled = false; // Enable select all

            // Event listeners
            ui.githubSelectAll.onchange = (e) => {
                toggleSelectAll((e.target as HTMLInputElement).checked);
                 // No need to explicitly update button here, toggleSelectAll handles it
            };
            // Use event delegation on the tree container for checkbox changes
            ui.githubTree.onchange = (e) => {
                 if ((e.target as HTMLElement).matches('input[type="checkbox"]')) {
                     const selected = getSelectedItems();
                     ui.githubDownloadBtn!.disabled = selected.length === 0;
                     ui.githubSelectAll!.checked = selected.length > 0 && areAllSelected();
                 }
             };
            ui.githubDownloadBtn.onclick = () => handleGitHubDownload(repoInfo); // Pass current repoInfo
        }
    } catch (error: any) {
        showError(`GitHub setup failed: ${error.message}`);
        if (ui.githubTree) ui.githubTree.innerHTML = `<div class="error-message">Failed to load tree: ${error.message}</div>`;
        disableAllButtons(); // Ensure buttons remain disabled on error
    }
}

function setupGeneral() {
    if (!ui.generalSection || !ui.generalPdfBtn || !ui.generalMdBtn || !ui.generalTxtBtn) { showError("General UI buttons missing."); return; }
    showSection('general-exporter');
    ui.generalPdfBtn.onclick = () => requestExtraction('general', 'pdf');
    ui.generalMdBtn.onclick = () => requestExtraction('general', 'md');
    ui.generalTxtBtn.onclick = () => requestExtraction('general', 'txt');
    // Enable buttons
    ui.generalPdfBtn.disabled = false;
    ui.generalMdBtn.disabled = false;
    ui.generalTxtBtn.disabled = false;
}

// --- Render GitHub File Tree (Runs in Popup) ---
function renderFileTree(files: GitHubFileItem[], container: HTMLElement): void {
     if (!container) { console.error("File tree container not found for rendering."); return; }
     const list = document.createElement('ul');
     files.forEach(item => {
         const listItem = document.createElement('li');
         listItem.className = item.type === 'dir' ? 'folder' : 'file'; // Set class for styling

         const label = document.createElement('label');
         const checkbox = document.createElement('input');
         checkbox.type = 'checkbox';
         checkbox.value = item.path; // Store the full path in the value
         checkbox.dataset.type = item.type; // Store type
         checkbox.dataset.name = item.name; // Store name

         const nameSpan = document.createElement('span');
         nameSpan.textContent = item.name; // Display name

         label.appendChild(checkbox);
         label.appendChild(nameSpan);
         listItem.appendChild(label);
         list.appendChild(listItem);
     });
     container.innerHTML = ''; // Clear loading/previous content
     container.appendChild(list);
     console.log(`Snaggle Popup: Rendered ${files.length} items in file tree.`);
 }

// --- Action Triggers ---
async function handleGitHubDownload(repoInfo: RepoInfo) {
     const items = getSelectedItems();
     if (items.length === 0) {
          console.warn("Snaggle Popup: Download clicked with no items selected.");
          showError("Please select at least one file or folder to download."); // Provide user feedback
          return;
     }
     if (ui.githubDownloadBtn && ui.githubSelectAll) {
         ui.githubDownloadBtn.textContent = 'Zipping...';
         ui.githubDownloadBtn.disabled = true;
         ui.githubSelectAll.disabled = true; // Disable select all during zip process

         console.log("Snaggle Popup: Requesting ZIP creation for", items);
         try {
             const zipResponse: BackgroundResponse = await api.runtime.sendMessage({
                 action: 'createAndDownloadZip',
                 filesToFetch: items,
                 repoInfo: repoInfo,
                 filename: sanitizeFilename(`${repoInfo.repo}-${repoInfo.apiPath || 'root'}-files`) + '.zip' // More specific filename
             });

             if (!zipResponse?.success) {
                 console.error("Snaggle Popup: Background reported ZIP failure:", zipResponse?.error);
                 showError(`ZIP creation failed: ${zipResponse?.error || 'Unknown reason'}`);
             } else {
                 console.log("Snaggle Popup: Background started ZIP download:", zipResponse.downloadId);
                 // Optionally close popup after initiating download
                 // setTimeout(() => window.close(), 500);
             }
         } catch (error: any) {
              console.error("Snaggle Popup: ZIP request failed:", error);
              showError(`ZIP creation failed: ${error.message || error}`);
         } finally {
              // Restore button state AFTER the operation completes or fails
              ui.githubDownloadBtn.textContent = 'Download Selected (.zip)';
              ui.githubSelectAll.disabled = false; // Re-enable select all
              // Re-enable download button only if items are still selected (unlikely if popup closes, but good practice)
              ui.githubDownloadBtn.disabled = getSelectedItems().length === 0;
         }
     } else {
         console.warn("Snaggle Popup: Download button or select-all checkbox missing when trying to download.");
     }
}

async function requestExtraction(type: 'chat' | 'general', format: 'txt' | 'md' | 'json' | 'pdf') {
    // Determine button ID based on type and format
    let buttonId: string | null = null;
    if (type === 'chat') buttonId = `chat-${format}`;
    else if (type === 'general') buttonId = `general-${format}`; // Includes 'general-pdf'

    const btn = buttonId ? document.getElementById(buttonId) as HTMLButtonElement | null : null;
    const originalText = btn?.textContent || 'Process'; // Store original text

    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
    if(ui.loadingDiv) ui.loadingDiv.hidden = false; // Show loading indicator

    console.log(`Snaggle Popup: Requesting ${type} extraction as ${format}`);

    try {
        const response: BackgroundResponse = await api.runtime.sendMessage({
            action: 'runExtraction',
            extractionType: type,
            format: format
        });

        // Handle PDF response: generate and download PDF using html2pdf
        if (type === 'general' && format === 'pdf') {
            if (!response?.success) throw new Error(response?.error || "Failed to extract PDF content.");
            const data = response.extractedData;
            if (!data || typeof data.content !== 'string') {
                throw new Error("Background did not return valid PDF content.");
            }
            // Determine filename
            const filename = data.filename || `${type}-export-${Date.now()}.pdf`;
            const sanitizedFilename = sanitizeFilename(filename);
            // Create offscreen container for HTML content
            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '-9999px';
            container.innerHTML = data.content;
            document.body.appendChild(container);
            try {
                console.log(`Snaggle Popup: Generating PDF for "${sanitizedFilename}"`);
                // Generate and save PDF
                await html2pdf(container, { filename: sanitizedFilename });
            } catch (err: any) {
                throw new Error(`PDF generation failed: ${err?.message || err}`);
            } finally {
                document.body.removeChild(container);
            }
            // Restore UI
            showSection('general-exporter');
            return; // PDF generation complete
        }

        // Handle regular extractions (TXT, MD, JSON)
        if (!response?.success) {
            throw new Error(response?.error || "Extraction failed in background.");
        }

        const data = response.extractedData;
        if (!data || typeof data.content === 'undefined' ) { // Filename might be generated in background
             throw new Error("Background did not return valid extracted content.");
        }
        // Use filename from data or generate a default if needed (background should provide it now)
        const filename = data.filename || `${type}-export-${Date.now()}.${format}`;

        console.log(`Snaggle Popup: Received data for "${filename}", size: ${data.content?.length ?? 'N/A'}`);
        await requestDownload(data.content, filename); // Wait for download request

        // Optional: Close popup after successful download request
        // setTimeout(() => window.close(), 500);

    } catch (error: any) {
        showError(`Export failed: ${error.message}`);
    } finally {
        // Restore UI state only if no error was shown
        if (ui.errorSection?.hidden) {
            if (ui.loadingDiv) ui.loadingDiv.hidden = true;
            // Show the correct section again after processing
            if (type === 'chat') showSection('chat-exporter');
            else if (type === 'general' && format !== 'pdf') showSection('general-exporter');
        }

        // Restore button text and state (always restore unless PDF which exited early)
        if(btn && format !== 'pdf') {
             btn.disabled = false;
             btn.textContent = originalText; // Restore original text
        } else if (format === 'pdf' && btn) {
             // Restore PDF button specifically if it didn't exit early (e.g., error before return)
             btn.disabled = false;
             btn.textContent = "Save as PDF...";
        }
    }
}

// --- Run Initialization on Load ---
document.addEventListener('DOMContentLoaded', initPopup);

console.log("Snaggle Popup Script Loaded");