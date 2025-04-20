/* eslint‑disable max‑lines */
// --------------------------------------------------
// Snaggle Popup – full script (MV3 + TypeScript)
// --------------------------------------------------
import './popup.css';

import * as ChatExporter from '../modules/chat_exporter';
import * as GitHubDownloader from '../modules/github_downloader';
import * as GeneralExporter from '../modules/general_exporter';
import { extractDataForInjection } from '../content/extractGeneralData';

declare var TurndownService: any;
const api = chrome;

/* ---------- helper types ---------- */
interface GitHubFileItem { path: string; type: 'file' | 'dir'; name: string; }
interface RepoInfo        { owner: string; repo: string; ref: string; apiPath: string; }
interface BackgroundMsg   { action: 'downloadFile' | 'createAndDownloadZip'; url?: string; filename?: string; filesToFetch?: GitHubFileItem[]; repoInfo?: RepoInfo; }
interface BackgroundRes   { success: boolean; error?: string; downloadId?: number; }
interface ChatResult      { content: string; filename: string; requiresMarkdownConversion?: boolean; error?: string; }
interface PageResult      { content: string; requiresMarkdownConversion?: boolean; error?: string; }
type InjectionResults     = chrome.scripting.InjectionResult[];
/* ----------------------------------- */

/* ---------- DOM cache ---------- */
const loadingDiv   = document.getElementById('loading')           as HTMLDivElement | null;
const chatSection  = document.getElementById('chat-exporter')     as HTMLDivElement | null;
const githubSection= document.getElementById('github-downloader') as HTMLDivElement | null;
const generalSect  = document.getElementById('general-exporter')  as HTMLDivElement | null;
const unsupported  = document.getElementById('unsupported-site')  as HTMLDivElement | null;
const errorSection = document.getElementById('error-section')     as HTMLDivElement | null;
const errorP       = document.getElementById('error-message')     as HTMLParagraphElement | null;
/* -------------------------------- */

/* ---------- small helpers ---------- */
function showSection(id: string): void {
  if (loadingDiv)   loadingDiv.hidden   = true;
  if (chatSection)  chatSection.hidden  = id !== 'chat-exporter';
  if (githubSection)githubSection.hidden= id !== 'github-downloader';
  if (generalSect)  generalSect.hidden  = id !== 'general-exporter';
  if (unsupported)  unsupported.hidden  = id !== 'unsupported-site';
  if (errorSection) errorSection.hidden = id !== 'error-section';
}

function showLoading(msg = 'Loading…'): void {
  if (loadingDiv) {
    loadingDiv.textContent = msg;
    loadingDiv.hidden = false;
    showSection(''); // hide all others
  }
}

function showError(msg: string): void {
  if (errorP) errorP.textContent = msg;
  showSection('error-section');
}

function sanitizeFilename(name = 'untitled'): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[\s._]+/g, '_')
    .replace(/^[._\s]+|[._\s]+$/g, '')
    .slice(0, 150) || 'untitled';
}

function triggerDownload(content: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  try {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);

    /* ---- NO GENERIC PARAMETER ---- */
    api.runtime.sendMessage({
      action: 'downloadFile',
      url,
      filename
    })
    /* ---- cast the promise result ---- */
    .then(res => {
      const resp = res as BackgroundRes | undefined;
      if (!resp?.success) showError(resp?.error ?? 'Download failed.');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })
    .catch(err => {
      showError(`SendMessage error: ${err?.message ?? 'unknown'}`);
      URL.revokeObjectURL(url);
    });
  } catch (err: any) {
    showError(`Download prep error: ${err?.message ?? 'unknown'}`);
  }
}
/* ----------------------------------- */

/* ---------- main startup ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  showLoading('Detecting site…');
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url) throw new Error('Active tab missing data.');

    const url = tab.url;
    const isChat    = ChatExporter.isChatSite(url);
    const isGitHub  = GitHubDownloader.isGitHubRepoPage(url);
    const isGeneral = GeneralExporter.isGeneralSite(url);

    if (isChat)       { setupChatListeners(tab);      showSection('chat-exporter'); }
    else if (isGitHub){ setupGitHubListeners(tab,url);showSection('github-downloader'); }
    else if (isGeneral){setupGeneralListeners(tab);   showSection('general-exporter'); }
    else               showSection('unsupported-site');
  } catch (err: any) {
    showError(`Init error: ${err?.message ?? 'unknown'}`);
  }
});
/* ---------------------------------- */

/* ---------- listener setup ---------- */
function setupChatListeners(tab: chrome.tabs.Tab): void {
  document.getElementById('chat-txt') ?.addEventListener('click', () => handleChatExport(tab,'txt'));
  document.getElementById('chat-md')  ?.addEventListener('click', () => handleChatExport(tab,'md'));
  document.getElementById('chat-json')?.addEventListener('click', () => handleChatExport(tab,'json'));
}

function setupGitHubListeners(tab: chrome.tabs.Tab, url: string): void {
  const dlBtn = document.getElementById('github-download-zip') as HTMLButtonElement | null;
  const selAll= document.getElementById('github-select-all')   as HTMLInputElement | null;
  const tree  = document.getElementById('github-file-tree')    as HTMLDivElement | null;
  if (!dlBtn || !selAll || !tree) { showError('GitHub UI missing.'); return; }

  dlBtn.addEventListener('click', () => handleGitHubDownload(tab,url));
  selAll.addEventListener('change', e => {
    GitHubDownloader.toggleSelectAll((e.target as HTMLInputElement).checked);
    dlBtn.disabled = GitHubDownloader.getSelectedItems().length === 0;
  });
  tree.addEventListener('change', () => {
    const any = GitHubDownloader.getSelectedItems().length > 0;
    dlBtn.disabled = !any;
    selAll.checked = any && GitHubDownloader.areAllSelected();
  });
  GitHubDownloader.displayFileTree(tab,url);
}

function setupGeneralListeners(tab: chrome.tabs.Tab): void {
  document.getElementById('general-pdf')?.addEventListener('click', () => handleGeneralExport(tab,'pdf'));
  // Download buttons
  document.getElementById('general-md') ?.addEventListener('click', () => handleGeneralExport(tab,'md'));
  document.getElementById('general-txt')?.addEventListener('click', () => handleGeneralExport(tab,'txt'));
  // Copy to clipboard buttons
  document.getElementById('general-copy-md')?.addEventListener('click', () => handleGeneralCopy(tab,'md'));
  document.getElementById('general-copy-txt')?.addEventListener('click', () => handleGeneralCopy(tab,'txt'));
}
/* ------------------------------------ */

/* ---------- chat export (placeholder) ---------- */
async function handleChatExport(tab: chrome.tabs.Tab, format: 'txt'|'md'|'json'): Promise<void> {
  /* keep existing chat export logic here */
}
/* ---------------------------------------------- */

/* ---------- GitHub download (placeholder) ---------- */
async function handleGitHubDownload(tab: chrome.tabs.Tab, url: string): Promise<void> {
  /* keep existing GitHub download logic here */
}
/* -------------------------------------------------- */

/* ---------- general page export ---------- */
async function handleGeneralExport(tab: chrome.tabs.Tab, format: 'pdf'|'txt'|'md'): Promise<void> {
  showLoading(`Exporting page as ${format.toUpperCase()}…`);
  if (!tab.id) return showError('Tab ID missing.');

  try {
    const base = sanitizeFilename(tab.title || 'page');

    if (format === 'pdf') {
      await api.scripting.executeScript({ target:{ tabId: tab.id }, func: () => window.print() });
      setTimeout(() => window.close(), 500);
      return;
    }

    const results: InjectionResults = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func:   extractDataForInjection,
      args:   []
    });

    const extracted = results?.[0]?.result as PageResult | undefined;
    if (!extracted || extracted.error) throw new Error(extracted?.error ?? 'No data');

    let content = extracted.content;
    if (extracted.requiresMarkdownConversion) {
      content =
        typeof TurndownService !== 'undefined'
          ? GeneralExporter.convertHtmlToMarkdown(content)
          : '<!-- Turndown library missing -->\n\n' + content;
    }

    const filename = `${base}.${format}`;
    const mime     = format === 'txt'
      ? 'text/plain;charset=utf-8'
      : 'text/markdown;charset=utf-8';

    triggerDownload(content, filename, mime);
    if (loadingDiv) loadingDiv.textContent = 'Download started!';
    setTimeout(() => window.close(), 1500);
  } catch (err: any) {
    showError(`Export failed: ${err?.message ?? 'unknown'}`);
    if (loadingDiv) loadingDiv.hidden = true;
  }
}
/* --------------------------------------- */
/**
 * Copy current page content to clipboard in specified format (md or txt).
 */
async function handleGeneralCopy(tab: chrome.tabs.Tab, format: 'txt'|'md'): Promise<void> {
  showLoading(`Copying page as ${format.toUpperCase()}…`);
  if (!tab.id) return showError('Tab ID missing.');
  try {
    const results = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDataForInjection,
      args: []
    });
    const extracted = results?.[0]?.result as PageResult | undefined;
    if (!extracted || extracted.error) throw new Error(extracted?.error ?? 'No data');
    let content = extracted.content;
    if (extracted.requiresMarkdownConversion) {
      content =
        typeof TurndownService !== 'undefined'
          ? GeneralExporter.convertHtmlToMarkdown(content)
          : '<!-- Turndown library missing -->\n\n' + content;
    }
    // Copy text to clipboard
    await navigator.clipboard.writeText(content);
    if (loadingDiv) loadingDiv.textContent = 'Copied to clipboard!';
    setTimeout(() => window.close(), 1500);
  } catch (err: any) {
    showError(`Copy failed: ${err?.message ?? 'unknown'}`);
  }
}
/* --------------------------------------- */
/* --------------------------------------- */

console.log('Snaggle Popup Script Loaded.');
