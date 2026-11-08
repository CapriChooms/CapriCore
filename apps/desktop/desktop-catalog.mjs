// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import {
  existsSync,
  lstatSync,
  realpathSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  constants,
  unlinkSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { writeJsonAtomic } from './storage.mjs';
import { callApplicationBridge } from '../../integrations/desktop-actions/service.mjs';
import { exactApplications, matchingApplications } from './application-target.mjs';
import { browserExecutableCandidate } from './browser-identity.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const idValid = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const packageIdValid = (id) =>
  typeof id === 'string' &&
  /^[a-z0-9][a-z0-9.-]{0,49}_[a-z0-9]{13}![a-z0-9][a-z0-9.-]{0,63}$/i.test(id);
function regular(file, allowHardlinks = false) {
  const absolute = path.resolve(file);
  for (let cursor = absolute; cursor !== path.dirname(cursor); cursor = path.dirname(cursor))
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error('Linked paths are not supported.');
  const stat = lstatSync(absolute);
  if (!stat.isFile() || (!allowHardlinks && stat.nlink !== 1) || absolute.startsWith('\\\\'))
    throw new Error('Choose a regular local file.');
  return { file: realpathSync(absolute), stat };
}
function executable(file) {
  if (
    typeof file !== 'string' ||
    !path.isAbsolute(file) ||
    path.extname(file).toLowerCase() !== '.exe'
  )
    throw new Error('Choose a local .exe application.');
  // Launching a fixed local .exe does not modify its file or other hard links.
  return regular(file, true).file;
}
/** Owner-selected executables only. Native controls are short-lived inspection capabilities. */
export class DesktopCatalog {
  constructor({
    root,
    state,
    filePermissions,
    trash,
    bridge = callApplicationBridge,
    now = Date.now,
    translate = (text) => text,
    fullAccess = () => false,
    accessAllowed = () => true,
    accessSignal = () => null,
    currentTurn = () => null,
  }) {
    Object.assign(this, {
      root,
      state,
      filePermissions,
      trash,
      bridge,
      now,
      translate,
      fullAccess,
      accessAllowed,
      accessSignal,
      currentTurn,
    });
    mkdirSync(state, { recursive: true });
    this.file = path.join(state, 'app-catalog.json');
    this.inspections = new Map();
    this.discovered = new Map();
    this.db = new DatabaseSync(path.join(state, 'desktop-operations.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,fingerprint TEXT,state TEXT,result TEXT,created INTEGER); CREATE TABLE IF NOT EXISTS recovery(id TEXT PRIMARY KEY,scope TEXT,relative TEXT,backup TEXT,sha TEXT,bytes INTEGER);',
    );
    this.tail = Promise.resolve();
    this.waiting = 0;
  }
  apps() {
    if (!existsSync(this.file)) {
      this.catalogCache = null;
      return [];
    }
    const info = lstatSync(this.file, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
      throw new Error('Invalid application catalog.');
    const stamp = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
    if (this.catalogCache?.stamp === stamp) return structuredClone(this.catalogCache.apps);
    const value = JSON.parse(readFileSync(this.file, 'utf8'));
    if (
      value.schemaVersion !== 1 ||
      !Array.isArray(value.apps) ||
      value.apps.length > 40 ||
      new Set(value.apps.map((a) => a.id)).size !== value.apps.length ||
      !value.apps.every(
        (a) =>
          idValid(a.id) &&
          typeof a.name === 'string' &&
          a.name.length <= 100 &&
          ((typeof a.executable === 'string' && a.packageId === undefined) ||
            (a.executable === undefined && packageIdValid(a.packageId))) &&
          ['launch', 'inspect', 'text'].every((key) => typeof a[key] === 'boolean'),
      )
    )
      throw new Error('Invalid application catalog.');
    this.catalogCache = { stamp, apps: value.apps };
    return structuredClone(value.apps);
  }
  save(apps) {
    this.catalogCache = null;
    writeJsonAtomic(this.file, { schemaVersion: 1, apps });
    this.inspections.clear();
    return this.apps();
  }
  add(file) {
    const exe = executable(file),
      apps = this.apps();
    if (apps.some((a) => a.executable?.toLowerCase() === exe.toLowerCase())) return apps;
    if (apps.length >= 40) throw new Error('Remove an application before adding another.');
    apps.push({
      id: randomUUID(),
      name: path.basename(exe, '.exe'),
      executable: exe,
      launch: false,
      inspect: false,
      text: false,
    });
    return this.save(apps);
  }
  update(value) {
    if (
      !value ||
      !idValid(value.id) ||
      Object.keys(value).some((k) => !['id', 'launch', 'inspect', 'text', 'remove'].includes(k)) ||
      Object.entries(value).some(([k, v]) => k !== 'id' && typeof v !== 'boolean')
    )
      throw new Error('Invalid application permission.');
    const apps = this.apps(),
      app = apps.find((a) => a.id === value.id);
    if (!app) throw new Error('Application permission no longer exists.');
    if (app.packageId && (value.inspect === true || value.text === true))
      throw new Error('Use full computer control to interact with this packaged application.');
    if (value.remove) return this.save(apps.filter((a) => a !== app));
    for (const key of ['launch', 'inspect', 'text'])
      if (value[key] !== undefined) app[key] = value[key];
    if (value.text === true && !app.inspect)
      throw new Error('Inspection is needed before text entry.');
    if (!app.inspect) app.text = false;
    return this.save(apps);
  }
  allowed(id, capability) {
    if (!this.accessAllowed())
      throw Object.assign(new Error('Application access is paused.'), {
        code: 'APPLICATION_ACCESS_PAUSED',
      });
    const app = this.availableApps().find((a) => a.id === id);
    if (!app) throw new Error('Unknown application ID. Call apps and use an actual appId.');
    if (app.packageId) {
      if (capability !== 'launch' || (!app.launch && !this.fullAccess()))
        throw new Error(
          'Use the full computer task to observe and interact with this installed app.',
        );
      return app;
    }
    if (!app[capability] && !this.fullAccess())
      throw Object.assign(
        new Error(
          'The ' +
            capability +
            ' permission is off in Application access. ' +
            (capability === 'inspect' && app.launch
              ? 'To open this application, use launch with the same appId. Inspection only reads an already open window; do not repeat inspect.'
              : 'Enable that specific permission before trying this action again.'),
        ),
        { code: 'DESKTOP_PERMISSION_REQUIRED' },
      );
    if (executable(app.executable).toLowerCase() !== app.executable.toLowerCase())
      throw new Error('The application target changed. Choose it again.');
    return app;
  }
  availableApps() {
    const saved = this.apps();
    return this.fullAccess()
      ? [
          ...saved,
          ...[...this.discovered.values()].filter(
            (a) =>
              !saved.some(
                (s) =>
                  (s.packageId ?? s.executable).toLowerCase() ===
                  (a.packageId ?? a.executable).toLowerCase(),
              ),
          ),
        ]
      : saved;
  }
  rememberApplication(file, name, packageId) {
    if (packageId !== undefined && (!packageIdValid(packageId) || file !== undefined))
      throw new Error('Invalid installed application identity.');
    const target = packageId ?? executable(file),
      saved = this.apps().find(
        (a) => (a.packageId ?? a.executable).toLowerCase() === target.toLowerCase(),
      );
    if (saved) return name ? { ...saved, name: String(name).slice(0, 100) } : saved;
    const hex = hash((packageId ? 'package:' : '') + target.toLowerCase()).slice(0, 32);
    const app = {
      id:
        hex.slice(0, 8) +
        '-' +
        hex.slice(8, 12) +
        '-4' +
        hex.slice(13, 16) +
        '-8' +
        hex.slice(17, 20) +
        '-' +
        hex.slice(20),
      name: String(name || path.basename(target, '.exe')).slice(0, 100),
      ...(packageId ? { packageId } : { executable: target }),
      launch: true,
      inspect: !packageId,
      text: !packageId,
    };
    if (this.discovered.size >= 40) this.discovered.delete(this.discovered.keys().next().value);
    this.discovered.set(app.id, app);
    return app;
  }
  async findApplications(query, signal, { exact = false } = {}) {
    const match = exact ? exactApplications : matchingApplications;
    const known = match(this.availableApps(), query);
    if (known.length || !this.fullAccess()) return known;
    const found = await this.bridge(
      this.root,
      { action: 'catalog_discover', query },
      { signal, stillAllowed: () => this.fullAccess() },
    );
    signal?.throwIfAborted();
    if (!this.fullAccess()) throw Error('Full computer access was revoked.');
    const result = [];
    for (const match of (found.matches ?? []).slice(0, 40)) {
      try {
        result.push(this.rememberApplication(match.executable, match.name, match.packageId));
      } catch {}
    }
    return match(result, query);
  }
  async discoverForOwner(query, refresh = false) {
    if (
      typeof query !== 'string' ||
      query.trim().length < 2 ||
      query.length > 80 ||
      /[\x00-\x1f]/.test(query)
    )
      throw new Error('Enter an application name (2–80 characters).');
    query = query.trim();
    this.ownerDiscovery ??= new Map();
    const key = query.toLocaleLowerCase('en');
    const cached = this.ownerDiscovery.get(key);
    if (!refresh && cached?.expires > this.now()) return structuredClone(cached.matches);
    const found = await this.bridge(this.root, { action: 'catalog_discover', query });
    const matches = [];
    for (const row of (found.matches ?? []).slice(0, 40)) {
      try {
        const app = this.rememberApplication(row.executable, row.name, row.packageId);
        matches.push({ ...app, launch: false, inspect: false, text: false });
      } catch {
        /* Discard unsafe or disappeared targets, not the whole result. */
      }
    }
    if (this.ownerDiscovery.size >= 40)
      this.ownerDiscovery.delete(this.ownerDiscovery.keys().next().value);
    this.ownerDiscovery.set(key, { matches, expires: this.now() + 300000 });
    return structuredClone(matches);
  }
  async grantDiscovered(id) {
    if (!idValid(id)) throw new Error('Choose an application from the search results.');
    const candidate = [...(this.ownerDiscovery?.values() ?? [])]
      .flatMap((row) => row.matches)
      .find((row) => row.id === id);
    if (!candidate) throw new Error('Search for the application again.');
    const fresh = await this.discoverForOwner(candidate.name, true);
    const target = candidate.packageId ?? candidate.executable;
    const confirmed = fresh.find(
      (row) => (row.packageId ?? row.executable).toLowerCase() === target.toLowerCase(),
    );
    if (!confirmed) throw new Error('The application changed or was removed. Refresh the search.');
    const apps = this.apps();
    if (
      apps.some((app) => (app.packageId ?? app.executable).toLowerCase() === target.toLowerCase())
    )
      return apps;
    if (apps.length >= 40) throw new Error('Remove an application before adding another.');
    return this.save([...apps, { ...confirmed, launch: true, inspect: false, text: false }]);
  }
  bindApplication(app, result) {
    const turn = this.currentTurn();
    if (turn && result.ok && !result.needsWindow && result.windowVerified !== false)
      this.lastApplication = {
        appId: app.id,
        turn,
        expiresAt: this.now() + 45000,
        windowId: result.windowId,
      };
    return { ...result, appId: app.id, appName: app.name };
  }
  journal() {
    return this.db
      .prepare('SELECT id,state,result,created FROM operations ORDER BY created DESC LIMIT 50')
      .all()
      .map((row) => ({ ...row, result: row.result ? JSON.parse(row.result) : null }));
  }
  recovery() {
    return this.db
      .prepare('SELECT id,scope,relative,bytes FROM recovery ORDER BY rowid DESC LIMIT 100')
      .all();
  }
  restore(id) {
    const row = this.db.prepare('SELECT * FROM recovery WHERE id=?').get(id);
    if (!row || !/^[a-f0-9-]{36}\.backup$/.test(row.backup))
      throw new Error('Recovery copy is unavailable.');
    const target = this.filePermissions.target(row.scope, row.relative, true);
    if (existsSync(target.path))
      throw new Error('The original path is occupied. Move the existing file before restoring.');
    const backup = regular(path.join(this.state, 'file-recovery', row.backup));
    if (backup.stat.size !== row.bytes || hash(readFileSync(backup.file)) !== row.sha)
      throw new Error('Recovery copy verification failed.');
    copyFileSync(backup.file, target.path, constants.COPYFILE_EXCL);
    if (hash(readFileSync(target.path)) !== row.sha)
      throw new Error('Restored file verification failed. Check it before retrying.');
    return { ok: true, confirmation: 'Restored the file without overwriting anything.' };
  }
  purgeRecovery(id) {
    const row = this.db.prepare('SELECT * FROM recovery WHERE id=?').get(id);
    if (!row) return { ok: true, alreadyRemoved: true };
    if (!/^[a-f0-9-]{36}\.backup$/.test(row.backup)) throw new Error('Invalid recovery copy.');
    const file = path.join(this.state, 'file-recovery', row.backup);
    if (existsSync(file)) {
      const checked = regular(file);
      if (checked.stat.size !== row.bytes || hash(readFileSync(file)) !== row.sha)
        throw new Error('Recovery copy verification failed.');
      unlinkSync(checked.file);
    }
    this.db.prepare('DELETE FROM recovery WHERE id=?').run(id);
    return { ok: true, confirmation: 'Deleted the recovery copy permanently.' };
  }
  operation(id, args, run, signal) {
    if (this.waiting >= 4) throw new Error('Too many pending desktop actions.');
    this.waiting++;
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        const fingerprint = hash(JSON.stringify(args)),
          prior = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id);
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new Error('An operation ID cannot change its arguments.');
          if (prior.state === 'complete') return JSON.parse(prior.result);
          throw new Error(
            'An earlier action may have partially completed. Check its actual state before trying again.',
          );
        }
        if (this.db.prepare('SELECT count(*) AS n FROM operations').get().n >= 10000)
          throw new Error('The desktop action journal is full.');
        this.db
          .prepare("INSERT INTO operations VALUES(?,?,'started',NULL,?)")
          .run(id, fingerprint, this.now());
        try {
          const result = await run();
          this.db
            .prepare("UPDATE operations SET state='complete',result=? WHERE id=?")
            .run(JSON.stringify(result), id);
          return result;
        } catch (error) {
          this.db
            .prepare("UPDATE operations SET state='uncertain',result=? WHERE id=?")
            .run(JSON.stringify({ error: error.message }), id);
          throw error;
        }
      })
      .finally(() => this.waiting--);
    this.tail = task;
    return task;
  }
  async execute(id, args, approvals, signal) {
    const accessSignal = this.accessSignal();
    if (accessSignal) signal = AbortSignal.any([accessSignal, ...(signal ? [signal] : [])]);
    signal?.throwIfAborted();
    if (!this.accessAllowed())
      throw Object.assign(
        new Error('Application access is paused. Turn it on from Capri’s toolbar.'),
        { code: 'APPLICATION_ACCESS_PAUSED' },
      );
    if (
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      Object.keys(args).some(
        (k) =>
          ![
            'action',
            'appId',
            'inspectionId',
            'controlId',
            'text',
            'scopeId',
            'path',
            'mode',
            'windowId',
            'windowTitle',
            'url',
            'query',
            'executable',
          ].includes(k),
      )
    )
      throw new Error('Invalid desktop action.');
    if (
      args.query !== undefined &&
      (typeof args.query !== 'string' ||
        !args.query.trim() ||
        args.query.length > 80 ||
        /[\x00-\x1f]/.test(args.query))
    )
      throw Error('Choose a short application name.');
    if (
      args.windowTitle !== undefined &&
      (typeof args.windowTitle !== 'string' ||
        !args.windowTitle.trim() ||
        args.windowTitle.length > 180 ||
        /[\x00-\x1f]/.test(args.windowTitle))
    )
      throw Error('Choose a short window title.');
    // A small model may choose launch_executable for a human app name. Resolve
    // names through the existing catalog and grants, never through PATH or a shell.
    if (
      args.action === 'launch_executable' &&
      ((!args.executable && args.query) ||
        (typeof args.executable === 'string' &&
          /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u.test(args.executable) &&
          !args.executable.includes('..')))
    ) {
      const { executable: name, ...rest } = args;
      args = { ...rest, action: 'launch', query: args.query || name.replace(/\.exe$/i, '') };
    }
    if (['find_app', 'launch_executable'].includes(args.action)) {
      if (!this.fullAccess())
        throw new Error(
          'Enable Full computer access to discover and launch applications without individual grants.',
        );
      if (args.action === 'find_app') {
        if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 80)
          throw new Error('Choose an application name.');
        const matches = await this.findApplications(args.query, signal);
        return {
          ok: true,
          matches: matches.map((app) => ({
            appId: app.id,
            name: app.name,
            ...(app.executable ? { executable: app.executable } : {}),
            launchCommand: { action: 'launch', appId: app.id },
            ...(app.inspect ? { inspectCommand: { action: 'inspect', appId: app.id } } : {}),
          })),
          instruction:
            'Use an actual returned appId or the application query. Internal IDs are discovered here; never ask the owner to find or provide one.',
        };
      }
      const file = executable(args.executable);
      const app = this.rememberApplication(file);
      const launched = await this.operation(
        id,
        args,
        () =>
          this.bridge(
            this.root,
            { action: 'catalog_launch', executable: file },
            { signal, stillAllowed: () => this.fullAccess() },
          ),
        signal,
      );
      return this.bindApplication(app, launched);
    }
    if (args.action === 'apps')
      return {
        ok: true,
        instruction:
          'To open an app, use its launchCommand. Inspection never opens it and needs a separate grant.',
        apps: this.availableApps().map(({ executable, ...saved }) => {
          const app = this.fullAccess()
            ? { ...saved, launch: true, inspect: !saved.packageId, text: !saved.packageId }
            : saved;
          return {
            ...app,
            ...(app.launch ? { launchCommand: { action: 'launch', appId: app.id } } : {}),
          };
        }),
      };
    if (args.query || (typeof args.appId === 'string' && !idValid(args.appId))) {
      const matches = await this.findApplications(args.query || args.appId, signal, {
        exact: ['launch', 'browser_input', 'open_url'].includes(args.action),
      });
      if (matches.length === 1) args = { ...args, appId: matches[0].id };
    }
    if (
      !args.appId &&
      ['inspect', 'type_text'].includes(args.action) &&
      this.currentTurn() &&
      this.lastApplication?.turn === this.currentTurn() &&
      this.lastApplication.expiresAt > this.now()
    )
      args = {
        ...args,
        appId: this.lastApplication.appId,
        ...(!args.windowId && this.lastApplication.windowId
          ? { windowId: this.lastApplication.windowId }
          : {}),
      };
    if (
      args.appId === this.lastApplication?.appId &&
      this.currentTurn() &&
      this.lastApplication.turn === this.currentTurn() &&
      this.lastApplication.expiresAt > this.now() &&
      this.lastApplication.windowId &&
      !args.windowId &&
      !args.windowTitle &&
      ['inspect', 'type_text', 'browser_input'].includes(args.action)
    )
      args = { ...args, windowId: this.lastApplication.windowId };
    if (['open_url', 'browser_input'].includes(args.action) && !args.appId) {
      const browsers = this.availableApps().filter(
        (app) => (this.fullAccess() || (app.launch && app.text)) && browserExecutableCandidate(app),
      );
      if (browsers.length === 1) args = { ...args, appId: browsers[0].id };
    }
    if (args.action === 'type_text' && !args.appId) {
      const matches = [...this.inspections].filter(
        ([id, i]) =>
          (!args.inspectionId || id === args.inspectionId) &&
          i.expiresAt > this.now() &&
          i.result.untrustedControls?.some((c) => c.id === args.controlId && c.editable),
      );
      if (matches.length === 1)
        args = { ...args, appId: matches[0][1].appId, inspectionId: matches[0][0] };
    }
    if (args.action === 'journal') return { ok: true, operations: this.journal() };
    if (
      args.windowId !== undefined &&
      (typeof args.windowId !== 'string' || !/^[0-9]{1,20}$/.test(args.windowId))
    )
      throw new Error('Choose an actual windowId from inspect.');
    if (
      ['launch', 'inspect', 'type_text', 'open_url', 'browser_input'].includes(args.action) &&
      (!args.appId || !this.availableApps().some((app) => app.id === args.appId))
    )
      return {
        ok: false,
        error: {
          code: args.appId ? 'unknown_app_id' : 'missing_app_id',
          message:
            'Use query with the requested application name, or copy an actual appId from the apps below. Never ask the owner for an internal ID. If several applications match, ask which named application they mean.',
          requiredArguments: ['query or appId'],
        },
        apps: this.availableApps().map(({ executable, ...app }) => app),
      };
    if (args.action === 'launch') {
      const app = this.allowed(args.appId, 'launch');
      const launched = await this.operation(
        id,
        args,
        () =>
          this.bridge(
            this.root,
            {
              action: 'catalog_launch',
              ...(app.packageId ? { packageId: app.packageId } : { executable: app.executable }),
              ...(args.windowId ? { windowId: args.windowId } : {}),
              ...(args.windowTitle ? { windowTitle: args.windowTitle } : {}),
            },
            { signal, stillAllowed: () => Boolean(this.allowed(app.id, 'launch')) },
          ),
        signal,
      );
      return this.bindApplication(app, launched);
    }
    if (args.action === 'browser_input') {
      const app = this.allowed(args.appId, 'launch');
      this.allowed(app.id, 'text');
      if (!browserExecutableCandidate(app, { explicit: true }))
        throw Error('Choose a supported browser executable.');
      if (
        typeof args.text !== 'string' ||
        !args.text.trim() ||
        args.text.length > 4000 ||
        /[\x00-\x1f\x7f]/.test(args.text)
      )
        throw Error(
          'Use bounded single-line text for the address bar. This action does not press Enter.',
        );
      return approvals.propose({
        title: 'Enter text in application?',
        detail: app.name + '\n\n' + args.text,
        kind: 'type',
        voice: false,
        execute: async () =>
          this.bindApplication(
            app,
            await this.operation(
              id,
              args,
              async () => {
                try {
                  return await this.bridge(
                    this.root,
                    {
                      action: 'browser_input',
                      executable: app.executable,
                      text: args.text,
                      ...(args.windowId ? { windowId: args.windowId } : {}),
                      ...(args.windowTitle ? { windowTitle: args.windowTitle } : {}),
                    },
                    {
                      signal,
                      stillAllowed: () =>
                        Boolean(this.allowed(app.id, 'launch') && this.allowed(app.id, 'text')),
                    },
                  );
                } catch (error) {
                  await this.bridge(
                    this.root,
                    { action: 'computer_release', keys: ['CTRL', 'L'] },
                    { signal: AbortSignal.timeout(2000) },
                  ).catch(() => {});
                  throw error;
                }
              },
              signal,
            ),
          ),
      });
    }
    if (args.action === 'open_url') {
      const app = this.allowed(args.appId, 'launch');
      this.allowed(app.id, 'text');
      if (
        typeof args.url !== 'string' ||
        args.url.length > 2048 ||
        /[\x00-\x20\x7f]/.test(args.url)
      )
        throw new Error('Choose a complete HTTP or HTTPS web address.');
      let url;
      try {
        url = new URL(args.url);
      } catch {
        throw new Error('Choose a complete HTTP or HTTPS web address.');
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error(
          'Only HTTP and HTTPS web pages without embedded credentials are supported.',
        );
      if (!browserExecutableCandidate(app, { explicit: true }))
        throw new Error('Choose a supported browser executable.');
      return approvals.propose({
        title: 'Open this web page?',
        detail: app.name + '\n\n' + url.href,
        kind: 'browser',
        voice: false,
        execute: () =>
          this.operation(
            id,
            args,
            () =>
              this.bridge(
                this.root,
                { action: 'browser_open', executable: app.executable, url: url.href },
                {
                  signal,
                  stillAllowed: () =>
                    Boolean(this.allowed(app.id, 'launch') && this.allowed(app.id, 'text')),
                },
              ),
            signal,
          ),
      });
    }
    if (args.action === 'inspect') {
      const app = this.allowed(args.appId, 'inspect');
      const result = await this.bridge(
        this.root,
        {
          action: 'catalog_inspect',
          executable: app.executable,
          ...(args.windowId ? { windowId: args.windowId } : {}),
          ...(args.windowTitle ? { windowTitle: args.windowTitle } : {}),
        },
        { signal, stillAllowed: () => Boolean(this.allowed(app.id, 'inspect')) },
      );
      if (result.needsWindow) return result;
      const inspectionId = randomUUID();
      if (this.inspections.size >= 40)
        this.inspections.delete(this.inspections.keys().next().value);
      this.inspections.set(inspectionId, { appId: app.id, expiresAt: this.now() + 45000, result });
      return this.bindApplication(app, { ...result, inspectionId, expiresInSeconds: 45 });
    }
    if (args.action === 'type_text') {
      if (args.mode !== undefined && !['append', 'replace'].includes(args.mode))
        throw new Error('Choose append or replace for text entry.');
      // Some local models omit inspectionId while correctly retaining the actual
      // control ID. Resolve it only when one live, matching lease exists.
      let inspectionId = args.inspectionId;
      if (!inspectionId) {
        const matches = [...this.inspections].filter(
          ([, i]) =>
            i.appId === args.appId &&
            i.expiresAt > this.now() &&
            i.result.untrustedControls?.some((c) => c.id === args.controlId && c.editable),
        );
        if (matches.length === 1) inspectionId = matches[0][0];
      }
      const inspection = this.inspections.get(inspectionId);
      if (!inspection || inspection.expiresAt <= this.now() || inspection.appId !== args.appId)
        return {
          ok: false,
          error: {
            code: 'inspection_required',
            message:
              'Call inspect and copy both inspectionId and controlId from its result. The previous inspection is absent or expired.',
            requiredArguments: ['appId', 'inspectionId', 'controlId', 'text'],
          },
        };
      const app = this.allowed(inspection.appId, 'text');
      if (
        typeof args.text !== 'string' ||
        !args.text ||
        args.text.length > 4000 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(args.text)
      )
        throw new Error('Invalid text.');
      const control = inspection.result.untrustedControls?.find(
        (c) => c.id === args.controlId && c.editable,
      );
      if (!control) throw new Error('Choose an editable field from this inspection.');
      return approvals.propose({
        title: 'Enter text in application?',
        detail:
          app.name +
          '\n' +
          control.name +
          '\n' +
          this.translate(
            args.mode === 'replace' ? 'Replace existing field text' : 'Append to field',
          ) +
          '\n\n' +
          args.text,
        kind: 'type',
        voice: false,
        execute: () =>
          this.operation(id, args, async () => {
            this.allowed(app.id, 'text');
            if (inspection.expiresAt <= this.now())
              throw new Error('Inspection expired. Inspect the app again.');
            this.inspections.delete(inspectionId);
            return this.bridge(
              this.root,
              {
                action: 'catalog_type',
                executable: app.executable,
                processId: inspection.result.processId,
                startedAtTicks: inspection.result.startedAtTicks,
                controlId: control.id,
                text: args.text,
                mode: args.mode ?? 'append',
                ...(inspection.result.windowId ? { windowId: inspection.result.windowId } : {}),
              },
              { stillAllowed: () => Boolean(this.allowed(app.id, 'text')) },
            );
          }),
      });
    }
    if (args.action === 'trash') {
      if (!args.path) throw new Error('Choose one exact file in an approved writable folder.');
      const target = this.filePermissions.target(args.scopeId, args.path, true),
        info = regular(target.path);
      if (info.stat.size > 20 * 1024 * 1024)
        throw new Error('This preview supports files up to 20 MB.');
      const digest = hash(readFileSync(info.file));
      const execute = () =>
        this.operation(id, args, async () => {
          const current = this.filePermissions.target(args.scopeId, args.path, true),
            checked = regular(current.path);
          if (
            checked.stat.size !== info.stat.size ||
            checked.stat.ino !== info.stat.ino ||
            hash(readFileSync(checked.file)) !== digest
          )
            throw new Error('The selected file changed. Ask again and review a new confirmation.');
          const total = this.db.prepare('SELECT COALESCE(sum(bytes),0) AS n FROM recovery').get().n;
          if (total + info.stat.size > 1024 * 1024 * 1024)
            throw new Error('The private recovery storage is full.');
          const folder = path.join(this.state, 'file-recovery');
          mkdirSync(folder, { recursive: true });
          const backup = path.join(folder, randomUUID() + '.backup');
          copyFileSync(checked.file, backup, constants.COPYFILE_EXCL);
          if (hash(readFileSync(backup)) !== digest)
            throw new Error('Recovery copy verification failed. The original was preserved.');
          this.db
            .prepare('INSERT INTO recovery VALUES(?,?,?,?,?,?)')
            .run(id, args.scopeId, args.path, path.basename(backup), digest, info.stat.size);
          this.filePermissions.target(args.scopeId, args.path, true);
          const last = regular(checked.file);
          if (
            last.stat.ino !== info.stat.ino ||
            last.stat.size !== info.stat.size ||
            hash(readFileSync(last.file)) !== digest
          )
            throw new Error('The file changed during backup. The original was preserved.');
          await this.trash(checked.file);
          if (existsSync(checked.file))
            throw new Error('Windows did not confirm removal. Check the file and Recycle Bin.');
          return { ok: true, confirmation: 'Moved the file to Recycle Bin.', recoveryId: id };
        });
      if (this.fullAccess() || this.filePermissions.isInstallation(target.scope)) return execute();
      return approvals.propose({
        title: 'Move this file to Recycle Bin?',
        detail:
          target.path +
          '\n\n' +
          this.translate('A private recovery copy will also be kept. Folders are not supported.'),
        kind: 'trash',
        voice: false,
        execute,
      });
    }
    throw new Error('Unsupported desktop action.');
  }
  async close() {
    await this.tail.catch(() => {});
    this.db.close();
  }
}
