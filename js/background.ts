import JSZip from 'jszip'; // Import type if possible (might still rely on importScripts for runtime)

// Ensure JSZip is loaded globally via importScripts
declare var JSZip: typeof import('jszip');

// Use chrome.* APIs with types from @types/chrome
const api = chrome;

// Type for messages sent from popup
interface BackgroundMessage {
    action: 'downloadFile' | 'createAndDownloadZip';
    url?: string; // Optional for some actions
    filename?: string; // Optional for some actions
    filesToFetch?: GitHubFileItem[]; // Use interface defined below or import from module
    repoInfo?: RepoInfo; // Use interface defined below or import from module
}

// Interfaces matching data structures (could be shared in a types file)
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


// Listener with typed parameters
api.runtime.onMessage.addListener((message: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: { success: boolean; error?: string; downloadId?: number }) => void): boolean | undefined => {
    console.log("Snaggle Background received message:", message);

    if (message.action === "downloadFile") {
        if (!message.url || !message.filename) {
            console.error("Snaggle: Missing URL or filename for downloadFile action.");
            sendResponse({ success: false, error: "Missing URL or filename." });
            return false; // Synchronous response
        }
        api.downloads.download({
            url: message.url,
            filename: message.filename,
            saveAs: false
        }).then(downloadId => {
            if (downloadId) {
                 console.log(`Snaggle: Download started with ID: ${downloadId}`);
                 if (api.runtime.lastError) { // Check lastError just in case
                    console.error(`Snaggle: Download failed (lastError): ${api.runtime.lastError.message}`);
                    sendResponse({ success: false, error: api.runtime.lastError.message });
                 } else sendResponse({ success: true, downloadId: downloadId });
            } else {
                 if (api.runtime.lastError) {
                     console.error(`Snaggle: Download initiation failed (lastError): ${api.runtime.lastError.message}`);
                     sendResponse({ success: false, error: api.runtime.lastError.message });
                 } else {
                     console.error(`Snaggle: Download initiation failed (no ID, no error). URL: ${message.url}`);
                     sendResponse({ success: false, error: "Download could not be initiated." });
                 }
            }
        }).catch((error: Error) => { // Type the error
            console.error(`Snaggle: Download promise failed: ${error.message}`);
            sendResponse({ success: false, error: error.message });
        });
        return true; // Indicates asynchronous response

    } else if (message.action === "createAndDownloadZip") {
        if (typeof JSZip === 'undefined') {
             console.error("Snaggle: JSZip library not loaded.");
             sendResponse({ success: false, error: "JSZip library not loaded." });
             return false;
        }
        if (!message.filesToFetch || !message.repoInfo) {
             console.error("Snaggle: Missing files or repoInfo for createAndDownloadZip action.");
             sendResponse({ success: false, error: "Missing filesToFetch or repoInfo." });
             return false;
        }

        let blobUrl: string | null = null;
        createZip(message.filesToFetch, message.repoInfo, message.filename || 'github-download.zip')
            .then((blob: Blob) => { // Type the blob
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
                      if (api.runtime.lastError) {
                         console.error(`Snaggle: ZIP Download failed (lastError): ${api.runtime.lastError.message}`);
                         sendResponse({ success: false, error: api.runtime.lastError.message });
                     } else sendResponse({ success: true, downloadId: downloadId });
                } else {
                     if (api.runtime.lastError) {
                         console.error(`Snaggle: ZIP Download initiation failed (lastError): ${api.runtime.lastError.message}`);
                         sendResponse({ success: false, error: api.runtime.lastError.message });
                     } else {
                         console.error(`Snaggle: ZIP Download initiation failed (no ID, no error).`);
                         sendResponse({ success: false, error: "ZIP Download could not be initiated." });
                     }
                }
            })
            .catch((error: Error) => { // Type the error
                console.error(`Snaggle: ZIP Creation/Download promise failed: ${error.message}`);
                sendResponse({ success: false, error: error.message });
            })
            .finally(() => {
                if (blobUrl) {
                    console.log("Snaggle: Revoking ZIP blob URL.");
                    setTimeout(() => URL.revokeObjectURL(blobUrl!), 60000); // Use non-null assertion or check
                    blobUrl = null;
                }
            });
        return true; // Indicates asynchronous response
    }

    // Indicate message was not handled synchronously or asynchronously
    // console.warn("Snaggle: Unhandled background message action:", message.action);
    // return false; // Or let it default to undefined
});

// --- GitHub Zip Creation Helper ---
// Added types to parameters and return value
async function createZip(filesToFetch: GitHubFileItem[], repoInfo: RepoInfo, filename: string): Promise<Blob> {
    // Use the type provided by @types/jszip
    const zip = new JSZip();
    const { owner, repo, ref } = repoInfo;

    console.log("Snaggle: Fetching files for ZIP:", filesToFetch);

    // Using Promise.all for potentially faster fetching (optional)
    const fetchPromises = filesToFetch.map(async (item) => {
        if (item.type === 'file') {
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${item.path}?ref=${ref}`;
            try {
                const response = await fetch(apiUrl, { headers: { 'Accept': 'application/vnd.github.v3.raw' } });
                if (!response.ok) {
                    let errorMsg = `GitHub API error: ${response.status} ${response.statusText}`;
                    try { const errBody = await response.text(); errorMsg += ` Body: ${errBody.substring(0, 100)}`; } catch (e) { }
                    throw new Error(`${errorMsg} for ${item.path}.`);
                }
                const content: Blob = await response.blob(); // Type the content
                zip.file(item.path, content, { binary: true });
            } catch (error: any) { // Catch specific error types if known, else any/unknown
                console.error(`Snaggle: Failed to fetch file ${item.path}:`, error);
                zip.file(item.path + ".error.txt", `Failed to fetch '${item.path}':\n${error.message}`);
            }
        } else if (item.type === 'dir') {
            console.warn(`Snaggle: Directory selection (${item.path}) - recursive download not implemented. Creating folder marker.`);
            zip.folder(item.path); // Creates the directory structure in the zip
        }
    });

    await Promise.all(fetchPromises); // Wait for all fetches to complete

    console.log("Snaggle: Generating ZIP file...");
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

console.log("Snaggle Background Service Worker Loaded (TypeScript).");

// Need to load JSZip via importScripts still, as top-level await isn't standard in service workers yet
// and standard ES module import might not work correctly depending on the library structure.
// The 'declare var JSZip' helps TypeScript know the global exists after importScripts runs.
try {
    // Check if JSZip already exists (it shouldn't typically, but belt-and-suspenders)
    if (typeof JSZip === 'undefined') {
        self.importScripts('vendor/jszip.min.js'); // Load it into the global scope
        console.log("Snaggle: JSZip loaded via importScripts.");
    }
} catch (e) {
    console.error("Snaggle: Failed to load JSZip via importScripts:", e);
}