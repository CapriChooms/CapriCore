// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, lstatSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../atomic-json.mjs';
import {
  downloadArtifact,
  noLinks,
  operationLock,
  safeFileName,
} from '../huggingface/artifacts.mjs';
import { ggufMetadata } from './gguf-metadata.mjs';
import pinned from '../../../../config/llama-models.json' with { type: 'json' };

const registry = 'registry.ollama.ai';
const registryHosts = new Set([
  registry,
  'dd20bb891979d25aebc8bec07b2b3bbc.r2.cloudflarestorage.com',
]);
const media = 'application/vnd.ollama.image.';
const sha = /^[a-f0-9]{64}$/;
const hubId = /^capri-(hf-[a-f0-9]{24}):latest$/;
const missing = () =>
  Object.assign(new Error('The local model is missing or incomplete.'), {
    status: 404,
    code: 'CAPRI_LOCAL_LANGUAGE_MODEL_MISSING',
  });

function coordinates(name) {
  if (
    typeof name !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,95}(?:\/[a-z0-9][a-z0-9._-]{0,95})?(?::[a-zA-Z0-9._-]{1,96})?$/.test(
      name,
    ) ||
    name.includes('..')
  )
    throw Object.assign(new Error('Invalid local model name.'), { status: 400 });
  const [model, tag = 'latest'] = name.split(':');
  const [namespace, base] = model.includes('/') ? model.split('/') : ['library', model];
  for (const segment of [namespace, base, tag]) safeFileName(segment);
  return { namespace, base, tag, name: model + ':' + tag };
}

function readManifest(file) {
  noLinks(file);
  const info = lstatSync(file);
  if (!info.isFile() || info.size > 128 * 1024) throw missing();
  return JSON.parse(readFileSync(file, 'utf8'));
}

function layers(manifest) {
  if (!Array.isArray(manifest?.layers) || manifest.layers.length > 32) throw missing();
  const selected = manifest.layers.filter((item) =>
    ['model', 'projector', 'license'].some((kind) => item?.mediaType === media + kind),
  );
  if (
    selected.filter((item) => item.mediaType === media + 'model').length !== 1 ||
    selected.filter((item) => item.mediaType === media + 'projector').length > 1 ||
    selected.some(
      ({ digest, size }) =>
        !/^sha256:[a-f0-9]{64}$/.test(digest) ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > 100 * 1024 ** 3,
    )
  )
    throw missing();
  return selected;
}

async function registryResponse(
  value,
  { signal, headers, fetchImpl = fetch, timeout = 30000 } = {},
) {
  let url = new URL(value);
  const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
  for (let redirect = 0; redirect < 6; redirect++) {
    if (
      url.protocol !== 'https:' ||
      !registryHosts.has(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      throw new Error('Unapproved model registry destination.');
    const connection = new AbortController();
    const timer = setTimeout(() => connection.abort(), Math.min(timeout, 30000));
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: 'manual',
        headers: { 'accept-encoding': 'identity', ...headers },
        signal: AbortSignal.any([combined, connection.signal]),
      });
    } finally {
      clearTimeout(timer);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Invalid model registry redirect.');
    url = new URL(location, url);
  }
  throw new Error('Too many model registry redirects.');
}

async function registryManifest(url, options) {
  const response = await registryResponse(url, options);
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Model registry manifest failed (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader(),
    buffers = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 128 * 1024) throw new Error('Model registry manifest exceeds the limit.');
      buffers.push(value);
    }
    return JSON.parse(Buffer.concat(buffers).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export class LlamaModelStore {
  constructor(root, { embeddingModel = 'capri-embed:latest' } = {}) {
    this.root = path.resolve(root);
    this.embeddingModel = embeddingModel;
    this.models = path.join(this.root, 'data/models');
    this.blobs = path.join(this.models, 'blobs');
    this.manifests = path.join(this.models, 'manifests', registry);
    this.manifestsV2 = path.join(this.models, 'manifests-v2', 'ollama.com');
    this.hub = path.join(this.root, 'data/huggingface');
    this.pendingImports = new Set();
    this.metadata = new Map();
  }
  manifest(name) {
    const { namespace, base, tag } = coordinates(name);
    return path.join(this.manifests, namespace, base, tag);
  }
  blob(folder, filename, size) {
    const file = noLinks(path.join(folder, filename));
    try {
      const info = lstatSync(file);
      if (info.isFile() && info.size === size) return { file, size };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    throw missing();
  }
  upstream(name) {
    if (name === 'capri-embed:latest') return 'bge-m3:latest';
    if (name.startsWith('capri-qwen3.5:')) return name.slice('capri-'.length);
    return name;
  }
  hubModel(name) {
    const [, id] = hubId.exec(name) ?? [];
    if (!id) throw missing();
    const receipt = readManifest(path.join(this.hub, 'packages', id, 'receipt.json'));
    if (
      receipt.id !== id ||
      receipt.task !== 'llm' ||
      (receipt.profile?.model !== name && !this.pendingImports.has(name)) ||
      !Array.isArray(receipt.files) ||
      !receipt.files.length ||
      receipt.files.length > 129
    )
      throw missing();
    const files = receipt.files.map(({ path: relative, sha256, bytes }) => {
      safeFileName(relative);
      if (
        !sha.test(sha256) ||
        !Number.isSafeInteger(bytes) ||
        bytes < 12 ||
        !/\.gguf$/i.test(relative)
      )
        throw missing();
      return {
        ...this.blob(path.join(this.hub, 'blobs'), sha256, bytes),
        relative,
        projector: /(?:^|\/)(?:mmproj|projector)/i.test(relative),
      };
    });
    return files;
  }
  registerImport(name, files) {
    if (!hubId.test(name) || !files || Array.isArray(files) || typeof files !== 'object')
      throw missing();
    const [, id] = hubId.exec(name);
    const receipt = readManifest(path.join(this.hub, 'packages', id, 'receipt.json'));
    if (
      !Array.isArray(receipt.files) ||
      receipt.files.length !== Object.keys(files).length ||
      receipt.files.some((item) => files[item.path] !== 'sha256:' + item.sha256)
    )
      throw missing();
    if (this.pendingImports.size >= 256)
      this.pendingImports.delete(this.pendingImports.values().next().value);
    this.pendingImports.add(name);
    try {
      return this.get(name);
    } catch (error) {
      this.pendingImports.delete(name);
      throw error;
    }
  }
  cachedFiles(model, upstream) {
    const names = [...new Set([upstream, model])];
    const manifests = names.flatMap((name) => {
      const { namespace, base, tag } = coordinates(name);
      return [this.manifest(name), path.join(this.manifestsV2, namespace, base, tag)];
    });
    const candidates = [
      ...manifests.map((file) => () => readManifest(file)),
      // Older installs can have all the pinned blobs but only an Ollama v2
      // manifest index. The checked-in manifest describes the same GGUF files.
      () => pinned[upstream],
    ];
    for (const read of candidates) {
      try {
        return layers(read())
          .filter((item) => item.mediaType !== media + 'license')
          .map((item) => ({
            ...this.blob(this.blobs, item.digest.replace(':', '-'), item.size),
            projector: item.mediaType === media + 'projector',
          }));
      } catch (error) {
        if (error.code !== 'ENOENT' && error.status !== 404) throw error;
      }
    }
    throw missing();
  }
  get(name) {
    const model = coordinates(name).name;
    const upstream = this.upstream(model);
    let files;
    if (hubId.test(model)) {
      files = this.hubModel(model);
    } else if (pinned[upstream]?.nativeModel) {
      files = [pinned[upstream].nativeModel, pinned[upstream].extraProjector].map(
        (item, index) => ({
          ...this.blob(this.blobs, 'sha256-' + item.sha256, item.bytes),
          projector: index === 1,
        }),
      );
    } else {
      files = this.cachedFiles(model, upstream);
    }
    const templateFile =
      upstream === 'ministral-3:3b'
        ? noLinks(
            path.resolve(
              import.meta.dirname,
              '../../../../config/Ministral-3-3B-Instruct-2512.jinja',
            ),
          )
        : undefined;
    return {
      name: model,
      upstream,
      files,
      templateFile,
      size: files.reduce((sum, item) => sum + item.size, 0),
      embedding: model === this.embeddingModel || model === 'bge-m3:latest',
    };
  }
  describe(model) {
    const item = model.files.find((file) => !file.projector);
    const stat = lstatSync(item.file);
    const key = `${item.file}\n${stat.size}\n${stat.mtimeMs}`;
    let info = this.metadata.get(key);
    if (!info) {
      info = ggufMetadata(item.file);
      if (this.metadata.size >= 32) this.metadata.delete(this.metadata.keys().next().value);
      this.metadata.set(key, info);
    }
    const template = model.templateFile
      ? readFileSync(model.templateFile, 'utf8')
      : (info['tokenizer.chat_template'] ?? info['tokenizer.chat_template.default'] ?? '');
    const capabilities = model.embedding ? ['embedding'] : ['completion'];
    if (model.files.some((file) => file.projector)) capabilities.push('vision');
    if (!model.embedding && /\btools\b|tool_calls/.test(template)) capabilities.push('tools');
    if (!model.embedding && /enable_thinking|reasoning_content|<think>|thinking/.test(template))
      capabilities.push('thinking');
    return { template, template_source: 'gguf_chat_template', model_info: info, capabilities };
  }
  list() {
    const names = new Set([
      ...Object.keys(pinned),
      this.embeddingModel,
      ...Object.keys(pinned)
        .filter((name) => name.startsWith('qwen3.5:'))
        .map((name) => 'capri-' + name),
      ...this.pendingImports.keys(),
    ]);
    const dirs = (folder, type) => {
      try {
        return readdirSync(noLinks(folder), { withFileTypes: true })
          .filter((entry) => (type === 'file' ? entry.isFile() : entry.isDirectory()))
          .slice(0, 256)
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    };
    scan: for (const manifests of [this.manifests, this.manifestsV2])
      for (const namespace of dirs(manifests))
        for (const base of dirs(path.join(manifests, namespace)))
          for (const tag of dirs(path.join(manifests, namespace, base), 'file')) {
            if (names.size >= 512) break scan;
            names.add(`${namespace === 'library' ? '' : namespace + '/'}${base}:${tag}`);
          }
    for (const id of dirs(path.join(this.hub, 'packages')))
      if (hubId.test('capri-' + id + ':latest')) names.add('capri-' + id + ':latest');
    return [...names].flatMap((name) => {
      try {
        const { size } = this.get(name);
        return [{ name, model: name, size }];
      } catch {
        return [];
      }
    });
  }
  async pull(name, { signal, onProgress = () => {}, fetchImpl } = {}) {
    const requested = coordinates(name).name;
    const coords = coordinates(this.upstream(requested));
    const base = `https://${registry}/v2/${coords.namespace}/${coords.base}`;
    const lock = operationLock(this.models);
    try {
      let installed;
      try {
        installed = this.get(requested);
      } catch {}
      const spec = pinned[coords.name];
      if (installed) {
        onProgress({ status: 'success', completed: installed.size, total: installed.size });
        return;
      }
      const manifest =
        spec ?? (await registryManifest(`${base}/manifests/${coords.tag}`, { signal, fetchImpl }));
      const artifacts = spec?.nativeModel
        ? [spec.nativeModel, spec.extraProjector]
        : layers(manifest).map(({ size, digest }) => ({
            bytes: size,
            sha256: digest.slice(7),
            url: `${base}/blobs/${digest}`,
            registry: true,
          }));
      const total = artifacts.reduce((sum, { bytes }) => sum + bytes, 0);
      let completed = 0;
      for (const [index, artifact] of artifacts.entries()) {
        await downloadArtifact(artifact, this.blobs, {
          signal,
          fetchImpl,
          source: 'Model registry',
          filename: 'sha256-' + artifact.sha256,
          ...(artifact.registry ? { requestFile: registryResponse } : {}),
          onProgress: (value) =>
            onProgress({
              ...value,
              file: artifact.path || `${coords.base}-layer-${index + 1}`,
              fileCompleted: value.completed,
              fileTotal: artifact.bytes,
              total,
              completed: completed + value.completed,
            }),
        });
        completed += artifact.bytes;
      }
      signal?.throwIfAborted();
      if (!spec?.nativeModel) {
        const target = noLinks(this.manifest(coords.name));
        mkdirSync(path.dirname(target), { recursive: true });
        writeJsonAtomic(target, manifest);
      }
      onProgress({ status: 'success', completed, total });
    } finally {
      lock();
    }
  }
}
