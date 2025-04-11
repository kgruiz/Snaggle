// Interfaces for structure
interface RepoInfo {
  owner: string;
  repo: string;
  ref: string;
  path: string; // Path being viewed in UI
  apiPath: string; // Path used for API call (often parent dir)
}

// Simplified GitHub item structure from API
interface GitHubApiItem {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule'; // Known types
  sha: string;
  html_url: string;
  // Add other fields like size if needed
}

// Structure used internally and passed to background script
export interface GitHubFileItem {
  name: string;
  path: string;
  type: 'file' | 'dir'; // Only handle file/dir for download
  sha?: string; // Optional
  url?: string; // Optional
}


// --- Constants ---
const GITHUB_API_BASE: string = "https://api.github.com/repos/";

// --- State --- (Typed)
let currentRepoInfo: RepoInfo | null = null;
let fileTreeData: GitHubFileItem[] = []; // Use the internal interface

// --- UI Element Getters --- (Typed)
function getElementById<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
function getFileTreeContainer(): HTMLDivElement | null { return getElementById<HTMLDivElement>('github-file-tree'); }
function getDownloadButton(): HTMLButtonElement | null { return getElementById<HTMLButtonElement>('github-download-zip'); }
function getSelectAllCheckbox(): HTMLInputElement | null { return getElementById<HTMLInputElement>('github-select-all'); }
function getErrorContainerWithinTree(): HTMLDivElement | null {
  const container = getFileTreeContainer();
  let errorDiv = container?.querySelector<HTMLDivElement>('.error-message'); // Use querySelector with type
  if (!errorDiv && container) {
      errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      // Add styles programmatically or ensure they are in CSS
      errorDiv.style.color = '#ffaaaa';
      errorDiv.style.padding = '10px';
      container.prepend(errorDiv);
  }
  return errorDiv;
}

// --- URL Parsing & Validation --- (Typed)
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

export function parseRepoUrl(urlString: string): RepoInfo { // Return typed object
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
          const fileNamePattern = /\.\w+$/; // Basic check for file extension
          const pathSegments = currentPath.split('/');
          if (currentPath && currentPath.includes('/') && fileNamePattern.test(pathSegments[pathSegments.length-1])) {
               apiPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
          } else if (currentPath && !currentPath.includes('/') && fileNamePattern.test(currentPath)){
               apiPath = '';
          }
      }
      return { owner, repo, ref, path: currentPath, apiPath: apiPath || '' }; // Ensure apiPath isn't undefined
  } catch (e: any) {
      console.error("Snaggle: Failed to parse GitHub URL:", e);
      throw new Error(`Could not parse GitHub URL: ${urlString} - ${e?.message ?? 'Unknown reason'}`);
  }
}


// --- File Tree Fetching and Display --- (Typed tab parameter, though not strictly needed now)
export async function displayFileTree(tab: chrome.tabs.Tab | null, url: string): Promise<void> {
  const fileTreeContainer = getFileTreeContainer();
  const downloadButton = getDownloadButton();
  const errorContainer = getErrorContainerWithinTree();
  const selectAllCheckbox = getSelectAllCheckbox();

  // Guard against missing elements
  if (!fileTreeContainer || !downloadButton || !selectAllCheckbox) {
      console.error("Snaggle: Cannot display file tree, critical UI elements missing.");
      return;
  }

  fileTreeContainer.innerHTML = '<div class="loading-tree">Loading file tree...</div>';
  if(errorContainer) errorContainer.textContent = '';
  downloadButton.disabled = true;
  selectAllCheckbox.checked = false;

  try {
      currentRepoInfo = parseRepoUrl(url);
      console.log("Snaggle: Fetching tree for:", currentRepoInfo);

      fileTreeData = await fetchFileTreeFromAPI(currentRepoInfo.owner, currentRepoInfo.repo, currentRepoInfo.ref, currentRepoInfo.apiPath);

      // fetchFileTreeFromAPI now returns GitHubFileItem[] or throws
      if (fileTreeData.length === 0) {
            fileTreeContainer.innerHTML = `<div class="error-message">${currentRepoInfo.apiPath ? `Directory '${currentRepoInfo.apiPath}' is empty or not found.` : 'Repository seems empty or inaccessible.'}</div>`;
       } else {
          renderFileTree(fileTreeData, fileTreeContainer);
          downloadButton.disabled = true; // Still disabled until selection
       }

  } catch (error: any) {
      console.error("Snaggle: Failed to display file tree:", error);
      if (errorContainer && !errorContainer.textContent) {
          errorContainer.textContent = `Error: ${error?.message ?? 'Unknown error'}`;
      }
      fileTreeContainer.querySelector('.loading-tree')?.remove();
      downloadButton.disabled = true;
  }
}


// Fetch tree using GitHub API (Typed parameters and return)
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

      // Type the response data more strictly
      const data: GitHubApiItem | GitHubApiItem[] = await response.json();

      let itemsToProcess: GitHubApiItem[];

      if (!Array.isArray(data)) {
          // Handle case where API returns a single file object instead of array for directory
          if (typeof data === 'object' && data !== null && data.type === 'file') {
               console.warn(`Snaggle: API path "${path}" resolved to a file. Displaying just this file.`);
                itemsToProcess = [data]; // Treat as array with one item
          } else {
              throw new Error("Unexpected response format from GitHub API (expected array or file object).");
          }
      } else {
          itemsToProcess = data;
      }

      // Map API response to our internal format
      const files: GitHubFileItem[] = itemsToProcess.map(item => ({
          name: item.name,
          path: item.path,
          type: (item.type === 'file' || item.type === 'dir') ? item.type : 'file', // Default unknown types to file? Or filter out? Let's treat as file for now.
          sha: item.sha,
          url: item.html_url
      }));

       files.sort((a, b) => { /* ... same sorting logic ... */ });
       return files;

  } catch (error: any) {
      console.error("Snaggle: GitHub API fetch error:", error);
      if (errorContainer) { errorContainer.textContent = error?.message ?? 'Unknown API error'; }
      // Re-throw the error so the caller knows it failed
      throw error;
  }
}


// Typed parameters
function renderFileTree(files: GitHubFileItem[], container: HTMLDivElement): void {
  const list = document.createElement('ul');
  files.forEach(item => {
      const listItem = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = item.path;
      checkbox.dataset.type = item.type; // Store original type for download logic
      checkbox.dataset.name = item.name;

      let displayType = item.type; // file or dir
      // Handle non-downloadable types
      if (item.type !== 'file' && item.type !== 'dir') {
           checkbox.disabled = true;
           label.style.opacity = "0.6";
           label.title = `Type '${item.type}' cannot be downloaded via ZIP.`;
           // Assign a class based on actual type for CSS icons if needed
           listItem.className = item.type; // e.g., 'symlink', 'submodule'
      } else {
           listItem.className = item.type === 'dir' ? 'folder' : 'file'; // Class for styling
      }


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

// --- Selection Handling --- (Typed return)

export function getSelectedItems(): GitHubFileItem[] { // Return our specific type
  const container = getFileTreeContainer();
  if (!container) return [];
  const selectedCheckboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked:not(:disabled):not(#github-select-all)'); // Type the NodeList
  const items: GitHubFileItem[] = [];
  selectedCheckboxes.forEach(checkbox => {
      // Ensure dataset properties exist and type is correct before pushing
      const type = checkbox.dataset.type;
      if ((type === 'file' || type === 'dir') && checkbox.dataset.name) {
           items.push({
               path: checkbox.value,
               type: type, // Type is 'file' | 'dir' here
               name: checkbox.dataset.name
           });
      }
  });
  return items;
}

// Typed parameter
export function toggleSelectAll(checked: boolean): void {
  const container = getFileTreeContainer();
  const downloadButton = getDownloadButton(); // Get button to update state
   if (!container || !downloadButton) return;
  const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled):not(#github-select-all)');
  checkboxes.forEach(checkbox => checkbox.checked = checked);
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