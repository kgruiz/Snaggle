// src/popup/index.ts

import JSZip from 'jszip'
import TurndownService from 'turndown'
import { isChatSite, extractChatData } from '../modules/chat_exporter'
import {
  isGitHubRepoPage,
  parseRepoUrl,
  toggleSelectAll,
  getSelectedItems,
  areAllSelected,
  displayFileTree
} from '../modules/github_downloader'
import {
  isGeneralSite,
  extractPageData,
  convertHtmlToMarkdown
} from '../modules/general_exporter'
import { extractDataForInjection } from '../content/extractGeneralData'

import popupHtml from '../../popup.html?raw'
import popupCss from './popup.css?raw'

const api = chrome

interface UIElementsCache {
  loadingDiv: HTMLElement | null
  chatSection: HTMLElement | null
  githubSection: HTMLElement | null
  generalSection: HTMLElement | null
  unsupported: HTMLElement | null
  errorSection: HTMLElement | null
  errorP: HTMLElement | null
  actionToggle: HTMLInputElement | null
  githubDownloadBtn: HTMLButtonElement | null
  githubSelectAll: HTMLInputElement | null
  githubTree: HTMLElement | null
  chatTxtBtn: HTMLButtonElement | null
  chatMdBtn: HTMLButtonElement | null
  chatJsonBtn: HTMLButtonElement | null
  generalPdfBtn: HTMLButtonElement | null
  generalMdBtn: HTMLButtonElement | null
  generalTxtBtn: HTMLButtonElement | null
}

let popupContainer: HTMLDivElement | null = null
let popupContent: HTMLDivElement | null = null

let ui: UIElementsCache = {
  loadingDiv: null,
  chatSection: null,
  githubSection: null,
  generalSection: null,
  unsupported: null,
  errorSection: null,
  errorP: null,
  actionToggle: null,
  githubDownloadBtn: null,
  githubSelectAll: null,
  githubTree: null,
  chatTxtBtn: null,
  chatMdBtn: null,
  chatJsonBtn: null,
  generalPdfBtn: null,
  generalMdBtn: null,
  generalTxtBtn: null
}

function sanitizeFilename(name = 'untitled'): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[\s._]+/g, '_')
    .replace(/^[._\s]+|[._\s]+$/g, '')
    .slice(0, 150)
}

function downloadBlob(data: string | ArrayBuffer, filename: string) {
  const blob = new Blob([data], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  api.downloads.download({ url, filename, saveAs: true })
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

function injectPopup() {
  if (popupContainer) return

  popupContainer = document.createElement('div')
  popupContainer.id = 'snaggle-popup-container'
  popupContainer.classList.add('hidden')

  // Create the popup content wrapper (single .container)
  popupContent = document.createElement('div')
  popupContent.className = 'container'
  // Parse the raw HTML and extract only the inner .container content to avoid nesting full HTML document
  const parser = new DOMParser()
  const doc = parser.parseFromString(popupHtml, 'text/html')
  // Locate the fragment container inside the parsed HTML
  const inner = doc.body.querySelector('.container')
  // Set the inner HTML: only the content of the popup body fragment
  popupContent.innerHTML = inner
    ? inner.innerHTML
    : popupHtml

  // Append to DOM
  popupContainer.appendChild(popupContent)
  document.body.appendChild(popupContainer)
  // Inject stylesheet to head (global CSS for popup)
  const styleTag = document.createElement('style')
  styleTag.textContent = popupCss
  document.head.appendChild(styleTag)

  cacheUI()
}

function cacheUI() {
  if (!popupContent) return
  ui = {
    loadingDiv: popupContent.querySelector('#loading'),
    chatSection: popupContent.querySelector('#chat-exporter'),
    githubSection: popupContent.querySelector('#github-downloader'),
    generalSection: popupContent.querySelector('#general-exporter'),
    unsupported: popupContent.querySelector('#unsupported-site'),
    errorSection: popupContent.querySelector('#error-section'),
    errorP: popupContent.querySelector('#error-message'),
    actionToggle: popupContent.querySelector('#toggle-action'),
    githubDownloadBtn: popupContent.querySelector('#github-download-zip'),
    githubSelectAll: popupContent.querySelector('#github-select-all'),
    githubTree: popupContent.querySelector('#github-file-tree'),
    chatTxtBtn: popupContent.querySelector('#chat-txt'),
    chatMdBtn: popupContent.querySelector('#chat-md'),
    chatJsonBtn: popupContent.querySelector('#chat-json'),
    generalPdfBtn: popupContent.querySelector('#general-pdf'),
    generalMdBtn: popupContent.querySelector('#general-md'),
    generalTxtBtn: popupContent.querySelector('#general-txt')
  }
}

function togglePopup(show?: boolean) {
  if (!popupContainer) return
  const isVisible = popupContainer.classList.contains('visible')
  const shouldShow = show === undefined ? !isVisible : show

  if (shouldShow && !isVisible) {
    popupContainer.classList.add('visible')
    initPopup()
  } else if (!shouldShow && isVisible) {
    popupContainer.classList.remove('visible')
  }
}

function showSection(id: string) {
  const sections: Record<string, HTMLElement | null> = {
    'chat-exporter': ui.chatSection,
    'github-downloader': ui.githubSection,
    'general-exporter': ui.generalSection,
    'unsupported-site': ui.unsupported,
    'error-section': ui.errorSection
  }
  Object.values(sections).forEach(el => el && (el.hidden = true))
  if (sections[id]) sections[id]!.hidden = false
}

function showError(msg: string) {
  if (ui.errorP && ui.errorSection) {
    ui.errorP.textContent = msg
    showSection('error-section')
  }
}

api.runtime.onMessage.addListener((
  msg: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
): boolean => {
  if (msg.action === 'togglePopup') {
    injectPopup()
    togglePopup()
    return false
  }
  return false
})

async function initPopup() {
  if (!popupContent) return

  const url = location.href
  cacheUI()

  ui.loadingDiv && (ui.loadingDiv.hidden = false)
  showSection('')

  if (isChatSite(url)) {
    setupChat()
  } else if (isGitHubRepoPage(url)) {
    setupGitHub(url)
  } else if (isGeneralSite(url)) {
    setupGeneral()
  } else {
    showSection('unsupported-site')
  }
}

function setupChat() {
  showSection('chat-exporter')
  ui.chatTxtBtn!.onclick = () => exportChat('txt')
  ui.chatMdBtn!.onclick = () => exportChat('md')
  ui.chatJsonBtn!.onclick = () => exportChat('json')
}

async function exportChat(format: 'txt' | 'md' | 'json') {
  try {
    const res = extractChatData(format)
    let content = res.content
    if (format === 'md' && res.requiresMarkdownConversion) {
      const svc = new TurndownService()
      content = svc.turndown(content)
    }
    const filename = sanitizeFilename(res.filename)
    downloadBlob(content, filename)
  } catch (e) {
    console.error('Chat export failed:', e)
    showError('Chat export failed')
  }
}

function setupGitHub(url: string) {
  showSection('github-downloader')
  displayFileTree(null, url).catch(e => showError('GitHub tree failed'))
  ui.githubSelectAll!.onchange = e => {
    toggleSelectAll((e.target as HTMLInputElement).checked)
  }
  ui.githubTree!.onchange = () => {
    const sel = getSelectedItems()
    ui.githubDownloadBtn!.disabled = sel.length === 0
    ui.githubSelectAll!.checked = sel.length > 0 && areAllSelected()
  }
  ui.githubDownloadBtn!.onclick = () => {
    const items = getSelectedItems()
    api.runtime.sendMessage({
      action: 'createAndDownloadZip',
      filesToFetch: items,
      repoInfo: parseRepoUrl(url)
    })
  }
}

function setupGeneral() {
  showSection('general-exporter')
  ui.generalPdfBtn!.onclick = () => window.print()
  ui.generalMdBtn!.onclick = () => exportPage('md')
  ui.generalTxtBtn!.onclick = () => exportPage('txt')
}

async function exportPage(format: 'txt' | 'md') {
  try {
    const res = extractDataForInjection()
    let content = res.content
    if (format === 'md' && res.requiresMarkdownConversion) {
      const svc = new TurndownService()
      content = svc.turndown(content)
    }
    const filename = sanitizeFilename(document.title) + `.${format}`
    downloadBlob(content, filename)
  } catch (e) {
    console.error('Page export failed:', e)
    showError('Page export failed')
  }
}

console.log('Snaggle Popup UI Content Script Loaded.')
