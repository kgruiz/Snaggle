// Interfaces for structure
interface RepoInfo { owner: string; repo: string; ref: string; path: string; apiPath: string; }
interface GitHubApiItem { name: string; path: string; type: 'file' | 'dir' | 'symlink' | 'submodule'; sha: string; html_url: string; }
export interface GitHubFileItem { name: string; path: string; type: 'file' | 'dir'; sha?: string; url?: string; }


// --- Constants ---
const GITHUB_API_BASE: string = "https://api.github.com/repos/";

// --- State ---
let currentRepoInfo: RepoInfo | null = null;
let fileTreeData: GitHubFileItem[] = [];

// --- UI Element Getters ---
function getElementById<T extends HTMLElement>(id: string): T | null { return document.getElementById(id) as T | null; }
function getFileTreeContainer(): HTMLDivElement | null { return getElementById<HTMLDivElement>('github-file-tree'); }
function getDownloadButton(): HTMLButtonElement | null { return getElementById<HTMLButtonElement>('github-download-zip'); }
function getSelectAllCheckbox(): HTMLInputElement | null { return getElementById<HTMLInputElement>('github-select-all'); }
// Add explicit return type
function getErrorContainerWithinTree(): HTMLDivElement | null {
    const container = getFileTreeContainer();
    if (!container) return null; // Return null if no container
    let errorDiv = container.querySelector<HTMLDivElement>('.error-message');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.style.color = '#ffaaaa'; errorDiv.style.padding = '10px';
        container.prepend(errorDiv);
    }
    return errorDiv; // Return the div or null if querySelector initially failed
}

// --- URL Parsing & Validation ---
export function isGitHubRepoPage(urlString: string): boolean {
    try {
        const url = new URL(urlString);
        if (url.hostname !== 'github.com') return false;
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) return false;
        const nonCodePaths = /^(settings|pulls|issues|wiki|projects|actions|security|pulse|graphs|find|upload|codespaces|notifications|stars|watching|forks|codesearch|marketplace|explore|topics|collections|events|sponsors|readme|about)$/i;
        if (pathParts.length === 2 && nonCodePaths.test(pathParts[1])) return false;
        if (pathParts.length > 2 && nonCodePaths.test(pathParts[0])) return false;
        const validSecondPart = /^(tree|blob)/i;
        if (pathParts.length > 2 && !validSecondPart.test(pathParts[2])) {
             const knownNonCodeSegments = /^(releases|tags|network|commits|branches|contributors|compare|labels|milestones|graphs|pulse|commit|blame|raw|search)$/i;
             if (knownNonCodeSegments.test(pathParts[2])) return false;
        }
        return true;
    } catch (e) { return false; }
}
export function parseRepoUrl(urlString: string): RepoInfo {
     try {
        const url = new URL(urlString);
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) throw new Error("Invalid GitHub repo URL path");

        const owner: string = pathParts[0];
        const repo: string = pathParts[1];
        let ref: string = 'HEAD';
        let currentPath: string = '';
        let apiPath: string = '';

        if (pathParts.length > 3 && (pathParts[2] === 'tree' || pathParts[2] === 'blob')) {
            ref = decodeURIComponent(pathParts[3]);
            currentPath = pathParts.slice(4).map(decodeURIComponent).join('/');
            apiPath = currentPath;
            if (pathParts[2] === 'blob' && apiPath.includes('/')) {
                apiPath = apiPath.substring(0, apiPath.lastIndexOf('/'));
            } else if (pathParts[2] === 'blob') { apiPath = ''; }
        } else if (pathParts.length > 2) {
            currentPath = pathParts.slice(2).map(decodeURIComponent).join('/');
            apiPath = currentPath;
            const fileNamePattern = /\.\w+$/;
            const pathSegments = currentPath.split('/');
            if (currentPath && currentPath.includes('/') && fileNamePattern.test(pathSegments[pathSegments.length-1])) {
                 apiPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
            } else if (currentPath && !currentPath.includes('/') && fileNamePattern.test(currentPath)){
                 apiPath = '';
            }
        }
        // Ensure apiPath is always a string
        return { owner, repo, ref, path: currentPath, apiPath: apiPath || '' };
    } catch (e: any) {
        console.error("Snaggle: Failed to parse GitHub URL:", e);
        throw new Error(`Could not parse GitHub URL: ${urlString} - ${e?.message ?? 'Unknown reason'}`);
    }
}


// --- File Tree Fetching and Display ---
export async function displayFileTree(tab: chrome.tabs.Tab | null, url: string): Promise<void> {
    const fileTreeContainer = getFileTreeContainer();
    const downloadButton = getDownloadButton();
    const errorContainer = getErrorContainerWithinTree();
    const selectAllCheckbox = getSelectAllCheckbox();
    if (!fileTreeContainer || !downloadButton || !selectAllCheckbox) { console.error("Snaggle: Cannot display file tree, critical UI elements missing."); return; }

    fileTreeContainer.innerHTML = '<div class="loading-tree">Loading file tree...</div>';
    if(errorContainer) errorContainer.textContent = '';
    downloadButton.disabled = true;
    selectAllCheckbox.checked = false;

    try {
        currentRepoInfo = parseRepoUrl(url);
        console.log("Snaggle: Fetching tree for:", currentRepoInfo);
        fileTreeData = await fetchFileTreeFromAPI(currentRepoInfo.owner, currentRepoInfo.repo, currentRepoInfo.ref, currentRepoInfo.apiPath);

        if (fileTreeData.length === 0) {
              fileTreeContainer.innerHTML = `<div class="error-message">${currentRepoInfo.apiPath ? `Directory '${currentRepoInfo.apiPath}' is empty or not found.` : 'Repository seems empty or inaccessible.'}</div>`;
         } else {
            renderFileTree(fileTreeData, fileTreeContainer);
            downloadButton.disabled = true;
         }
    } catch (error: any) {
        console.error("Snaggle: Failed to display file tree:", error);
        if (errorContainer && !errorContainer.textContent) errorContainer.textContent = `Error: ${error?.message ?? 'Unknown error'}`;
        fileTreeContainer.querySelector('.loading-tree')?.remove();
        downloadButton.disabled = true;
    }
}


// Fetch tree using GitHub API
async function fetchFileTreeFromAPI(owner: string, repo: string, ref: string = 'HEAD', path: string = ''): Promise<GitHubFileItem[]> {
    const apiUrl = `${GITHUB_API_BASE}${owner}/${repo}/contents/${path}?ref=${ref}`;
    console.log("Snaggle: Fetching from API:", apiUrl);
    const errorContainer = getErrorContainerWithinTree();
    if(errorContainer) errorContainer.textContent = '';

    try {
        const response = await fetch(apiUrl, { headers: { 'Accept': 'application/vnd.github.v3+json' } });
        if (!response.ok) {
             let errorMsg = `GitHub API Error: ${response.status} ${response.statusText}`;
             try { const errorData = await response.json(); if (errorData?.message) errorMsg += ` - ${errorData.message}`; } catch (e) {}
             if (response.status === 404) errorMsg = `Repo, branch, or path not found (${path || 'root'}).`;
             if (response.status === 403) errorMsg = `Access denied (Rate limit? Private repo?).`;
            throw new Error(errorMsg);
        }
        const data: GitHubApiItem | GitHubApiItem[] = await response.json();
        let itemsToProcess: GitHubApiItem[];
        if (!Array.isArray(data)) {
            if (typeof data === 'object' && data !== null && data.type === 'file') itemsToProcess = [data];
            else throw new Error("Unexpected API response format.");
        } else itemsToProcess = data;

        const files: GitHubFileItem[] = itemsToProcess.map(item => ({
            name: item.name, path: item.path,
            // Map only file/dir to our specific type, treat others as file? Or filter? Let's map knowns
            type: (item.type === 'file' || item.type === 'dir') ? item.type : 'file', // Default others to 'file'
            sha: item.sha, url: item.html_url
        })).filter(item => item.type === 'file' || item.type === 'dir'); // Optionally filter out non file/dir

         // --- Corrected Sort Logic with Return Type ---
         files.sort((a, b): number => {
            const typeOrder = { 'dir': 0, 'file': 1 }; // Only sorting dir/file now
            const typeA = typeOrder[a.type];
            const typeB = typeOrder[b.type];
            if (typeA !== typeB) return typeA - typeB; // Dirs first
            return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: 'base' });
        });
         // --- End Corrected Sort Logic ---

        return files;
    } catch (error: any) {
        console.error("Snaggle: GitHub API fetch error:", error);
        if (errorContainer) { errorContainer.textContent = error?.message ?? 'Unknown API error'; }
        throw error; // Re-throw
    }
}

// Render file tree
function renderFileTree(files: GitHubFileItem[], container: HTMLDivElement): void {
    const list = document.createElement('ul');
    files.forEach(item => {
        const listItem = document.createElement('li');
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.path;
        checkbox.dataset.type = item.type;
        checkbox.dataset.name = item.name;

        // Set class based on the known type (file or dir)
        listItem.className = item.type === 'dir' ? 'folder' : 'file';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = item.name;

        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        listItem.appendChild(label);
        list.appendChild(listItem);
    });
    container.innerHTML = ''; // Clear loading/previous
    container.appendChild(list);
}

// --- Selection Handling ---
export function getSelectedItems(): GitHubFileItem[] {
    const container = getFileTreeContainer();
    if (!container) return [];
    const selectedCheckboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked:not(:disabled):not(#github-select-all)');
    const items: GitHubFileItem[] = [];
    selectedCheckboxes.forEach(checkbox => {
        const type = checkbox.dataset.type;
        // Check dataset properties are strings and match expected types
        if ((type === 'file' || type === 'dir') && checkbox.dataset.name) {
             items.push({ path: checkbox.value, type: type, name: checkbox.dataset.name });
        }
    });
    return items;
}
export function toggleSelectAll(checked: boolean): void {
    const container = getFileTreeContainer();
    const downloadButton = getDownloadButton();
     if (!container || !downloadButton) return;
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled):not(#github-select-all)');
    checkboxes.forEach(checkbox => checkbox.checked = checked);
    // Update button state based on whether any items *can* be selected and if the toggle is checking them
    downloadButton.disabled = !checked && checkboxes.length > 0;
}
export function areAllSelected(): boolean {
    const container = getFileTreeContainer();
    if (!container) return false;
    const allCheckableCheckboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled):not(#github-select-all)');
    if (allCheckableCheckboxes.length === 0) return false;
    const checkedCheckboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked:not(:disabled):not(#github-select-all)');
    return allCheckableCheckboxes.length === checkedCheckboxes.length;
}