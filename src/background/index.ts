// Declare JSZip assuming it will become global after dynamic load/eval
declare var JSZip: typeof import('jszip');

// Use chrome.* APIs with types from @types/chrome
const api = chrome;

// --- Type Definitions ---
interface GitHubFileItem { path: string; type: 'file' | 'dir'; name: string; }
interface RepoInfo { owner: string; repo: string; ref: string; }
interface BackgroundMessage { action: 'downloadFile' | 'createAndDownloadZip' | 'togglePopup'; url?: string; filename?: string; filesToFetch?: GitHubFileItem[]; repoInfo?: RepoInfo; saveAs?: boolean; } // Added 'togglePopup' action
interface BackgroundResponse { success: boolean; error?: string; downloadId?: number; }
// --- End Type Definitions ---

// --- Action Listener (Trigger content script UI) ---
// MODIFIED listener: Sends message to content script instead of creating window
api.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
    console.log("Snaggle Background: Browser Action clicked. Sending message to content script.");
    if (tab?.id) {
        try {
            // Send a message to the content script in the active tab
            await api.tabs.sendMessage(tab.id, { action: 'togglePopup' });
            console.log(`Snaggle Background: Sent 'togglePopup' message to tab ${tab.id}`);
        } catch (e: any) {
            // This can happen if the content script failed to inject or the tab is not scriptable
            console.error("Snaggle Background: Failed to send message to content script:", e);
            // Optional: Show an error message to the user, maybe in a small temporary UI element or log
        }
    } else {
        console.error("Snaggle Background: No active tab found.");
    }
});
// --- End Action Listener ---


// --- Function to Load and Execute JSZip ---
let jszipLoaded = false;
let jszipLoadingPromise: Promise<void> | null = null;

async function loadJSZip(): Promise<void> {
    if (jszipLoaded || typeof JSZip !== 'undefined') {
        if (!jszipLoaded) { console.log("Snaggle Background: JSZip already defined."); jszipLoaded = true; }
        return Promise.resolve();
    }
    if (jszipLoadingPromise) { return jszipLoadingPromise; }
    console.log("Snaggle Background: Initiating JSZip dynamic load...");
    jszipLoadingPromise = (async () => {
        try {
            const jszipPath = '/vendor/jszip.min.js';
            // Fetch the script content from the extension's package
            const response = await fetch(api.runtime.getURL(jszipPath));
            if (!response.ok) throw new Error(`Failed to fetch JSZip (${response.status}): ${response.statusText}`);
            const scriptContent = await response.text();
            // Execute in global scope of the service worker.
            new Function(scriptContent)();
            if (typeof JSZip === 'undefined') throw new Error("JSZip script executed but global not defined.");
            jszipLoaded = true;
            console.log("Snaggle Background: JSZip loaded dynamically.");
        } catch (e: any) {
            console.error("Snaggle Background: Failed to load/execute JSZip:", e);
            jszipLoaded = false; throw e;
        } finally { jszipLoadingPromise = null; }
    })();
    return jszipLoadingPromise;
}

// --- Message Listener (from content script) ---
// Keeps existing download/zip logic
api.runtime.onMessage.addListener((message: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: BackgroundResponse) => void): boolean | undefined => {
    console.log("Snaggle Background received message:", message);

    if (message.action === "downloadFile") {
        if (!message.url || !message.filename) {
            console.error("Snaggle Background: Missing URL/filename for downloadFile.");
            sendResponse({ success: false, error: "Missing URL or filename." });
            return false;
        }
        // Use saveAs from message, default to false
        api.downloads.download({ url: message.url, filename: message.filename, saveAs: message.saveAs ?? false })
            .then(downloadId => {
                // Promise resolved, assume success if downloadId is valid
                if (downloadId !== undefined && downloadId !== 0) {
                    console.log(`Snaggle Background: Download started with ID: ${downloadId}`);
                    sendResponse({ success: true, downloadId: downloadId });
                } else {
                    // This case might indicate an issue even without explicit rejection
                    console.error(`Snaggle Background: Download initiation returned invalid ID (${downloadId}). URL: ${message.url}`);
                    sendResponse({ success: false, error: "Download could not be initiated (invalid ID)." });
                }
            })
            .catch((error: Error) => { // Catch promise rejections
                console.error(`Snaggle Background: Download promise failed: ${error.message}`);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Async response required

    } else if (message.action === "createAndDownloadZip") {
        // Ensure JSZip is loaded before attempting ZIP creation
        loadJSZip().then(() => {
            if (!jszipLoaded || typeof JSZip === 'undefined') {
                 console.error("Snaggle Background: JSZip could not be loaded for ZIP.");
                 sendResponse({ success: false, error: "JSZip library could not be loaded for ZIP creation." });
                 return;
            }
            if (!message.filesToFetch || !message.repoInfo) {
                 console.error("Snaggle Background: Missing files/repoInfo for ZIP.");
                 sendResponse({ success: false, error: "Missing filesToFetch or repoInfo." });
                 return;
            }

            let blobUrl: string | null = null;
            // Note: ZIP download currently hardcoded to saveAs: false in the download call below
            createZip(message.filesToFetch, message.repoInfo, message.filename || 'github-download.zip')
                .then((blob: Blob) => {
                    blobUrl = URL.createObjectURL(blob);
                    // ZIP download currently does NOT prompt saveAs, hardcoded false
                    return api.downloads.download({ url: blobUrl, filename: message.filename || 'github-download.zip', saveAs: false });
                })
                .then((downloadId?: number) => {
                    if (downloadId !== undefined && downloadId !== 0) {
                        console.log(`Snaggle Background: ZIP Download started with ID: ${downloadId}`);
                        sendResponse({ success: true, downloadId: downloadId });
                    } else {
                        // Handle invalid ID case
                        console.error(`Snaggle Background: ZIP Download initiation returned invalid ID (${downloadId}).`);
                        sendResponse({ success: false, error: "ZIP Download could not be initiated (invalid ID)." });
                    }
                })
                .catch((error: Error) => { // Catch errors from createZip or download
                    console.error(`Snaggle Background: ZIP Creation/Download promise failed: ${error.message}`);
                    sendResponse({ success: false, error: error.message });
                })
                .finally(() => { // Revoke URL regardless of success/failure
                    // Add a slight delay before revoking to ensure browser has time to process
                    if (blobUrl) {
                         console.log("Snaggle Background: Revoking ZIP blob URL after delay.");
                        setTimeout(() => { if (blobUrl) URL.revokeObjectURL(blobUrl); } , 60000); // Revoke after 1 minute
                        blobUrl = null; // Clear reference
                    }
                });

        }).catch(loadError => { // Catch errors from loadJSZip() promise
             console.error("Snaggle Background: Error during JSZip loading sequence:", loadError);
             sendResponse({ success: false, error: `Failed to prepare ZIP library: ${ (loadError as Error)?.message ?? 'Unknown load error'}` });
        });
        return true; // Async response required
    }
    // default return false for unhandled actions
     return false; // Indicate that sendResponse will not be called synchronously for unhandled actions
});

// --- GitHub Zip Creation Helper ---
// (Logic remains the same, still runs in background)
async function createZip(filesToFetch: GitHubFileItem[], repoInfo: RepoInfo, filename: string): Promise<Blob> {
    if (typeof JSZip === 'undefined') { throw new Error("JSZip is not available when trying to create ZIP."); }
    const zip = new JSZip();
    const { owner, repo, ref } = repoInfo;
    console.log("Snaggle Background: Fetching files for ZIP:", filesToFetch);
    const fetchPromises = filesToFetch.map(async (item) => {
        if (item.type === 'file') {
            // Construct API URL carefully, handling potential empty 'path' for root level files
             const contentPath = item.path || ''; // API needs path, but root is just .../contents/
             const apiUrl = `${GITHUB_API_BASE}${owner}/${repo}/contents/${contentPath}?ref=${ref}`;

            try {
                const response = await fetch(apiUrl, { headers: { 'Accept': 'application/vnd.github.v3.raw' } });
                if (!response.ok) {
                     let errorMsg = `GitHub API error: ${response.status} ${response.statusText}`;
                     try { const errBody = await response.text(); errorMsg += ` Body: ${errBody.substring(0,100)}`; } catch (e) { /* Ignore body read error */ }
                     throw new Error(`${errorMsg} for ${item.path}.`);
                }
                const content: Blob = await response.blob();
                // Use item.path as the path within the zip file
                zip.file(item.path, content, { binary: true });
            } catch (error: any) {
                console.error(`Snaggle Background: Failed to fetch file ${item.path}:`, error);
                zip.file(item.path + ".error.txt", `Failed to fetch '${item.path}':\n${error.message}`);
            }
        } else if (item.type === 'dir') {
            console.warn(`Snaggle Background: Directory selection (${item.path}) - recursive download not implemented. Creating folder marker.`);
            zip.folder(item.path); // Create a folder entry
        }
    });
    await Promise.all(fetchPromises);
    console.log("Snaggle Background: Generating ZIP file...");
    // Adding the root directory name might be nice, but requires knowing the selected root dir if any.
    // For simplicity, just generate the blob directly. Filename handled in download call.
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

// GitHub API Base URL constant
const GITHUB_API_BASE: string = "https://api.github.com/repos/";

console.log("Snaggle Background Service Worker Loaded (TypeScript/Vite - Module).");