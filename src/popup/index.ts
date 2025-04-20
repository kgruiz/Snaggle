/* eslint-disable max-lines */
// --------------------------------------------------
// Snaggle Popup – full script (MV3 + TypeScript)
// --------------------------------------------------
import './popup.css'; // Ensure CSS is imported

// Import functions from modules
import { isChatSite, extractChatData } from '../modules/chat_exporter';
import { isGitHubRepoPage, parseRepoUrl, toggleSelectAll, getSelectedItems, areAllSelected, displayFileTree } from '../modules/github_downloader';
import { isGeneralSite, convertHtmlToMarkdown } from '../modules/general_exporter';
import { extractDataForInjection } from '../content/extractGeneralData';

// Declare global variables provided by external scripts (like Turndown)
declare var TurndownService: any;
const api = chrome; // Use chrome namespace directly

/* ---------- helper types ---------- */
// Interfaces matching external structures or message formats
interface GitHubFileItem { path: string; type: 'file' | 'dir'; name: string; }
interface RepoInfo        { owner: string; repo: string; ref: string; apiPath: string; }

// Message definition for communication with background script
interface BackgroundMsg   {
    action: 'downloadFile' | 'createAndDownloadZip';
    url?: string;
    filename?: string;
    filesToFetch?: GitHubFileItem[];
    repoInfo?: Pick<RepoInfo, 'owner' | 'repo' | 'ref'>; // Only pass needed info
    saveAs?: boolean; // Used by downloadFile to prompt for save location
}
// Response definition from background script
interface BackgroundRes   { success: boolean; error?: string; downloadId?: number; }

// Result structure for chat extraction (Should match return type of extractChatData)
type ChatResult = ReturnType<typeof extractChatData>;
// Result structure for general page extraction
type PageResult = ReturnType<typeof extractDataForInjection>;

// *** FIX: Revert InjectionResult type alias to be non-generic ***
type InjectionResult = chrome.scripting.InjectionResult;
type InjectionResults = InjectionResult[];
/* ----------------------------------- */

/* ---------- DOM cache ---------- */
// Cache frequently accessed DOM elements for performance
const loadingDiv         = document.getElementById('loading')             as HTMLDivElement | null;
const chatSection        = document.getElementById('chat-exporter')       as HTMLDivElement | null;
// Corrected typo
const githubSection      = document.getElementById('github-downloader')   as HTMLDivElement | null;
const generalSect        = document.getElementById('general-exporter')    as HTMLDivElement | null;
const unsupported        = document.getElementById('unsupported-site')    as HTMLDivElement | null;
const errorSection       = document.getElementById('error-section')       as HTMLDivElement | null;
const errorP             = document.getElementById('error-message')       as HTMLParagraphElement | null;
// Cache the new toggle switch for the general exporter
const actionToggleSwitch = document.getElementById('action-toggle-switch') as HTMLInputElement | null;
/* -------------------------------- */

/* ---------- small helpers ---------- */

// Hides all main sections except the one specified by ID
function showSection(id: string): void {
  if (loadingDiv)   loadingDiv.hidden   = true; // Always hide loading when showing a section
  if (chatSection)  chatSection.hidden  = id !== 'chat-exporter';
  if (githubSection)githubSection.hidden= id !== 'github-downloader';
  if (generalSect)  generalSect.hidden  = id !== 'general-exporter';
  if (unsupported)  unsupported.hidden  = id !== 'unsupported-site';
  if (errorSection) errorSection.hidden = id !== 'error-section'; // Also hide error section initially

  // Ensure the target section is shown (if it exists)
  const sectionToShow = document.getElementById(id);
  if (sectionToShow) {
    sectionToShow.hidden = false;
  }
}

// Shows the loading indicator with a specific message
function showLoading(msg = 'Loading…'): void {
  if (loadingDiv) {
    loadingDiv.textContent = msg;
    loadingDiv.hidden = false;
    // Hide all other sections when loading is shown
    showSection(''); // Pass empty ID to hide all regular sections
  }
}

// Shows the error section with a specific message
function showError(msg: string): void {
  if (errorP) errorP.textContent = msg;
  showSection('error-section'); // Show only the error section
}

// Sanitizes a string to be safe for use as a filename
function sanitizeFilename(name = 'untitled'): string {
  // Remove invalid filename characters, replace whitespace/dots, trim ends, limit length
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') // Replace invalid chars with underscore
    .replace(/[\s._]+/g, '_') // Replace sequences of whitespace, dots, underscores with a single underscore
    .replace(/^[._\s]+|[._\s]+$/g, '') // Trim leading/trailing underscores, dots, whitespace
    .slice(0, 150) || 'untitled'; // Limit length and provide default if empty
}

// Helper function to initiate a download via the background script
/**
 * Sends a message to the background script to download a file created from content.
 * @param content The file content (string).
 * @param filename Desired filename (should be sanitized).
 * @param mime MIME type (e.g., 'text/plain;charset=utf-8').
 * @param saveAs If true, prompt the user for save location via browser dialog.
 */
function triggerDownload(content: string, filename: string, mime = 'text/plain;charset=utf-8', saveAs = false): void {
  try {
    // Create a Blob from the content
    const blob = new Blob([content], { type: mime });
    // Create an Object URL for the Blob
    const url  = URL.createObjectURL(blob);

    // Send message to background script including the saveAs preference
    api.runtime.sendMessage({
      action: 'downloadFile',
      url: url,
      filename: filename, // Pass the sanitized filename
      saveAs: saveAs // Pass the saveAs preference
    })
    .then(res => {
      const resp = res as BackgroundRes | undefined;
      if (!resp?.success) {
        // Show error message from background or a generic one
        showError(`Download failed: ${resp?.error ?? 'Unknown background error'}`);
      } else {
         // Update UI to indicate download started
         if (loadingDiv && !loadingDiv.hidden) { // Check if loading indicator is still visible
            loadingDiv.textContent = 'Download started!';
         }
         console.log(`Snaggle: Download initiated (ID: ${resp.downloadId}) for ${filename}, saveAs=${saveAs}`);
      }
      // Revoke the object URL after a delay to allow the download process to start
      // This is important to free up memory
      setTimeout(() => URL.revokeObjectURL(url), 60_000); // 60 seconds delay
    })
    .catch(err => {
      // Handle errors during message sending (e.g., background script not available)
      showError(`Failed to send download message: ${err?.message ?? 'unknown'}`);
      URL.revokeObjectURL(url); // Revoke immediately on send error
    });
  } catch (err: any) {
    // Handle errors during Blob or Object URL creation
    showError(`Download preparation error: ${err?.message ?? 'unknown'}`);
  }
}
/* ----------------------------------- */

/* ---------- main startup ---------- */
// This runs when the popup's DOM is fully loaded
document.addEventListener('DOMContentLoaded', async () => {
  showLoading('Detecting site…'); // Show loading message initially
  try {
    // Get the currently active tab in the current window
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    // Ensure we have a valid tab with ID and URL
    if (!tab?.id || !tab?.url) throw new Error('Active tab missing data.');

    const url = tab.url;
    // Determine the type of site based on the URL using helper functions from imported modules
    const isChatSiteDetected    = isChatSite(url);
    const isGitHubRepoDetected  = isGitHubRepoPage(url);
    // Check for general site *last*, ensuring it's not a specific type and has a supported protocol
    const isGeneralSiteDetected = !isChatSiteDetected && !isGitHubRepoDetected && isGeneralSite(url);

    // Setup the appropriate listeners and show the relevant UI section
    if (isChatSiteDetected)       { setupChatListeners(tab);      showSection('chat-exporter'); }
    else if (isGitHubRepoDetected){ setupGitHubListeners(tab,url);showSection('github-downloader'); }
    else if (isGeneralSiteDetected){ setupGeneralListeners(tab);   showSection('general-exporter'); }
    else               { showSection('unsupported-site'); } // Show if none of the above match

  } catch (err: any) {
    // Display any errors that occur during this initial setup
    showError(`Initialization error: ${err?.message ?? 'unknown'}`);
  }
});
/* ---------------------------------- */

/* ---------- listener setup ---------- */

// Sets up listeners for the Chat Exporter buttons
function setupChatListeners(tab: chrome.tabs.Tab): void {
    // These buttons always trigger a direct download (saveAs=false by default in triggerDownload)
    document.getElementById('chat-txt')?.addEventListener('click', () => handleChatExport(tab,'txt'));
    document.getElementById('chat-md')?.addEventListener('click', () => handleChatExport(tab,'md'));
    document.getElementById('chat-json')?.addEventListener('click', () => handleChatExport(tab,'json'));
}

// Sets up listeners for the GitHub Downloader section
function setupGitHubListeners(tab: chrome.tabs.Tab, url: string): void {
    // Cache GitHub specific UI elements
    const dlBtn = document.getElementById('github-download-zip') as HTMLButtonElement | null;
    const selAll= document.getElementById('github-select-all')   as HTMLInputElement | null;
    const tree  = document.getElementById('github-file-tree')    as HTMLDivElement | null;
    // Ensure all required elements are present before proceeding
    if (!dlBtn || !selAll || !tree) { showError('GitHub UI elements missing.'); return; }

    // Main download button triggers the ZIP creation/download process
    dlBtn.addEventListener('click', () => handleGitHubDownload(tab,url));

    // "Select All" checkbox functionality
    selAll.addEventListener('change', (e) => {
      const isChecked = (e.target as HTMLInputElement).checked;
      toggleSelectAll(isChecked); // Update underlying checkboxes using imported function
      dlBtn.disabled = getSelectedItems().length === 0; // Enable/disable download button
    });

    // Listen for changes on individual file/folder checkboxes within the tree
    tree.addEventListener('change', (e) => {
      if ((e.target as HTMLElement).matches('input[type="checkbox"]')) {
        const selectedItems = getSelectedItems();
        const anySelected = selectedItems.length > 0;
        dlBtn.disabled = !anySelected; // Enable/disable download button
        selAll.checked = anySelected && areAllSelected(); // Update "Select All" state
      }
    });

    // Populate the file tree when the section is shown using imported function
    displayFileTree(tab, url)
        .catch(err => showError(`Failed to display GitHub tree: ${err.message}`)); // Handle potential errors
}

// Sets up listeners for the General Exporter section (including the toggle)
function setupGeneralListeners(tab: chrome.tabs.Tab): void {
  // Check if the crucial toggle switch element exists
  if (!actionToggleSwitch) {
    showError("Action toggle switch UI element not found.");
    return; // Cannot proceed without the toggle
  }

  // PDF Button - Always triggers the print dialog handler
  document.getElementById('general-pdf')?.addEventListener('click', () => handleGeneralPdfExport(tab));

  // Markdown Button - Routes to the action handler which checks the toggle
  document.getElementById('general-md')?.addEventListener('click', () => handleGeneralAction(tab, 'md'));

  // Text Button - Routes to the action handler which checks the toggle
  document.getElementById('general-txt')?.addEventListener('click', () => handleGeneralAction(tab, 'txt'));
}
/* ------------------------------------ */


/* ---------- chat export (triggers download) ---------- */
// Handles exporting chat logs as TXT, MD, or JSON files.
async function handleChatExport(tab: chrome.tabs.Tab, format: 'txt'|'md'|'json'): Promise<void> {
    showLoading(`Exporting chat as ${format.toUpperCase()}...`);
    if (!tab.id) { showError("Tab ID missing."); return; }
    try {
        // *** FIX: Use inline function and 'arguments' object for executeScript ***
        const results: InjectionResults = await api.scripting.executeScript({
            target: { tabId: tab.id },
            // Define an inline, parameterless function for 'func'
            func: (): ChatResult => {
                // This code runs IN THE CONTENT SCRIPT context.
                // It accesses the 'format' value passed via 'args' using the 'arguments' object.
                const formatArg = (arguments && arguments.length > 0)
                                    ? arguments[0] as ('txt' | 'md' | 'json')
                                    : undefined;

                if (!formatArg) {
                    console.error("Snaggle Content Script: Format argument not received.");
                    return { content: '', filename: 'error-args.txt', error: 'Format argument not received in content script' };
                }

                // Check if the main extraction function is available in this context.
                // IMPORTANT: This requires 'extractChatData' to be available globally
                // in the content script or injected separately.
                if (typeof extractChatData !== 'function') {
                     console.error("Snaggle Content Script: extractChatData function not found.");
                     return { content: '', filename: 'error-func.txt', error: 'extractChatData function not available in content script.' };
                 }

                // Call the actual extraction logic
                return extractChatData(formatArg);
            },
            args: [format] // Pass the 'format' variable as an argument
        });

        // Check results array before accessing
        if (!results || results.length === 0 || !results[0]) {
            throw new Error("Chat extraction script did not return a result.");
        }
        // Access the result from the first frame's execution
        // Assert the type of the result for type safety
        const extracted = results[0].result as ChatResult | undefined;

        // Handle potential errors from the extraction script
        if (!extracted) { // Handles null/undefined result
             throw new Error("Chat extraction result is empty or invalid.");
        }
        if (extracted.error) { // Check error property within the result object
             throw new Error(`Chat extraction error: ${extracted.error}`);
        }

        let finalContent = extracted.content;
        // Perform Markdown conversion if necessary
        if (format === 'md' && extracted.requiresMarkdownConversion) {
            if (typeof TurndownService !== 'undefined') {
                // Use imported convertHtmlToMarkdown for consistency if preferred,
                // otherwise direct Turndown usage is fine.
                finalContent = convertHtmlToMarkdown(finalContent);
            } else {
                console.warn("Snaggle: Turndown library missing for chat MD conversion.");
                finalContent = "<!-- Turndown library missing -->\n\n" + finalContent;
            }
        }

        // Prepare filename and MIME type
        const filename = sanitizeFilename(extracted.filename || `chat-export.${format}`);
        const mime = format === 'json' ? 'application/json' : format === 'md' ? 'text/markdown' : 'text/plain';

        // Trigger download using the helper (default saveAs=false, no prompt)
        triggerDownload(finalContent, filename, `${mime};charset=utf-8`);

        // Close the popup after a short delay
        setTimeout(() => window.close(), 1500);
    } catch (err: any) {
        // Catch errors from executeScript or subsequent processing
        // Log the detailed error for debugging
        console.error("Snaggle: Chat export executeScript failed:", err);
        showError(`Chat export failed: ${err instanceof Error ? err.message : String(err)}`);
        if (loadingDiv) loadingDiv.hidden = true; // Hide loading indicator on error
    }
}
/* ---------------------------------------------- */

/* ---------- GitHub download (triggers zip download) ---------- */
// Handles downloading selected files/folders from GitHub as a ZIP.
async function handleGitHubDownload(tab: chrome.tabs.Tab, url: string): Promise<void> {
     showLoading("Preparing ZIP download...");
    if (!tab.id) { showError("Tab ID missing."); return; }
    try {
        const selectedItems = getSelectedItems(); // Use imported function
        // Ensure items are selected before proceeding
        if (selectedItems.length === 0) {
            showError("No files or folders selected for download.");
            if (loadingDiv) loadingDiv.hidden = true; // Hide loading as we stop here
            return;
         }
        // Parse repo info needed for the background script API calls
        const repoInfo = parseRepoUrl(url); // Use imported function
        const filename = sanitizeFilename(`${repoInfo.repo}-${repoInfo.ref}-download.zip`);

        // Send message to background script to handle fetching and zipping
        api.runtime.sendMessage({
            action: 'createAndDownloadZip',
            filesToFetch: selectedItems,
            repoInfo: { owner: repoInfo.owner, repo: repoInfo.repo, ref: repoInfo.ref }, // Pass only needed info
            filename: filename
            // Note: saveAs for ZIP is currently hardcoded to false in background.ts
        }).then(res => {
            const resp = res as BackgroundRes | undefined;
            if (!resp?.success) {
                 showError(`ZIP Download failed: ${resp?.error ?? 'Unknown background error'}`);
            } else {
                if (loadingDiv) loadingDiv.textContent = 'ZIP Download started!';
                 setTimeout(() => window.close(), 1500); // Close popup after success
            }
        }).catch(err => {
            // Handle errors sending the message to the background script
            showError(`Failed to send ZIP request: ${err?.message ?? 'unknown'}`);
        });
    } catch (err: any) {
        // Handle errors during setup (getting items, parsing URL)
        showError(`GitHub download failed: ${err?.message ?? 'Unknown error'}`);
        if (loadingDiv) loadingDiv.hidden = true; // Hide loading indicator on error
    }
}
/* -------------------------------------------------- */

// ----- General Exporter Handlers -----

/**
 * Intermediate handler for General Exporter MD and TXT buttons.
 * Checks the state of the toggle switch (#action-toggle-switch) and
 * delegates to either the copy or download handler.
 */
function handleGeneralAction(tab: chrome.tabs.Tab, format: 'md' | 'txt'): void {
  // Ensure the toggle switch element is available
  if (!actionToggleSwitch) {
    showError("Cannot determine action: Toggle switch not found in UI.");
    return;
  }

  // Read the state of the toggle switch:
  // - `checked = true` means the user wants to Download.
  // - `checked = false` means the user wants to Copy.
  const shouldDownload = actionToggleSwitch.checked;

  // Call the appropriate final handler function based on the toggle state
  if (shouldDownload) {
    console.log(`Snaggle: Action toggle is ON (Download) for ${format.toUpperCase()}`);
    handleGeneralDownload(tab, format);
  } else {
    console.log(`Snaggle: Action toggle is OFF (Copy) for ${format.toUpperCase()}`);
    handleGeneralCopy(tab, format);
  }
}

/**
 * Handles triggering the browser's Print Dialog for saving as PDF.
 * This action is independent of the Copy/Download toggle.
 */
async function handleGeneralPdfExport(tab: chrome.tabs.Tab): Promise<void> {
  showLoading(`Opening print dialog for PDF…`);
  if (!tab.id) { showError('Tab ID missing.'); return; }
  try {
    // Execute a simple script in the target tab to call window.print()
    await api.scripting.executeScript({
        target:{ tabId: tab.id },
        func: () => window.print()
    });
    // Close the popup shortly after, assuming the print dialog is now open
    setTimeout(() => window.close(), 500);
  } catch (err: any) {
    showError(`Failed to open print dialog: ${err?.message ?? 'unknown'}`);
    if (loadingDiv) loadingDiv.hidden = true; // Hide loading indicator on failure
  }
}

/**
 * Final handler: Handles DOWNLOADING the page content as MD or TXT.
 * Called by `handleGeneralAction` when the toggle is set to Download.
 * It prompts the user for a save location (`saveAs=true`).
 */
async function handleGeneralDownload(tab: chrome.tabs.Tab, format: 'txt'|'md'): Promise<void> {
  showLoading(`Preparing ${format.toUpperCase()} download…`);
  if (!tab.id) { showError('Tab ID missing.'); return; }

  try {
    // 1. Extract page content using content script
    // Use the non-generic InjectionResults type
    const results: InjectionResults = await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractDataForInjection, // This function takes no args, so it's fine directly
        args: []
    });
    // Check results array before accessing
    if (!results || results.length === 0 || !results[0]) {
        throw new Error("Page data extraction script did not return a result.");
    }
    // Assert the type of the result for type safety
    const extracted = results[0].result as PageResult | undefined;
    if (!extracted) {
         throw new Error("Page data extraction result is empty or invalid.");
    }
    if (extracted.error) {
        throw new Error(`Page data extraction error: ${extracted.error}`);
    }

    let finalContent = extracted.content;
    // 2. Convert to Markdown if requested format is MD and content requires it
    if (format === 'md' && (extracted.requiresMarkdownConversion ?? false)) {
       showLoading('Converting HTML to Markdown...'); // Update loading message
       if (typeof TurndownService !== 'undefined') {
           finalContent = convertHtmlToMarkdown(finalContent); // Use imported function
       } else {
           console.warn("Snaggle: Turndown library missing for MD download.");
           finalContent = "<!-- Turndown library was not available for Markdown conversion -->\n\n" + finalContent;
       }
    }

    // 3. Prepare filename and MIME type
    const baseFilename = sanitizeFilename(tab.title || 'page-export');
    const filename = `${baseFilename}.${format}`;
    const mime = format === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8';

    // 4. Trigger the download, ensuring saveAs is true to prompt user
    triggerDownload(finalContent, filename, mime, true); // *** saveAs = true ***

    // Close popup after initiating download (may close before user finishes save dialog)
    setTimeout(() => window.close(), 1500);

  } catch (err: any) {
    showError(`Download failed: ${err?.message ?? 'unknown'}`);
    if (loadingDiv) loadingDiv.hidden = true; // Hide loading on error
  }
}

/**
 * Final handler: Handles COPYING the page content to the clipboard as MD or TXT.
 * Called by `handleGeneralAction` when the toggle is set to Copy.
 */
async function handleGeneralCopy(tab: chrome.tabs.Tab, format: 'txt'|'md'): Promise<void> {
  showLoading(`Preparing to copy as ${format.toUpperCase()}…`);
  if (!tab.id) { showError('Tab ID missing.'); return; }

  try {
    // 1. Extract page content using content script
    // Use the non-generic InjectionResults type
    const results: InjectionResults = await api.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractDataForInjection, // This function takes no args, fine directly
        args: []
    });
    // Check results array before accessing
     if (!results || results.length === 0 || !results[0]) {
        throw new Error("Page data extraction script did not return a result.");
    }
    // Assert the type of the result for type safety
    const extracted = results[0].result as PageResult | undefined;
     if (!extracted) {
         throw new Error("Page data extraction result is empty or invalid.");
     }
     if (extracted.error) {
         throw new Error(`Page data extraction error: ${extracted.error}`);
     }

    let finalContent = extracted.content;
    // 2. Convert to Markdown if requested format is MD and content requires it
     if (format === 'md' && (extracted.requiresMarkdownConversion ?? false)) {
       showLoading('Converting HTML to Markdown for copy...'); // Update loading message
       if (typeof TurndownService !== 'undefined') {
           finalContent = convertHtmlToMarkdown(finalContent); // Use imported function
        } else {
           console.warn("Snaggle: Turndown library missing for MD copy.");
           finalContent = "<!-- Turndown library was not available for Markdown conversion -->\n\n" + finalContent;
       }
    }

    // 3. Use the Clipboard API to write the content
    await navigator.clipboard.writeText(finalContent);

    // 4. Update UI and close popup
    if (loadingDiv) loadingDiv.textContent = 'Copied to clipboard!';
    setTimeout(() => window.close(), 1500);

  } catch (err: any) {
    // Handle errors from extraction, conversion, or clipboard API
    showError(`Copy failed: ${err?.message ?? 'unknown'}`);
    if (loadingDiv) loadingDiv.hidden = true; // Hide loading on error
  }
}
/* --------------------------------------- */

console.log('Snaggle Popup Script Loaded.');