/* eslint-disable max-lines */
// --------------------------------------------------
// Snaggle Popup UI (Running as Content Script - Runtime Fetch)
// --------------------------------------------------

// Use chrome.* APIs with types from @types/chrome
const api = chrome;

// Import module scripts - these functions are still callable directly
import { isChatSite, extractChatData } from '../modules/chat_exporter';
import { isGitHubRepoPage, parseRepoUrl, toggleSelectAll, getSelectedItems, areAllSelected, displayFileTree } from '../modules/github_downloader';
import { isGeneralSite, convertHtmlToMarkdown } from '../modules/general_exporter';
import { extractDataForInjection } from '../content/extractGeneralData';

// Declare TurndownService global variable expected after eval'ing the script
declare var TurndownService: any;

/* ---------- helper types ---------- */
// ... (types remain the same)
interface GitHubFileItem { path: string; type: 'file' | 'dir'; name: string; }
interface RepoInfo        { owner: string; repo: string; ref: string; apiPath: string; }
interface BackgroundMsgFromCS {
    action: 'downloadFile' | 'createAndDownloadZip';
    url?: string;
    filename?: string;
    filesToFetch?: GitHubFileItem[];
    repoInfo?: Pick<RepoInfo, 'owner' | 'repo' | 'ref'>;
    saveAs?: boolean;
}
interface BackgroundMsgToCS { action: 'togglePopup'; }
interface BackgroundRes   { success: boolean; error?: string; downloadId?: number; }
type ChatResult = ReturnType<typeof extractChatData>;
type PageResult = ReturnType<typeof extractDataForInjection>;
type InjectionResult = chrome.scripting.InjectionResult;
type InjectionResults = InjectionResult[];

// FIX: Define a type for the UI elements cache
interface UIElementsCache {
    loadingDiv: HTMLDivElement | null;
    chatSection: HTMLDivElement | null;
    githubSection: HTMLDivElement | null;
    generalSect: HTMLDivElement | null;
    unsupported: HTMLDivElement | null;
    errorSection: HTMLDivElement | null;
    errorP: HTMLParagraphElement | null;
    actionToggleSwitch: HTMLInputElement | null;
    githubDownloadZipButton: HTMLButtonElement | null;
    githubSelectAllCheckbox: HTMLInputElement | null;
    githubFileTree: HTMLDivElement | null;
    chatTxtButton: HTMLButtonElement | null;
    chatMdButton: HTMLButtonElement | null;
    chatJsonButton: HTMLButtonElement | null;
    generalPdfButton: HTMLButtonElement | null;
    generalMdButton: HTMLButtonElement | null;
    generalTxtButton: HTMLButtonElement | null;
}
/* ----------------------------------- */

/* ---------- State & DOM Cache ---------- */
let popupContainer: HTMLDivElement | null = null;
let popupContent: HTMLDivElement | null = null; // Inner container

// FIX: Initialize uiElements with the defined type and null values
let uiElements: UIElementsCache = {
    loadingDiv: null, chatSection: null, githubSection: null, generalSect: null,
    unsupported: null, errorSection: null, errorP: null, actionToggleSwitch: null,
    githubDownloadZipButton: null, githubSelectAllCheckbox: null, githubFileTree: null,
    chatTxtButton: null, chatMdButton: null, chatJsonButton: null,
    generalPdfButton: null, generalMdButton: null, generalTxtButton: null
};

let turndownLoaded = false;
let assetsLoaded = false; // Flag to track if assets have been fetched
let popupHtmlContent: string | null = null;
let popupCssContent: string | null = null;
let turndownScriptSourceContent: string | null = null;

// --- Reset UI Elements Cache ---
function resetUIElementsCache() {
    // Re-initialize with null values
    uiElements = {
        loadingDiv: null, chatSection: null, githubSection: null, generalSect: null,
        unsupported: null, errorSection: null, errorP: null, actionToggleSwitch: null,
        githubDownloadZipButton: null, githubSelectAllCheckbox: null, githubFileTree: null,
        chatTxtButton: null, chatMdButton: null, chatJsonButton: null,
        generalPdfButton: null, generalMdButton: null, generalTxtButton: null
    };
}

/* ---------- Asset Loading Function ---------- */
async function loadAssets(): Promise<void> {
    if (assetsLoaded) return;

    console.log("Snaggle Content Script: Fetching assets at runtime...");
    try {
        const [htmlRes, cssRes, turndownRes] = await Promise.all([
            fetch(api.runtime.getURL('popup.html')),
            fetch(api.runtime.getURL('popup.css')),
            // Fetch from the /vendor directory which is copied to dist root
            fetch(api.runtime.getURL('/vendor/turndown.js'))
        ]);

        if (!htmlRes.ok) throw new Error(`Failed to fetch popup.html: ${htmlRes.statusText}`);
        if (!cssRes.ok) throw new Error(`Failed to fetch popup.css: ${cssRes.statusText}`);
        if (!turndownRes.ok) throw new Error(`Failed to fetch turndown.js: ${turndownRes.statusText}`);

        popupHtmlContent = await htmlRes.text();
        popupCssContent = await cssRes.text();
        turndownScriptSourceContent = await turndownRes.text();

        assetsLoaded = true;
        console.log("Snaggle Content Script: Assets fetched successfully.");

    } catch (error) {
        console.error("Snaggle Content Script: Failed to load assets:", error);
        assetsLoaded = false; // Ensure flag is false on error
        // Propagate error to be handled by the caller
        throw new Error(`Asset loading failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}


/* ---------- Utility Functions (adapted for content script) ---------- */

/**
 * Injects the popup HTML and CSS into the page's DOM if not already present.
 * Assumes assets (HTML, CSS, Turndown source) have already been loaded into variables.
 */
async function ensurePopupInjected(): Promise<void> {
    if (popupContainer) {
        //console.log("Snaggle Content Script: Popup already injected.");
        return; // Already injected
    }
     // Ensure assets are loaded before proceeding
     if (!assetsLoaded || !popupHtmlContent || !popupCssContent || !turndownScriptSourceContent) {
          throw new Error("Cannot inject popup: Assets not loaded.");
     }
    console.log("Snaggle Content Script: Injecting popup UI using fetched assets...");

    // Create the main wrapper container for positioning
    popupContainer = document.createElement('div');
    popupContainer.id = 'snaggle-popup-container';

    // Create the inner container to hold the actual popup content structure
    popupContent = document.createElement('div');
    popupContent.className = 'container'; // Use the existing container class for styles
    popupContent.innerHTML = popupHtmlContent; // Inject the FETCHED HTML content

    // Append the content to the main wrapper
    popupContainer.appendChild(popupContent);

    // Add the wrapper to the page body
    document.body.appendChild(popupContainer);
    //console.log("Snaggle Content Script: Popup HTML injected.");

    // Inject the CSS
    const styleTag = document.createElement('style');
    styleTag.textContent = popupCssContent; // Inject the FETCHED CSS content
    document.head.appendChild(styleTag);
    //console.log("Snaggle Content Script: Popup CSS injected.");

    // Load the Turndown script by evaluating its source code
    try {
        eval(turndownScriptSourceContent); // Evaluate the FETCHED script content
        if (typeof TurndownService === 'undefined') {
            throw new Error("TurndownService not found after evaluating script.");
        }
        turndownLoaded = true;
        //console.log("Snaggle Content Script: Turndown script evaluated.");
    } catch (e) {
        console.error("Snaggle Content Script: Failed to evaluate Turndown script:", e);
        turndownLoaded = false;
    }

    resetUIElementsCache(); // Clear previous cache if any
    cacheUIElements(); // Cache elements from the newly injected DOM
    //console.log("Snaggle Content Script: UI elements cached.");

     popupContainer.addEventListener('click', (event: MouseEvent) => { // Add type to event
         if (event.target === popupContainer) {
             togglePopupVisibility(false);
         }
     });
}

// --- cacheUIElements and other helpers remain largely the same, ---
// --- just ensure they use the `uiElements` cache object ---
function cacheUIElements(): void {
    if (!popupContent) return;
    resetUIElementsCache(); // Ensure clean state
    uiElements.loadingDiv = popupContent.querySelector('#loading');
    uiElements.chatSection = popupContent.querySelector('#chat-exporter');
    uiElements.githubSection = popupContent.querySelector('#github-downloader');
    uiElements.generalSect = popupContent.querySelector('#general-exporter');
    uiElements.unsupported = popupContent.querySelector('#unsupported-site');
    uiElements.errorSection = popupContent.querySelector('#error-section');
    uiElements.errorP = popupContent.querySelector('#error-message');
    uiElements.actionToggleSwitch = popupContent.querySelector('#action-toggle-switch');
    uiElements.githubDownloadZipButton = popupContent.querySelector('#github-download-zip');
    uiElements.githubSelectAllCheckbox = popupContent.querySelector('#github-select-all');
    uiElements.githubFileTree = popupContent.querySelector('#github-file-tree');
    uiElements.chatTxtButton = popupContent.querySelector('#chat-txt');
    uiElements.chatMdButton = popupContent.querySelector('#chat-md');
    uiElements.chatJsonButton = popupContent.querySelector('#chat-json');
    uiElements.generalPdfButton = popupContent.querySelector('#general-pdf');
    uiElements.generalMdButton = popupContent.querySelector('#general-md');
    uiElements.generalTxtButton = popupContent.querySelector('#general-txt');
}

function togglePopupVisibility(show?: boolean): void {
    if (!popupContainer) return;
    const isVisible = popupContainer.classList.contains('visible');
    const shouldShow = show === undefined ? !isVisible : show;

    if (shouldShow) {
        if (!isVisible) { // Only run setup if becoming visible
            popupContainer.classList.add('visible');
             initialPopupSetup(); // Run setup when first showing
             console.log("Snaggle Content Script: Popup UI shown.");
        } else {
            // Optionally re-run setup if already visible to refresh state?
            // initialPopupSetup(); // Uncomment if needed
            console.log("Snaggle Content Script: Popup UI already visible.");
        }
    } else {
        if (isVisible) { // Only reset if hiding
            popupContainer.classList.remove('visible');
             if (uiElements.loadingDiv) uiElements.loadingDiv.hidden = true;
             ['chatSection', 'githubSection', 'generalSect', 'unsupported', 'errorSection'].forEach(sectionKey => {
                  const el = uiElements[sectionKey as keyof UIElementsCache]; // Use type here
                  if (el instanceof HTMLElement) el.hidden = true; // el is now typed correctly
             });
             if (uiElements.errorP) uiElements.errorP.textContent = '';
             console.log("Snaggle Content Script: Popup UI hidden.");
        }
    }
}

function showSection(id: string): void {
  if (!popupContent || !uiElements.loadingDiv) return;
  uiElements.loadingDiv.hidden = true;
  const sectionElements: Record<string, HTMLElement | null> = {
    'chat-exporter': uiElements.chatSection,
    'github-downloader': uiElements.githubSection,
    'general-exporter': uiElements.generalSect,
    'unsupported-site': uiElements.unsupported,
    'error-section': uiElements.errorSection,
  };
  Object.keys(sectionElements).forEach(key => {
    if (sectionElements[key]) sectionElements[key]!.hidden = (key !== id);
  });
  if (id && sectionElements[id]) (sectionElements[id] as HTMLElement).hidden = false;
}

function showLoading(msg = 'Loading…'): void {
  if (uiElements.loadingDiv) {
    uiElements.loadingDiv.textContent = msg;
    uiElements.loadingDiv.hidden = false;
    showSection('');
  } else {
      console.warn("Attempted to show loading, but loadingDiv not cached/found.");
  }
}

function showError(msg: string): void {
  if (uiElements.errorP) {
      uiElements.errorP.textContent = msg;
      showSection('error-section');
  } else {
       console.error("Snaggle Error:", msg); // Fallback log
       alert(`Snaggle Error:\n${msg}`); // Fallback alert
  }
}

function sanitizeFilename(name = 'untitled'): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[\s._]+/g, '_')
    .replace(/^[._\s]+|[._\s]+$/g, '')
    .slice(0, 150) || 'untitled';
}

function triggerDownload(contentUrl: string, filename: string, saveAs = false): void {
  try {
    api.runtime.sendMessage({
      action: 'downloadFile', url: contentUrl, filename: filename, saveAs: saveAs
    } as BackgroundMsgFromCS).then(res => {
      const resp = res as BackgroundRes | undefined;
      if (!resp?.success) {
        showError(`Download failed: ${resp?.error ?? 'Unknown background error'}`);
      } else {
         if (uiElements.loadingDiv && !uiElements.loadingDiv.hidden) {
            uiElements.loadingDiv.textContent = 'Download started!';
         }
         console.log(`Snaggle Content Script: Download initiated (ID: ${resp.downloadId}) for ${filename}, saveAs=${saveAs}`);
         setTimeout(() => togglePopupVisibility(false), 1500);
      }
      setTimeout(() => URL.revokeObjectURL(contentUrl), 60_000);
    }).catch(err => {
      console.error("Snaggle Content Script: Failed to send download message:", err);
      showError(`Failed to send download message: ${err?.message ?? 'unknown'}`);
      URL.revokeObjectURL(contentUrl);
    });
  } catch (err: any) {
    console.error("Snaggle Content Script: Error preparing download message:", err);
    showError(`Download preparation error: ${err?.message ?? 'unknown'}`);
  }
}

function initiateContentDownload(content: string, filename: string, mime = 'text/plain;charset=utf-8', saveAs = false): void {
     try {
        const blob = new Blob([content], { type: mime });
        const url  = URL.createObjectURL(blob);
        triggerDownload(url, filename, saveAs);
     } catch (err: any) {
         showError(`Download preparation error: ${err?.message ?? 'unknown'}`);
     }
}
/* -------------------------------- */

/* ---------- Initial Popup Setup ---------- */
async function initialPopupSetup(): Promise<void> {
     if (!assetsLoaded) {
         showError("Cannot setup popup: Core assets failed to load.");
         return;
     }
     showLoading('Detecting site…');
    try {
        const url = window.location.href;
        const isChatSiteDetected    = isChatSite(url);
        const isGitHubRepoDetected  = isGitHubRepoPage(url);
        const isGeneralSiteDetected = !isChatSiteDetected && !isGitHubRepoDetected && isGeneralSite(url);

        // Re-attach listeners every time setup runs, ensure elements are cached first
        if (!popupContainer) await ensurePopupInjected(); // Should be injected already, but double check
        cacheUIElements(); // Ensure cache is fresh

        if (isChatSiteDetected)       { setupChatListeners();      showSection('chat-exporter'); }
        else if (isGitHubRepoDetected){ setupGitHubListeners(url);showSection('github-downloader'); }
        else if (isGeneralSiteDetected){ setupGeneralListeners();   showSection('general-exporter'); }
        else               { showSection('unsupported-site'); }

    } catch (err: any) {
        console.error("Snaggle Content Script: Initialization error:", err);
        showError(`Initialization error: ${err?.message ?? 'unknown'}`);
    }
}
/* ---------------------------------- */

/* ---------- Listener Setup ---------- */
// Add checks for element existence before adding listeners
// Use .onclick for simplicity in replacing listeners on re-setup
function setupChatListeners(): void {
    if (uiElements.chatTxtButton) uiElements.chatTxtButton.onclick = () => handleChatExport('txt'); else console.warn("chat-txt button not found");
    if (uiElements.chatMdButton) uiElements.chatMdButton.onclick = () => handleChatExport('md'); else console.warn("chat-md button not found");
    if (uiElements.chatJsonButton) uiElements.chatJsonButton.onclick = () => handleChatExport('json'); else console.warn("chat-json button not found");
    //console.log("Snaggle Content Script: Chat listeners (re)attached.");
}

function setupGitHubListeners(url: string): void {
    const dlBtn = uiElements.githubDownloadZipButton;
    const selAll= uiElements.githubSelectAllCheckbox;
    const tree  = uiElements.githubFileTree;
    if (!dlBtn || !selAll || !tree) { console.error('Snaggle Content Script: GitHub UI elements missing.'); showError('GitHub UI elements missing.'); return; }

    dlBtn.onclick = () => handleGitHubDownload(url);
    selAll.onchange = (e: Event) => { // FIX: Add Event type
      const isChecked = (e.target as HTMLInputElement).checked;
      toggleSelectAll(isChecked);
      dlBtn.disabled = getSelectedItems().length === 0;
    };
    // Use event delegation on the tree container for checkbox changes
    tree.onchange = (e: Event) => { // FIX: Add Event type
      if ((e.target as HTMLElement).matches('input[type="checkbox"]')) {
        const selectedItems = getSelectedItems();
        const anySelected = selectedItems.length > 0;
        dlBtn.disabled = !anySelected;
        selAll.checked = anySelected && areAllSelected();
      }
    };
    // Clear previous tree content before displaying new one
    tree.innerHTML = '<div class="loading-tree">Loading file tree...</div>'; // Reset loading state
    displayFileTree(null, url)
        .catch(err => showError(`Failed to display GitHub tree: ${err.message}`));
    //console.log("Snaggle Content Script: GitHub listeners (re)attached.");
}

function setupGeneralListeners(): void {
  if (!uiElements.actionToggleSwitch) {
    console.error("Snaggle Content Script: Action toggle switch UI element not found.");
  }
  if (uiElements.generalPdfButton) uiElements.generalPdfButton.onclick = () => handleGeneralPdfExport(); else console.warn("general-pdf button not found");
  if (uiElements.generalMdButton) uiElements.generalMdButton.onclick = () => handleGeneralAction('md'); else console.warn("general-md button not found");
  if (uiElements.generalTxtButton) uiElements.generalTxtButton.onclick = () => handleGeneralAction('txt'); else console.warn("general-txt button not found");
  //console.log("Snaggle Content Script: General listeners (re)attached.");
}
/* ------------------------------------ */

/* ---------- Handler Functions ---------- */
// ... (handler functions remain the same logic)
async function handleChatExport(format: 'txt'|'md'|'json'): Promise<void> {
    showLoading(`Exporting chat as ${format.toUpperCase()}...`);
    try {
        const extracted: ChatResult = extractChatData(format);
        if (extracted.error) {
             throw new Error(`Chat extraction error: ${extracted.error}`);
        }
        let finalContent = extracted.content;
        if (format === 'md' && (extracted.requiresMarkdownConversion ?? false)) {
             showLoading('Converting HTML to Markdown...');
            if (turndownLoaded && typeof TurndownService !== 'undefined') {
                finalContent = convertHtmlToMarkdown(finalContent);
            } else {
                console.warn("Snaggle Content Script: Turndown library missing for chat MD conversion.");
                finalContent = "<!-- Turndown library was not available for Markdown conversion -->\n\n" + finalContent;
            }
        }
        const filename = sanitizeFilename(extracted.filename || `chat-export.${format}`);
        const mime = format === 'json' ? 'application/json' : format === 'md' ? 'text/markdown' : 'text/plain';
        initiateContentDownload(finalContent, filename, `${mime};charset=utf-8`);
    } catch (err: any) {
        console.error("Snaggle Content Script: Chat export failed:", err);
        showError(`Chat export failed: ${err instanceof Error ? err.message : String(err)}`);
        if (uiElements.loadingDiv) uiElements.loadingDiv.hidden = true;
    }
}

async function handleGitHubDownload(url: string): Promise<void> {
     showLoading("Preparing ZIP download...");
    try {
        const selectedItems = getSelectedItems();
        if (selectedItems.length === 0) {
            showError("No files or folders selected for download.");
            if (uiElements.loadingDiv) uiElements.loadingDiv.hidden = true;
            return;
         }
        const repoInfo = parseRepoUrl(url);
        const filename = sanitizeFilename(`${repoInfo.repo}-${repoInfo.ref}-download.zip`);

        api.runtime.sendMessage({
            action: 'createAndDownloadZip', filesToFetch: selectedItems,
            repoInfo: { owner: repoInfo.owner, repo: repoInfo.repo, ref: repoInfo.ref },
            filename: filename
        } as BackgroundMsgFromCS).then(res => {
            const resp = res as BackgroundRes | undefined;
            if (!resp?.success) {
                 showError(`ZIP Download failed: ${resp?.error ?? 'Unknown background error'}`);
            } else {
                if (uiElements.loadingDiv) uiElements.loadingDiv.textContent = 'ZIP Download started!';
                 setTimeout(() => togglePopupVisibility(false), 1500);
            }
        }).catch(err => {
             console.error("Snaggle Content Script: Failed to send ZIP request:", err);
            showError(`Failed to send ZIP request: ${err?.message ?? 'unknown'}`);
        });
    } catch (err: any) {
        console.error("Snaggle Content Script: GitHub download failed:", err);
        showError(`GitHub download failed: ${err?.message ?? 'Unknown error'}`);
        if (uiElements.loadingDiv) uiElements.loadingDiv.hidden = true;
    }
}

function handleGeneralAction(format: 'md' | 'txt'): void {
  if (!uiElements.actionToggleSwitch) {
    console.error("Snaggle Content Script: Cannot determine action: Toggle switch not found in UI.");
    showError("Action toggle switch UI element not found.");
    return;
  }
  const shouldDownload = uiElements.actionToggleSwitch.checked;
  if (shouldDownload) {
    console.log(`Snaggle Content Script: Action toggle is ON (Download) for ${format.toUpperCase()}`);
    handleGeneralDownload(format);
  } else {
    console.log(`Snaggle Content Script: Action toggle is OFF (Copy) for ${format.toUpperCase()}`);
    handleGeneralCopy(format);
  }
}

async function handleGeneralPdfExport(): Promise<void> {
  showLoading(`Opening print dialog for PDF…`);
  try {
    window.print();
    setTimeout(() => togglePopupVisibility(false), 500);
  } catch (err: any) {
    console.error("Snaggle Content Script: Failed to open print dialog:", err);
    showError(`Failed to open print dialog: ${err?.message ?? 'unknown'}`);
    if (uiElements.loadingDiv) uiElements.loadingDiv.hidden = true;
  }
}

async function handleGeneralDownload(format: 'txt'|'md'): Promise<void> {
  showLoading(`Preparing ${format.toUpperCase()} download…`);
  try {
    const extracted: PageResult = extractDataForInjection();
    if (extracted.error) {
        throw new Error(`Page data extraction error: ${extracted.error}`);
    }
    let finalContent = extracted.content;
     if (format === 'md' && (extracted.requiresMarkdownConversion ?? false)) {
       showLoading('Converting HTML to Markdown...');
       if (turndownLoaded && typeof TurndownService !== 'undefined') {
           finalContent = convertHtmlToMarkdown(finalContent);
       } else {
           console.warn("Snaggle Content Script: Turndown library missing for MD download.");
           finalContent = "<!-- Turndown library was not available for Markdown conversion -->\n\n" + finalContent;
       }
    }
    const baseFilename = sanitizeFilename(window.document.title || 'page-export');
    const filename = `${baseFilename}.${format}`;
    const mime = format === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8';
    initiateContentDownload(finalContent, filename, mime, true);
  } catch (err: any) {
    console.error("Snaggle Content Script: General download failed:", err);
    showError(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    if (uiElements.loadingDiv) uiElements.loadingDiv.hidden = true;
  }
}

async function handleGeneralCopy(format: 'txt'|'md'): Promise<void> {
  showLoading(`Preparing to copy as ${format.toUpperCase()} file data…`);
  try {
    const extracted: PageResult = extractDataForInjection();
     if (extracted.error) {
         throw new Error(`Page data extraction error: ${extracted.error}`);
     }
    let finalContent = extracted.content;
     if (format === 'md' && (extracted.requiresMarkdownConversion ?? false)) {
       showLoading('Converting HTML to Markdown for copy...');
       if (turndownLoaded && typeof TurndownService !== 'undefined') {
           finalContent = convertHtmlToMarkdown(finalContent);
        } else {
           console.warn("Snaggle Content Script: Turndown library missing for MD copy.");
           finalContent = "<!-- Turndown library was not available for Markdown conversion -->\n\n" + finalContent;
       }
    }
    const mime = format === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8';
    const blob = new Blob([finalContent], { type: mime });
    try {
        const data = new ClipboardItem({ [mime]: blob });
        await navigator.clipboard.write([data]);
        console.log(`Snaggle Content Script: Copied ${format.toUpperCase()} Blob to clipboard.`);
    } catch (clipboardErr: any) {
        throw new Error(`Clipboard write failed: ${clipboardErr?.message ?? 'Unknown clipboard API error'}`);
    }
    if (uiElements.loadingDiv) uiElements.loadingDiv.textContent = 'Copied to clipboard!';
    setTimeout(() => togglePopupVisibility(false), 1500);
  } catch (err: any) {
    console.error("Snaggle Content Script: General copy failed:", err);
    showError(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    if (uiElements.loadingDiv) uiElements.loadingDiv.hidden = true;
  }
}
/* --------------------------------------- */

/* ---------- Message Listener (from Background Script) ---------- */
// Corrected signature from previous step
api.runtime.onMessage.addListener((
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
): boolean | undefined => {
    const msg = message as BackgroundMsgToCS;
    if (msg?.action === 'togglePopup') {
        //console.log("Snaggle Content Script: Received 'togglePopup' message.");
        // Load assets first, then inject/toggle
        loadAssets()
            .then(() => ensurePopupInjected()) // Ensure injected after assets load
            .then(() => togglePopupVisibility()) // Then toggle visibility
            .catch(err => {
                console.error("Snaggle Content Script: Failed to load assets or inject popup UI:", err);
                // Attempt to show error even if injection failed partly
                // Need to ensure error section can be accessed or fallback
                if (uiElements.errorP) {
                    showError(`Failed to display popup UI: ${err?.message ?? 'unknown'}`);
                } else {
                     // Fallback if UI wasn't even injected enough to show error
                     alert(`Snaggle Failed to display popup UI: ${err?.message ?? 'unknown'}`);
                }
            });
        return false; // Synchronous processing for this message type
    }
    console.warn("Snaggle Content Script: Received unhandled message:", message);
    return false; // No asynchronous response needed for unhandled messages
});

// Initial log to confirm content script loaded
console.log('Snaggle Popup UI Content Script Loaded.');