// Declare JSZip assuming it will become global after dynamic load/eval
declare var JSZip: typeof import('jszip');

// Use chrome.* APIs with types from @types/chrome
const api = chrome;

// --- Type Definitions ---
interface GitHubFileItem { path: string; type: 'file' | 'dir'; name: string; }
interface RepoInfo { owner: string; repo: string; ref: string; }
interface BackgroundMessage { action: 'downloadFile' | 'createAndDownloadZip'; url?: string; filename?: string; filesToFetch?: GitHubFileItem[]; repoInfo?: RepoInfo; }
interface BackgroundResponse { success: boolean; error?: string; downloadId?: number; }
// --- End Type Definitions ---

// --- Function to Load and Execute JSZip ---
let jszipLoaded = false;
let jszipLoadingPromise: Promise<void> | null = null;

async function loadJSZip(): Promise<void> {
    if (jszipLoaded || typeof JSZip !== 'undefined') {
        if (!jszipLoaded) { console.log("Snaggle: JSZip already defined."); jszipLoaded = true; }
        return Promise.resolve();
    }
    if (jszipLoadingPromise) { return jszipLoadingPromise; }
    console.log("Snaggle: Initiating JSZip dynamic load...");
    jszipLoadingPromise = (async () => {
        try {
            const jszipPath = '/vendor/jszip.min.js';
            const response = await fetch(jszipPath);
            if (!response.ok) throw new Error(`Failed to fetch JSZip (${response.status}): ${response.statusText}`);
            const scriptContent = await response.text();
            new Function(scriptContent)(); // Execute in global scope
            if (typeof JSZip === 'undefined') throw new Error("JSZip script executed but global not defined.");
            jszipLoaded = true;
            console.log("Snaggle: JSZip loaded dynamically.");
        } catch (e: any) {
            console.error("Snaggle: Failed to load/execute JSZip:", e);
            jszipLoaded = false; throw e;
        } finally { jszipLoadingPromise = null; }
    })();
    return jszipLoadingPromise;
}

// --- Listener ---
api.runtime.onMessage.addListener((message: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: BackgroundResponse) => void): boolean | undefined => {
    console.log("Snaggle Background received message:", message);

    if (message.action === "downloadFile") {
        if (!message.url || !message.filename) {
            console.error("Snaggle: Missing URL/filename for downloadFile.");
            sendResponse({ success: false, error: "Missing URL or filename." });
            return false;
        }
        api.downloads.download({ url: message.url, filename: message.filename, saveAs: false })
            .then(downloadId => {
                // Promise resolved, assume success if downloadId is valid
                if (downloadId !== undefined && downloadId !== 0) {
                    console.log(`Snaggle: Download started with ID: ${downloadId}`);
                    sendResponse({ success: true, downloadId: downloadId });
                } else {
                    // This case might indicate an issue even without explicit rejection
                    console.error(`Snaggle: Download initiation returned invalid ID (${downloadId}). URL: ${message.url}`);
                    sendResponse({ success: false, error: "Download could not be initiated (invalid ID)." });
                }
            })
            .catch((error: Error) => { // Catch promise rejections
                console.error(`Snaggle: Download promise failed: ${error.message}`);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Async response required

    } else if (message.action === "createAndDownloadZip") {
        loadJSZip().then(() => {
            if (!jszipLoaded || typeof JSZip === 'undefined') {
                 console.error("Snaggle: JSZip could not be loaded for ZIP.");
                 sendResponse({ success: false, error: "JSZip library could not be loaded." });
                 return;
            }
            if (!message.filesToFetch || !message.repoInfo) {
                 console.error("Snaggle: Missing files/repoInfo for ZIP.");
                 sendResponse({ success: false, error: "Missing filesToFetch or repoInfo." });
                 return;
            }

            let blobUrl: string | null = null;
            createZip(message.filesToFetch, message.repoInfo, message.filename || 'github-download.zip')
                .then((blob: Blob) => {
                    blobUrl = URL.createObjectURL(blob);
                    return api.downloads.download({ url: blobUrl, filename: message.filename || 'github-download.zip', saveAs: false });
                })
                .then((downloadId?: number) => {
                    if (downloadId !== undefined && downloadId !== 0) {
                        console.log(`Snaggle: ZIP Download started with ID: ${downloadId}`);
                        sendResponse({ success: true, downloadId: downloadId });
                    } else {
                        // Handle invalid ID case
                        console.error(`Snaggle: ZIP Download initiation returned invalid ID (${downloadId}).`);
                        sendResponse({ success: false, error: "ZIP Download could not be initiated (invalid ID)." });
                    }
                })
                .catch((error: Error) => { // Catch errors from createZip or download
                    console.error(`Snaggle: ZIP Creation/Download promise failed: ${error.message}`);
                    sendResponse({ success: false, error: error.message });
                })
                .finally(() => { // Revoke URL regardless of success/failure
                    if (blobUrl) {
                         console.log("Snaggle: Revoking ZIP blob URL in finally block.");
                        setTimeout(() => { if (blobUrl) URL.revokeObjectURL(blobUrl); } , 60000);
                        blobUrl = null;
                    }
                });

        }).catch(loadError => { // Catch errors from loadJSZip() promise
             console.error("Snaggle: Error during JSZip loading sequence:", loadError);
             sendResponse({ success: false, error: `Failed to prepare ZIP library: ${ (loadError as Error)?.message ?? 'Unknown load error'}` });
        });
        return true; // Async response required
    }
});

// --- GitHub Zip Creation Helper ---
async function createZip(filesToFetch: GitHubFileItem[], repoInfo: RepoInfo, filename: string): Promise<Blob> {
    if (typeof JSZip === 'undefined') { throw new Error("JSZip is not available when trying to create ZIP."); }
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
                    try { const errBody = await response.text(); errorMsg += ` Body: ${errBody.substring(0,100)}`; } catch (e) { /* Ignore body read error */ }
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

console.log("Snaggle Background Service Worker Loaded (TypeScript/Vite - Module).");