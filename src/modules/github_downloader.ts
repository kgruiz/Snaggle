// src/modules/github_downloader.ts

// Interfaces for structure
export interface RepoInfo { owner: string; repo: string; ref: string; path: string; apiPath: string; }
export interface GitHubFileItem { name: string; path: string; type: 'file' | 'dir'; sha?: string; url?: string; }

// isGitHubRepoPage function removed - it's now in src/utils/site_checkers.ts

/**
 * Parses a GitHub URL to extract repository information.
 * @param urlString The full URL string of the GitHub page.
 * @returns RepoInfo object or throws an error if parsing fails.
 */
export function parseRepoUrl(urlString: string): RepoInfo {
     try {
        const url = new URL(urlString);
        if (url.hostname !== 'github.com') {
            throw new Error("URL is not a github.com URL.");
        }
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) {
            throw new Error("Invalid GitHub repo URL path (missing owner/repo)");
        }

        const owner: string = pathParts[0];
        const repo: string = pathParts[1];
        let ref: string = 'HEAD'; // Default ref (points to the default branch)
        let currentPath: string = ''; // Path shown in browser URL relative to repo root
        let apiPath: string = ''; // Path used for API 'contents' endpoint (directory path)

        // Determine ref and path based on URL structure (/tree/, /blob/, or root)
        if (pathParts.length > 3 && (pathParts[2] === 'tree' || pathParts[2] === 'blob')) {
            // Structure: /owner/repo/tree|blob/ref/path...
            ref = decodeURIComponent(pathParts[3]);
            currentPath = pathParts.slice(4).map(decodeURIComponent).join('/');
            // API path should be the directory containing the item(s) being viewed
            if (pathParts[2] === 'blob') {
                // If viewing a file, apiPath is the containing directory
                apiPath = currentPath.includes('/') ? currentPath.substring(0, currentPath.lastIndexOf('/')) : '';
            } else {
                 // If viewing a tree, apiPath is the tree path itself
                apiPath = currentPath;
            }
        } else if (pathParts.length > 2) {
            // Structure: /owner/repo/path... (implies default branch)
            // ref remains 'HEAD'
            currentPath = pathParts.slice(2).map(decodeURIComponent).join('/');
            apiPath = currentPath; // Assume path is a directory first

            // Refine apiPath if currentPath looks like a file path
            const fileNamePattern = /\.[^/.]+$/; // Matches a dot followed by non-slashes/dots at the end
             if (apiPath.includes('/') && fileNamePattern.test(pathParts[pathParts.length - 1])) {
                 // File within a directory
                 apiPath = apiPath.substring(0, apiPath.lastIndexOf('/'));
             } else if (!apiPath.includes('/') && fileNamePattern.test(apiPath)) {
                 // File in the root directory
                 apiPath = '';
             }
             // If apiPath ends with a slash, remove it for consistency
             if (apiPath.endsWith('/')) {
                  apiPath = apiPath.slice(0, -1);
             }
        }
        // Ensure apiPath is always a string, default to empty string for root
        apiPath = apiPath || '';

        console.log(`Parsed GitHub URL: owner=${owner}, repo=${repo}, ref=${ref}, path=${currentPath}, apiPath=${apiPath}`);
        return { owner, repo, ref, path: currentPath, apiPath: apiPath };
    } catch (e: any) {
        console.error("Snaggle: Failed to parse GitHub URL:", urlString, e);
        throw new Error(`Could not parse GitHub URL: ${urlString} - ${e?.message ?? 'Unknown reason'}`);
    }
}

// --- UI/Selection Handling Helpers ---
// These functions need access to the popup's DOM and are used by src/popup/index.ts

/** Gets selected file/folder items from the popup's file tree UI. */
export function getSelectedItems(): GitHubFileItem[] {
    const container = document.getElementById('github-file-tree');
    if (!container) {
        console.warn("getSelectedItems: File tree container not found.");
        return [];
    }
    // Select only checked checkboxes that are not the "Select All" checkbox and are not disabled
    const selectedCheckboxes = container.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]:checked:not(:disabled):not(#github-select-all)'
    );
    const items: GitHubFileItem[] = [];
    selectedCheckboxes.forEach(checkbox => {
        const type = checkbox.dataset.type;
        const name = checkbox.dataset.name;
        const path = checkbox.value; // The 'value' attribute holds the item's full path
        // Validate required data attributes before adding
        if ((type === 'file' || type === 'dir') && name && path) {
             items.push({ path: path, type: type, name: name });
        } else {
            console.warn("Skipping selected item with missing data:", { value: path, type, name });
        }
    });
    return items;
}

/** Toggles the checked state of all individual file/folder checkboxes in the popup. */
export function toggleSelectAll(checked: boolean): void {
    const container = document.getElementById('github-file-tree');
    const downloadButton = document.getElementById('github-download-zip') as HTMLButtonElement | null;
    if (!container || !downloadButton) return;

    // Select all checkboxes within list items (excluding the main "Select All" one)
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
        'li input[type="checkbox"]:not(:disabled):not(#github-select-all)'
    );
    checkboxes.forEach(checkbox => checkbox.checked = checked);

    // Update the download button's state based on the new selection
    downloadButton.disabled = !checked && checkboxes.length > 0; // Disable if unchecking all
    if (checked && checkboxes.length > 0) {
        downloadButton.disabled = false; // Enable if checking all (and items exist)
    }
}

/** Checks if all individual file/folder checkboxes in the popup are currently selected. */
export function areAllSelected(): boolean {
    const container = document.getElementById('github-file-tree');
    if (!container) return false;

    // Find all checkable items (excluding the main "Select All")
    const allCheckableCheckboxes = container.querySelectorAll<HTMLInputElement>(
        'li input[type="checkbox"]:not(:disabled):not(#github-select-all)'
    );
    if (allCheckableCheckboxes.length === 0) return false; // No items to select

    // Find all *checked* checkable items
    const checkedCheckboxes = container.querySelectorAll<HTMLInputElement>(
        'li input[type="checkbox"]:checked:not(:disabled):not(#github-select-all)'
    );

    // Return true only if the count of all checkable items equals the count of checked items
    return allCheckableCheckboxes.length === checkedCheckboxes.length;
}