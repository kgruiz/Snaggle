# Snaggle

Snaggle is a Chrome extension designed to help users easily download and export content from specific websites. With Snaggle you can:

- **Export Chats**
  Download chat threads from supported platforms (e.g. chat.openai.com, Gemini, AI Studio) in plain text, Markdown, or JSON format.

- **Download GitHub Files**
  Select files or directories from GitHub repositories and download them as a compressed ZIP archive.

- **Export Web Pages**
  Save the current webpage as a PDF, Markdown, or plain text file.

---

## Features

- **Dynamic Script Loading:**
  Supports runtime loading of dependencies (e.g. JSZip and Turndown for ZIP compression and HTML-to-Markdown conversion).

- **Modular Codebase:**
  Organized into background scripts, popup logic, and content modules for different export functionalities.

- **Modern Tech Stack:**
  Built using TypeScript, Vite, and the CRXJS plugin for a streamlined Chrome extension development experience.

- **User-Friendly UI:**
  An intuitive popup interface offers separate sections for chat exporting, GitHub downloading, and general page exports.

---

## Project Structure

```
Snaggle/
├── dist/                  # Generated distribution files
│   ├── assets/            # Compiled JS/CSS assets (with Vite hashing)
│   ├── icons/             # Extension icons
│   ├── manifest.json      # Extension manifest (v3)
│   ├── popup.html         # Compiled popup interface
│   └── service-worker-loader.js
├── docs/                  # Documentation files (including this README)
├── public/                # Public assets (vendor scripts, icons)
├── src/
│   ├── background/        # Background service worker scripts
│   ├── modules/           # Feature modules:
│   │   ├── chat_exporter.ts
│   │   ├── general_exporter.ts
│   │   └── github_downloader.ts
│   └── popup/             # Popup scripts & styles (index.ts, popup.css)
├── package.json           # Project metadata & dependency list
├── tsconfig.json          # TypeScript configuration
└── vite.config.ts         # Vite (and CRXJS) configuration for building the extension
```

---

## Installation & Development

1. **Clone the Repo:**

   ```bash
   git clone https://github.com/yourusername/Snaggle.git
   cd Snaggle
   ```

2. **Install Dependencies:**

   Use npm or yarn:

   ```bash
   npm install
   ```

   or

   ```bash
   yarn install
   ```

3. **Run Development Server:**

   Launch Vite’s dev server:

   ```bash
   npm run dev
   ```

   This will serve the extension’s popup and automatically rebuild on changes.

4. **Build the Extension:**

   Create a production build with:

   ```bash
   npm run build
   ```

5. **Load in Chrome:**

   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top-right.
   - Click "Load unpacked" and select the built `dist` directory.

---

## Usage

- **Chat Exporter:**
  Visit a supported chat website and open the extension popup to export the active chat session in your preferred format.

- **GitHub Downloader:**
  While on a GitHub repository page, open the extension and select files or directories from the file tree; click to download the selected items as a ZIP archive.

- **General Page Exporter:**
  Open any webpage (using HTTP, HTTPS, or file protocols) and choose to export the page’s content either as a PDF, Markdown, or plain text.

---

## Technologies & Libraries

- **TypeScript** for type-safe development.
- **Vite** as the development and build tool.
- **CRXJS/Vite Plugin** to bundle the Chrome extension.
- **JSZip** to dynamically compress files into a ZIP archive.
- **Turndown** to convert HTML content to Markdown.

---

## Contributing

Contributions are welcome! Please fork the repository and open a pull request with your changes. For major changes or new feature ideas, please open an issue first to discuss your proposal.
