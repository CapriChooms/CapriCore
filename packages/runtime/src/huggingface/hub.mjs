// SPDX-License-Identifier: GPL-3.0-only
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  rmdirSync,
  createReadStream,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeJsonAtomic } from '../atomic-json.mjs';
import { validateImportedProfile } from '../hardware/imported-model.mjs';
import { hubJson } from './transport.mjs';
import {
  downloadArtifact,
  noLinks,
  safeFileName,
  operationLock,
  freeBytes,
  fileHash,
} from './artifacts.mjs';

const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const idPattern = /^hf-[a-f0-9]{24}$/;
const reserveBytes = 64 * 1024 ** 2;

export function parseRepository(input) {
  if (typeof input !== 'string' || input.length > 1000)
    throw new Error('Enter a Hugging Face repository or model URL.');
  let value = input.trim(),
    revision,
    filename;
  if (value.startsWith('https://')) {
    const url = new URL(value);
    if (
      url.origin !== 'https://huggingface.co' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'Use a model URL from huggingface.co without credentials or query parameters.',
      );
    const parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent);
    value = parts.slice(0, 2).join('/');
    if (parts.length > 2) {
      if (!['tree', 'blob', 'resolve'].includes(parts[2]) || !revisionPattern.test(parts[3] ?? ''))
        throw new Error('Unsupported Hugging Face model URL.');
      revision = parts[3];
      if (parts.length > 4) filename = safeFileName(parts.slice(4).join('/'));
    }
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value) ||
    value.includes('..')
  )
    throw new Error('Use a Hugging Face repository in owner/model form.');
  return {
    repository: value,
    ...(revision ? { revision } : {}),
    ...(filename ? { filename } : {}),
  };
}

function modelKind(file) {
  if (!/\.gguf$/i.test(file)) return 'other';
  return /(?:^|\/)(?:mmproj|projector)/i.test(file) ? 'projector' : 'gguf';
}

function splitFile(file) {
  const match = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i.exec(file);
  return match ? { prefix: match[1], index: Number(match[2]), count: Number(match[3]) } : null;
}

function completeWeightSet(files) {
  const first = splitFile(files[0]?.path ?? '');
  if (!first) return files.length === 1;
  return (
    first.count >= 2 &&
    first.count <= 128 &&
    files.length === first.count &&
    files.every((file, index) => {
      const split = splitFile(file.path);
      return (
        split?.prefix === first.prefix && split.count === first.count && split.index === index + 1
      );
    })
  );
}

function ttsCompatibility(repository) {
  if (repository === 'ResembleAI/chatterbox-turbo')
    return {
      adapter: 'chatterbox-turbo',
      status: 'curated',
      message: 'Use the Capri voice installer for the pinned English voice and adapter.',
    };
  if (repository === 'ResembleAI/chatterbox')
    return {
      adapter: 'chatterbox-multilingual',
      status: 'curated',
      message: 'Use the Capri language settings for the pinned multilingual voice.',
    };
  if (/^Qwen\/Qwen3-TTS-12Hz-(?:0\.6B|1\.7B)-/.test(repository))
    return {
      adapter: 'qwen3-tts',
      status: 'experimental',
      message: 'Requires a compatible Qwen TTS voice runtime and language profile.',
    };
  return {
    adapter: null,
    status: 'unsupported',
    message: 'This TTS family requires a reviewed Capri voice adapter.',
  };
}

function packageId(plan) {
  return (
    'hf-' +
    createHash('sha256')
      .update(
        JSON.stringify({
          repository: plan.repository,
          revision: plan.revision,
          files: plan.files.map(({ path: name, bytes, sha256 }) => ({ path: name, bytes, sha256 })),
        }),
      )
      .digest('hex')
      .slice(0, 24)
  );
}

function validatePlan(plan) {
  if (
    !plan ||
    plan.schemaVersion !== 1 ||
    plan.task !== 'llm' ||
    !commitPattern.test(plan.revision ?? '') ||
    !Array.isArray(plan.files) ||
    plan.files.length < 1 ||
    plan.files.length > 129
  )
    throw new Error('Invalid Hugging Face installation plan.');
  parseRepository(plan.repository);
  const paths = new Set();
  for (const file of plan.files) {
    safeFileName(file.path);
    if (
      paths.has(file.path) ||
      !['gguf', 'projector'].includes(modelKind(file.path)) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 12 ||
      file.bytes > 256 * 1024 ** 3 ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')
    )
      throw new Error('Invalid Hugging Face artifact manifest.');
    paths.add(file.path);
  }
  if (
    !completeWeightSet(plan.files.filter((file) => modelKind(file.path) === 'gguf')) ||
    plan.files.filter((file) => modelKind(file.path) === 'projector').length > 1 ||
    plan.id !== packageId(plan) ||
    !idPattern.test(plan.id) ||
    plan.totalBytes !== plan.files.reduce((total, file) => total + file.bytes, 0) ||
    !Number.isInteger(plan.contextTokens) ||
    plan.contextTokens < 8192 ||
    plan.contextTokens > 262144
  )
    throw new Error('Invalid Hugging Face model selection.');
  return plan;
}

function checkGguf(file) {
  noLinks(file);
  const fd = openSync(file, 'r'),
    bytes = Buffer.alloc(8);
  try {
    if (
      readSync(fd, bytes, 0, 8, 0) !== 8 ||
      bytes.toString('ascii', 0, 4) !== 'GGUF' ||
      ![2, 3].includes(bytes.readUInt32LE(4))
    )
      throw new Error('The selected file is not a supported GGUF model.');
  } finally {
    closeSync(fd);
  }
}

/** Owned Hub packages. Receipts, artifacts and activation remain separate. */
export class HuggingFaceHub {
  constructor({
    root,
    ollamaUrl,
    fetchImpl = fetch,
    token = async () => null,
    diskFree = freeBytes,
  }) {
    this.folder = path.join(path.resolve(root), 'data/huggingface');
    this.blobs = path.join(this.folder, 'blobs');
    this.packages = path.join(this.folder, 'packages');
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.diskFree = diskFree;
    const local = new URL(ollamaUrl);
    if (
      local.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]', 'localhost'].includes(local.hostname) ||
      local.username ||
      local.password ||
      local.pathname !== '/' ||
      local.search ||
      local.hash
    )
      throw new Error('Hugging Face model import requires the owned local Ollama endpoint.');
    this.ollamaUrl = local.origin;
  }
  options(signal) {
    return { signal, fetchImpl: this.fetchImpl, token: this.token };
  }

  async search({ query = '', task = 'llm', limit = 20 } = {}, { signal } = {}) {
    if (
      typeof query !== 'string' ||
      query.length > 160 ||
      !['llm', 'tts'].includes(task) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 30
    )
      throw new Error('Invalid Hugging Face search.');
    const params = new URLSearchParams({
      search: query,
      limit: String(limit),
      sort: 'downloads',
      direction: '-1',
      full: 'true',
    });
    params.set(
      task === 'tts' ? 'pipeline_tag' : 'filter',
      task === 'tts' ? 'text-to-speech' : 'gguf',
    );
    const data = await hubJson(`https://huggingface.co/api/models?${params}`, this.options(signal));
    if (!Array.isArray(data)) throw new Error('Hugging Face returned an invalid model list.');
    return data.slice(0, limit).flatMap((model) => {
      try {
        const repository = parseRepository(model.id ?? model.modelId).repository;
        return [
          {
            repository,
            task,
            downloads: Number.isSafeInteger(model.downloads) ? model.downloads : 0,
            gated: Boolean(model.gated),
            private: Boolean(model.private),
            ...(task === 'tts' ? { compatibility: ttsCompatibility(repository) } : {}),
          },
        ];
      } catch {
        return [];
      }
    });
  }

  async inspect(input, { revision, signal } = {}) {
    const parsed = parseRepository(input),
      selectedRevision = revision ?? parsed.revision ?? 'main';
    if (!revisionPattern.test(selectedRevision)) throw new Error('Invalid Hugging Face revision.');
    const data = await hubJson(
      `https://huggingface.co/api/models/${parsed.repository}/revision/${encodeURIComponent(selectedRevision)}?blobs=true`,
      this.options(signal),
    );
    if (
      !commitPattern.test(data.sha ?? '') ||
      !Array.isArray(data.siblings) ||
      data.siblings.length > 4096
    )
      throw new Error('Hugging Face did not provide a bounded immutable file manifest.');
    const files = [];
    for (const item of data.siblings) {
      let name;
      try {
        name = safeFileName(item.rfilename);
      } catch {
        continue;
      }
      const bytes = item.lfs?.size ?? item.size,
        digest = item.lfs?.sha256 ?? item.lfs?.oid;
      const sha256 = typeof digest === 'string' ? digest.replace(/^sha256:/, '') : null;
      files.push({
        path: name,
        kind: modelKind(name),
        bytes: Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null,
        sha256: /^[a-f0-9]{64}$/.test(sha256 ?? '') ? sha256 : null,
        split: /-\d{5}-of-\d{5}\.gguf$/i.test(name),
      });
    }
    const task = data.pipeline_tag === 'text-to-speech' ? 'tts' : 'llm';
    const rawLanguage = data.cardData?.language;
    const languages = (Array.isArray(rawLanguage) ? rawLanguage : [rawLanguage])
      .filter((item) => typeof item === 'string' && /^[a-zA-Z0-9-]{2,20}$/.test(item))
      .slice(0, 100);
    const license =
      typeof data.cardData?.license === 'string' ? data.cardData.license.slice(0, 100) : null;
    return {
      repository: parsed.repository,
      revision: data.sha,
      task,
      languages,
      license,
      gated: Boolean(data.gated),
      private: Boolean(data.private),
      files,
      selectedFilename: parsed.filename ?? null,
      ...(task === 'tts' ? { compatibility: ttsCompatibility(parsed.repository) } : {}),
    };
  }

  async plan(
    { repository, revision, filename, projector = null, contextTokens = 32768 },
    { signal } = {},
  ) {
    const parsed = parseRepository(repository);
    const info = await this.inspect(repository, { revision, signal });
    if (info.task !== 'llm')
      throw new Error('Install this voice through a supported Capri TTS adapter.');
    const selected = filename ?? parsed.filename;
    if (typeof selected !== 'string') throw new Error('Choose a GGUF model file.');
    const split = splitFile(selected);
    let weights = [selected];
    if (split) {
      if (split.count < 2 || split.count > 128)
        throw new Error('This GGUF shard count is outside the supported range.');
      weights = Array.from(
        { length: split.count },
        (_, index) =>
          `${split.prefix}-${String(index + 1).padStart(5, '0')}-of-${String(split.count).padStart(5, '0')}.gguf`,
      );
    }
    const names = [...weights, ...(projector ? [projector] : [])];
    const files = names.map((name, index) => {
      const file = info.files.find((item) => item.path === name);
      if (!file || file.kind !== (index < weights.length ? 'gguf' : 'projector'))
        throw new Error('The GGUF selection has a missing shard or an incompatible projector.');
      if (!file.sha256 || !file.bytes)
        throw new Error('This file has no independently verifiable size and SHA-256.');
      return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
    });
    const plan = {
      schemaVersion: 1,
      task: 'llm',
      repository: info.repository,
      revision: info.revision,
      files,
      contextTokens,
      license: info.license,
      languages: info.languages,
      private: info.private,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    };
    plan.id = packageId(plan);
    validatePlan(plan);
    noLinks(this.blobs);
    mkdirSync(this.blobs, { recursive: true });
    let downloadBytes = 0;
    for (const file of files) {
      const cached = noLinks(path.join(this.blobs, file.sha256));
      if (
        existsSync(cached) &&
        statSync(cached).size === file.bytes &&
        (await fileHash(cached, signal)) === file.sha256
      )
        continue;
      const partial = noLinks(cached + '.partial');
      const offset = existsSync(partial) ? Math.min(statSync(partial).size, file.bytes) : 0;
      downloadBytes += file.bytes - offset;
    }
    return {
      ...plan,
      downloadBytes,
      requiredBytes: downloadBytes + plan.totalBytes + reserveBytes,
      diskFreeBytes: await this.diskFree(this.folder),
      memoryEstimated: true,
      estimatedCpuRamGiB: Math.ceil((plan.totalBytes / 1024 ** 3) * 1.3 + 4),
      estimatedVramGiB: Math.ceil(plan.totalBytes / 1024 ** 3 + 2),
    };
  }

  list() {
    noLinks(this.packages);
    if (!existsSync(this.packages)) return [];
    return readdirSync(this.packages)
      .filter((id) => idPattern.test(id))
      .flatMap((id) => {
        try {
          return [this.receipt(id)];
        } catch {
          return [];
        }
      });
  }

  receipt(id) {
    if (!idPattern.test(id)) throw new Error('Invalid Hugging Face package ID.');
    const file = noLinks(path.join(this.packages, id, 'receipt.json'));
    if (statSync(file).size > 256 * 1024)
      throw new Error('Hugging Face receipt exceeds the size limit.');
    const receipt = validatePlan(JSON.parse(readFileSync(file, 'utf8')));
    if (receipt.id !== id) throw new Error('Hugging Face package identity changed.');
    for (const item of receipt.files) {
      const blob = noLinks(path.join(this.blobs, item.sha256));
      if (!statSync(blob).isFile() || statSync(blob).size !== item.bytes)
        throw new Error('Hugging Face package needs repair.');
    }
    if (
      receipt.profile &&
      (receipt.profile.id !== id ||
        receipt.profile.model !== `capri-${id}:latest` ||
        receipt.profile.alias !== receipt.profile.model)
    )
      throw new Error('Hugging Face imported model identity changed.');
    if (receipt.profile) validateImportedProfile(receipt.profile);
    return receipt;
  }

  async install(plan, { signal, onProgress = () => {} } = {}) {
    validatePlan(plan);
    const release = operationLock(this.folder);
    try {
      const needed = plan.files.reduce(
        (sum, file) => sum + (existsSync(path.join(this.blobs, file.sha256)) ? 0 : file.bytes),
        0,
      );
      if ((await this.diskFree(this.folder)) < needed + plan.totalBytes + reserveBytes)
        throw new Error('There is not enough free disk space for download and model import.');
      let completed = 0;
      for (const file of plan.files) {
        signal?.throwIfAborted();
        await downloadArtifact(
          {
            ...file,
            url: `https://huggingface.co/${plan.repository}/resolve/${plan.revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
          },
          this.blobs,
          {
            ...this.options(signal),
            diskFree: this.diskFree,
            onProgress: (progress) =>
              onProgress({
                ...progress,
                completed: completed + progress.completed,
                total: plan.totalBytes,
              }),
          },
        );
        checkGguf(path.join(this.blobs, file.sha256));
        completed += file.bytes;
      }
      signal?.throwIfAborted();
      const receipt = {
        schemaVersion: 1,
        task: 'llm',
        id: plan.id,
        repository: plan.repository,
        revision: plan.revision,
        files: plan.files,
        contextTokens: plan.contextTokens,
        totalBytes: plan.totalBytes,
        license: plan.license,
        languages: plan.languages,
        private: plan.private,
        installedAt: new Date().toISOString(),
      };
      const destination = noLinks(path.join(this.packages, plan.id, 'receipt.json'));
      if (existsSync(destination)) {
        try {
          receipt.profile = this.receipt(plan.id).profile;
        } catch {
          /* Repair replaces an invalid receipt. */
        }
      }
      writeJsonAtomic(destination, receipt);
      onProgress({ status: 'installed', completed, total: plan.totalBytes });
      return receipt;
    } finally {
      release();
    }
  }

  async localRequest(endpoint, { allowMissing = false, ...options } = {}) {
    let response;
    try {
      response = await this.fetchImpl(this.ollamaUrl + endpoint, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.any([
          ...(options.signal ? [options.signal] : []),
          AbortSignal.timeout(120000),
        ]),
      });
    } catch {
      options.signal?.throwIfAborted();
      throw new Error('The local model engine could not complete Hugging Face import.');
    }
    if (allowMissing && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Local model import failed (HTTP ${response.status}).`);
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 ** 2) throw new Error('Local model metadata exceeds the size limit.');
        chunks.push(value);
      }
    } catch {
      await reader.cancel().catch(() => {});
      throw new Error('Local model import response could not be read.');
    }
    try {
      const text = Buffer.concat(chunks).toString('utf8');
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error('Local model engine returned invalid metadata.');
    }
  }

  async importLanguageModel(id, { signal } = {}) {
    const release = operationLock(this.folder);
    let created = false,
      previousProfile = null;
    try {
      const receipt = this.receipt(id),
        alias = `capri-${id}:latest`,
        files = {};
      previousProfile = receipt.profile ?? null;
      for (const item of receipt.files) {
        const file = noLinks(path.join(this.blobs, item.sha256));
        if ((await fileHash(file, signal)) !== item.sha256)
          throw new Error('Hugging Face package checksum changed. Repair the model.');
        checkGguf(file);
        const stream = createReadStream(file);
        try {
          await this.localRequest('/api/blobs/sha256:' + item.sha256, {
            method: 'POST',
            body: stream,
            duplex: 'half',
            signal,
            headers: {
              'content-type': 'application/octet-stream',
              'content-length': String(item.bytes),
            },
          });
        } finally {
          stream.destroy();
        }
        files[item.path] = 'sha256:' + item.sha256;
      }
      const result = await this.localRequest('/api/create', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: alias, stream: false, files }),
      });
      if (result?.error) throw new Error('The local engine does not support this GGUF model.');
      created = true;
      const description = await this.localRequest('/api/show', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: alias }),
      });
      const info = description?.model_info ?? {},
        architecture = info['general.architecture'];
      const limit =
        typeof architecture === 'string' ? info[architecture + '.context_length'] : null;
      if (!Number.isInteger(limit) || limit < 8192 || !description.template?.trim())
        throw new Error(
          'The imported model needs a verified chat template and context of at least 8K.',
        );
      if (!description.capabilities?.includes('completion'))
        throw new Error('This model does not support text completion.');
      if (
        receipt.files.some((item) => modelKind(item.path) === 'projector') &&
        !description.capabilities.includes('vision')
      )
        throw new Error('The selected projector does not provide compatible vision support.');
      const contextLimit = Math.min(limit, 262144);
      const profile = {
        id,
        source: 'huggingface',
        family: receipt.repository,
        model: alias,
        alias,
        contextTokens: Math.min(receipt.contextTokens, contextLimit),
        contextLimit,
        cpuThreads: 4,
        capabilities: ['tools', 'vision', 'thinking'].filter((capability) =>
          description.capabilities.includes(capability),
        ),
        ramGiB: Math.ceil((receipt.totalBytes / 1024 ** 3) * 1.3 + 4),
        recommendedVramGiB: Math.ceil(receipt.totalBytes / 1024 ** 3 + 2),
        memoryEstimated: true,
        sizeBytes: receipt.totalBytes,
        experimental: true,
        description:
          'Imported Hugging Face model. Capability metadata is checked against the local engine; task quality requires evaluation.',
      };
      signal?.throwIfAborted();
      writeJsonAtomic(noLinks(path.join(this.packages, id, 'receipt.json')), {
        ...receipt,
        profile,
      });
      return profile;
    } catch (error) {
      if (created && !previousProfile) {
        await this.localRequest('/api/delete', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: `capri-${id}:latest` }),
        }).catch(() => {});
      }
      throw error;
    } finally {
      release();
    }
  }

  async remove(id, { signal, activeModel } = {}) {
    const release = operationLock(this.folder);
    try {
      const receipt = this.receipt(id);
      const referenced = new Set();
      for (const other of readdirSync(this.packages).filter(
        (entry) => idPattern.test(entry) && entry !== id,
      )) {
        let installed;
        try {
          installed = this.receipt(other);
        } catch {
          throw new Error('Repair other Hugging Face packages before removing shared model files.');
        }
        for (const file of installed.files) referenced.add(file.sha256);
      }
      if (receipt.profile) {
        if (activeModel === receipt.profile.model)
          throw new Error('Switch to another model before removing the active model.');
        const running = await this.localRequest('/api/ps', { signal });
        if (running?.models?.some((model) => (model.name ?? model.model) === receipt.profile.model))
          throw new Error('Unload this model before removing it.');
        await this.localRequest('/api/delete', {
          method: 'DELETE',
          allowMissing: true,
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: receipt.profile.model }),
        });
      }
      signal?.throwIfAborted();
      const directory = noLinks(path.join(this.packages, id));
      unlinkSync(noLinks(path.join(directory, 'receipt.json')));
      rmdirSync(directory);
      let freedBytes = 0;
      for (const item of receipt.files) {
        if (referenced.has(item.sha256)) continue;
        const file = noLinks(path.join(this.blobs, item.sha256));
        if (existsSync(file)) {
          freedBytes += statSync(file).size;
          unlinkSync(file);
        }
      }
      return { removed: id, freedBytes };
    } finally {
      release();
    }
  }
}
