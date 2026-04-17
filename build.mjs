#!/usr/bin/env node
/**
 * build.mjs — Script de build AlfyChat Desktop
 * Usage :
 *   node build.mjs              → build debug (toutes plateformes)
 *   node build.mjs --release    → build release zippé
 *   node build.mjs --win        → Windows seulement
 *   node build.mjs --linux      → Linux seulement
 *   node build.mjs --mac        → macOS seulement
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const args  = process.argv.slice(2);

const isRelease = args.includes('--release');
const winOnly   = args.includes('--win');
const linuxOnly = args.includes('--linux');
const macOnly   = args.includes('--mac');

const DIST = join(__dir, 'dist');
const ICONS_SRC = join(__dir, 'resources', 'icons');

// S'assurer que dist/ existe
if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });

// Nettoyer les anciens binaires
try { rmSync(join(__dir, 'dist'), { recursive: true, force: true }); } catch {}

console.log('🔨 Build AlfyChat Desktop…');

// Installer neu CLI si absent
try {
  execSync('npx neu version', { stdio: 'ignore' });
} catch {
  console.log('📦 Installation de @neutralinojs/neu…');
  execSync('npm install', { stdio: 'inherit', cwd: __dir });
}

// Build
const buildCmd = isRelease ? 'npx neu build --release' : 'npx neu build';
console.log(`▶ ${buildCmd}`);
execSync(buildCmd, { stdio: 'inherit', cwd: __dir });

console.log('✅ Build terminé → dist/');
