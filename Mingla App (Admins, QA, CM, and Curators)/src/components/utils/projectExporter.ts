/**
 * Project Exporter Utility
 * Downloads the entire Mingla project as a ZIP file
 */

export async function downloadProjectAsZip() {
  try {
    // Try to import JSZip
    let JSZip;
    try {
      const jsZipModule = await import('jszip');
      JSZip = jsZipModule.default || jsZipModule;
    } catch (importError) {
      console.error('JSZip not available:', importError);
      // Fallback: Create individual file downloads
      downloadIndividualFiles();
      return true;
    }
    
    const zip = new JSZip();

  // File content - all project files as strings
  const files: Record<string, string> = {
    // Root configuration files
    'package.json': JSON.stringify({
      "name": "mingla-prototype",
      "version": "1.0.0",
      "description": "Mingla - Complete Experience Discovery Platform",
      "type": "module",
      "scripts": {
        "dev": "vite",
        "build": "tsc && vite build",
        "preview": "vite preview",
        "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
        "type-check": "tsc --noEmit"
      },
      "dependencies": {
        "react": "^19.0.0",
        "react-dom": "^19.0.0",
        "lucide-react": "latest",
        "motion": "latest",
        "date-fns": "^2.30.0",
        "recharts": "^2.10.0",
        "react-slick": "^0.30.0",
        "slick-carousel": "^1.8.1",
        "react-responsive-masonry": "^2.2.0",
        "react-dnd": "^16.0.1",
        "react-dnd-html5-backend": "^16.0.1",
        "qrcode.react": "^3.1.0",
        "sonner": "^2.0.3",
        "react-hook-form": "^7.55.0",
        "jszip": "^3.10.1"
      },
      "devDependencies": {
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@vitejs/plugin-react": "^4.3.0",
        "typescript": "^5.5.0",
        "vite": "^6.0.0",
        "tailwindcss": "^4.0.0",
        "@tailwindcss/vite": "^4.0.0",
        "eslint": "^9.0.0",
        "eslint-plugin-react-hooks": "^5.0.0",
        "eslint-plugin-react-refresh": "^0.4.0"
      },
      "engines": {
        "node": ">=18.0.0"
      }
    }, null, 2),

    'README.md': `# Mingla - Experience Discovery Platform

## 🚀 Quick Start

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
\`\`\`

## 📖 About

Mingla is a comprehensive experience discovery platform with:
- Tinder-style card discovery
- Multi-user system (5 roles)
- Collaboration boards
- Calendar integration
- Purchase flow
- 39 currencies support

## 🎯 Features

- **Discovery**: Swipeable cards with smart filtering
- **Collaboration**: Shared boards and discussions
- **Activity**: Calendar, saved experiences, boards
- **Profile**: Stats, achievements, settings
- **Multi-role**: Explorer, Curator, Content Manager, QA, Admin

## 📚 Documentation

See \`EXPORT_GUIDE.md\` for complete documentation.

## 🔐 Test Accounts

- Explorer: jordan.explorer@mingla.com / Mingla2025!
- Curator: maria.curator@mingla.com / Mingla2025!
- Content Manager: alex.content@mingla.com / Mingla2025!
- QA Manager: sam.qa@mingla.com / Mingla2025!
- Admin: admin@mingla.com / Mingla2025!

## 📄 License

MIT License
`,

    'tsconfig.json': JSON.stringify({
      "compilerOptions": {
        "target": "ES2020",
        "useDefineForClassFields": true,
        "lib": ["ES2020", "DOM", "DOM.Iterable"],
        "module": "ESNext",
        "skipLibCheck": true,
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "isolatedModules": true,
        "moduleDetection": "force",
        "noEmit": true,
        "jsx": "react-jsx",
        "strict": true,
        "noUnusedLocals": true,
        "noUnusedParameters": true,
        "noFallthroughCasesInSwitch": true,
        "baseUrl": ".",
        "paths": {
          "@/*": ["./*"],
          "@components/*": ["./components/*"],
          "@screens/*": ["./screens/*"],
          "@theme/*": ["./theme/*"],
          "@navigation/*": ["./navigation/*"],
          "@utils/*": ["./components/utils/*"]
        }
      },
      "include": ["**/*.ts", "**/*.tsx"],
      "exclude": ["node_modules"]
    }, null, 2),

    'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@components': path.resolve(__dirname, './components'),
      '@screens': path.resolve(__dirname, './screens'),
      '@theme': path.resolve(__dirname, './theme'),
      '@navigation': path.resolve(__dirname, './navigation'),
      '@utils': path.resolve(__dirname, './components/utils'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
`,

    '.gitignore': `# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
coverage/

# Production
dist/
build/

# Misc
.DS_Store
*.pem
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
`,

    'INSTALLATION.md': `# Installation Guide

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

## Step 1: Extract Files

Extract the downloaded ZIP file to your desired location.

## Step 2: Install Dependencies

\`\`\`bash
cd mingla-prototype
npm install
\`\`\`

This will install all required dependencies including:
- React 19
- TypeScript
- Tailwind V4
- Lucide Icons
- Motion/React
- And more...

## Step 3: Start Development Server

\`\`\`bash
npm run dev
\`\`\`

The app will open at \`http://localhost:3000\`

## Step 4: Build for Production

\`\`\`bash
npm run build
\`\`\`

Output will be in the \`/dist\` folder.

## Troubleshooting

### Port already in use
If port 3000 is in use, the app will try the next available port.

### Module not found
Run \`npm install\` again to ensure all dependencies are installed.

### TypeScript errors
Run \`npm run type-check\` to see detailed type errors.

## Next Steps

1. Review \`EXPORT_GUIDE.md\` for complete documentation
2. Check test accounts in \`README.md\`
3. Explore the codebase structure
4. Start customizing for your needs!
`
  };

  // Add all files to ZIP
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }

  // Note about remaining files
  zip.file('DOWNLOAD_NOTE.txt', `
Mingla Project Export - Downloaded ${new Date().toLocaleString()}

This ZIP contains the core configuration files for the Mingla project.

WHAT'S INCLUDED:
✅ package.json - All dependencies
✅ tsconfig.json - TypeScript configuration  
✅ vite.config.ts - Build configuration
✅ README.md - Quick start guide
✅ INSTALLATION.md - Setup instructions
✅ .gitignore - Git ignore rules

WHAT YOU NEED TO DO:
1. Extract this ZIP file
2. Copy ALL remaining files from the development environment:
   - /App.tsx
   - /components/ (entire folder)
   - /screens/ (entire folder)
   - /theme/ (entire folder)
   - /navigation/ (entire folder)
   - /styles/globals.css
   - All .md documentation files

3. Run: npm install
4. Run: npm run dev

IMPORTANT:
This download includes configuration files only. You must manually copy
the source code files (App.tsx, components, etc.) from your development
environment to have the complete working application.

The complete file list is available in your current development environment.

For questions, refer to the EXPORT_GUIDE.md in your development environment.
`);

  // Generate ZIP
  const blob = await zip.generateAsync({ type: 'blob' });
  
  // Create download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mingla-project-${Date.now()}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return true;
  } catch (error) {
    console.error('ZIP creation failed:', error);
    // Fallback to individual file downloads
    downloadIndividualFiles();
    return true;
  }
}

/**
 * Fallback: Download files individually if JSZip is not available
 */
function downloadIndividualFiles() {
  const files = {
    'package.json': JSON.stringify({
      "name": "mingla-prototype",
      "version": "1.0.0",
      "description": "Mingla - Complete Experience Discovery Platform",
      "type": "module",
      "scripts": {
        "dev": "vite",
        "build": "tsc && vite build",
        "preview": "vite preview"
      },
      "dependencies": {
        "react": "^19.0.0",
        "react-dom": "^19.0.0",
        "lucide-react": "latest",
        "motion": "latest",
        "date-fns": "^2.30.0",
        "recharts": "^2.10.0",
        "react-slick": "^0.30.0",
        "slick-carousel": "^1.8.1",
        "react-responsive-masonry": "^2.2.0",
        "react-dnd": "^16.0.1",
        "react-dnd-html5-backend": "^16.0.1",
        "qrcode.react": "^3.1.0",
        "sonner": "^2.0.3",
        "react-hook-form": "^7.55.0",
        "jszip": "^3.10.1"
      },
      "devDependencies": {
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@vitejs/plugin-react": "^4.3.0",
        "typescript": "^5.5.0",
        "vite": "^6.0.0",
        "tailwindcss": "^4.0.0",
        "@tailwindcss/vite": "^4.0.0"
      }
    }, null, 2),

    'README.md': `# Mingla - Experience Discovery Platform

## 🚀 Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

## 📚 Documentation

See EXPORT_GUIDE.md for complete documentation.

## 🔐 Test Accounts

- Explorer: jordan.explorer@mingla.com / Mingla2025!
- Curator: maria.curator@mingla.com / Mingla2025!

## ⚠️ Important

This download includes configuration files only.
You must copy source files from your development environment:
- App.tsx
- /components (100+ files)
- /screens (6 files)
- /theme (6 files)
- /navigation (2 files)
- /styles/globals.css
`
  };

  // Download package.json
  downloadFile(files['package.json'], 'package.json', 'application/json');
  
  setTimeout(() => {
    // Download README.md
    downloadFile(files['README.md'], 'README.md', 'text/markdown');
  }, 500);

  // Show instructions
  setTimeout(() => {
    alert(`📥 Files downloaded!\n\n✅ package.json\n✅ README.md\n\n⚠️ IMPORTANT:\nThese are configuration files only.\n\nYou must also copy from your dev environment:\n• App.tsx\n• /components folder (100+ files)\n• /screens folder (6 files)\n• /theme folder (6 files)\n• /navigation folder (2 files)\n• /styles/globals.css\n\nSee README.md for setup instructions.`);
  }, 1000);
}

/**
 * Download a single file
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
