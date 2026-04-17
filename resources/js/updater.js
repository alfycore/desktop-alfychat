/**
 * Updater — chargé comme script classique, expose window.Updater
 */

class Updater {
  /** @param {{ manifestUrl: string, currentVersion: string }} opts */
  constructor({ manifestUrl, currentVersion }) {
    this.manifestUrl    = manifestUrl;
    this.currentVersion = currentVersion;
  }

  // ── Semver compare ──────────────────────────────────────────────────────────
  /** Retourne true si `a` > `b` (format X.Y.Z) */
  static semverGt(a, b) {
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff > 0) return true;
      if (diff < 0) return false;
    }
    return false;
  }

  // ── Platform detection ──────────────────────────────────────────────────────
  static getPlatform() {
    const p = navigator.platform.toLowerCase();
    if (p.includes('win'))                                return 'win32';
    if (p.includes('mac') || p.includes('intel mac') || p.includes('apple')) return 'darwin';
    return 'linux';
  }

  // ── Fetch manifest ──────────────────────────────────────────────────────────
  async fetchManifest() {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${this.manifestUrl}?_t=${Date.now()}`, {
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  }

  // ── Check ───────────────────────────────────────────────────────────────────
  /**
   * Vérifie si une mise à jour est disponible.
   * @returns {Promise<null | { version: string, notes: string, url: string, size: number }>}
   */
  async checkForUpdate() {
    const manifest = await this.fetchManifest();
    if (!manifest?.version) throw new Error('Manifest invalide');

    if (!Updater.semverGt(manifest.version, this.currentVersion)) {
      return null; // Déjà à jour
    }

    const platform = Updater.getPlatform();
    const platformData = manifest.platforms?.[platform];
    if (!platformData?.url) {
      console.warn('[Updater] Pas de binaire pour la plateforme:', platform);
      return null;
    }

    return {
      version: manifest.version,
      notes:   manifest.notes ?? '',
      date:    manifest.date  ?? '',
      url:     platformData.url,
      size:    platformData.size ?? 0,
    };
  }

  // ── Install ─────────────────────────────────────────────────────────────────
  /**
   * Télécharge et installe la mise à jour.
   * Utilise l'API Neutralino updater si disponible, sinon fallback manuel.
   * @param {{ version: string, url: string }} update
   * @param {(pct: number) => void} [onProgress]
   */
  async installUpdate(update, onProgress) {
    // Essayer l'API native Neutralino.updater (v5+)
    if (typeof Neutralino?.updater?.checkForUpdates === 'function') {
      try {
        return await this._installNative(update, onProgress);
      } catch (e) {
        console.warn('[Updater] Fallback manuel (API native échouée):', e.message);
      }
    }
    return await this._installManual(update, onProgress);
  }

  /** Méthode 1 : API officielle Neutralino.updater */
  async _installNative(update, onProgress) {
    onProgress?.(10);
    const result = await Neutralino.updater.checkForUpdates(update.url);
    onProgress?.(50);
    if (result.update) {
      await Neutralino.updater.install();
      onProgress?.(100);
    }
  }

  /** Méthode 2 : fallback — télécharge le zip et écrit le fichier de mise à jour */
  async _installManual(update, onProgress) {
    onProgress?.(5);

    // Téléchargement via fetch + ArrayBuffer
    const res = await fetch(update.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Téléchargement échoué : HTTP ${res.status}`);

    const total = update.size || parseInt(res.headers.get('content-length') ?? '0', 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) onProgress?.(5 + Math.round((received / total) * 80));
    }

    onProgress?.(85);

    // Assembler en Uint8Array puis base64
    const all = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    const b64 = btoa(String.fromCharCode(...all));

    // Écrire dans le répertoire temporaire Neutralino
    const tmpPath = `${NL_PATH ?? '.'}/update_pkg.zip`;
    await Neutralino.filesystem.writeBinaryFile(tmpPath, b64);

    onProgress?.(95);

    // Écrire le manifest de mise à jour que Neutralino lit au prochain démarrage
    await Neutralino.storage.setData('pendingUpdate', JSON.stringify({
      version: update.version,
      packagePath: tmpPath,
      installedAt: new Date().toISOString(),
    }));

    onProgress?.(100);
  }

  // ── Appliquer un update en attente au démarrage ────────────────────────────
  /**
   * A appeler au tout début du boot, avant d'afficher quoi que ce soit.
   * Si un update a été téléchargé, Neutralino.updater.install() le déploie.
   */
  static async applyPendingIfAny() {
    try {
      const raw = await Neutralino.storage.getData('pendingUpdate');
      if (!raw) return;
      const info = JSON.parse(raw);
      if (info?.packagePath) {
        await Neutralino.updater.install();
        await Neutralino.storage.setData('pendingUpdate', '');
      }
    } catch { /* rien à appliquer */ }
  }
}

// Exposer en global pour les scripts classiques
window.Updater = Updater;
