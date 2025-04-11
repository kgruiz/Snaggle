// JSZip types are often included with the library itself, or globally available after importScripts.
// We use 'declare var' to tell TS about the global variable created by importScripts.
declare var JSZip: typeof import('jszip');

// Use chrome.* APIs with types from @types/chrome
const api = chrome;

// --- Type Definitions (Consider moving to a shared types file later) ---
interface GitHubFileItem {
    path: string;
    type: 'file' | 'dir';
    name: string;
}
interface RepoInfo {
    owner: string;
    repo: string;
    ref: string;
}
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
// --- End Type Definitions ---


// Listener with typed parameters
api.runtime.onMessage.addListener((message: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: BackgroundResponse) => void): boolean | undefined => {
    console.log("Snaggle Background received message:", message);

    if (message.action === "downloadFile") {
        if (!message.url || !message.filename) {
            console.error("Snaggle: Missing URL or filename for downloadFile action.");
            sendResponse({ success: false, error: "Missing URL or filename." });
            return false; // Synchronous response indicates error
        }
        api.downloads.download({
            url: message.url,
            filename: message.filename,
            saveAs: false
        }).then(downloadId => {
            if (downloadId) {
                 console.log(`Snaggle: Download started with ID: ${downloadId}`);
                 // Check lastError for potential issues even on promise success
                 if (api.runtime.lastError) {
                    console.error(`Snaggle: Download failed (lastError): ${api.runtime.lastError.message}`);
                    sendResponse({ success: false, error: api.runtime.lastError.message });
                 } else sendResponse({ success: true, downloadId: downloadId });
            } else { // downloadId might be 0 or undefined on failure
                 if (api.runtime.lastError) {
                     console.error(`Snaggle: Download initiation failed (lastError): ${api.runtime.lastError.message}`);
                     sendResponse({ success: false, error: api.runtime.lastError.message });
                 } else {
                     console.error(`Snaggle: Download initiation failed (no ID, no error). URL: ${message.url}`);
                     sendResponse({ success: false, error: "Download could not be initiated." });
                 }
            }
        }).catch((error: Error) => { // Catch promise rejections
            console.error(`Snaggle: Download promise failed: ${error.message}`);
            sendResponse({ success: false, error: error.message });
        });
        return true; // Indicates asynchronous response

    } else if (message.action === "createAndDownloadZip") {
        // Check if JSZip loaded correctly (it should be global after importScripts)
        if (typeof JSZip === 'undefined') {
             console.error("Snaggle: JSZip library not loaded or available.");
             sendResponse({ success: false, error: "JSZip library not loaded." });
             return false; // Synchronous response indicates error
        }
        if (!message.filesToFetch || !message.repoInfo) {
             console.error("Snaggle: Missing files or repoInfo for createAndDownloadZip action.");
             sendResponse({ success: false, error: "Missing filesToFetch or repoInfo." });
             return false; // Synchronous response indicates error
        }

        let blobUrl: string | null = null;
        createZip(message.filesToFetch, message.repoInfo, message.filename || 'github-download.zip')
            .then((blob: Blob) => {
                blobUrl = URL.createObjectURL(blob);
                return api.downloads.download({
                    url: blobUrl,
                    filename: message.filename || 'github-download.zip',
                    saveAs: false
                });
            })
            .then((downloadId?: number) => { // downloadId can be undefined if failed
                if (downloadId) {
                     console.log(`Snaggle: ZIP Download started with ID: ${downloadId}`);
                      if (api.runtime.lastError) { // Check lastError
                         console.error(`Snaggle: ZIP Download failed (lastError): ${api.runtime.lastError.message}`);
                         sendResponse({ success: false, error: api.runtime.lastError.message });
                     } else sendResponse({ success: true, downloadId: downloadId });
                } else { // No downloadId returned
                     if (api.runtime.lastError) {
                         console.error(`Snaggle: ZIP Download initiation failed (lastError): ${api.runtime.lastError.message}`);
                         sendResponse({ success: false, error: api.runtime.lastError.message });
                     } else {
                         console.error(`Snaggle: ZIP Download initiation failed (no ID, no error).`);
                         sendResponse({ success: false, error: "ZIP Download could not be initiated." });
                     }
                }
            })
            .catch((error: Error) => { // Catch promise rejections
                console.error(`Snaggle: ZIP Creation/Download promise failed: ${error.message}`);
                sendResponse({ success: false, error: error.message });
            })
            .finally(() => {
                // Ensure blob URL is revoked whether download succeeded or failed
                if (blobUrl) {
                    console.log("Snaggle: Revoking ZIP blob URL.");
                    // Revoke after a delay to ensure download can start
                    setTimeout(() => {
                        if (blobUrl) URL.revokeObjectURL(blobUrl);
                    } , 60000);
                    blobUrl = null; // Clear reference
                }
            });
        return true; // Indicates asynchronous response
    }

    // If message not handled, return false or undefined
    // console.warn("Snaggle: Unhandled background message action:", message.action);
});

// --- GitHub Zip Creation Helper ---
async function createZip(filesToFetch: GitHubFileItem[], repoInfo: RepoInfo, filename: string): Promise<Blob> {
    if (typeof JSZip === 'undefined') {
        throw new Error("JSZip is not available in createZip function.");
    }
    const zip = new JSZip();
    const { owner, repo, ref } = repoInfo;
    console.log("Snaggle: Fetching files for ZIP:", filesToFetch);

    const fetchPromises = filesToFetch.map(async (item) => {
        if (item.type === 'file') {
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${item.path}?ref=${ref}`;
            try {
                const response = await fetch(apiUrl, { headers: { 'Accept': 'application/vnd.github.v3.raw' } });
                if (!response.ok) {
                    let errorMsg = `GitHub API error: ${response.status} ${response.statusText}`;
                    try { const errBody = await response.text(); errorMsg += ` Body: ${errBody.substring(0,100)}`; } catch (e) { }
                    throw new Error(`${errorMsg} for ${item.path}.`);
                }
                const content: Blob = await response.blob();
                zip.file(item.path, content, { binary: true });
            } catch (error: any) {
                console.error(`Snaggle: Failed to fetch file ${item.path}:`, error);
                zip.file(item.path + ".error.txt", `Failed to fetch '${item.path}':\n${error.message}`);
            }
        } else if (item.type === 'dir') {
            console.warn(`Snaggle: Directory selection (${item.path}) - recursive download not implemented. Creating folder marker.`);
            zip.folder(item.path);
        }
    });
    await Promise.all(fetchPromises);

    console.log("Snaggle: Generating ZIP file...");
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

// Load JSZip using importScripts at the worker's top level
try {
    if (typeof JSZip === 'undefined') {
        importScripts('vendor/jszip.min.js'); // Use global importScripts directly
        console.log("Snaggle: JSZip loaded via importScripts.");
    }
} catch (e) {
    console.error("Snaggle: Failed to load JSZip via importScripts:", e);
}

console.log("Snaggle Background Service Worker Loaded (TypeScript).");