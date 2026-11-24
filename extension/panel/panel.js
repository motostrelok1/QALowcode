// QA Recorder — Side Panel (этап 1: минимальный список шагов + карточка кандидатов)
// Полноценный UI — этап 2; здесь цель: видеть, что пишет content script.

const $ = (sel) => document.querySelector(sel);

let steps = [];
let recording = false;
let selectedId = null;

// ---------- рендер ----------

function renderList() {
  const ul = $('#step-list');
  ul.innerHTML = '';
  $('#counter').textContent = String(steps.length);
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.dataset.id = s.step_id;
    if (s.step_id === selectedId) li.classList.add('selected');
    li.innerHTML = `<span class="num">${i + 1}</span><span class="lbl"></span>`;
    li.querySelector('.lbl').textContent = s.human_label || s.action;
    li.title = s.human_label || '';
    li.addEventListener('click', () => {
      selectedId = s.step_id;
      renderList();
      renderCard(s);
    });
    ul.appendChild(li);
  });
}

function candidateText(c) {
  if (c.kind === 'text' || c.kind === 'role_text') {
    return `${c.kind}${c.role ? `[${c.role}]` : ''}: "${c.text_norm}"`;
  }
  return c.selector;
}

function renderCard(s) {
  $('#step-card').classList.remove('hidden');
  $('#card-label').textContent = s.human_label || '';
  $('#card-action').textContent = s.action;
  $('#card-resolution').textContent = s.resolution;

  const wr = $('#card-within-row');
  if (s.within) {
    wr.style.display = '';
    $('#card-within').textContent = s.within.description || s.within.container_selector;
  } else {
    wr.style.display = 'none';
  }

  const ul = $('#candidate-list');
  ul.innerHTML = '';
  for (const c of s.candidates) {
    const li = document.createElement('li');
    li.className = c.rejected ? 'rejected' : c.unique ? 'unique' : 'not-unique';
    const matches = c.rejected ? c.rejected : c.unique ? '1' : String(c.matches);
    li.innerHTML = `<span class="prio">P${c.priority}</span><span class="txt"></span><span class="matches"></span>`;
    li.querySelector('.txt').textContent = candidateText(c);
    li.querySelector('.matches').textContent = matches;
    ul.appendChild(li);
  }

  $('#inp-timeout').value = s.timing.wait_timeout_ms;
  $('#inp-delay').value = s.timing.post_action_delay_ms;
  $('#inp-timeout').onchange = (e) => { s.timing.wait_timeout_ms = Number(e.target.value); };
  $('#inp-delay').onchange = (e) => { s.timing.post_action_delay_ms = Number(e.target.value); };
}

function renderRecordBtn() {
  const b = $('#btn-record');
  b.textContent = recording ? '■ Стоп' : '● Запись';
  b.classList.toggle('recording', recording);
  b.classList.toggle('primary', !recording);
}

// ---------- сообщения ----------

function send(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => null);
}

$('#btn-record').addEventListener('click', async () => {
  const resp = await send({ type: 'qa:panel-set-recording', recording: !recording });
  if (resp && resp.ok) {
    recording = resp.recording;
    renderRecordBtn();
  }
});

$('#btn-clear').addEventListener('click', async () => {
  await send({ type: 'qa:panel-clear-steps' });
  steps = [];
  selectedId = null;
  $('#step-card').classList.add('hidden');
  renderList();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'qa:panel-step-added') {
    steps.push(msg.step);
    renderList();
    const ul = $('#step-list');
    ul.scrollTop = ul.scrollHeight;
  }
});

// ---------- init ----------

(async () => {
  const st = await send({ type: 'qa:panel-get-state' });
  if (st) {
    steps = st.steps || [];
    recording = !!st.recording;
  }
  renderList();
  renderRecordBtn();
})();
