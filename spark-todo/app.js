let tasks = JSON.parse(localStorage.getItem('spark-tasks') || '[]');
let filter = 'all';

const taskInput = document.getElementById('taskInput');
const addBtn = document.getElementById('addBtn');
const taskList = document.getElementById('taskList');
const statsText = document.getElementById('statsText');
const clearDoneBtn = document.getElementById('clearDoneBtn');
const filterBtns = document.querySelectorAll('.filter-btn');

function save() {
  localStorage.setItem('spark-tasks', JSON.stringify(tasks));
}

function render() {
  const visible = tasks.filter(t => {
    if (filter === 'active') return !t.done;
    if (filter === 'done') return t.done;
    return true;
  });

  taskList.innerHTML = '';

  if (visible.length === 0) {
    taskList.innerHTML = '<li class="empty-state">タスクがありません</li>';
  } else {
    visible.forEach(task => {
      const li = document.createElement('li');
      li.className = 'task-item' + (task.done ? ' done' : '');
      li.dataset.id = task.id;
      li.innerHTML = `
        <button class="task-check" aria-label="完了にする">
          <svg viewBox="0 0 12 10"><polyline points="1,5 4.5,9 11,1"/></svg>
        </button>
        <span class="task-text">${escapeHtml(task.text)}</span>
        <button class="delete-btn" aria-label="削除">✕</button>
      `;
      li.querySelector('.task-check').addEventListener('click', () => toggleTask(task.id));
      li.querySelector('.delete-btn').addEventListener('click', () => deleteTask(task.id));
      taskList.appendChild(li);
    });
  }

  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  statsText.textContent = total === 0
    ? 'タスクはまだありません'
    : `${done} / ${total} 件完了`;
}

function addTask() {
  const text = taskInput.value.trim();
  if (!text) return;
  tasks.unshift({ id: Date.now(), text, done: false });
  taskInput.value = '';
  save();
  render();
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (task) { task.done = !task.done; save(); render(); }
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  save();
  render();
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

addBtn.addEventListener('click', addTask);
taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

clearDoneBtn.addEventListener('click', () => {
  tasks = tasks.filter(t => !t.done);
  save();
  render();
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    render();
  });
});

render();
