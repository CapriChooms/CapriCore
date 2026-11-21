// SPDX-License-Identifier: GPL-3.0-only
import { applyChessArrowAppearance, renderChessArrow } from './chess-arrow.mjs';
import { ChessArrowConfigurator } from './chess-arrow-configurator.mjs';
import { ChessFrameConfigurator } from './chess-frame-configurator.mjs';
import { CHESS_REACTION_DEFAULTS, CHESS_REACTION_EVENTS } from './chess-reaction-settings.mjs';
const switches = {
  autoMove: { id: 'auto-move', error: 'Auto move setting could not be saved.' },
  moveLightning: { id: 'move-lightning', error: 'Lightning setting could not be saved.' },
  showArrow: { id: 'show-arrow', error: 'Chess settings could not be saved.' },
  boardFrame: { id: 'board-frame', error: 'Chess settings could not be saved.' },
};
const PIECES = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
  '': '·',
};
const FILES = 'abcdefgh';
const unpack = (value) =>
  [...value.replaceAll('/', '').replace(/[1-8]/g, (n) => ' '.repeat(Number(n)))].map((p) =>
    p.trim(),
  );
const pack = (cells) =>
  Array.from({ length: 8 }, (_, row) =>
    cells
      .slice(row * 8, row * 8 + 8)
      .map((p) => p || '1')
      .join('')
      .replace(/1{2,}/g, (run) => String(run.length)),
  ).join('/');

export class ChessPanel {
  constructor({ api, ui, host }) {
    Object.assign(this, { api, ui });
    this.panel = document.createElement('section');
    this.panel.id = 'chess-panel';
    this.panel.className = 'preferences-panel';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <div class="settings-heading"><h2>Chess</h2></div>
      <div class="preferences-content chess-settings">
        <div class="settings-card"><h3>Stockfish</h3>
          <p id="chess-engine-status" role="status"></p>
          <progress id="chess-progress" hidden></progress>
          <div class="settings-actions"><button id="chess-download" type="button" disabled>Download Stockfish</button>
          <button id="chess-cancel" type="button" hidden>Cancel download</button>
          <button id="chess-remove" type="button" hidden>Remove</button></div>
        </div>
        <div class="settings-card">
          <label class="general-toggle"><input id="chess-auto-move" type="checkbox" role="switch" aria-describedby="chess-auto-move-help"><span>Auto move</span><span class="general-switch-track" aria-hidden="true"></span></label>
          <p id="chess-auto-move-help" class="settings-help">Play Stockfish’s best move on the Chess.com board when it’s your turn against a bot.</p>
          <label class="general-toggle"><input id="chess-move-lightning" type="checkbox" role="switch"><span>Auto-move lightning</span><span class="general-switch-track" aria-hidden="true"></span></label>
        </div>
        <div class="settings-card">
          <label class="general-toggle"><input id="chess-show-arrow" type="checkbox" role="switch"><span>Show move arrow</span><span class="general-switch-track" aria-hidden="true"></span></label>
          <label class="general-toggle"><input id="chess-board-frame" type="checkbox" role="switch"><span>Show chessboard outline</span><span class="general-switch-track" aria-hidden="true"></span></label>
        </div>
        <div class="settings-card chess-reactions"><h3>Capri’s game reactions</h3>
          <label class="general-toggle"><input id="chess-reactions" type="checkbox" role="switch"><span>React to game events</span><span class="general-switch-track" aria-hidden="true"></span></label>
          <fieldset id="chess-reaction-options">
            <label class="general-toggle"><input id="chess-reactions-spoken" type="checkbox" role="switch"><span>Speak game reactions</span><span class="general-switch-track" aria-hidden="true"></span></label>
            <div class="chess-reaction-events" role="group" aria-label="Game events">
              ${Object.entries(CHESS_REACTION_EVENTS)
                .map(
                  ([type, label]) =>
                    `<label class="dimming-switch"><input id="chess-reaction-${type}" type="checkbox"> ${label}</label>`,
                )
                .join('')}
            </div>
          </fieldset>
          <p id="chess-reactions-status" class="settings-help" role="status"></p>
        </div>
        <details id="chess-arrow-editor" class="settings-disclosure chess-arrow-editor"></details>
        <details id="chess-frame-editor" class="settings-disclosure chess-arrow-editor"></details>
        <div class="settings-card">
        <label for="chess-display">Source</label><select id="chess-display"></select>
        <div class="settings-actions"><button id="chess-select" type="button">Select chessboard</button>
        <button id="chess-detect" type="button">Find chessboard</button></div>
        <label id="chess-candidate-label" for="chess-candidate" hidden>Detected chessboards</label><select id="chess-candidate" hidden></select>
        </div>
        <div class="settings-card">
        <label for="chess-input">FEN / PGN</label><textarea id="chess-input" rows="3" maxlength="64000" spellcheck="false"></textarea>
        <div class="settings-actions"><button id="chess-import" type="button">Import position</button>
        <button id="chess-stop" type="button">Stop</button></div>
        </div>
        <div id="chess-position" class="settings-card" hidden>
          <div id="chess-replay" hidden><label for="chess-ply">Move</label>
            <input id="chess-ply" type="range" min="0" step="1"><output id="chess-ply-count"></output></div>
          <div class="settings-actions"><button id="chess-flip" type="button">Flip board</button></div>
          <div class="chess-board-frame">
            <div id="chess-board" aria-label="Chess"></div>
            <svg id="chess-board-arrow" viewBox="0 0 8 8" aria-hidden="true" hidden></svg>
          </div>
          <details id="chess-preview" class="settings-disclosure" hidden><summary>Preview</summary><img id="chess-preview-image" alt="" /></details>
          <label id="chess-piece-editor" hidden><span id="chess-cell-name" data-untranslated></span><select id="chess-piece"></select></label>
          <label for="chess-turn">Side to move</label><select id="chess-turn"><option value="">Choose…</option><option value="w">White</option><option value="b">Black</option></select>
          <div class="settings-actions"><button id="chess-analyse" type="button">Analyze position</button>
          <button id="chess-deep" type="button">Analyze deeper</button>
          <button id="chess-explain" type="button" hidden>Ask Capri about this move</button></div>
          <p id="chess-overlay-help" class="settings-help" hidden>Arrows appear automatically on supported analysis boards and in games against the site’s computer.</p>
          <pre id="chess-result" hidden></pre>
        </div>
        <p id="chess-status" role="status"></p>
      </div>`;
    host.append(this.panel);
    this.$ = (id) => this.panel.querySelector('#chess-' + id);
    const on = (id, method) => {
      this.$(id).onclick = () => this.run(method);
    };
    on('download', async () => this.showEngine(await api('install')));
    this.$('cancel').onclick = () => void api('cancel').catch(() => {});
    this.$('stop').onclick = () => {
      this.invalidate();
      void api('stop').catch(() => {});
    };
    on('remove', async () => {
      this.invalidate();
      this.showEngine(await api('remove'));
    });
    on('select', async () => this.scan(true));
    on('detect', async () => this.scan(false));
    on('import', async () => this.load(this.$('input').value));
    on('analyse', async () => this.analyse(false));
    on('deep', async () => this.analyse(true));
    for (const [name, { id }] of Object.entries(switches))
      this.$(id).onchange = () => this.saveSwitch(name);
    this.$('reactions').onchange = () => this.saveReactions();
    this.$('reaction-options').onchange = () => this.saveReactions();
    this.arrowEditor = new ChessArrowConfigurator({
      root: this.$('arrow-editor'),
      ui,
      onPreview: (value) => applyChessArrowAppearance(this.$('board-arrow'), value),
      onChange: (value) => this.saveArrowAppearance(value),
    });
    this.frameEditor = new ChessFrameConfigurator({
      root: this.$('frame-editor'),
      ui,
      onChange: (value) => this.saveFrameAppearance(value),
    });
    on('explain', async () => this.api('explain', { fen: this.resultFen }));
    this.$('candidate').onchange = () =>
      this.run(() => this.selectAndAnalyse(Number(this.$('candidate').value)));
    this.$('flip').onclick = () => {
      this.orientation = this.orientation === 'black' ? 'white' : 'black';
      if (this.index !== null) {
        this.cells.reverse();
        this.doubts.reverse();
      }
      this.invalidate();
      this.renderBoard();
    };
    this.$('ply').onchange = () =>
      this.run(() => this.load(this.imported, Number(this.$('ply').value)));
    this.$('turn').onchange = () => this.invalidate();
    this.$('input').oninput = () => this.invalidate();
    this.$('display').onchange = () => {
      void this.api('stop').catch(() => {});
      this.index = null;
      this.$('select').disabled = this.$('display').value.startsWith('window:');
      this.$('candidate').hidden =
        this.$('candidate-label').hidden =
        this.$('overlay-help').hidden =
          true;
      this.$('position').hidden = true;
      this.preview(null);
      this.invalidate();
    };
    for (const [piece, symbol] of Object.entries(PIECES)) {
      const option = document.createElement('option');
      option.value = piece;
      option.textContent = piece ? `${symbol} ${piece}` : symbol;
      this.$('piece').append(option);
    }
    this.$('piece').onchange = () => {
      this.cells[this.editing] = this.$('piece').value;
      this.doubts[this.editing] = false;
      this.changed = true;
      this.invalidate();
      this.renderBoard();
    };
    this.index = null;
    this.generation = 0;
    this.switchRevisions = { autoMove: 0, moveLightning: 0, showArrow: 0, boardFrame: 0 };
    this.frameRevision = 0;
    this.frameStyle = this.frameEditor.style;
    this.switchWrites = {};
    this.reactionRevision = 0;
    this.arrowRevision = 0;
    this.setArrowAppearance();
    this.setSwitch('autoMove', false);
    this.setSwitch('moveLightning', true);
    this.setSwitch('showArrow', true);
    this.setSwitch('boardFrame', false);
    this.setReactions();
    window.addEventListener('pagehide', () => this.preview(null), { once: true });
  }

  async open() {
    await this.run(
      async () => {
        const previous = this.$('display').value;
        const switchRevisions = { ...this.switchRevisions };
        const arrowRevision = this.arrowRevision;
        const frameRevision = this.frameRevision;
        const reactionRevision = this.reactionRevision;
        const state = await this.api('status');
        this.$('display').replaceChildren(
          ...state.displays.map(({ id, label, width, height }) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = width
              ? `${label || this.ui.text('Display')} · ${width} × ${height}`
              : label;
            return option;
          }),
        );
        if (state.displays.some(({ id }) => id === previous)) this.$('display').value = previous;
        this.$('select').disabled = this.$('display').value.startsWith('window:');
        this.showEngine(state.engine);
        for (const name of Object.keys(switches)) {
          if (switchRevisions[name] === this.switchRevisions[name] && !this.switchWrites[name])
            this.setSwitch(name, state[name]);
        }
        if (arrowRevision === this.arrowRevision && !this.arrowWrite)
          this.setArrowAppearance(state.arrow);
        if (frameRevision === this.frameRevision && !this.frameWrite) {
          this.frameEditor.set(state.frameStyle);
          this.frameStyle = this.frameEditor.style;
        }
        if (reactionRevision === this.reactionRevision && !this.reactionWrite)
          this.setReactions(state.reactions);
      },
      { clearMessage: false },
    );
  }

  async run(method, { clearMessage = true } = {}) {
    if (this.busy) return;
    this.busy = true;
    this.$('ply').disabled = true;
    this.$('candidate').disabled = true;
    this.panel.setAttribute('aria-busy', 'true');
    if (clearMessage) this.message('');
    try {
      await method();
    } catch (error) {
      if (this.previewAnalysis) this.invalidate();
      this.message(
        error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''),
      );
    } finally {
      this.busy = false;
      this.$('ply').disabled = false;
      this.$('candidate').disabled = false;
      this.panel.removeAttribute('aria-busy');
    }
  }

  message(value, params) {
    this.$('status').textContent = value ? this.ui.text(value, params) : '';
  }

  recordDecision(reason) {
    void this.api('ui-diagnostic', { reason, boardIndex: this.index }).catch(() => {});
  }

  setArrowAppearance(value) {
    this.arrowEditor.setAppearance(value);
    this.arrow = this.arrowEditor.style;
  }

  saveArrowAppearance(value) {
    const revision = ++this.arrowRevision;
    this.arrowWrite = (this.arrowWrite ?? Promise.resolve())
      .then(() => this.api('arrow-appearance', value))
      .then((saved) => {
        this.arrow = saved;
      })
      .catch(() => {
        if (revision === this.arrowRevision) {
          if (this.arrowEditor.style === value) this.setArrowAppearance(this.arrow);
          this.arrowEditor.message('Arrow appearance could not be saved.');
        }
      })
      .finally(() => {
        if (revision === this.arrowRevision) this.arrowWrite = null;
      });
  }

  setSwitch(name, value) {
    this[name] = value === true;
    this.$(switches[name].id).checked = this[name];
    if (name === 'showArrow')
      renderChessArrow(this.$('board-arrow'), (this.showArrow && this.previewMove) || undefined);
  }

  saveFrameAppearance(value) {
    const revision = ++this.frameRevision;
    this.frameEditor.message('');
    this.frameWrite = (this.frameWrite ?? Promise.resolve())
      .then(() => this.api('frame-appearance', value))
      .then((saved) => {
        this.frameStyle = saved;
      })
      .catch(() => {
        if (revision !== this.frameRevision) return;
        this.frameEditor.set(this.frameStyle);
        this.frameEditor.message('Chess settings could not be saved.');
      })
      .finally(() => {
        if (revision === this.frameRevision) this.frameWrite = null;
      });
  }

  saveSwitch(name) {
    const { id, error } = switches[name];
    const input = this.$(id);
    this.switchRevisions[name]++;
    input.disabled = true;
    this.switchWrites[name] = this.api(id, input.checked)
      .then((saved) => this.setSwitch(name, saved))
      .catch(() => {
        this.setSwitch(name, this[name]);
        this.message(error);
      })
      .finally(() => {
        this.switchWrites[name] = null;
        input.disabled = false;
      });
  }

  setReactions(value = CHESS_REACTION_DEFAULTS) {
    this.reactions = value;
    this.$('reactions').checked = value.enabled;
    this.$('reactions-spoken').checked = value.spoken;
    for (const [type, checked] of Object.entries(value.events))
      this.$(`reaction-${type}`).checked = checked;
    this.$('reaction-options').disabled = !value.enabled;
  }

  saveReactions() {
    if (this.reactionWrite) return;
    this.reactionRevision++;
    const input = this.$('reactions');
    const value = {
      enabled: input.checked,
      spoken: this.$('reactions-spoken').checked,
      events: Object.fromEntries(
        Object.keys(CHESS_REACTION_EVENTS).map((type) => [
          type,
          this.$(`reaction-${type}`).checked,
        ]),
      ),
    };
    this.$('reactions-status').textContent = '';
    input.disabled = this.$('reaction-options').disabled = true;
    this.reactionWrite = this.api('reactions', value)
      .then((saved) => this.setReactions(saved))
      .catch(() => {
        this.setReactions(this.reactions);
        this.$('reactions-status').textContent = this.ui.text(
          'Game reaction settings could not be saved.',
        );
      })
      .finally(() => {
        this.reactionWrite = null;
        input.disabled = false;
      });
  }

  showEngine(value) {
    const loading = ['downloading', 'checking'].includes(value.phase);
    this.engineInstalled = value.installed;
    const number = new Intl.NumberFormat(this.ui.language, { maximumFractionDigits: 1 });
    this.$('engine-status').textContent = loading
      ? `${number.format(value.received / 1048576)} / ${number.format(value.total / 1048576)} MiB · ${Math.floor((value.received * 100) / value.total)}%`
      : value.installed
        ? `Stockfish ${value.version} · ${this.ui.text('Installed')}`
        : this.ui.text('Install Stockfish first');
    this.$('download').hidden = value.installed;
    this.$('download').disabled = !value.supported || loading || value.installed;
    this.$('remove').hidden = !value.installed || loading;
    this.$('cancel').hidden = !loading;
    this.$('progress').hidden = !loading;
    this.$('progress').max = value.total || 1;
    this.$('progress').value = value.received;
  }

  async scan(manual) {
    this.invalidate();
    const generation = this.generation;
    this.index = null;
    this.items = [];
    this.current = this.imported = null;
    this.$('position').hidden =
      this.$('candidate').hidden =
      this.$('candidate-label').hidden =
        true;
    this.preview(null);
    this.message(manual ? 'Select chessboard' : 'Finding chessboard…');
    const result = await this.api('scan', { id: this.$('display').value, manual });
    if (generation !== this.generation) return;
    this.items = result.items;
    this.$('candidate').replaceChildren(
      ...this.items.map(({ rect }, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${index + 1} · ${rect.width} × ${rect.height} (${rect.x}, ${rect.y})`;
        return option;
      }),
    );
    this.$('candidate').hidden = this.$('candidate-label').hidden = this.items.length < 2;
    if (!this.items.length) {
      this.message('No chessboard found');
      return;
    }
    const index = Math.max(
      0,
      this.items.findIndex((item) => item.watchable),
    );
    this.$('candidate').value = String(index);
    await this.selectAndAnalyse(index);
  }

  async selectAndAnalyse(index) {
    const item = this.select(index);
    if (!item) return;
    if (!this.engineInstalled) {
      this.recordDecision('stockfish_missing');
      this.message('Install Stockfish first');
    } else if (item.fen) {
      await this.analyse(false);
    } else if (item.canWait) {
      this.recordDecision('awaiting_turn');
      this.message('Waiting for a move to identify whose turn it is');
      await this.startTracking({ index, orientation: this.orientation, waiting: true });
    } else {
      this.message(item.reliable ? 'Confirm the side to move' : 'Check the highlighted squares');
    }
  }

  select(index) {
    const item = this.items[index];
    if (!item) return;
    this.index = index;
    this.orientation = item.orientation;
    this.cells = unpack(item.placement);
    this.doubts = [...item.confidence.slice(0, 64)];
    this.doubts = Array.from({ length: 8 }, (_, row) =>
      this.doubts.slice((7 - row) * 8, (8 - row) * 8),
    )
      .flat()
      .map((score) => score < 0.85);
    if (this.orientation === 'black') {
      this.cells.reverse();
      this.doubts.reverse();
    }
    this.current = null;
    this.imported = null;
    this.changed = false;
    this.$('replay').hidden = true;
    this.$('piece-editor').hidden = true;
    this.$('turn').value = item.fen?.split(' ')[1] ?? '';
    this.$('overlay-help').hidden = false;
    this.preview(item.preview);
    this.invalidate();
    this.renderBoard();
    return item;
  }

  async load(text, ply) {
    if (this.trackingIndex !== null) await this.api('stop');
    const value = await this.api('import', { text, ply });
    const [board, turn] = value.fen.split(' ');
    this.orientation ??= 'white';
    this.cells = unpack(board);
    this.doubts = [];
    this.current = value;
    this.imported = text;
    this.index = null;
    this.changed = false;
    this.$('turn').value = turn;
    this.$('overlay-help').hidden = true;
    this.$('candidate').hidden = this.$('candidate-label').hidden = true;
    this.$('replay').hidden = !value.count;
    this.$('ply').max = value.count;
    this.$('ply').value = value.ply ?? 0;
    this.$('ply-count').value = `${value.ply ?? 0} / ${value.count}`;
    this.preview(null);
    this.invalidate();
    this.renderBoard();
  }

  preview(bytes) {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = bytes ? URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) : null;
    this.$('preview').hidden = !this.previewUrl;
    if (this.previewUrl) this.$('preview-image').src = this.previewUrl;
    else this.$('preview-image').removeAttribute('src');
  }

  invalidate() {
    this.generation++;
    this.trackingIndex = null;
    this.trackingFen = null;
    this.previewAnalysis = null;
    this.previewMove = null;
    this.resultFen = null;
    this.$('result').hidden = this.$('explain').hidden = true;
    renderChessArrow(this.$('board-arrow'));
  }

  async startTracking(board) {
    this.trackingIndex = board.index;
    await this.api('watch', board);
  }

  updateTracking({ index, result, fen, orientation, lost, provisional = false, analysisId }) {
    if (analysisId !== undefined) {
      if (this.previewAnalysis?.id === analysisId && provisional && result)
        this.showResult(result, this.previewAnalysis.drawBoardArrow, true);
      return;
    }
    if (index !== this.trackingIndex || index !== this.index) return;
    if (lost) {
      this.trackingIndex = null;
      if (this.$('result').hasAttribute('data-provisional')) this.invalidate();
      this.message('The chess source changed');
      return;
    }
    if (!result || !fen) return;
    if (this.trackingFen !== fen || (orientation && orientation !== this.orientation)) {
      const [position, side] = fen.split(' ');
      this.trackingFen = fen;
      this.orientation = orientation ?? this.orientation;
      this.cells = unpack(position);
      this.doubts = [];
      const item = this.items[index];
      item.fen = fen;
      item.orientation = this.orientation;
      item.placement = this.orientation === 'white' ? position : pack([...this.cells].reverse());
      item.confidence = Array(64).fill(1);
      this.changed = false;
      this.$('piece-editor').hidden = true;
      this.$('turn').value = side;
      this.renderBoard();
    }
    this.showResult(result, false, provisional);
    if (provisional) return;
    this.resultFen = fen;
    this.$('explain').hidden = !result.bestMove;
    this.message('');
  }

  async analyse(deep) {
    this.invalidate();
    const generation = this.generation;
    await this.switchWrites.autoMove;
    if (generation !== this.generation) return;
    const item = this.items?.[this.index];
    const screenBoard =
      this.index === null
        ? null
        : {
            index: this.index,
            orientation: this.orientation,
            corrected: this.changed,
          };
    const side = this.$('turn').value;
    if (!side) throw new Error('Confirm the side to move');
    const useScreenPosition =
      item?.fen &&
      !this.changed &&
      item.orientation === this.orientation &&
      side === item.fen.split(' ')[1];
    const keepHistory = this.current && !this.changed && side === this.current.fen.split(' ')[1];
    const text = keepHistory
      ? this.imported
      : `${pack(this.cells)} ${side} ${this.changed ? '- - 0 1' : (this.current?.fen.split(' ').slice(2).join(' ') ?? '- - 0 1')}`;
    if (screenBoard && item?.watchable) {
      await this.startTracking({
        ...screenBoard,
        analyse: true,
        deep,
        text: useScreenPosition ? undefined : text,
      });
      return;
    }
    this.previewAnalysis = { id: generation, drawBoardArrow: !screenBoard };
    const value = await this.api('analyse', {
      ...(useScreenPosition ? { index: this.index } : { text }),
      ply: keepHistory ? this.current.ply : undefined,
      deep,
      analysisId: generation,
    });
    if (generation !== this.generation) return;
    this.previewAnalysis = null;
    this.resultFen = value.fen;
    this.showResult(value.result, !screenBoard);
    this.$('explain').hidden = !value.result.bestMove;
    if (screenBoard && !item?.watchable) {
      this.recordDecision('tracking_unavailable');
      this.message('Live analysis is unavailable for this board.');
    }
  }

  renderBoard() {
    this.$('position').hidden = false;
    const board = this.$('board');
    const order = Array.from({ length: 64 }, (_, i) => (this.orientation === 'black' ? 63 - i : i));
    board.replaceChildren(
      ...order.map((i) => {
        const square = FILES[i % 8] + (8 - Math.floor(i / 8));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-visual-control';
        button.textContent = PIECES[this.cells[i]] ?? '·';
        button.dataset.square = square;
        button.classList.toggle('chess-dark', ((i % 8) + Math.floor(i / 8)) % 2 === 1);
        button.classList.toggle('chess-doubtful', this.doubts[i] === true);
        button.setAttribute('aria-label', `${square} ${this.cells[i] || PIECES['']}`);
        button.onclick = () => {
          this.editing = i;
          this.$('cell-name').textContent = square;
          this.$('piece-editor').hidden = false;
          this.$('piece').value = this.cells[i];
          this.$('piece').focus();
        };
        return button;
      }),
    );
  }

  showResult(result, drawBoardArrow, provisional = false) {
    const { bestMove, lines } = result;
    const status = this.$('result');
    status.toggleAttribute('data-provisional', provisional);
    status.hidden = false;
    this.previewMove =
      drawBoardArrow && bestMove ? { uci: bestMove.uci, orientation: this.orientation } : null;
    if (!bestMove) {
      status.textContent = this.ui.text('No legal continuation');
      renderChessArrow(this.$('board-arrow'));
      return;
    }
    const move = document.createElement('span');
    move.toggleAttribute('data-untranslated', true);
    move.textContent = bestMove.san;
    status.replaceChildren(move);
    if (provisional) status.append(' · ', this.ui.text('Analyzing…'));
    if (lines.length) {
      const variations = document.createElement('span');
      variations.toggleAttribute('data-untranslated', true);
      variations.textContent =
        '\n' +
        lines
          .map(({ moves, score, depth }) => {
            const number =
              score.type === 'mate' ? `#${score.value}` : (score.value / 100).toFixed(2);
            const bound =
              score.bound === 'upperbound' ? '≤' : score.bound === 'lowerbound' ? '≥' : '';
            return `${bound}${number} · d${depth}   ${moves.map(({ san }) => san).join(' ')}`;
          })
          .join('\n');
      status.append(variations);
    }
    renderChessArrow(this.$('board-arrow'), (this.showArrow && this.previewMove) || undefined);
  }
}
