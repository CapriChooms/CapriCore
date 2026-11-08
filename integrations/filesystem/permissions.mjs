import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../../apps/desktop/storage.mjs';

export const INSTALLATION_SCOPE_ID = 'ca9f1000-0000-4000-8000-000000000001';

export const within = (root, target) => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
};
export function protectedLocations(root) {
  return [
    root,
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
  ]
    .filter(Boolean)
    .map((value) => path.resolve(value));
}
export class FilePermissions {
  constructor(
    file,
    {
      protectedRoots = [],
      privatePaths = [],
      applicationRoot = null,
      computerScopes = () => [],
    } = {},
  ) {
    Object.assign(this, { file, protectedRoots, computerScopes });
    this.privatePaths = privatePaths.map((value) => path.resolve(value));
    this.applicationRoot = applicationRoot ? realpathSync(applicationRoot) : null;
    if (
      this.applicationRoot &&
      (this.applicationRoot === path.parse(this.applicationRoot).root ||
        !lstatSync(this.applicationRoot).isDirectory())
    )
      throw new Error('The installation scope must be a dedicated application directory.');
  }
  load() {
    if (!existsSync(this.file)) {
      if (!this.applicationRoot) return [];
      const scopes = [{ id: INSTALLATION_SCOPE_ID, root: this.applicationRoot, write: true }];
      this.save(scopes);
      return scopes;
    }
    const bytes = readFileSync(this.file);
    if (bytes.length > 32768) throw new Error('File permissions are invalid. Reopen File access.');
    const saved = JSON.parse(bytes.toString('utf8'));
    if (
      saved.schemaVersion !== 1 ||
      !Array.isArray(saved.scopes) ||
      saved.scopes.length > 21 ||
      saved.scopes.filter((s) => s?.id !== INSTALLATION_SCOPE_ID).length > 20 ||
      (saved.applicationScopeInitialized !== undefined &&
        typeof saved.applicationScopeInitialized !== 'boolean') ||
      !saved.scopes.every(
        (s) =>
          s &&
          /^[a-f0-9-]{36}$/.test(s.id) &&
          typeof s.root === 'string' &&
          s.root.length < 2048 &&
          typeof s.write === 'boolean',
      )
    )
      throw new Error('Invalid file permissions');
    if (new Set(saved.scopes.map((s) => s.id)).size !== saved.scopes.length)
      throw new Error('Duplicate file permission IDs');
    if (this.applicationRoot) {
      const own = saved.scopes.find((s) => s.id === INSTALLATION_SCOPE_ID);
      if (own) own.root = this.applicationRoot;
      // Migrate once. Revocation/read-only choices survive every later load and restart.
      if (saved.applicationScopeInitialized !== true) {
        if (!own)
          saved.scopes.unshift({
            id: INSTALLATION_SCOPE_ID,
            root: this.applicationRoot,
            write: true,
          });
        this.save(saved.scopes);
      }
    }
    return saved.scopes;
  }
  isInstallation(scope) {
    return Boolean(
      this.applicationRoot &&
        scope.id === INSTALLATION_SCOPE_ID &&
        path.resolve(scope.root).toLowerCase() === this.applicationRoot.toLowerCase(),
    );
  }
  isComputer(scope) {
    return this.computerScopes().some(
      (entry) => entry.id === scope.id && entry.root.toLowerCase() === scope.root.toLowerCase(),
    );
  }
  canActWithoutConfirmation(scope) {
    return this.isInstallation(scope) || this.isComputer(scope);
  }
  all() {
    return [...this.load(), ...this.computerScopes()];
  }
  allowedRoot(folder, id) {
    const root = realpathSync(folder);
    const computer = this.isComputer({ id, root });
    if (
      (!computer && root === path.parse(root).root) ||
      root.startsWith('\\\\') ||
      !lstatSync(root).isDirectory() ||
      (!computer &&
        !this.isInstallation({ id, root }) &&
        this.protectedRoots.some((p) => within(p, root)))
    )
      throw new Error('Choose a personal folder outside system and Capri application data.');
    return root;
  }
  grant(folder) {
    const own =
      this.applicationRoot &&
      realpathSync(folder).toLowerCase() === this.applicationRoot.toLowerCase();
    const id = own ? INSTALLATION_SCOPE_ID : randomUUID();
    const root = this.allowedRoot(folder, id),
      scopes = this.load();
    if (scopes.some((s) => s.root.toLowerCase() === root.toLowerCase())) return this.snapshot();
    if (!own && scopes.filter((s) => s.id !== INSTALLATION_SCOPE_ID).length >= 20)
      throw new Error('Remove a folder before adding another one.');
    scopes.push({ id, root, write: Boolean(own) });
    this.save(scopes);
    return this.snapshot();
  }
  save(scopes) {
    writeJsonAtomic(this.file, {
      schemaVersion: 1,
      scopes,
      ...(this.applicationRoot ? { applicationScopeInitialized: true } : {}),
    });
  }
  update(id, write) {
    if (typeof write !== 'boolean') throw new Error('Invalid folder permission');
    const scopes = this.load(),
      scope = scopes.find((s) => s.id === id);
    if (!scope) throw new Error('Folder permission no longer exists');
    this.allowedRoot(scope.root, scope.id);
    scope.write = write;
    this.save(scopes);
    return this.snapshot();
  }
  revoke(id) {
    const scopes = this.load();
    this.save(scopes.filter((s) => s.id !== id));
    return this.snapshot();
  }
  snapshot() {
    return this.all().map((s) => ({
      ...s,
      label: path.basename(s.root) || s.root,
      ...(this.isInstallation(s) ? { kind: 'installation', confirmationRequired: false } : {}),
    }));
  }
  scope(id, write = false) {
    const scope = this.all().find((s) => s.id === id);
    if (!scope) throw new Error('Choose an allowed folder in Menu → File access first.');
    if (write && !scope.write)
      throw new Error('This folder is read-only. The owner can allow file changes in File access.');
    const root = this.allowedRoot(scope.root, scope.id);
    if (root.toLowerCase() !== scope.root.toLowerCase())
      throw new Error('The approved folder target changed. Select it again.');
    return { ...scope, root };
  }
  target(id, relative = '', write = false) {
    const scope = this.scope(id, write);
    if (
      typeof relative !== 'string' ||
      relative.length > 1024 ||
      path.isAbsolute(relative) ||
      path.win32.isAbsolute(relative) ||
      /[\x00-\x1f<>:"|?*]/.test(relative)
    )
      throw new Error('Use a path relative to the approved folder.');
    const parts = relative ? relative.split(/[\\/]/) : [];
    if (
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
    )
      throw new Error('Invalid relative file path');
    let target = scope.root;
    for (const part of parts) {
      target = path.join(target, part);
      if (this.privatePaths.some((privatePath) => within(privatePath, target)))
        throw new Error(
          'Private application data is available only through its dedicated controls.',
        );
      if (
        !this.isComputer(scope) &&
        !this.isInstallation(scope) &&
        this.protectedRoots.some((p) => within(p, target))
      )
        throw new Error('Application and system data cannot be accessed by this tool.');
      if (existsSync(target)) {
        const stat = lstatSync(target);
        if (
          stat.isSymbolicLink() ||
          (stat.isFile() && stat.nlink > 1) ||
          !within(scope.root, realpathSync(target))
        )
          throw new Error('Linked paths are not supported. Select the real folder.');
      }
    }
    if (this.privatePaths.some((privatePath) => within(privatePath, target)))
      throw new Error('Private application data is available only through its dedicated controls.');
    return { scope, path: target, relative: parts.join(path.sep) };
  }
}
