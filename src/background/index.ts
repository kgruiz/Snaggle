// src/background/index.ts

// Import JSZip and TurndownService statically; assign to global to skip dynamic loading
import JSZip from 'jszip';
import TurndownService from 'turndown';
;(self as any).JSZip = JSZip;
;(self as any).TurndownService = TurndownService;

// Import background-safe checkers from the new utils file
import { isChatSite, isGitHubRepoPage, isGeneralSite } from '../utils/site_checkers.js';
// Import markdown converter utility and content exporters
import { convertHtmlToMarkdown } from '../utils/markdown_converter.js';
import { extractChatData } from '../modules/chat_exporter.js';
import { extractPageData } from '../modules/general_exporter.js';

const api = chrome;

// --- Type Definitions ---
interface GitHubFileItem { path: string; type: 'file' | 'dir'; name: string; }
interface RepoInfo { owner: string; repo: string; ref: string; path: string; apiPath: string; }
interface BackgroundMessage {
    action: 'downloadFile' | 'createAndDownloadZip' | 'getSiteData' | 'runExtraction' | 'fetchGitHubData';
    url?: string;
    filename?: string;
    filesToFetch?: GitHubFileItem[];
    repoInfo?: RepoInfo;
    saveAs?: boolean;
    extractionType?: 'chat' | 'general'; // For runExtraction
    format?: 'txt' | 'md' | 'json' | 'pdf'; // For runExtraction
}
// Define the expected structure of the data extracted by content scripts
interface ExtractedContentData {
    content: string;
    filename?: string;
    error?: string;
    requiresMarkdownConversion?: boolean;
}
interface BackgroundResponse {
    success: boolean;
    error?: string;
    downloadId?: number;
    siteType?: 'chat' | 'github' | 'general' | 'unsupported';
    // Use the specific extracted data type here
    extractedData?: ExtractedContentData;
    githubTreeData?: GitHubFileItem[];
    url?: string;
}
// --- End Type Definitions ---

// JSZip and TurndownService are available via static imports; dynamic loading removed

async function loadJSZip(): Promise<void> {
    // No-op; JSZip is available via static import
    return;
}

async function loadTurndown(): Promise<void> {
    // No-op; TurndownService is available via static import
    return;
}


// --- Message Listener (from popup script) ---
api.runtime.onMessage.addListener((message: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: BackgroundResponse) => void): boolean => {
    const action = message.action;
    console.log("Snaggle BG received message:", action, message);

    (async () => {
        try {
            // --- Get Site Data Request ---
            if (action === 'getSiteData') {
                const tab = await getCurrentTab();
                const url = tab.url!;

                let siteType: BackgroundResponse['siteType'] = 'unsupported';
                if (isChatSite(url)) { siteType = 'chat'; }
                else if (isGitHubRepoPage(url)) { siteType = 'github'; }
                else if (isGeneralSite(url)) { siteType = 'general'; }

                console.log(`Snaggle BG: Site type for ${url} is ${siteType}`);
                sendResponse({ success: true, siteType: siteType, url: url });
            }

            // --- Run Extraction Request ---
            else if (action === 'runExtraction') {
                if (!message.extractionType || !message.format) {
                    throw new Error("Missing extraction type or format.");
                }
                const tab = await getCurrentTab();
                const tabId = tab.id!;
                const format = message.format;

                let functionToInject: (...args: any[]) => ExtractedContentData;

                if (message.extractionType === 'chat') {
                    functionToInject = extractChatData;
                } else if (message.extractionType === 'general') {
                    functionToInject = extractPageData;
                } else {
                    throw new Error(`Unsupported extraction type: ${message.extractionType}`);
                }

                console.log(`Snaggle BG: Executing script for ${message.extractionType} (${format}) in tab ${tabId}`);
                // *** FIX: Remove generic parameter from InjectionResult type ***
                let results: chrome.scripting.InjectionResult[];
                try {
                    results = await api.scripting.executeScript({
                        target: { tabId: tabId },
                        func: functionToInject,
                        // For PDF, extract HTML (as 'md') instead of invoking print dialog
                        args: [format === 'pdf' ? 'md' : format],
                        world: 'ISOLATED'
                    });
                } catch (e: any) {
                    throw new Error(`Script injection failed: ${e.message}`);
                }

                if (!results || results.length === 0 || !results[0]) {
                     throw new Error("Extraction script injection returned no results.");
                }

                 // Cast the result, assuming the injected function returns ExtractedContentData
                 const resultData = results[0].result as ExtractedContentData | undefined;

                 if (!resultData) {
                      throw new Error("Extraction script result is missing or undefined.");
                 }
                 // Check for errors reported *by* the injected script itself
                 if (resultData.error && !resultData.content) {
                     throw new Error(`Extraction script failed: ${resultData.error}`);
                 }
                 // Content might be legitimately empty, but check if it's expected
                 if (typeof resultData.content === 'undefined' && format !== 'pdf') {
                      throw new Error("Extraction script returned undefined content.");
                 }

                let extractedData = resultData as ExtractedContentData; // Now safer to assert

                console.log("Snaggle BG: Raw extraction result:", extractedData);

                if ((format === 'md') && extractedData?.requiresMarkdownConversion && extractedData?.content) {
                    console.log("Snaggle BG: Performing Markdown conversion...");
                    await loadTurndown();
                    extractedData.content = convertHtmlToMarkdown(extractedData.content);
                    extractedData.requiresMarkdownConversion = false;
                }

                // Add default filename if missing
                if (!extractedData.filename) {
                   const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
                   let baseName = "export";
                   try {
                       const urlObject = new URL(tab.url || 'http://unknown.com');
                       baseName = urlObject.hostname.replace(/^www\./, '').split('.')[0] || baseName;
                       if (urlObject.protocol === 'file:') {
                           baseName = urlObject.pathname.split('/').pop()?.split('.')[0] || 'file-export';
                       }
                   } catch { /* ignore URL parsing errors */ }
                   extractedData.filename = `${baseName}-${message.extractionType}-${dateStr}.${format}`;
                }
                console.log("Snaggle BG: Sending successful extraction data to popup");
                // Send the correctly typed data
                sendResponse({ success: true, extractedData: extractedData });
            }

            // --- Fetch GitHub Data ---
            else if (action === 'fetchGitHubData') {
                // ... (GitHub fetch logic remains the same)
                if (!message.repoInfo) {
                    throw new Error("Missing repoInfo for GitHub fetch.");
                }
                const { owner, repo, ref, apiPath = '' } = message.repoInfo;
                const cleanApiPath = apiPath.startsWith('/') ? apiPath.substring(1) : apiPath;
                const apiUrl = `${GITHUB_API_BASE}${owner}/${repo}/contents/${cleanApiPath}?ref=${ref}`;
                console.log("Snaggle BG: Fetching GitHub tree from API:", apiUrl);

                const response = await fetch(apiUrl, { headers: { 'Accept': 'application/vnd.github.v3+json' } });

                if (!response.ok) {
                    let errorMsg = `GitHub API Error: ${response.status} ${response.statusText}`;
                    try {
                        const errData = await response.json();
                        if (errData?.message) errorMsg += ` - ${errData.message}`;
                        if (response.status === 404) errorMsg = `Repo, branch, or path not found ('${cleanApiPath || 'root'}'). Check URL/permissions.`;
                        if (response.status === 403) errorMsg = `Access denied (Rate limit? Private repo?). Check token/permissions.`;
                    } catch { /* Ignore JSON parsing error on error response */ }
                    throw new Error(errorMsg);
                }

                const data: any | any[] = await response.json();
                let itemsToProcess: any[];
                if (!Array.isArray(data)) {
                    if (typeof data === 'object' && data !== null && data.type === 'file') itemsToProcess = [data];
                    else throw new Error("Unexpected GitHub API response format (expected array or single file).");
                } else itemsToProcess = data;

                const files: GitHubFileItem[] = itemsToProcess
                     .map(item => {
                         const mappedItem = {
                             name: item.name,
                             path: item.path,
                             type: (item.type === 'dir') ? 'dir' : 'file'
                         };
                         if (item.type === 'file' || item.type === 'dir') {
                             return mappedItem as GitHubFileItem;
                         }
                         console.warn(`Snaggle BG: Filtering out GitHub item with unexpected type '${item.type}':`, item.path);
                         return null;
                     })
                     .filter((item): item is GitHubFileItem => item !== null)
                     .sort((a, b): number => {
                         const typeOrder = { 'dir': 0, 'file': 1 };
                         const typeA = typeOrder[a.type as 'dir' | 'file'];
                         const typeB = typeOrder[b.type as 'dir' | 'file'];
                         if (typeA !== typeB) return typeA - typeB;
                         return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: 'base' });
                     });

                 console.log("Snaggle BG: Sending GitHub tree data to popup");
                 sendResponse({ success: true, githubTreeData: files });
            }

            // --- Download File Request ---
            else if (action === "downloadFile") {
                // ... (Download file logic remains the same, using try/catch)
                if (!message.url || !message.filename) {
                    throw new Error("Missing URL or filename for downloadFile.");
                }
                const allowedSchemes = ['blob:', 'data:', 'http:', 'https:'];
                const urlScheme = message.url.substring(0, message.url.indexOf(':') + 1);
                if (!allowedSchemes.includes(urlScheme)) {
                    throw new Error(`Invalid URL scheme for download: ${urlScheme}`);
                }
                const downloadOptions: chrome.downloads.DownloadOptions = {
                    url: message.url,
                    filename: message.filename,
                    saveAs: message.saveAs ?? true
                };

                let downloadId: number | undefined;
                try {
                    downloadId = await api.downloads.download(downloadOptions);
                } catch (e: any) {
                     throw new Error(`Download initiation failed: ${e.message}`);
                }

                if (downloadId === undefined || downloadId === 0) {
                    throw new Error("Download initiation failed (invalid ID returned or zero).");
                }
                console.log(`Snaggle BG: Download started: ${downloadId}`);
                sendResponse({ success: true, downloadId: downloadId });
            }

            // --- Create and Download ZIP Request ---
            else if (action === "createAndDownloadZip") {
                // ... (ZIP logic remains the same, using try/catch)
                await loadJSZip();
                if (typeof JSZip === 'undefined') {
                    throw new Error("JSZip library not loaded for ZIP creation.");
                }
                if (!message.filesToFetch || !message.repoInfo) {
                    throw new Error("Missing filesToFetch or repoInfo for ZIP.");
                }
                console.log("Snaggle BG: Starting ZIP creation process...");
                const blob = await createZip(message.filesToFetch, message.repoInfo, message.filename || 'github-download.zip');

                console.log("Snaggle BG: ZIP Blob created, size:", blob.size);
                const blobUrl = URL.createObjectURL(blob);
                let downloadId : number | undefined;
                try {
                    const downloadOptions: chrome.downloads.DownloadOptions = {
                        url: blobUrl,
                        filename: message.filename || 'github-download.zip',
                        saveAs: true
                    };
                    try {
                         downloadId = await api.downloads.download(downloadOptions);
                    } catch (e: any) {
                         URL.revokeObjectURL(blobUrl);
                         throw new Error(`ZIP Download initiation failed: ${e.message}`);
                    }
                } finally {
                    setTimeout(() => {
                        console.log("Snaggle BG: Revoking ZIP blob URL:", blobUrl);
                        URL.revokeObjectURL(blobUrl);
                    }, 15000);
                }

                if (downloadId === undefined || downloadId === 0) {
                    throw new Error("ZIP Download initiation failed (invalid ID returned or zero).");
                }
                console.log(`Snaggle BG: ZIP Download started: ${downloadId}`);
                sendResponse({ success: true, downloadId: downloadId });
            }

            // --- Unhandled Action ---
            else {
                 console.warn("Snaggle BG: Unhandled message action:", action);
                 sendResponse({ success: false, error: `Unhandled action: ${action}` });
            }
        } catch (error: any) {
            console.error(`Snaggle BG: Error processing action "${action}":`, error);
            sendResponse({ success: false, error: error.message || "An unknown background error occurred." });
        }
    })();

    return true;
});


// --- Helper Functions ---
async function getCurrentTab(): Promise<chrome.tabs.Tab> {
    // ... (getCurrentTab implementation remains the same, using try/catch)
    let tabs: chrome.tabs.Tab[];
    try {
        tabs = await api.tabs.query({ active: true, currentWindow: true });
    } catch (e: any) {
        console.warn(`Error querying active tab in current window: ${e.message}. Trying last focused window.`);
        tabs = [];
    }

    let tab = tabs?.[0];

    if (!tab) {
        console.log("Snaggle BG: No active tab in current window, trying last focused window.");
        try {
            tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
        } catch (e: any) {
             throw new Error(`Could not get active tab: ${e.message}`);
        }
         tab = tabs?.[0];
    }

    if (!tab) {
        throw new Error("Could not find the active tab in current or last focused window.");
    }
    if (!tab.id) {
        throw new Error("Active tab is missing an ID.");
    }
    if (!tab.url) {
        console.warn("Active tab is missing a complete URL (may be a chrome:// page or new tab):", tab);
        throw new Error("Active tab is missing a URL.");
    }
    return tab;
}


const GITHUB_API_BASE: string = "https://api.github.com/repos/";

// createZip function remains the same
async function createZip(filesToFetch: GitHubFileItem[], repoInfo: RepoInfo, filename: string): Promise<Blob> {
     // ... (createZip implementation remains the same)
     if (typeof JSZip === 'undefined') { throw new Error("JSZip is not available for ZIP creation."); }
     const zip = new JSZip();
     const { owner, repo, ref } = repoInfo;
     console.log(`Snaggle BG: Adding ${filesToFetch.length} items to ZIP for ${owner}/${repo}#${ref}`);

     const results = await Promise.allSettled(filesToFetch.map(async (item) => {
         const itemPath = item.path || '';
         const cleanItemPath = itemPath.startsWith('/') ? itemPath.substring(1) : itemPath;

         if (item.type === 'file') {
             const apiUrl = `${GITHUB_API_BASE}${owner}/${repo}/contents/${cleanItemPath}?ref=${ref}`;
             try {
                  console.log(`Snaggle BG Zip: Fetching file ${cleanItemPath}`);
                 const response = await fetch(apiUrl, { headers: { 'Accept': 'application/vnd.github.raw+json' } });
                 if (!response.ok) {
                     console.warn(`Snaggle BG Zip: Raw fetch failed for ${cleanItemPath} (${response.status}), trying v3.raw...`);
                     const mediaResponse = await fetch(apiUrl, { headers: { 'Accept': 'application/vnd.github.v3.raw' } });
                      if (!mediaResponse.ok) {
                           let errorMsg = `API Error ${mediaResponse.status}`;
                           try { const errText = await mediaResponse.text(); errorMsg += `: ${errText.substring(0, 100)}`; } catch { }
                           throw new Error(`${errorMsg} fetching ${cleanItemPath}`);
                      }
                      const content: Blob = await mediaResponse.blob();
                      zip.file(itemPath, content, { binary: true });
                      console.log(`Snaggle BG Zip: Added file ${itemPath} (${content.size} bytes) via fallback`);
                 } else {
                     const content: Blob = await response.blob();
                     zip.file(itemPath, content, { binary: true });
                     console.log(`Snaggle BG Zip: Added file ${itemPath} (${content.size} bytes)`);
                 }
                 return { status: 'fulfilled', path: itemPath };
             } catch (error: any) {
                 console.error(`Snaggle BG Zip: Failed file ${itemPath}:`, error);
                 zip.file(itemPath + ".error.txt", `Failed to fetch '${itemPath}':\n${error.message}\nAPI URL: ${apiUrl}`);
                 return Promise.reject({ path: itemPath, reason: error.message });
             }
         } else if (item.type === 'dir') {
             zip.folder(itemPath);
             console.log(`Snaggle BG Zip: Added folder ${itemPath}`);
             return { status: 'fulfilled', path: itemPath };
         } else {
             console.warn(`Snaggle BG Zip: Skipping unknown item type '${item.type}' for path '${itemPath}'`);
             return { status: 'fulfilled', path: itemPath, skipped: true };
         }
     }));

     const failedItems = results.filter(r => r.status === 'rejected');
     if (failedItems.length > 0) {
        console.error(`Snaggle BG Zip: ${failedItems.length} item(s) failed during ZIP creation.`);
        failedItems.forEach(result => {
            if (result.status === 'rejected') {
                const failedInfo = result.reason as { path?: string; reason?: string } | string;
                const path = typeof failedInfo === 'object' ? failedInfo.path : 'unknown path';
                const reason = typeof failedInfo === 'object' ? failedInfo.reason : failedInfo;
                console.error(` - Failed: ${path}, Reason: ${reason}`);
            }
        });
     } else {
         console.log("Snaggle BG Zip: All selected items processed for ZIP.");
     }

     console.log("Snaggle BG: Generating final ZIP blob...");
     return zip.generateAsync({
         type: "blob",
         compression: "DEFLATE",
         compressionOptions: { level: 6 }
     });
 }

console.log("Snaggle Background Service Worker Loaded");